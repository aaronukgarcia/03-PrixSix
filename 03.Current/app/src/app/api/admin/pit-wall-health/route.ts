// GUID: API_ADMIN_PITWALL_HEALTH-000-v01
// [Intent] Admin-only health check endpoint for the Pit Wall module.
//          Returns OpenF1 connectivity, token status, and cache introspection.
// [Inbound Trigger] PitWallManager admin component polls this on mount and refresh.
// [Downstream Impact] Read-only — no side effects. Reports cache and OpenF1 state.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { getCacheStatus } from '@/lib/pit-wall-cache';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_PITWALL_HEALTH-001-v01
// [Intent] GET handler — returns Pit Wall health status including OpenF1 reachability,
//          token validity, and cache state for both live data and detail tiers.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();

  try {
    // Auth: verify Firebase token
    const authHeader = req.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);
    if (!verifiedUser) {
      return NextResponse.json(
        { error: 'Unauthorised', code: ERRORS.SESSION_INVALID.code, correlationId },
        { status: 401 },
      );
    }

    // Admin-only gate
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden', code: ERRORS.AUTH_ADMIN_REQUIRED.code, correlationId },
        { status: 403 },
      );
    }

    // OpenF1 connectivity check — lightweight ping to /sessions?session_key=latest
    let openf1Reachable = false;
    let openf1LatencyMs: number | null = null;
    let openf1SessionKey: number | null = null;
    let openf1SessionName: string | null = null;
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://api.openf1.org/v1/sessions?session_key=latest', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeout);
      openf1LatencyMs = Date.now() - start;
      if (res.ok) {
        openf1Reachable = true;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          openf1SessionKey = data[0].session_key ?? null;
          openf1SessionName = `${data[0].meeting_name ?? ''} — ${data[0].session_name ?? ''}`.trim();
        }
      }
    } catch {
      openf1Reachable = false;
    }

    // Cache status from shared module
    const cache = getCacheStatus();

    // Replay collection stats — use aggregation queries
    const replaySessionsSnap = await db.collection('replay_sessions').count().get();
    const replayChunksSnap = await db.collection('replay_chunks').count().get();
    const replayMetaSnap = await db.collection('replay_meta').count().get();

    return NextResponse.json({
      openf1: {
        reachable: openf1Reachable,
        latencyMs: openf1LatencyMs,
        sessionKey: openf1SessionKey,
        sessionName: openf1SessionName,
      },
      cache,
      collections: {
        replay_sessions: replaySessionsSnap.data().count,
        replay_chunks: replayChunksSnap.data().count,
        replay_meta: replayMetaSnap.data().count,
      },
      correlationId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Pit Wall health check failed', code: 'PX-3318', correlationId },
      { status: 500 },
    );
  }
}
