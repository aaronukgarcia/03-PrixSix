// GUID: API_EMAIL_QUEUE-000-v03
// [Intent] API route that manages the email queue — supports fetching queued/failed emails (GET), sending or re-queuing emails with retry logic (POST), and deleting queued emails (DELETE). Central to the email delivery reliability system.
// [Inbound Trigger] GET/POST/DELETE requests from the admin email queue management UI.
// [Downstream Impact] Reads/writes email_queue and email_daily_stats collections. Sends emails via sendEmail (email lib). Failed emails are retried up to MAX_RETRY_ATTEMPTS times before being marked permanently failed.

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_EMAIL_QUEUE-001-v03
// [Intent] Retry configuration constants — limits retry attempts to 3 and spaces retries 5 minutes apart to avoid hammering the Graph API during transient failures.
// [Inbound Trigger] Referenced by handleEmailFailure when deciding whether to schedule a retry or mark as permanently failed.
// [Downstream Impact] Changing MAX_RETRY_ATTEMPTS affects how many times a failed email is retried before giving up. Changing RETRY_DELAY_MINUTES affects the delay between retry attempts.
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 5;

// GUID: API_EMAIL_QUEUE-002-v03
// [Intent] Type definition for a queued email document — represents an email in the email_queue Firestore collection with its delivery status, retry metadata, and content.
// [Inbound Trigger] Used to type documents retrieved from the email_queue collection across GET, POST, and DELETE handlers.
// [Downstream Impact] Changing this shape affects the admin email queue UI that displays queued emails and all handler logic that processes queue documents.
interface QueuedEmail {
  id: string;
  toEmail: string;
  subject: string;
  htmlContent: string;
  type: string;
  teamName?: string;
  status: 'pending' | 'sent' | 'failed';
  reason: string;
  retryCount?: number;
  nextRetryAt?: FirebaseFirestore.Timestamp | null;
  lastError?: string;
}

// GUID: API_EMAIL_QUEUE-003-v03
// [Intent] GET handler — fetches queued emails from Firestore. In admin mode (includeAll=true), returns up to 100 emails regardless of status. In normal mode, returns only pending emails whose nextRetryAt has passed (ready to process).
// [Inbound Trigger] HTTP GET, optionally with ?includeAll=true query parameter for admin view.
// [Downstream Impact] Returns email queue data to the admin UI. The filtering logic determines which emails appear as processable. Errors are console-logged (note: does not use logError — potential Golden Rule #1 gap).
export async function GET(request: NextRequest) {
  try {
    const { db, Timestamp } = await getFirebaseAdmin();
    const { searchParams } = new URL(request.url);
    const includeAll = searchParams.get('includeAll') === 'true';
    const now = Timestamp.now();

    let queuedEmails: QueuedEmail[] = [];

    if (includeAll) {
      // Admin view: return all emails (pending + failed)
      const snapshot = await db.collection('email_queue')
        .orderBy('queuedAt', 'desc')
        .limit(100)
        .get();
      queuedEmails = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as QueuedEmail));
    } else {
      // Normal view: only pending emails ready to process
      const pendingSnapshot = await db.collection('email_queue')
        .where('status', '==', 'pending')
        .orderBy('queuedAt', 'desc')
        .get();

      // Filter to only include emails ready for retry (no nextRetryAt or nextRetryAt <= now)
      queuedEmails = pendingSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as QueuedEmail))
        .filter(email => {
          if (!email.nextRetryAt) return true;
          const retryTime = email.nextRetryAt as FirebaseFirestore.Timestamp;
          return retryTime.toMillis() <= now.toMillis();
        });
    }

    return NextResponse.json({ success: true, emails: queuedEmails });
  } catch (error: any) {
    console.error('Error fetching email queue:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GUID: API_EMAIL_QUEUE-004-v03
// [Intent] POST handler — processes email queue actions. "resend" action re-queues failed emails by resetting their retry count and status to pending. "push" action sends pending emails via Graph API, recording successes in email_daily_stats and handling failures with exponential retry logic via handleEmailFailure.
// [Inbound Trigger] HTTP POST with JSON body containing action ("push" or "resend") and optional emailIds array.
// [Downstream Impact] "push" sends emails via sendEmail, updates email_queue documents to sent/failed, and records successful sends in email_daily_stats. "resend" resets failed emails to pending. Errors are console-logged (note: does not use logError — potential Golden Rule #1 gap).
export async function POST(request: NextRequest) {
  try {
    const { action, emailIds } = await request.json();
    const { db, FieldValue, Timestamp } = await getFirebaseAdmin();

    // Action: resend - Re-queue failed emails for another round of attempts
    if (action === 'resend') {
      if (!emailIds || emailIds.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No email IDs provided for resend' },
          { status: 400 }
        );
      }

      let resendCount = 0;
      for (const id of emailIds) {
        const doc = await db.collection('email_queue').doc(id).get();
        if (doc.exists && doc.data()?.status === 'failed') {
          await db.collection('email_queue').doc(id).update({
            status: 'pending',
            retryCount: 0,
            nextRetryAt: null,
            lastError: null,
            requeuedAt: FieldValue.serverTimestamp(),
          });
          resendCount++;
        }
      }

      return NextResponse.json({
        success: true,
        message: `Re-queued ${resendCount} email(s) for sending`,
        resendCount,
      });
    }

    // Action: push - Send queued emails
    if (action === 'push') {
      const now = Timestamp.now();

      // If emailIds provided, push those specific emails; otherwise push all pending ready for retry
      let emailsToProcess: QueuedEmail[] = [];

      if (emailIds && emailIds.length > 0) {
        // Get specific emails by ID
        for (const id of emailIds) {
          const doc = await db.collection('email_queue').doc(id).get();
          if (doc.exists && doc.data()?.status === 'pending') {
            emailsToProcess.push({ id: doc.id, ...doc.data() } as QueuedEmail);
          }
        }
      } else {
        // Get all pending emails
        const snapshot = await db.collection('email_queue')
          .where('status', '==', 'pending')
          .get();

        // Filter to only include emails ready for processing
        emailsToProcess = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as QueuedEmail))
          .filter(email => {
            if (!email.nextRetryAt) return true;
            const retryTime = email.nextRetryAt as FirebaseFirestore.Timestamp;
            return retryTime.toMillis() <= now.toMillis();
          });
      }

      const results: { id: string; success: boolean; error?: string; retryScheduled?: boolean }[] = [];

      for (const email of emailsToProcess) {
        const currentRetryCount = email.retryCount || 0;

        try {
          const emailResult = await sendEmail({
            toEmail: email.toEmail,
            subject: email.subject,
            htmlContent: email.htmlContent,
          });

          if (emailResult.success) {
            // Update the queue document to 'sent'
            await db.collection('email_queue').doc(email.id).update({
              status: 'sent',
              processedAt: FieldValue.serverTimestamp(),
              emailGuid: emailResult.emailGuid,
              retryCount: currentRetryCount,
            });

            // Record in email daily stats
            const today = new Date().toISOString().split('T')[0];
            const statsRef = db.collection('email_daily_stats').doc(today);
            await statsRef.set({
              totalSent: FieldValue.increment(1),
              emailsSent: FieldValue.arrayUnion({
                toEmail: email.toEmail,
                subject: email.subject,
                type: email.type,
                teamName: email.teamName,
                emailGuid: emailResult.emailGuid,
                sentAt: new Date().toISOString(),
                status: 'sent',
                attempts: currentRetryCount + 1,
              }),
            }, { merge: true });

            results.push({ id: email.id, success: true });
          } else {
            // Handle failure with retry logic
            const result = await handleEmailFailure(
              db, FieldValue, Timestamp,
              email.id, currentRetryCount, emailResult.error || 'Unknown error'
            );
            results.push({ id: email.id, success: false, error: emailResult.error, retryScheduled: result.retryScheduled });
          }
        } catch (error: any) {
          // Handle exception with retry logic
          const result = await handleEmailFailure(
            db, FieldValue, Timestamp,
            email.id, currentRetryCount, error.message
          );
          results.push({ id: email.id, success: false, error: error.message, retryScheduled: result.retryScheduled });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const retriedCount = results.filter(r => r.retryScheduled).length;
      const failedCount = results.filter(r => !r.success && !r.retryScheduled).length;

      return NextResponse.json({
        success: true,
        message: `Processed ${emailsToProcess.length} emails: ${successCount} sent, ${retriedCount} scheduled for retry, ${failedCount} failed permanently`,
        results,
        summary: { sent: successCount, retrying: retriedCount, failed: failedCount },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action. Use "push" or "resend"' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error processing email queue:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GUID: API_EMAIL_QUEUE-005-v03
// [Intent] Handles email send failures with retry logic. If the retry count is below MAX_RETRY_ATTEMPTS (3), schedules a retry after RETRY_DELAY_MINUTES (5 min) by updating the queue document. If max retries are exhausted, marks the email as permanently failed.
// [Inbound Trigger] Called from the POST handler's "push" action when sendEmail fails or returns an error.
// [Downstream Impact] Updates the email_queue document with new retry state. Determines whether the email will be retried or abandoned. The retryScheduled return value is surfaced in the POST response.
async function handleEmailFailure(
  db: FirebaseFirestore.Firestore,
  FieldValue: typeof import('firebase-admin/firestore').FieldValue,
  Timestamp: typeof import('firebase-admin/firestore').Timestamp,
  emailId: string,
  currentRetryCount: number,
  errorMessage: string
): Promise<{ retryScheduled: boolean }> {
  const newRetryCount = currentRetryCount + 1;

  if (newRetryCount < MAX_RETRY_ATTEMPTS) {
    // Schedule retry
    const nextRetryTime = Timestamp.fromMillis(Date.now() + RETRY_DELAY_MINUTES * 60 * 1000);
    await db.collection('email_queue').doc(emailId).update({
      status: 'pending',
      retryCount: newRetryCount,
      nextRetryAt: nextRetryTime,
      lastError: errorMessage,
      lastAttemptAt: FieldValue.serverTimestamp(),
    });
    return { retryScheduled: true };
  } else {
    // Max retries reached - mark as failed
    await db.collection('email_queue').doc(emailId).update({
      status: 'failed',
      retryCount: newRetryCount,
      nextRetryAt: null,
      lastError: errorMessage,
      processedAt: FieldValue.serverTimestamp(),
    });
    return { retryScheduled: false };
  }
}

// GUID: API_EMAIL_QUEUE-006-v03
// [Intent] DELETE handler — removes queued emails from Firestore. If specific emailIds are provided, deletes those; otherwise deletes all pending emails. Used by admins to clear the queue.
// [Inbound Trigger] HTTP DELETE with JSON body containing optional emailIds array.
// [Downstream Impact] Permanently removes documents from the email_queue collection. Deleted emails cannot be recovered. Errors are console-logged (note: does not use logError — potential Golden Rule #1 gap).
export async function DELETE(request: NextRequest) {
  try {
    const { db } = await getFirebaseAdmin();
    const { emailIds } = await request.json();

    let deletedCount = 0;

    if (emailIds && emailIds.length > 0) {
      // Delete specific emails
      for (const id of emailIds) {
        await db.collection('email_queue').doc(id).delete();
        deletedCount++;
      }
    } else {
      // Delete all pending emails
      const snapshot = await db.collection('email_queue')
        .where('status', '==', 'pending')
        .get();

      for (const doc of snapshot.docs) {
        await doc.ref.delete();
        deletedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${deletedCount} queued email(s)`,
      deletedCount,
    });
  } catch (error: any) {
    console.error('Error deleting from email queue:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
