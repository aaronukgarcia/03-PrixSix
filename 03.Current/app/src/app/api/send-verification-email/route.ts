// GUID: API_SEND_VERIFICATION_EMAIL-000-v03
// [Intent] API route that sends a primary email verification link to a user. Generates a CSPRNG token, stores it in Firestore with a 2-hour expiry, builds a branded HTML email, and sends via Graph API.
// [Inbound Trigger] POST request from client-side registration or profile verification flow.
// [Downstream Impact] Creates a document in email_verification_tokens collection (consumed by /verify-email page). Sends email via sendEmail. Writes to audit_logs. Frontend relies on success/emailGuid response.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';

// GUID: API_SEND_VERIFICATION_EMAIL-001-v03
// [Intent] Generates a cryptographically secure 32-byte hex token for email verification links.
// [Inbound Trigger] Called once per POST request to create a unique verification token.
// [Downstream Impact] Token is stored in email_verification_tokens and embedded in the verification URL. Changing token length affects storage and URL format.
function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// GUID: API_SEND_VERIFICATION_EMAIL-002-v03
// [Intent] POST handler — validates required fields (uid, email), checks Graph API config, generates a verification token with 2-hour expiry, stores it in Firestore, builds a branded verification email with CTA button, sends via Graph API, and logs an audit event on success.
// [Inbound Trigger] HTTP POST with JSON body containing uid, email, and optional teamName.
// [Downstream Impact] Creates/overwrites email_verification_tokens/{uid} document. Sends email. Writes to audit_logs on success. Errors logged to error_logs with correlation ID and ERROR_CODES mapping.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { uid, email, teamName } = body;

    if (!uid || !email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: uid and email',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if Graph API is configured
    if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
      return NextResponse.json(
        {
          success: false,
          error: 'Email service not configured. Graph API credentials missing.',
          errorCode: ERROR_CODES.EMAIL_CONFIG_MISSING.code,
          correlationId,
        },
        { status: 503 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // Generate verification token
    const token = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    // Store token in Firestore
    await db.collection('email_verification_tokens').doc(uid).set({
      token,
      email,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
      used: false,
    });

    // Build verification URL - use the primary domain
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;
    const baseUrl = isProduction
      ? 'https://prix6.win'
      : 'http://localhost:9002';
    const verificationUrl = `${baseUrl}/verify-email?token=${token}&uid=${uid}`;

    // Send verification email via Graph API
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #e10600 0%, #1e1e1e 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .cta-button { display: inline-block; background: #e10600; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
    .security-note { background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Verify Your Email</h1>
      <p>Prix Six - F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello${teamName ? ` <strong>${teamName}</strong>` : ''},</p>

      <p>Please verify your email address to complete your Prix Six account setup.</p>

      <p style="text-align: center;">
        <a href="${verificationUrl}" class="cta-button">Verify Email Address</a>
      </p>

      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; background: #e9e9e9; padding: 10px; border-radius: 4px; font-size: 12px;">
        ${verificationUrl}
      </p>

      <div class="security-note">
        <strong>Note:</strong> This link will expire in 2 hours. If you did not create a Prix Six account, please ignore this email.
      </div>
    </div>
    <div class="footer">
      <p>Prix Six - F1 Prediction League</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    const emailResult = await sendEmail({
      toEmail: email,
      subject: 'Verify your Prix Six email address',
      htmlContent,
    });

    if (emailResult.success) {
      // Log the verification email sent
      await db.collection('audit_logs').add({
        userId: uid,
        action: 'verification_email_sent_graph',
        data: { email, emailGuid: emailResult.emailGuid, correlationId },
        timestamp: Timestamp.now(),
      });

      return NextResponse.json({
        success: true,
        message: 'Verification email sent',
        emailGuid: emailResult.emailGuid,
      });
    } else {
      await logError({
        correlationId,
        error: emailResult.error || 'Failed to send verification email',
        context: {
          route: '/api/send-verification-email',
          action: 'send_email',
          userId: uid,
          additionalInfo: { email },
        },
      });
      return NextResponse.json({
        success: false,
        error: emailResult.error || 'Failed to send verification email',
        errorCode: ERROR_CODES.EMAIL_SEND_FAILED.code,
        correlationId,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error sending verification email:', error);
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/send-verification-email',
        action: 'POST',
        additionalInfo: { errorType: error.code || error.name || 'UnknownError' },
      },
    });
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
        errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
