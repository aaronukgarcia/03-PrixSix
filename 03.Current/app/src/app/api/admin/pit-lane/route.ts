// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST
// Auth:        Firebase Auth bearer token — admin only
// Reads:       app-settings/pit-lane (current state)
// Writes:      app-settings/pit-lane (override field), audit_logs
// Body:        { action: 'open' | 'close' | 'clear' }
//              open  — force pit lane open regardless of clock
//              close — force pit lane closed regardless of clock
//              clear — remove override, revert to automatic clock logic
// Errors:      401 (auth), 403 (not admin), 400 (bad action)
// Idempotent:  YES — repeated calls with same action are safe
// Side-effects: Audit log entry written. Predictions page and dashboard
//               read app-settings/pit-lane in real-time via useDoc.
// ──────────────────────────────────────────────────────────────────

// GUID: API_PIT_LANE-000-v01
// [Intent] Admin API route to manually override the pit lane open/closed state.
//          By default the pit lane auto-opens/closes based on qualifying time.
//          This route lets an admin force-open, force-close, or clear the override.
//          All actions are written to audit_logs for traceability.
// [Inbound Trigger] POST from PitLaneAdmin component in admin panel.
// [Downstream Impact] Writes app-settings/pit-lane override field.
//   - predictions/page.tsx reads this via useDoc to compute isPitlaneOpen.
//   - submit-prediction/route.ts checks this before accepting submissions.
//   - dashboard reads this server-side via getFirebaseAdmin.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

// GUID: API_PIT_LANE-001-v01
// [Intent] Validate action is one of the three permitted values.
function isValidAction(action: unknown): action is 'open' | 'close' | 'clear' {
    return action === 'open' || action === 'close' || action === 'clear';
}

// GUID: API_PIT_LANE-002-v01
// [Intent] POST handler — verifies admin auth, validates action, writes override to
//          app-settings/pit-lane, and writes an audit_logs entry.
// [Inbound Trigger] PitLaneAdmin component calls POST /api/admin/pit-lane.
// [Downstream Impact] Pit lane state change is immediately visible to all players
//   via real-time Firestore subscription. Audit log records who made the change and when.
export async function POST(request: NextRequest): Promise<NextResponse> {
    const correlationId = generateCorrelationId();

    try {
        // Auth: verify Firebase token
        const authHeader = request.headers.get('Authorization');
        const verifiedUser = await verifyAuthToken(authHeader);
        if (!verifiedUser) {
            return NextResponse.json({ success: false, error: 'Unauthorised' }, { status: 401 });
        }

        // GUID: API_PIT_LANE-003-v01
        // [Intent] Admin-only gate — verify the calling user has isAdmin: true in Firestore.
        // [Downstream Impact] Non-admin users receive 403. Without this check, any
        //   authenticated user could force the pit lane open and allow post-qualifying submissions.
        const { db } = await getFirebaseAdmin();
        const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
        if (!userDoc.exists || !userDoc.data()?.isAdmin) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { action } = body;

        if (!isValidAction(action)) {
            return NextResponse.json(
                { success: false, error: 'Invalid action. Must be "open", "close", or "clear".' },
                { status: 400 }
            );
        }

        const adminEmail = userDoc.data()?.email || verifiedUser.uid;
        const now = new Date().toISOString();

        // GUID: API_PIT_LANE-004-v01
        // [Intent] Write the override state to app-settings/pit-lane and record an audit entry.
        //          Uses a batch for atomicity — both writes succeed or neither does.
        // [Inbound Trigger] Validated POST action from admin.
        // [Downstream Impact] app-settings/pit-lane.override is read by predictions page and
        //   submit-prediction API to determine effective pit lane state. Null override means
        //   auto (clock-based). "open"/"close" override the automatic behaviour.
        const batch = db.batch();

        const pitLaneRef = db.collection('app-settings').doc('pit-lane');
        const auditRef = db.collection('audit_logs').doc();

        // Map action to override value
        const overrideValue = action === 'clear' ? null : action; // null = auto

        batch.set(pitLaneRef, {
            override: overrideValue,
            overriddenBy: adminEmail,
            overriddenAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const auditAction = action === 'open'  ? 'pit_lane_force_opened'
                          : action === 'close' ? 'pit_lane_force_closed'
                          :                     'pit_lane_override_cleared';

        batch.set(auditRef, {
            userId: verifiedUser.uid,
            action: auditAction,
            details: {
                adminEmail,
                action,
                overrideValue,
                correlationId,
                timestamp: now,
            },
            correlationId,
            timestamp: FieldValue.serverTimestamp(),
        });

        await batch.commit();

        return NextResponse.json({ success: true, action, override: overrideValue });

    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: 'Internal server error', correlationId },
            { status: 500 }
        );
    }
}
