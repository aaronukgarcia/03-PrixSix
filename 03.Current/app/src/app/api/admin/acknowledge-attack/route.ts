// GUID: API_ADMIN_ACK_ATTACK-000-v01
// @SECURITY_FIX: Created server-side API endpoint for attack alert acknowledgement (ADMINCOMP-013).
//                Replaces direct client-side Firestore writes with authenticated endpoint.
// [Intent] API endpoint for admins to acknowledge attack alerts with proper authorization.
// [Inbound Trigger] POST request from AttackMonitor component when admin clicks "Acknowledge" or "Acknowledge All".
// [Downstream Impact] Updates attack_alerts Firestore collection. Requires admin authentication.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/admin';
import { verifyAuthToken } from '@/lib/auth';
import { FieldValue } from 'firebase-admin/firestore';

// GUID: API_ADMIN_ACK_ATTACK-001-v01
// [Intent] POST handler that authenticates the user, verifies admin status, and acknowledges one or more attack alerts.
// [Inbound Trigger] POST request with { alertId: string } or { alertIds: string[] } in body.
// [Downstream Impact] Updates attack_alerts documents with acknowledged=true, acknowledgedBy, and acknowledgedAt timestamp.
export async function POST(request: NextRequest) {
  try {
    // GUID: API_ADMIN_ACK_ATTACK-002-v01
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

    // GUID: API_ADMIN_ACK_ATTACK-003-v01
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

    // GUID: API_ADMIN_ACK_ATTACK-004-v01
    // [Intent] Extract and validate alert ID(s) from request body (supports single or batch).
    // [Inbound Trigger] Parse JSON body and check for alertId or alertIds field.
    // [Downstream Impact] Returns 400 if neither field is provided or if format is invalid.
    const body = await request.json();
    const { alertId, alertIds } = body;

    // Support both single and batch acknowledgement
    let targetAlertIds: string[];
    if (alertId && typeof alertId === 'string') {
      targetAlertIds = [alertId];
    } else if (Array.isArray(alertIds) && alertIds.every(id => typeof id === 'string')) {
      targetAlertIds = alertIds;
    } else {
      return NextResponse.json(
        { success: false, error: 'Valid alertId (string) or alertIds (string[]) is required' },
        { status: 400 }
      );
    }

    if (targetAlertIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one alert ID must be provided' },
        { status: 400 }
      );
    }

    // GUID: API_ADMIN_ACK_ATTACK-005-v01
    // [Intent] Validate that all alert IDs exist before updating any documents (atomic check).
    // [Inbound Trigger] Fetch all attack_alerts documents by ID.
    // [Downstream Impact] Returns 404 if any alert ID does not exist; prevents partial updates.
    const alertRefs = targetAlertIds.map(id => db.collection('attack_alerts').doc(id));
    const alertDocs = await Promise.all(alertRefs.map(ref => ref.get()));

    const missingIds = targetAlertIds.filter((id, index) => !alertDocs[index].exists);
    if (missingIds.length > 0) {
      return NextResponse.json(
        { success: false, error: `Attack alert(s) not found: ${missingIds.join(', ')}` },
        { status: 404 }
      );
    }

    // GUID: API_ADMIN_ACK_ATTACK-006-v01
    // [Intent] Update all target alerts with acknowledgement data in parallel.
    // [Inbound Trigger] Execute updateDoc for all validated alert IDs.
    // [Downstream Impact] Real-time listeners in AttackMonitor will reflect the changes.
    const now = FieldValue.serverTimestamp();
    await Promise.all(
      alertRefs.map(ref =>
        ref.update({
          acknowledged: true,
          acknowledgedBy: verifiedUser.uid,
          acknowledgedAt: now,
        })
      )
    );

    return NextResponse.json({
      success: true,
      message: `Successfully acknowledged ${targetAlertIds.length} alert(s)`,
      acknowledgedCount: targetAlertIds.length,
    });
  } catch (error: any) {
    console.error('Error acknowledging attack alert(s):', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
