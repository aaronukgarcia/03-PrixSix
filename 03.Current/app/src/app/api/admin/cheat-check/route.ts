// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      GET
// Auth:        Firebase Auth bearer token + server-side isAdmin check (users/{uid}.isAdmin)
// Reads:       race_schedule, predictions (collectionGroup), audit_logs (pit_lane_force_*,
//              login_success — capped), users
// Writes:      admin_configuration/cheatCheckStatus (lastRunAt, for the UI's own display —
//              not a hard rate limit; this route is read-only against the rest of the app)
// Errors:      401 (bad/missing token), 403 (not admin), 500 (unexpected failure)
// Idempotent:  YES — read-only against game data, safe to re-run any time
// ──────────────────────────────────────────────────────────────────
// GUID: API_ADMIN_CHEAT_CHECK-000-v01
// [Intent] Admin-only diagnostic: runs the checks in lib/cheat-check.ts (late submissions,
//          shared login IPs) and returns a summary the admin panel can render. Explicitly NOT
//          an automated ban/flag system — every finding is a lead for a human to look at.
// [Inbound Trigger] GET from CheatCheckManager.tsx when the admin clicks "Run Cheat Check".
// [Downstream Impact] No writes to game data. Writes only a status timestamp for the UI.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import {
  checkLateSubmissions,
  checkSharedLoginIPs,
  generateCheatCheckSummary,
  type PredictionRow,
  type RaceDeadline,
  type PitLaneOverrideEvent,
  type LoginEvent,
  type UserSummary,
  type CheatFinding,
} from '@/lib/cheat-check';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_CHEAT_CHECK-001-v01
// [Intent] GET handler — auth + isAdmin gate, fetch the data the pure check functions need,
//          run them, write a last-run status marker, return the summary.
// [Inbound Trigger] HTTP GET /api/admin/cheat-check with Authorization header.
// [Downstream Impact] See CONTRACT above.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);
    if (!verifiedUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized', correlationId }, { status: 401 });
    }

    const { db } = await getFirebaseAdmin();
    const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, error: 'Forbidden', correlationId }, { status: 403 });
    }

    // ── race_schedule → deadline map ──────────────────────────────────
    const scheduleSnap = await db.collection('race_schedule').get();
    const schedule: Record<string, RaceDeadline> = {};
    scheduleSnap.forEach(doc => {
      const x = doc.data();
      schedule[doc.id] = {
        id: doc.id,
        qualifyingTimeMs: x.qualifyingTime ? new Date(x.qualifyingTime).getTime() : null,
        sprintTimeMs: x.sprintTime ? new Date(x.sprintTime).getTime() : null,
      };
    });

    // ── predictions (collectionGroup) ─────────────────────────────────
    const predsSnap = await db.collectionGroup('predictions').limit(5000).get();
    const predictions: PredictionRow[] = predsSnap.docs.map(doc => {
      const x = doc.data();
      const submittedAtMs = x.submittedAt?.toMillis ? x.submittedAt.toMillis() : null;
      return {
        path: doc.ref.path,
        teamName: x.teamName ?? '(unknown team)',
        userId: x.userId ?? '',
        raceId: x.raceId ?? '',
        submittedAtMs,
        isCarryForward: x.isCarryForward === true,
      };
    });

    // ── admin pit-lane override windows ────────────────────────────────
    const overrideSnap = await db
      .collection('audit_logs')
      .where('action', 'in', ['pit_lane_force_opened', 'pit_lane_force_closed'])
      .limit(500)
      .get();
    const overrideEvents: PitLaneOverrideEvent[] = overrideSnap.docs.map(doc => {
      const x = doc.data();
      const action: 'open' | 'close' = x.action === 'pit_lane_force_opened' ? 'open' : 'close';
      return {
        action,
        atMs: x.timestamp?.toMillis ? x.timestamp.toMillis() : 0,
        adminEmail: x.details?.adminEmail,
      };
    }).filter(e => e.atMs > 0);

    // ── successful logins (for shared-IP check) ────────────────────────
    const loginSnap = await db
      .collection('audit_logs')
      .where('action', '==', 'login_success')
      .limit(5000)
      .get();
    const loginEvents: LoginEvent[] = loginSnap.docs
      .map(doc => {
        const x = doc.data();
        return { email: x.details?.email ?? '', ip: x.details?.ip ?? '' };
      })
      .filter(e => e.email && e.ip);

    // ── users (email → team/admin lookup) ───────────────────────────────
    const usersSnap = await db.collection('users').get();
    const usersByEmail: Record<string, UserSummary> = {};
    usersSnap.forEach(doc => {
      const x = doc.data();
      if (!x.email) return;
      usersByEmail[x.email] = {
        email: x.email,
        teamName: x.teamName ?? x.email,
        isAdmin: x.isAdmin === true,
      };
    });

    // ── run checks ───────────────────────────────────────────────────
    const findingsByCheck: Record<'late-submissions' | 'shared-login-ips', CheatFinding[]> = {
      'late-submissions': checkLateSubmissions(predictions, schedule, overrideEvents),
      'shared-login-ips': checkSharedLoginIPs(loginEvents, usersByEmail),
    };

    const summary = generateCheatCheckSummary(correlationId, findingsByCheck);

    // Status marker for the admin panel's "last run" display — not a rate limit.
    await db.collection('admin_configuration').doc('cheatCheckStatus').set(
      { lastRunAt: new Date().toISOString(), lastRunBy: verifiedUser.uid, totalFlags: summary.totalFlags, correlationId },
      { merge: true }
    );

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    await logError({
      correlationId,
      error: error instanceof Error ? error : new Error(String(error)),
      context: { route: '/api/admin/cheat-check', action: 'run_cheat_check' },
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', correlationId },
      { status: 500 }
    );
  }
}
