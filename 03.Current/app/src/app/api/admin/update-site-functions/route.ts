// GUID: API_ADMIN_SITE_FUNCTIONS-000-v01
// @SECURITY_FIX: Server-side API for admin site function configuration (ADMINCOMP-005).
// [Intent] Provides authenticated, business-rule-enforced endpoint for toggling global site functions.
//          Prevents site lockout by requiring at least one authentication method enabled.
//          Replaces direct client-side Firestore writes from SiteFunctionsManager.tsx.
// [Inbound Trigger] POST request from admin SiteFunctionsManager component.
// [Downstream Impact] Updates admin_configuration/global document. Login and signup flows
//                     check these flags to allow/block access. Audit trail created for accountability.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { FieldValue } from 'firebase-admin/firestore';

// GUID: API_ADMIN_SITE_FUNCTIONS-001-v01
// [Intent] Type contract for site function configuration request.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] Requires adminUid for verification and new toggle states for both functions.
interface UpdateSiteFunctionsRequest {
  adminUid: string;
  userLoginEnabled: boolean;
  newUserSignupEnabled: boolean;
}

// GUID: API_ADMIN_SITE_FUNCTIONS-002-v01
// [Intent] Main POST handler that verifies admin authentication, enforces business rules,
//          updates site function configuration, and logs the change to audit_logs.
// [Inbound Trigger] HTTP POST to /api/admin/update-site-functions with toggle states.
// [Downstream Impact] Updates admin_configuration/global document. Creates audit log entry.
//                     Enforces critical business rule: at least one auth method must remain enabled.
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

    const body: UpdateSiteFunctionsRequest = await request.json();
    const { adminUid, userLoginEnabled, newUserSignupEnabled } = body;

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

    // BUSINESS RULE: Prevent site lockout - at least one authentication method must be enabled
    if (!userLoginEnabled && !newUserSignupEnabled) {
      return NextResponse.json(
        {
          success: false,
          error: 'Business rule violation: Cannot disable both login and signup. At least one authentication method must remain enabled to prevent site lockout.',
          errorCode: ERRORS.VALIDATION_BUSINESS_RULE.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // Update site function configuration
    const configRef = db.collection('admin_configuration').doc('global');
    await configRef.set({
      userLoginEnabled,
      newUserSignupEnabled,
      lastUpdatedAt: FieldValue.serverTimestamp(),
      lastUpdatedBy: adminUid,
    }, { merge: true });

    // Log the configuration change to audit_logs
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'admin_update_site_functions',
      data: {
        userLoginEnabled,
        newUserSignupEnabled,
        correlationId,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'Site functions updated successfully',
      settings: {
        userLoginEnabled,
        newUserSignupEnabled,
      },
    });

  } catch (error: any) {
    // GUID: API_ADMIN_SITE_FUNCTIONS-003-v01
    // [Intent] Top-level error handler for uncaught exceptions.
    // [Inbound Trigger] Any unhandled exception within the POST handler.
    // [Downstream Impact] Logs error to error_logs collection and returns safe 500 response.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/update-site-functions', action: 'POST' },
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
