// GUID: API_UPDATE_SECONDARY_EMAIL-000-v04
// @SECURITY_FIX: Added authentication and authorization checks to prevent account takeover (GEMINI-AUDIT-006).
// [Intent] API route for adding, updating, or removing a user's secondary (communications) email address. Validates format, prevents duplicate/same-as-primary usage, resets verification status on change, and logs all changes to audit_logs.
// [Inbound Trigger] POST request from the user profile page when a user sets or clears their secondary email.
// [Downstream Impact] Updates Firestore users/{uid}.secondaryEmail and secondaryEmailVerified fields. Writes audit_logs. After update, the user must re-verify via the verify-secondary-email route.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// GUID: API_UPDATE_SECONDARY_EMAIL-001-v03
// [Intent] Regex for basic email format validation — ensures the input looks like a valid email before database operations.
// [Inbound Trigger] Referenced during email format validation in the POST handler.
// [Downstream Impact] Rejects clearly invalid email formats. Not exhaustive — does not cover all edge cases of RFC 5322.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GUID: API_UPDATE_SECONDARY_EMAIL-002-v04
// @SECURITY_FIX: Added authentication and authorization checks before processing request (GEMINI-AUDIT-006).
// [Intent] POST handler that orchestrates secondary email management: validates uid, handles removal (null/empty), validates email format, checks for same-as-primary and in-use conflicts, updates Firestore, and logs audit events.
// [Inbound Trigger] POST /api/update-secondary-email with JSON body containing uid and secondaryEmail (string, null, or empty string).
// [Downstream Impact] Writes to Firestore users/{uid} (secondaryEmail, secondaryEmailVerified) and audit_logs. On removal, deletes both fields using FieldValue.delete(). On update, resets secondaryEmailVerified to false.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // SECURITY: Verify Firebase Auth token (GEMINI-AUDIT-006 fix)
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AUTH_INVALID_TOKEN.message,
          errorCode: ERRORS.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { uid, secondaryEmail } = body;

    // GUID: API_UPDATE_SECONDARY_EMAIL-003-v04
    // @SECURITY_FIX: Added authorization check to prevent cross-user email changes (GEMINI-AUDIT-006).
    // [Intent] Validate that uid is present in the request and matches the authenticated user.
    // [Inbound Trigger] Missing uid in the request body or uid mismatch.
    // [Downstream Impact] Returns 400 with VALIDATION_MISSING_FIELDS or 403 with AUTH_PERMISSION_DENIED. No database lookups occur.
    if (!uid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: uid',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // SECURITY: Verify the uid matches the authenticated user (prevent account takeover)
    if (uid !== verifiedUser.uid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Cannot modify another user\'s email',
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // GUID: API_UPDATE_SECONDARY_EMAIL-004-v03
    // [Intent] Verify the user exists in Firestore before attempting any updates.
    // [Inbound Trigger] uid provided in the request.
    // [Downstream Impact] Returns 404 if user not found. userData is used for same-as-primary check and audit logging.
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

    // GUID: API_UPDATE_SECONDARY_EMAIL-005-v03
    // [Intent] Handle removal of secondary email — deletes both secondaryEmail and secondaryEmailVerified fields from the user document, logs removal to audit_logs.
    // [Inbound Trigger] secondaryEmail is null or empty string in the request.
    // [Downstream Impact] Removes Firestore fields using FieldValue.delete(). Writes audit_logs with previousEmail. Returns success immediately.
    if (secondaryEmail === null || secondaryEmail === '') {
      await userRef.update({
        secondaryEmail: FieldValue.delete(),
        secondaryEmailVerified: FieldValue.delete(),
      });

      // Log the removal
      await db.collection('audit_logs').add({
        userId: uid,
        action: 'secondary_email_removed',
        data: { previousEmail: userData?.secondaryEmail, correlationId },
        timestamp: Timestamp.now(),
      });

      return NextResponse.json({
        success: true,
        message: 'Secondary email removed',
      });
    }

    // GUID: API_UPDATE_SECONDARY_EMAIL-006-v03
    // [Intent] Validate email format using regex, check secondary email is not the same as the primary email, and check it is not already in use as another user's primary email.
    // [Inbound Trigger] secondaryEmail is a non-empty string (i.e., user is setting or updating, not removing).
    // [Downstream Impact] Returns 400 for invalid format, same-as-primary, or already-in-use. Uses VALIDATION_INVALID_FORMAT, VALIDATION_SECONDARY_EMAIL_SAME, and VALIDATION_SECONDARY_EMAIL_IN_USE error codes respectively.
    if (!EMAIL_REGEX.test(secondaryEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please enter a valid email address (e.g. name@example.com). This field is for a secondary email, not a team name.',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if secondary email is same as primary
    if (userData?.email?.toLowerCase() === secondaryEmail.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_SAME.message,
          errorCode: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_SAME.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Check if email is already used as another user's primary email
    const primaryEmailCheck = await db
      .collection('users')
      .where('email', '==', secondaryEmail.toLowerCase())
      .limit(1)
      .get();

    if (!primaryEmailCheck.empty) {
      return NextResponse.json(
        {
          success: false,
          error: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_IN_USE.message,
          errorCode: ERROR_CODES.VALIDATION_SECONDARY_EMAIL_IN_USE.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_UPDATE_SECONDARY_EMAIL-007-v03
    // [Intent] Persist the new secondary email (normalised to lowercase) and reset verification status to false, then log the change to audit_logs.
    // [Inbound Trigger] All validation checks have passed.
    // [Downstream Impact] Updates Firestore users/{uid}.secondaryEmail and sets secondaryEmailVerified = false. The user must re-verify via verify-secondary-email route. Writes audit_logs with both old and new email.
    await userRef.update({
      secondaryEmail: secondaryEmail.toLowerCase(),
      secondaryEmailVerified: false,
    });

    // Log the update
    await db.collection('audit_logs').add({
      userId: uid,
      action: 'secondary_email_updated',
      data: {
        previousEmail: userData?.secondaryEmail || null,
        newEmail: secondaryEmail.toLowerCase(),
        correlationId,
      },
      timestamp: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: 'Secondary email updated. Please verify your new email address.',
    });
  } catch (error: any) {
    // GUID: API_UPDATE_SECONDARY_EMAIL-008-v04
    // [Intent] Top-level error handler — catches any unhandled exceptions, logs to error_logs, and returns a safe 500 response with correlation ID.
    // [Inbound Trigger] Any uncaught exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId to client for support reference. Golden Rule #1 compliance.
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/update-secondary-email', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);
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
