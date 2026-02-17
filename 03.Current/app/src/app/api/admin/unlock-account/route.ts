// GUID: API_ADMIN_UNLOCK-000-v01
// @SECURITY_FIX: Admin endpoint to unlock locked-out user accounts (GEMINI-AUDIT-012).
// [Intent] Provides emergency unlock functionality for administrators to reset failed login attempts.
//          Verifies admin authentication, validates target user exists, resets badLoginAttempts to 0,
//          and logs the unlock action to audit_logs for accountability.
// [Inbound Trigger] POST request from admin UI when admin clicks "Unlock Account" button.
// [Downstream Impact] Resets badLoginAttempts and lastFailedLoginAt on target user document,
//                     allowing them to attempt login again immediately. Writes to audit_logs.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { FieldValue } from 'firebase-admin/firestore';

// GUID: API_ADMIN_UNLOCK-001-v01
// [Intent] Type contract for the unlock account request payload.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] Requires adminUid (for verification) and targetUserEmail to identify the account to unlock.
interface UnlockAccountRequest {
  adminUid: string;
  targetUserEmail: string;
}

// GUID: API_ADMIN_UNLOCK-002-v01
// [Intent] Main POST handler that verifies admin authentication, checks admin permissions,
//          finds the target user, resets their lockout state, and logs the unlock action.
// [Inbound Trigger] HTTP POST to /api/admin/unlock-account with adminUid and targetUserEmail.
// [Downstream Impact] Resets badLoginAttempts and lastFailedLoginAt on the target user document.
//                     Creates audit log entry for admin accountability. Returns success/error response.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // SECURITY: Verify Firebase Auth token
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

    const body: UnlockAccountRequest = await request.json();
    const { adminUid, targetUserEmail } = body;

    // SECURITY: Verify the authenticated user matches the adminUid
    if (verifiedUser.uid !== adminUid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Admin UID mismatch',
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // Verify admin has admin privileges
    const adminDoc = await db.collection('users').doc(adminUid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Admin privileges required',
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    // Find target user by email
    const normalizedEmail = targetUserEmail.toLowerCase().trim();
    const targetUserQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (targetUserQuery.empty) {
      return NextResponse.json(
        {
          success: false,
          error: 'Target user not found',
          errorCode: ERRORS.AUTH_USER_NOT_FOUND.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    const targetUserDoc = targetUserQuery.docs[0];
    const targetUserId = targetUserDoc.id;
    const targetUserData = targetUserDoc.data();

    // Reset lockout state
    await targetUserDoc.ref.update({
      badLoginAttempts: 0,
      lastFailedLoginAt: FieldValue.delete(),
    });

    // Log the unlock action to audit_logs
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'admin_unlock_account',
      data: {
        targetUserId,
        targetUserEmail: normalizedEmail,
        previousAttempts: targetUserData.badLoginAttempts || 0,
        correlationId,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: `Account unlocked successfully for ${normalizedEmail}`,
      targetUserId,
      previousAttempts: targetUserData.badLoginAttempts || 0,
    });

  } catch (error: any) {
    // GUID: API_ADMIN_UNLOCK-003-v01
    // [Intent] Top-level error handler for uncaught exceptions.
    // [Inbound Trigger] Any unhandled exception within the POST handler.
    // [Downstream Impact] Logs error to error_logs collection and returns safe 500 response.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/unlock-account', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, db);
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
