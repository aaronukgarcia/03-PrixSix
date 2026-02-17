// GUID: API_ADMIN_AUDIT_SETTINGS-000-v01
// @SECURITY_FIX: Server-side API for admin audit logging configuration (GEMINI-AUDIT-002).
// [Intent] Provides authenticated endpoint for updating audit logging toggle state.
//          Moves configuration from hardcoded client-side to server-controlled setting.
// [Inbound Trigger] POST request from admin audit settings component (future implementation).
// [Downstream Impact] Updates admin_configuration/audit_settings document. Client-side audit
//                     logging will eventually read this value (Phase 4 implementation).
//                     Audit trail created for accountability.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { FieldValue } from 'firebase-admin/firestore';

// GUID: API_ADMIN_AUDIT_SETTINGS-001-v01
// [Intent] Type contract for audit settings update request.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] Requires adminUid for verification and auditLoggingEnabled toggle state.
interface UpdateAuditSettingsRequest {
  adminUid: string;
  auditLoggingEnabled: boolean;
}

// GUID: API_ADMIN_AUDIT_SETTINGS-002-v01
// [Intent] Main POST handler that verifies admin authentication, updates audit logging config,
//          and logs the change to audit_logs.
// [Inbound Trigger] HTTP POST to /api/admin/update-audit-settings with toggle state.
// [Downstream Impact] Updates admin_configuration/audit_settings document. Creates audit log entry.
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

    const body: UpdateAuditSettingsRequest = await request.json();
    const { adminUid, auditLoggingEnabled } = body;

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

    const adminEmail = adminDoc.data()?.email;

    // Update audit settings configuration
    const auditSettingsRef = db.collection('admin_configuration').doc('audit_settings');
    await auditSettingsRef.set({
      auditLoggingEnabled,
      lastUpdated: FieldValue.serverTimestamp(),
      updatedBy: adminUid,
    }, { merge: true });

    // Log the configuration change to audit_logs
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'admin_update_audit_settings',
      data: {
        auditLoggingEnabled,
        correlationId,
        email: adminEmail,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'Audit settings updated successfully',
      settings: {
        auditLoggingEnabled,
      },
    });

  } catch (error: any) {
    // GUID: API_ADMIN_AUDIT_SETTINGS-003-v01
    // [Intent] Top-level error handler for uncaught exceptions.
    // [Inbound Trigger] Any unhandled exception within the POST handler.
    // [Downstream Impact] Logs error to error_logs collection and returns safe 500 response.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/update-audit-settings', action: 'POST' },
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
