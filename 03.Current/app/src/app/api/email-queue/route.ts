import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { sendEmail } from '@/lib/email';

// Lazy initialization to avoid build-time errors
let adminApp: App | null = null;
let adminDb: Firestore | null = null;

function getAdminDb(): Firestore {
  if (!adminDb) {
    if (!getApps().length) {
      adminApp = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    adminDb = getFirestore();
  }
  return adminDb;
}

interface QueuedEmail {
  id: string;
  toEmail: string;
  subject: string;
  htmlContent: string;
  type: string;
  teamName?: string;
  status: 'pending' | 'sent' | 'failed';
  reason: string;
}

// GET - Fetch all queued emails
export async function GET() {
  try {
    const queueSnapshot = await getAdminDb().collection('email_queue')
      .where('status', '==', 'pending')
      .orderBy('queuedAt', 'desc')
      .get();

    const queuedEmails: QueuedEmail[] = queueSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    } as QueuedEmail));

    return NextResponse.json({ success: true, emails: queuedEmails });
  } catch (error: any) {
    console.error('Error fetching email queue:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST - Push (send) queued emails
export async function POST(request: NextRequest) {
  try {
    const { action, emailIds } = await request.json();

    if (action === 'push') {
      // If emailIds provided, push those specific emails; otherwise push all pending
      let emailsToProcess: QueuedEmail[] = [];

      if (emailIds && emailIds.length > 0) {
        // Get specific emails by ID
        for (const id of emailIds) {
          const doc = await getAdminDb().collection('email_queue').doc(id).get();
          if (doc.exists && doc.data()?.status === 'pending') {
            emailsToProcess.push({ id: doc.id, ...doc.data() } as QueuedEmail);
          }
        }
      } else {
        // Get all pending emails
        const snapshot = await getAdminDb().collection('email_queue')
          .where('status', '==', 'pending')
          .get();
        emailsToProcess = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        } as QueuedEmail));
      }

      const results: { id: string; success: boolean; error?: string }[] = [];

      for (const email of emailsToProcess) {
        try {
          const emailResult = await sendEmail({
            toEmail: email.toEmail,
            subject: email.subject,
            htmlContent: email.htmlContent,
          });

          if (emailResult.success) {
            // Update the queue document to 'sent'
            await getAdminDb().collection('email_queue').doc(email.id).update({
              status: 'sent',
              processedAt: FieldValue.serverTimestamp(),
              emailGuid: emailResult.emailGuid,
            });

            // Record in email daily stats
            const today = new Date().toISOString().split('T')[0];
            const statsRef = getAdminDb().collection('email_daily_stats').doc(today);
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
              }),
            }, { merge: true });

            results.push({ id: email.id, success: true });
          } else {
            await getAdminDb().collection('email_queue').doc(email.id).update({
              status: 'failed',
              processedAt: FieldValue.serverTimestamp(),
              error: emailResult.error,
            });
            results.push({ id: email.id, success: false, error: emailResult.error });
          }
        } catch (error: any) {
          await getAdminDb().collection('email_queue').doc(email.id).update({
            status: 'failed',
            processedAt: FieldValue.serverTimestamp(),
            error: error.message,
          });
          results.push({ id: email.id, success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      return NextResponse.json({
        success: true,
        message: `Processed ${successCount} of ${emailsToProcess.length} emails`,
        results,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
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

// DELETE - Remove queued emails
export async function DELETE(request: NextRequest) {
  try {
    const { emailIds } = await request.json();

    let deletedCount = 0;

    if (emailIds && emailIds.length > 0) {
      // Delete specific emails
      for (const id of emailIds) {
        await getAdminDb().collection('email_queue').doc(id).delete();
        deletedCount++;
      }
    } else {
      // Delete all pending emails
      const snapshot = await getAdminDb().collection('email_queue')
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
