// GUID: API_NOTIFY_PIN_CHANGED-000-v01
// @FIX (BUG-PIN-002): Replaces client-side write to dead `mail` collection in changePin().
//   The provider was calling addDocumentNonBlocking(collection(firestore, 'mail'), ...) directly
//   from the browser — blocked by Firestore rules (allow create: if false on mail) and would have
//   been a dead queue anyway. Errors surfaced in error_logs for jameskeymer.mobile@gmail.com and
//   green.jeff12345@gmail.com on 2026-03-04.
// [Intent] Authenticated POST endpoint that sends a "PIN changed" notification email via Graph API
//          and writes the result to email_logs and audit_logs. Called by changePin() in provider.tsx
//          immediately after the Firebase Auth password update succeeds.
// [Inbound Trigger] POST from changePin() in provider.tsx with Firebase Bearer token auth.
// [Downstream Impact] Sends email via sendEmail(); writes to email_logs and audit_logs.
//                     Failure is non-fatal — PIN change already succeeded in Auth; only notification is affected.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId } from '@/lib/firebase-admin';
import { verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { sendEmail, escapeHtml } from '@/lib/email';

export const dynamic = 'force-dynamic';

// GUID: API_NOTIFY_PIN_CHANGED-001-v01
// [Intent] POST handler — verifies Firebase auth token, sends PIN changed notification via Graph API,
//          logs result to email_logs and audit_logs. Returns success regardless of email outcome
//          (PIN change already committed in Auth before this is called).
// [Inbound Trigger] POST /api/auth/notify-pin-changed from changePin() in provider.tsx.
//                   Authorization: Bearer {firebaseIdToken} header required.
// [Downstream Impact] Sends email via Graph API; writes email_logs and audit_logs.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const user = await verifyAuthToken(request.headers.get('authorization'));
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { email, teamName } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Missing email', correlationId },
        { status: 400 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    const subject = 'Your Prix Six PIN Has Changed';
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .security-note { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PIN Changed</h1>
      <p>Prix Six — F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello${teamName ? ` <strong>${escapeHtml(teamName)}</strong>` : ''},</p>
      <p>Your Prix Six PIN was just changed successfully.</p>
      <div class="security-note">
        <strong>Wasn't you?</strong> If you did not make this change, please contact support immediately — your account may be compromised.
      </div>
    </div>
    <div class="footer">
      <p>Prix Six — F1 Prediction League</p>
    </div>
  </div>
</body>
</html>`.trim();

    const emailResult = await sendEmail({ toEmail: email, subject, htmlContent });

    await db.collection('email_logs').add({
      to: email,
      subject,
      html: htmlContent,
      status: emailResult.success ? 'sent' : 'failed',
      emailGuid: emailResult.emailGuid ?? null,
      timestamp: FieldValue.serverTimestamp(),
    });

    if (!emailResult.success) {
      const traced = createTracedError(ERRORS.EMAIL_SEND_FAILED, {
        correlationId,
        context: { route: '/api/auth/notify-pin-changed', action: 'send_email', userId: user.uid, email },
      });
      await logTracedError(traced, db);
    }

    await db.collection('audit_logs').add({
      userId: user.uid,
      action: 'pin_changed_notification_sent',
      data: { email, emailSuccess: emailResult.success, correlationId },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    try {
      const { db } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
        correlationId,
        context: { route: '/api/auth/notify-pin-changed', action: 'POST' },
        cause: error instanceof Error ? error : undefined,
      });
      await logTracedError(traced, db);
    } catch { /* log failure is non-fatal */ }

    return NextResponse.json(
      { success: false, error: 'Notification failed', correlationId },
      { status: 500 }
    );
  }
}
