// GUID: API_ADMIN_PITWALL_HEALTH-000-v02
// [Intent] Admin-only health check endpoint for the Pit Wall module.
//          v02: Added process metrics, cache hit/miss counters, and replay usage stats.
//          Returns OpenF1 connectivity, token status, cache introspection, and Node.js
//          process health (heap, RSS, event loop lag, high-water marks).
// [Inbound Trigger] PitWallManager admin component polls this on mount and refresh.
// [Downstream Impact] Read-only — no side effects. Reports cache, OpenF1, and process state.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { getCacheStatus, getCacheMetrics } from '@/lib/pit-wall-cache';
import { getFullMetrics } from '@/lib/pit-wall-metrics';

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

    // Process metrics + cache counters
    const fullMetrics = getFullMetrics();
    const cacheMetrics = getCacheMetrics();
    const metricsAgeMs = Date.now() - cacheMetrics.lastResetAt;

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
      metrics: {
        process: fullMetrics.process,
        highWaterMarks: {
          ...fullMetrics.highWaterMarks,
          peakActiveRequests: cacheMetrics.peakActiveRequests,
        },
        cache: {
          coreHits: cacheMetrics.coreHits,
          coreMisses: cacheMetrics.coreMisses,
          coreCoalesced: cacheMetrics.coreCoalesced,
          detailHits: cacheMetrics.detailHits,
          detailMisses: cacheMetrics.detailMisses,
          detailCoalesced: cacheMetrics.detailCoalesced,
          activeRequests: cacheMetrics.activeRequests,
          metricsAgeMs,
        },
        replay: fullMetrics.replay,
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
