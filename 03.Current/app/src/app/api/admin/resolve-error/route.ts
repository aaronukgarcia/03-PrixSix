// GUID: API_ADMIN_RESOLVE-000-v01
// @SECURITY_FIX: Created server-side API endpoint for error dismissal (ADMINCOMP-012).
//                Replaces direct client-side Firestore writes with authenticated endpoint.
// [Intent] API endpoint for admins to mark error logs as resolved with proper authorization.
// [Inbound Trigger] POST request from ErrorLogViewer component when admin clicks "Mark as Resolved".
// [Downstream Impact] Updates error_logs Firestore collection. Requires admin authentication.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// GUID: API_ADMIN_RESOLVE-001-v01
// [Intent] POST handler that authenticates the user, verifies admin status, and marks an error log as resolved.
// [Inbound Trigger] POST request with { errorLogId: string } in body.
// [Downstream Impact] Updates error_logs/{errorLogId} document with resolved=true and timestamp.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // Get Firestore instance
    const { db } = await getFirebaseAdmin();

    // GUID: API_ADMIN_RESOLVE-002-v01
    // [Intent] Authenticate the user via Authorization header token.
    // [Inbound Trigger] Extract Authorization header from request.
    // [Downstream Impact] Returns 401 if token invalid or missing.
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // GUID: API_ADMIN_RESOLVE-003-v01
    // [Intent] Verify the authenticated user has admin privileges.
    // [Inbound Trigger] Check users/{uid} document for isAdmin field.
    // [Downstream Impact] Returns 403 if user is not an admin.
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    // GUID: API_ADMIN_RESOLVE-004-v01
    // [Intent] Extract and validate the errorLogId from request body.
    // [Inbound Trigger] Parse JSON body and check for errorLogId field.
    // [Downstream Impact] Returns 400 if errorLogId is missing or invalid.
    const body = await request.json();
    const { errorLogId } = body;

    if (!errorLogId || typeof errorLogId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid errorLogId is required' },
        { status: 400 }
      );
    }

    // GUID: API_ADMIN_RESOLVE-005-v01
    // [Intent] Verify the error log exists before attempting to update it.
    // [Inbound Trigger] Fetch error_logs/{errorLogId} document.
    // [Downstream Impact] Returns 404 if error log does not exist.
    const errorLogRef = db.collection('error_logs').doc(errorLogId);
    const errorLogDoc = await errorLogRef.get();

    if (!errorLogDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Error log not found' },
        { status: 404 }
      );
    }

    // GUID: API_ADMIN_RESOLVE-006-v01
    // [Intent] Mark the error log as resolved with timestamp and admin info.
    // [Inbound Trigger] Update error_logs/{errorLogId} with resolved=true.
    // [Downstream Impact] Real-time listeners in ErrorLogViewer will reflect the change.
    await errorLogRef.update({
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy: verifiedUser.uid,
    });

    return NextResponse.json({
      success: true,
      message: 'Error log marked as resolved',
    });
  } catch (error: any) {
    // GUID: API_ADMIN_RESOLVE-007-v02
    // @GOLDEN_RULE_1: Proper error logging with 4-pillar pattern (Phase 4 compliance).
    // [Intent] Log error to error_logs collection with correlation ID and traced error context.
    // [Inbound Trigger] Any uncaught exception during error log resolution.
    // [Downstream Impact] Error logged for debugging, correlation ID returned to client for support tracking.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/resolve-error', action: 'POST' },
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
