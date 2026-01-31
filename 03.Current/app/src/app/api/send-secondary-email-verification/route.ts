// GUID: API_SEND_SECONDARY_VERIFICATION-000-v04
// [Intent] API route that sends a verification email for a user's secondary email address. Validates that the secondary email matches the user record, generates a CSPRNG token, stores it in Firestore with a 2-hour expiry, and sends a branded verification email via Graph API.
// [Inbound Trigger] POST request from the profile page when a user adds or re-verifies a secondary email address.
// [Downstream Impact] Creates a document in secondary_email_verification_tokens collection (consumed by /verify-secondary-email page). Sends email via sendEmail. Writes to audit_logs. Frontend relies on success/emailGuid response.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { sendEmail } from '@/lib/email';
import crypto from 'crypto';

// GUID: API_SEND_SECONDARY_VERIFICATION-001-v03
// [Intent] Generates a cryptographically secure 32-byte hex token for secondary email verification links.
// [Inbound Trigger] Called once per POST request to create a unique verification token.
// [Downstream Impact] Token is stored in secondary_email_verification_tokens and embedded in the verification URL. Changing token length affects storage and URL format.
function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// GUID: API_SEND_SECONDARY_VERIFICATION-002-v04
// [Intent] POST handler — validates required fields (uid, secondaryEmail), checks Graph API config, verifies user exists and secondary email matches their record, generates a verification token with 2-hour expiry, stores it in Firestore, builds a branded verification email with CTA button, sends via Graph API, and logs an audit event on success.
// [Inbound Trigger] HTTP POST with JSON body containing uid, secondaryEmail, and optional teamName.
// [Downstream Impact] Creates/overwrites secondary_email_verification_tokens/{uid} document. Sends email. Writes to audit_logs on success. Errors logged to error_logs with correlation ID and ERROR_CODES mapping. Reads from users collection to validate secondary email ownership.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { uid, secondaryEmail, teamName } = body;

    if (!uid || !secondaryEmail) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: uid and secondaryEmail',
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

    // Verify the user exists and has this secondary email set
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found',
          errorCode: ERROR_CODES.AUTH_USER_NOT_FOUND.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    const userData = userDoc.data();
    if (userData?.secondaryEmail !== secondaryEmail) {
      return NextResponse.json(
        {
          success: false,
          error: 'Secondary email does not match user record',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Generate verification token
    const token = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    // Store token in Firestore (separate collection for secondary email tokens)
    await db.collection('secondary_email_verification_tokens').doc(uid).set({
      token,
      email: secondaryEmail,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
      used: false,
    });

    // Build verification URL
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;
    const baseUrl = isProduction
      ? 'https://prix6.win'
      : 'http://localhost:9002';
    const verificationUrl = `${baseUrl}/verify-secondary-email?token=${token}&uid=${uid}`;

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
      <h1>Verify Your Secondary Email</h1>
      <p>Prix Six - F1 Prediction League</p>
    </div>
    <div class="content">
      <p>Hello${teamName ? ` <strong>${teamName}</strong>` : ''},</p>

      <p>Please verify this secondary email address to receive Prix Six communications at this address.</p>

      <p style="text-align: center;">
        <a href="${verificationUrl}" class="cta-button">Verify Secondary Email</a>
      </p>

      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; background: #e9e9e9; padding: 10px; border-radius: 4px; font-size: 12px;">
        ${verificationUrl}
      </p>

      <div class="security-note">
        <strong>Note:</strong> This link will expire in 2 hours. If you did not request this, please ignore this email.
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
      toEmail: secondaryEmail,
      subject: 'Verify your Prix Six secondary email address',
      htmlContent,
    });

    if (emailResult.success) {
      // Log the verification email sent
      await db.collection('audit_logs').add({
        userId: uid,
        action: 'secondary_verification_email_sent',
        data: { secondaryEmail, emailGuid: emailResult.emailGuid, correlationId },
        timestamp: Timestamp.now(),
      });

      return NextResponse.json({
        success: true,
        message: 'Verification email sent to secondary address',
        emailGuid: emailResult.emailGuid,
      });
    } else {
      const traced = createTracedError(ERRORS.EMAIL_SEND_FAILED, {
        correlationId,
        context: { route: '/api/send-secondary-email-verification', action: 'send_email', userId: uid, secondaryEmail },
      });
      await logTracedError(traced, db);
      return NextResponse.json({
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      }, { status: 500 });
    }
  } catch (error: any) {
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/send-secondary-email-verification', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, (await getFirebaseAdmin()).db);
    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      },
      { status: 500 }
    );
  }
}
