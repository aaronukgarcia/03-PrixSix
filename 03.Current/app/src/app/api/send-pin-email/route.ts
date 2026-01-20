import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { canSendEmail, recordSentEmail } from '@/lib/email-tracking';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function getAdminDb() {
  const { db } = await getFirebaseAdmin();
  return db;
}

interface PinEmailRequest {
  toEmail: string;
  teamName?: string;
  pin?: string;
  type: 'reset' | 'changed';
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const { toEmail, teamName, pin, type }: PinEmailRequest = await request.json();

    if (!toEmail || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: toEmail and type' },
        { status: 400 }
      );
    }

    const db = await getAdminDb();

    // Check rate limiting
    const rateCheck = await canSendEmail(db as any, toEmail);
    if (!rateCheck.canSend) {
      // Log the rate-limited attempt
      await db.collection('email_logs').add({
        to: toEmail,
        type: type === 'reset' ? 'pin_reset' : 'pin_changed',
        status: 'rate_limited',
        reason: rateCheck.reason,
        timestamp: new Date(),
        correlationId
      });

      return NextResponse.json({
        success: false,
        error: rateCheck.reason,
        rateLimited: true
      });
    }

    let subject: string;
    let htmlContent: string;

    if (type === 'reset') {
      subject = 'Your Prix Six PIN has been reset';
      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .pin-box { background: #1e1e1e; color: #e10600; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; margin: 20px 0; border-radius: 8px; letter-spacing: 8px; }
    .security-note { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PIN Reset</h1>
      <p>Prix Six - F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>A PIN reset was requested for your account. Your temporary PIN is:</p>
      <div class="pin-box">${pin || 'N/A'}</div>
      <p>You will be required to change this PIN after logging in.</p>
      <div class="security-note">
        <strong>Security Notice:</strong> If you did not request this PIN reset, please contact <a href="mailto:aaron@garcia.ltd">aaron@garcia.ltd</a> immediately.
      </div>
    </div>
  </div>
</body>
</html>
      `.trim();
    } else {
      subject = 'Your Prix Six PIN Has Changed';
      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .security-note { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>PIN Changed</h1>
      <p>Prix Six - F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello${teamName ? ` ${teamName}` : ''},</p>
      <p>Your PIN for Prix Six was just changed.</p>
      <div class="security-note">
        <strong>Security Notice:</strong> If you did not make this change, please contact <a href="mailto:aaron@garcia.ltd">aaron@garcia.ltd</a> immediately.
      </div>
    </div>
  </div>
</body>
</html>
      `.trim();
    }

    const emailResult = await sendEmail({
      toEmail,
      subject,
      htmlContent
    });

    // Log to email_logs with proper status
    await db.collection('email_logs').add({
      to: toEmail,
      subject,
      type: type === 'reset' ? 'pin_reset' : 'pin_changed',
      status: emailResult.success ? 'sent' : 'failed',
      emailGuid: emailResult.emailGuid,
      error: emailResult.error || null,
      timestamp: new Date(),
      correlationId
    });

    // Also record in daily stats for tracking
    if (emailResult.success) {
      await recordSentEmail(db as any, {
        toEmail,
        subject,
        type: type === 'reset' ? 'pin_reset' : 'pin_changed',
        teamName: teamName || undefined,
        emailGuid: emailResult.emailGuid,
        sentAt: new Date().toISOString(),
        status: 'sent'
      });
    }

    if (emailResult.success) {
      return NextResponse.json({
        success: true,
        emailGuid: emailResult.emailGuid
      });
    } else {
      return NextResponse.json(
        { success: false, error: emailResult.error },
        { status: 500 }
      );
    }
  } catch (error: any) {
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/send-pin-email',
        action: 'POST',
        userAgent: request.headers.get('user-agent') || undefined,
      },
    });

    return NextResponse.json(
      { success: false, error: error.message, correlationId },
      { status: 500 }
    );
  }
}
