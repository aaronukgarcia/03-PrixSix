// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST (no GET handler — prevents browser/crawler trigger by design)
// Auth:        CRON_SECRET bearer token (NOT Firebase Auth); timing-safe comparison (crypto.timingSafeEqual)
// Reads:       email_queue (pending docs where nextRetryAt <= now or null)
// Writes:      email_queue (status updates), email_daily_stats (on successful send)
// Errors:      401 (bad/missing token), 500 (unexpected failure)
// Idempotent:  YES — safe to call repeatedly; only sends emails that are pending and ready
// Side-effects: Calls sendEmail() → Microsoft Graph API (billable, irreversible per email)
// Key gotcha:  Capped at PUSH_BATCH_LIMIT (50) per invocation — mirrors /api/email-queue push logic.
//              Called every 15 minutes by processEmailQueue Cloud Function in functions/index.js.
//              CRON_SECRET must match the secret set via `firebase apphosting:secrets:set CRON_SECRET`.
// ──────────────────────────────────────────────────────────────────
// GUID: CRON_EMAIL_QUEUE-000-v01
// [Intent] Cron-authenticated POST endpoint that drains the email_queue collection by sending
//          pending emails via Microsoft Graph. Called every 15 minutes by the processEmailQueue
//          Cloud Function. Mirrors the push logic in /api/email-queue but uses CRON_SECRET auth
//          instead of Firebase user auth — no human session required.
// [Inbound Trigger] POST from processEmailQueue Cloud Function (every 15 minutes).
//                   Authorization: Bearer {CRON_SECRET} header required.
// [Downstream Impact] Sends pending emails via sendEmail(); updates email_queue docs to sent/failed;
//                     writes to email_daily_stats on success. Failed emails are retried up to 3 times
//                     with 5-minute delays before being marked permanently failed.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { sendEmail } from '@/lib/email';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 5;
const PUSH_BATCH_LIMIT = 50;

// GUID: CRON_EMAIL_QUEUE-001-v01
// [Intent] Validate the Authorization: Bearer header against CRON_SECRET using timing-safe
//          comparison to prevent token oracle attacks. Returns true only if the token matches exactly.
// [Inbound Trigger] Called at the top of the POST handler before any queue work is done.
// [Downstream Impact] Unauthorized calls are rejected before any Firestore or email work.
function isAuthorized(request: NextRequest): boolean {
    // Strip BOM (U+FEFF) — Secret Manager may prepend it on Windows-created secrets
    const secret = (process.env.CRON_SECRET ?? '').replace(/^\uFEFF/, '');
    if (!secret) return false;
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return false;
    const provided = Buffer.from(authHeader);
    const expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
}

// GUID: CRON_EMAIL_QUEUE-002-v01
// [Intent] Handle a failed email send attempt with retry logic. If retryCount < MAX_RETRY_ATTEMPTS,
//          schedules a retry after RETRY_DELAY_MINUTES by keeping status as pending with nextRetryAt set.
//          After MAX_RETRY_ATTEMPTS, marks the document as permanently failed.
// [Inbound Trigger] Called from the POST handler when sendEmail() returns failure or throws.
// [Downstream Impact] Updates the email_queue document. Determines retry vs permanent failure.
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

// GUID: CRON_EMAIL_QUEUE-003-v01
// [Intent] POST handler — validates bearer token, fetches up to PUSH_BATCH_LIMIT pending emails
//          whose nextRetryAt has passed (or is unset), sends each via sendEmail(), and updates
//          queue document status. Returns a summary of sent/retrying/failed counts and hasMore flag.
// [Inbound Trigger] HTTP POST to /api/cron/process-email-queue from the Cloud Function.
// [Downstream Impact] Sends emails via Microsoft Graph; updates email_queue and email_daily_stats.
export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isAuthorized(request)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const correlationId = generateCorrelationId();

    try {
        const { db, FieldValue, Timestamp } = await getFirebaseAdmin();
        const now = Timestamp.now();

        const snapshot = await db.collection('email_queue')
            .where('status', '==', 'pending')
            .limit(PUSH_BATCH_LIMIT)
            .get();

        const emailsToProcess = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as any))
            .filter((email: any) => {
                if (!email.nextRetryAt) return true;
                return email.nextRetryAt.toMillis() <= now.toMillis();
            });

        const results: { id: string; success: boolean; retryScheduled?: boolean }[] = [];

        for (const email of emailsToProcess) {
            const currentRetryCount = email.retryCount || 0;

            try {
                const emailResult = await sendEmail({
                    toEmail: email.toEmail,
                    subject: email.subject,
                    htmlContent: email.htmlContent,
                });

                if (emailResult.success) {
                    await db.collection('email_queue').doc(email.id).update({
                        status: 'sent',
                        processedAt: FieldValue.serverTimestamp(),
                        emailGuid: emailResult.emailGuid,
                        retryCount: currentRetryCount,
                    });

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
                    const result = await handleEmailFailure(
                        db, FieldValue, Timestamp,
                        email.id, currentRetryCount, emailResult.error || 'Unknown error'
                    );
                    results.push({ id: email.id, success: false, retryScheduled: result.retryScheduled });
                }
            } catch (err: any) {
                const result = await handleEmailFailure(
                    db, FieldValue, Timestamp,
                    email.id, currentRetryCount, err.message || 'Unknown error'
                );
                results.push({ id: email.id, success: false, retryScheduled: result.retryScheduled });
            }
        }

        const sentCount = results.filter(r => r.success).length;
        const retryingCount = results.filter(r => !r.success && r.retryScheduled).length;
        const failedCount = results.filter(r => !r.success && !r.retryScheduled).length;
        const hasMore = emailsToProcess.length >= PUSH_BATCH_LIMIT;

        return NextResponse.json({
            success: true,
            processed: emailsToProcess.length,
            summary: { sent: sentCount, retrying: retryingCount, failed: failedCount },
            hasMore,
            correlationId,
        });
    } catch (error: any) {
        if (process.env.NODE_ENV !== 'production') {
            console.error('[cron/process-email-queue] error:', error);
        }
        return NextResponse.json(
            { success: false, error: 'Internal server error', correlationId },
            { status: 500 }
        );
    }
}
