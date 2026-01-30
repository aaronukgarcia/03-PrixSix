// GUID: API_VERIFY_EMAIL-000-v03
// [Intent] API route for verifying a user's primary email address via a token-based verification link. Validates the token, marks email as verified in both Firestore and Firebase Auth, and logs an audit event.
// [Inbound Trigger] POST request from the email verification page when a user clicks the verification link containing a token and uid.
// [Downstream Impact] Updates Firestore users/{uid}.emailVerified, Firebase Auth emailVerified flag, marks token as used in email_verification_tokens collection, writes audit_logs. Email verification banner on all pages reads the emailVerified field.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import crypto from 'crypto';

// GUID: API_VERIFY_EMAIL-001-v03
// [Intent] POST handler that validates an email verification token (constant-time comparison), checks expiry and re-use, updates both Firestore and Firebase Auth verified status, marks the token as used, and writes an audit log.
// [Inbound Trigger] POST /api/verify-email with JSON body containing token (verification string) and uid (user ID).
// [Downstream Impact] Writes to Firestore users/{uid} (emailVerified), Firebase Auth (emailVerified), email_verification_tokens/{uid} (used flag), and audit_logs. If Auth update fails, Firestore is still updated (graceful degradation).
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const body = await request.json();
    const { token, uid } = body;

    // GUID: API_VERIFY_EMAIL-002-v03
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
    const { getAuth } = await import('firebase-admin/auth');

    // GUID: API_VERIFY_EMAIL-003-v03
    // [Intent] Retrieve the verification token document and perform security checks: existence, constant-time token comparison (prevents timing attacks), re-use check, and expiry check.
    // [Inbound Trigger] Valid token and uid provided in request.
    // [Downstream Impact] Returns 400 for invalid/expired/used tokens. Uses crypto.timingSafeEqual to prevent timing-based token guessing.
    const tokenRef = db.collection('email_verification_tokens').doc(uid);
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
        { success: false, error: 'Email already verified' },
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

    // GUID: API_VERIFY_EMAIL-004-v03
    // [Intent] Mark the user's email as verified in Firestore users collection.
    // [Inbound Trigger] Token has passed all validation checks (exists, matches, not used, not expired).
    // [Downstream Impact] Sets users/{uid}.emailVerified = true. The email verification banner component reads this field. If this write fails, returns 500 and does not proceed to Auth update.
    const userRef = db.collection('users').doc(uid);
    try {
      await userRef.update({
        emailVerified: true,
      });
    } catch (userUpdateError: any) {
      await logError({
        correlationId,
        error: userUpdateError,
        context: {
          route: '/api/verify-email',
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

    // GUID: API_VERIFY_EMAIL-005-v03
    // [Intent] Also mark as verified in Firebase Auth for consistency (Golden Rule #3). Auth failure is non-fatal — Firestore was already updated.
    // [Inbound Trigger] Firestore user document successfully updated.
    // [Downstream Impact] Updates Firebase Auth emailVerified flag. Failure is logged but does not fail the request — graceful degradation. Consistency Checker should validate Auth/Firestore sync.
    try {
      const auth = getAuth();
      await auth.updateUser(uid, { emailVerified: true });
    } catch (authUpdateError: any) {
      await logError({
        correlationId,
        error: authUpdateError,
        context: {
          route: '/api/verify-email',
          action: 'update_auth_user',
          userId: uid,
          additionalInfo: { step: 'firebase_auth_update' },
        },
      });
      // Don't fail completely - Firestore was updated, just log the auth error
      console.warn('[Verify Email] Firebase Auth update failed, but Firestore was updated:', authUpdateError.message);
    }

    // GUID: API_VERIFY_EMAIL-006-v03
    // [Intent] Mark the verification token as used to prevent re-use, and write an audit log entry.
    // [Inbound Trigger] Email verified successfully in Firestore (and attempted in Auth).
    // [Downstream Impact] Sets email_verification_tokens/{uid}.used = true. Writes to audit_logs for traceability.
    await tokenRef.update({
      used: true,
      usedAt: Timestamp.now(),
    });

    // Log the verification
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'email_verified_custom',
      data: { email: tokenData.email, correlationId },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error: any) {
    // GUID: API_VERIFY_EMAIL-007-v03
    // [Intent] Top-level error handler — catches any unhandled exceptions, logs to error_logs, and returns a safe 500 response with correlation ID.
    // [Inbound Trigger] Any uncaught exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId to client for support reference. Golden Rule #1 compliance.
    console.error('Error verifying email:', error);
    await logError({
      correlationId,
      error,
      context: {
        route: '/api/verify-email',
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
