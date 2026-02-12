// GUID: API_AUTH_ADMIN_CHALLENGE-000-v01
// [Intent] API route that sends an admin verification link to an authenticated admin user.
//          Generates a CSPRNG token, stores it in Firestore with a 30-minute expiry,
//          and sends a magic link email for admin panel access.
// [Inbound Trigger] POST request from admin page when requesting email verification.
// [Downstream Impact] Creates admin_verification_tokens/{uid} document, sends email,
//                     writes audit log. The magic link redirects to /admin/verify.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { sendEmail, escapeHtml } from '@/lib/email';
import crypto from 'crypto';

// GUID: API_AUTH_ADMIN_CHALLENGE-001-v01
// [Intent] Generate a cryptographically secure 32-byte hex token for admin verification.
// [Inbound Trigger] Called once per POST request.
// [Downstream Impact] Token embedded in verification URL and stored in Firestore.
function generateAdminVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// GUID: API_AUTH_ADMIN_CHALLENGE-002-v01
// [Intent] POST handler that authenticates user, verifies admin status, generates verification
//          token with 30-minute expiry, stores in Firestore, and sends magic link email.
// [Inbound Trigger] HTTP POST with Authorization header containing Firebase ID token.
// [Downstream Impact] Creates/overwrites admin_verification_tokens/{uid}. Sends email. Writes audit log.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_AUTH_ADMIN_CHALLENGE-003-v01
    // [Intent] Authenticate the user via Authorization header.
    // [Inbound Trigger] Extract and verify Firebase ID token.
    // [Downstream Impact] Returns 401 if token invalid or missing.
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 401 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // GUID: API_AUTH_ADMIN_CHALLENGE-004-v01
    // [Intent] Verify the authenticated user has admin privileges.
    // [Inbound Trigger] Check users/{uid} document for isAdmin field.
    // [Downstream Impact] Returns 403 if user is not an admin.
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Admin access required',
          errorCode: ERROR_CODES.AUTH_ADMIN_REQUIRED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    const userData = userDoc.data();
    const email = userData?.email || verifiedUser.email;
    const teamName = userData?.teamName || 'Admin';

    // GUID: API_AUTH_ADMIN_CHALLENGE-005-v01
    // [Intent] Generate verification token and store in Firestore with 30-minute expiry.
    // [Inbound Trigger] Admin user authenticated and verified.
    // [Downstream Impact] Creates admin_verification_tokens/{uid} document.
    const token = generateAdminVerificationToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await db.collection('admin_verification_tokens').doc(verifiedUser.uid).set({
      token,
      email,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
      used: false,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    // GUID: API_AUTH_ADMIN_CHALLENGE-006-v01
    // [Intent] Build admin verification URL with encoded parameters.
    // [Inbound Trigger] Token generated and stored.
    // [Downstream Impact] URL sent in email, redirects to /admin/verify page.
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;
    const baseUrl = isProduction ? 'https://prix6.win' : 'http://localhost:9002';
    const verificationUrl = `${baseUrl}/admin/verify?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(verifiedUser.uid)}`;

    // GUID: API_AUTH_ADMIN_CHALLENGE-007-v01
    // [Intent] Send verification email with magic link button.
    // [Inbound Trigger] Verification URL built.
    // [Downstream Impact] Email sent via Graph API to admin user.
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
      <h1>🏎️ Prix Six Admin Verification</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(teamName)},</p>

      <p>A request was made to access the Prix Six Admin Panel from your account.</p>

      <div class="security-note">
        <strong>🔒 Multi-Factor Verification</strong><br>
        For security, admin panel access requires email verification each session.
      </div>

      <p>Click the button below to verify your admin access:</p>

      <div style="text-align: center;">
        <a href="${verificationUrl}" class="cta-button">Verify Admin Access</a>
      </div>

      <p><strong>Security Information:</strong></p>
      <ul>
        <li>This link expires in 30 minutes</li>
        <li>This link can only be used once</li>
        <li>If you didn't request this, please ignore this email</li>
      </ul>

      <p>Or copy and paste this URL into your browser:</p>
      <p style="background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 5px; word-break: break-all; font-family: monospace; font-size: 12px;">
        ${verificationUrl}
      </p>
    </div>
    <div class="footer">
      <p>This is an automated security email from Prix Six</p>
      <p>© ${new Date().getFullYear()} Prix Six. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;

    const textContent = `
Prix Six Admin Verification

Hi ${teamName},

A request was made to access the Prix Six Admin Panel from your account.

For security, admin panel access requires email verification each session.

Click this link to verify your admin access:
${verificationUrl}

Security Information:
- This link expires in 30 minutes
- This link can only be used once
- If you didn't request this, please ignore this email

This is an automated security email from Prix Six
© ${new Date().getFullYear()} Prix Six. All rights reserved.
    `.trim();

    // GUID: API_AUTH_ADMIN_CHALLENGE-008-v01
    // [Intent] Send the email via Graph API.
    // [Inbound Trigger] HTML and text content prepared.
    // [Downstream Impact] Email queued via sendEmail. Returns email GUID or error.
    const emailResult = await sendEmail({
      toEmail: email,
      subject: '🔒 Prix Six Admin Verification Required',
      htmlContent: htmlContent,
    });

    if (!emailResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to send verification email',
          errorCode: ERROR_CODES.EMAIL_SEND_FAILED.code,
          correlationId,
        },
        { status: 500 }
      );
    }

    // GUID: API_AUTH_ADMIN_CHALLENGE-009-v01
    // [Intent] Log successful admin verification request to audit log.
    // [Inbound Trigger] Email sent successfully.
    // [Downstream Impact] Writes to audit_logs collection.
    await db.collection('audit_logs').add({
      timestamp: Timestamp.now(),
      userId: verifiedUser.uid,
      email,
      action: 'ADMIN_VERIFICATION_REQUEST',
      metadata: {
        teamName,
        emailGuid: emailResult.emailGuid,
        expiresAt,
      },
      correlationId,
    });

    return NextResponse.json({
      success: true,
      message: 'Verification email sent successfully',
      emailGuid: emailResult.emailGuid,
      correlationId,
    });

  } catch (error: any) {
    console.error('Admin challenge error:', error);

    // GOLDEN RULE #1: Log error to error_logs collection
    const { db } = await getFirebaseAdmin();
    await db.collection('error_logs').add({
      timestamp: Timestamp.now(),
      correlationId,
      errorCode: ERROR_CODES.UNKNOWN_ERROR.code,
      errorMessage: error.message || 'Internal server error',
      context: {
        endpoint: '/api/auth/admin-challenge',
        method: 'POST',
        stack: error.stack,
      },
      severity: 'high',
    }).catch(() => {}); // Silent fail on logging error

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
