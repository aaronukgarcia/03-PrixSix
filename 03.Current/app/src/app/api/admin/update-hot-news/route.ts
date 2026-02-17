// GUID: API_ADMIN_HOT_NEWS-000-v01
// @SECURITY_FIX: Server-side API for admin hot news configuration (ADMINCOMP-006).
// [Intent] Provides authenticated endpoint for updating hot news content and toggle state.
//          Replaces direct client-side Firestore writes from HotNewsManager.tsx.
// [Inbound Trigger] POST request from admin HotNewsManager component.
// [Downstream Impact] Updates app-settings/hot-news document. Dashboard displays this content.
//                     Audit trail created for accountability.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { FieldValue } from 'firebase-admin/firestore';

// GUID: API_ADMIN_HOT_NEWS-001-v01
// [Intent] Type contract for hot news update request.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] Requires adminUid for verification, content, and toggle state.
interface UpdateHotNewsRequest {
  adminUid: string;
  content: string;
  hotNewsFeedEnabled: boolean;
}

// GUID: API_ADMIN_HOT_NEWS-002-v01
// [Intent] Main POST handler that verifies admin authentication, updates hot news content,
//          and logs the change to audit_logs.
// [Inbound Trigger] HTTP POST to /api/admin/update-hot-news with content and toggle state.
// [Downstream Impact] Updates app-settings/hot-news document. Creates audit log entry.
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

    const body: UpdateHotNewsRequest = await request.json();
    const { adminUid, content, hotNewsFeedEnabled } = body;

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

    // Update hot news configuration
    const hotNewsRef = db.collection('app-settings').doc('hot-news');
    await hotNewsRef.set({
      content,
      hotNewsFeedEnabled,
      lastUpdated: FieldValue.serverTimestamp(),
      updatedBy: adminUid,
    }, { merge: true });

    // Log the configuration change to audit_logs
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'admin_update_hot_news',
      data: {
        contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        contentLength: content.length,
        hotNewsFeedEnabled,
        correlationId,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'Hot news updated successfully',
      settings: {
        content,
        hotNewsFeedEnabled,
      },
    });

  } catch (error: any) {
    // GUID: API_ADMIN_HOT_NEWS-003-v01
    // [Intent] Top-level error handler for uncaught exceptions.
    // [Inbound Trigger] Any unhandled exception within the POST handler.
    // [Downstream Impact] Logs error to error_logs collection and returns safe 500 response.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/update-hot-news', action: 'POST' },
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
