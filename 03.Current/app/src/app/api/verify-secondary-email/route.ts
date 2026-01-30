// GUID: API_VERIFY_SECONDARY_EMAIL-000-v03
// [Intent] API route for verifying a user's secondary (communications) email address via a token-based verification link. Similar to primary email verification but operates on the secondary_email_verification_tokens collection and does NOT update Firebase Auth.
// [Inbound Trigger] POST request from the secondary email verification page when a user clicks the verification link.
// [Downstream Impact] Updates Firestore users/{uid}.secondaryEmailVerified, marks token as used in secondary_email_verification_tokens collection, writes audit_logs. Secondary email is for communications only — not for login.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import crypto from 'crypto';

// GUID: API_VERIFY_SECONDARY_EMAIL-001-v03
// [Intent] POST handler that validates a secondary email verification token (constant-time comparison), checks expiry and re-use, verifies the secondary email has not changed since the token was issued, updates Firestore verified status, marks the token as used, and writes an audit log.
// [Inbound Trigger] POST /api/verify-secondary-email with JSON body containing token (verification string) and uid (user ID).
// [Downstream Impact] Writes to Firestore users/{uid} (secondaryEmailVerified), secondary_email_verification_tokens/{uid} (used flag), and audit_logs. Does NOT update Firebase Auth — secondary email is Firestore-only.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { token, uid } = body;

    // GUID: API_VERIFY_SECONDARY_EMAIL-002-v03
    // [Intent] Validate that both required fields (token and uid) are present in the request.
    // [Inbound Trigger] Missing token or uid in the request body.
    // [Downstream Impact] Returns 400 with VALIDATION_MISSING_FIELDS. No database lookups occur.
    if (!token || !uid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: token and uid',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // GUID: API_VERIFY_SECONDARY_EMAIL-003-v03
    // [Intent] Retrieve the secondary email verification token document and perform security checks: existence, constant-time token comparison (prevents timing attacks), re-use check, and expiry check.
    // [Inbound Trigger] Valid token and uid provided in request.
    // [Downstream Impact] Returns 400 for invalid/expired/used tokens. Uses crypto.timingSafeEqual to prevent timing-based token guessing.
    const tokenRef = db.collection('secondary_email_verification_tokens').doc(uid);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    const tokenData = tokenDoc.data();

    if (!tokenData) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    // Check if token matches (constant-time comparison to prevent timing attacks)
    if (!crypto.timingSafeEqual(Buffer.from(tokenData.token), Buffer.from(token))) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    // Check if already used
    if (tokenData.used) {
      return NextResponse.json(
        { success: false, error: 'Secondary email already verified' },
        { status: 400 }
      );
    }

    // Check if expired
    const now = Timestamp.now();
    if (tokenData.expiresAt && tokenData.expiresAt.toMillis() < now.toMillis()) {
      return NextResponse.json(
        { success: false, error: 'Token expired' },
        { status: 400 }
      );
    }

    // GUID: API_VERIFY_SECONDARY_EMAIL-004-v03
    // [Intent] Verify the user still exists and their secondary email has not changed since the verification token was issued. Prevents verifying a stale email address.
    // [Inbound Trigger] Token has passed all validation checks.
    // [Downstream Impact] Returns 404 if user not found, 400 if secondary email has changed. Ensures token is only valid for the email address it was issued for.
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

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
    if (userData?.secondaryEmail !== tokenData.email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Secondary email has changed. Please request a new verification.',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_VERIFY_SECONDARY_EMAIL-005-v03
    // [Intent] Mark the user's secondary email as verified in Firestore. NOTE: Does NOT update Firebase Auth — secondary email is for communications only, not login.
    // [Inbound Trigger] User exists and secondary email matches the token's email.
    // [Downstream Impact] Sets users/{uid}.secondaryEmailVerified = true. Profile page reads this field. If write fails, returns 500.
    try {
      await userRef.update({
        secondaryEmailVerified: true,
      });
    } catch (userUpdateError: any) {
      await logError({
        correlationId,
        error: userUpdateError,
        context: {
          route: '/api/verify-secondary-email',
          action: 'update_user_document',
          userId: uid,
          additionalInfo: { step: 'firestore_user_update' },
        },
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to update user record',
          errorCode: ERROR_CODES.FIRESTORE_WRITE_FAILED.code,
          correlationId,
        },
        { status: 500 }
      );
    }

    // GUID: API_VERIFY_SECONDARY_EMAIL-006-v03
    // [Intent] Mark the verification token as used to prevent re-use, and write an audit log entry.
    // [Inbound Trigger] Secondary email verified successfully in Firestore.
    // [Downstream Impact] Sets secondary_email_verification_tokens/{uid}.used = true. Writes to audit_logs for traceability.
    await tokenRef.update({
      used: true,
      usedAt: Timestamp.now(),
    });

    // Log the verification
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'secondary_email_verified',
      data: { secondaryEmail: tokenData.email, correlationId },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Secondary email verified successfully',
    });
  } catch (error: any) {
    // GUID: API_VERIFY_SECONDARY_EMAIL-007-v03
    // [Intent] Top-level error handler — catches any unhandled exceptions, logs to error_logs, and returns a safe 500 response with correlation ID.
    // [Inbound Trigger] Any uncaught exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId to client for support reference. Golden Rule #1 compliance.
    console.error('Error verifying secondary email:', error);
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/verify-secondary-email',
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
