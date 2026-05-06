// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      GET
// Auth:        Firebase ID token + isAdmin=true in users/{uid}
// Reads:       race_results (count + sample), users (admin check + names), collectionGroup(predictions)
// Writes:      none
// Errors:      PX-2001 (auth), PX-2003 (admin), PX-5008 (compute), PX-5010 (degraded — health-only)
// Idempotent:  yes
// Side-effects: none (read-only health probe)
// Returns:     { status: 'healthy'|'degraded'|'down', ... diagnostic detail ... }
// ──────────────────────────────────────────────────────────────────
// GUID: API_ADMIN_HEALTH_STANDINGS-000-v01
// [Intent] Admin health probe for the cumulative standings calculation. Runs the same
//          shared lib that produces the on-screen standings and the email standings
//          table, validates the output against simple invariants, and returns a RAG
//          status the InterfaceHealthMonitor renders. The amber "degraded" check here
//          is the killer feature: had this existed in March, the broken email's
//          all-zeros pattern would have triggered amber the first time it ran.
// [Inbound Trigger] GET from InterfaceHealthMonitor (auto-refresh every 30s) and the
//                   admin "Run Diagnostic" button.
// [Downstream Impact] Read-only — does not write to any collection.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  type CumulativeStanding,
} from '@/lib/cumulative-standings';

export const dynamic = 'force-dynamic';

type HealthStatus = 'healthy' | 'degraded' | 'down';

interface HealthResponse {
  status: HealthStatus;
  responseTimeMs: number;
  raceResultsCount: number;
  predictionsCount?: number;
  scoresCount?: number;
  topFive?: CumulativeStanding[];
  warnings: string[];
  error?: string;
  errorCode?: string;
  correlationId: string;
  checkedAt: string;
}

// GUID: API_ADMIN_HEALTH_STANDINGS-001-v01
// [Intent] Apply heuristic invariants to a standings payload. Detects the specific bug
//          that prompted this whole feature: cumulative standings returning all-zeros
//          despite predictions and race_results both being non-empty. Returns a list of
//          warning strings — empty list means healthy, any entry means degraded.
// [Inbound Trigger] Called by GET after computeRaceScores returns successfully.
// [Downstream Impact] Drives the RAG colour in the admin dashboard. Tweak heuristics
//                     here to add new invariants; never throw — return warnings only.
function detectDegradation(args: {
  raceResultsCount: number;
  predictionsCount: number;
  scoresCount: number;
  standings: CumulativeStanding[];
}): string[] {
  const warnings: string[] = [];
  const { raceResultsCount, predictionsCount, scoresCount, standings } = args;

  // Invariant 1: race_results exist but compute produced no scores → broken join.
  if (raceResultsCount > 0 && scoresCount === 0) {
    warnings.push(
      `race_results has ${raceResultsCount} doc(s) but compute returned 0 score rows — predictions and races are not being joined.`,
    );
  }

  // Invariant 2: predictions exist AND races scored AND no team has any points → the all-zeros bug.
  if (predictionsCount > 0 && raceResultsCount > 0 && standings.length > 0) {
    const topPoints = standings[0]?.totalPoints ?? 0;
    if (topPoints === 0) {
      warnings.push(
        `All ${standings.length} team(s) at 0 points despite ${raceResultsCount} race(s) and ${predictionsCount} prediction(s). This is the all-zeros pattern.`,
      );
    }
  }

  // Invariant 3: standings empty but predictions and races both exist → totals never accumulated.
  if (predictionsCount > 0 && raceResultsCount > 0 && standings.length === 0) {
    warnings.push(
      `Standings empty despite ${raceResultsCount} race(s) and ${predictionsCount} prediction(s) — likely no successful join.`,
    );
  }

  return warnings;
}

// GUID: API_ADMIN_HEALTH_STANDINGS-002-v01
// [Intent] GET handler. Verifies admin, runs the lib, applies invariants, returns RAG.
// [Inbound Trigger] InterfaceHealthMonitor on mount, on 30s tick, and on user-clicked diagnostic.
// [Downstream Impact] Errors return HTTP 200 with status=down so the admin UI can render
//                     the failure state without the fetch itself throwing. Real auth
//                     failures still return 401/403 so the admin UI can show "not signed in".
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const startedAt = performance.now();

  // ── Auth ──────────────────────────────────────────────────────────
  const verifiedUser = await verifyAuthToken(request.headers.get('authorization'));
  if (!verifiedUser) {
    return NextResponse.json(
      {
        status: 'down',
        responseTimeMs: 0,
        raceResultsCount: 0,
        warnings: [],
        error: 'Unauthorized',
        errorCode: ERRORS.AUTH_INVALID_TOKEN.code,
        correlationId,
        checkedAt: new Date().toISOString(),
      } as HealthResponse,
      { status: 401 },
    );
  }

  const { db } = await getFirebaseAdmin();
  const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
  if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
    return NextResponse.json(
      {
        status: 'down',
        responseTimeMs: 0,
        raceResultsCount: 0,
        warnings: [],
        error: 'Admin access required',
        errorCode: ERRORS.AUTH_ADMIN_REQUIRED.code,
        correlationId,
        checkedAt: new Date().toISOString(),
      } as HealthResponse,
      { status: 403 },
    );
  }

  // ── Probe ─────────────────────────────────────────────────────────
  try {
    // Count race_results and predictions cheaply (count() avoids a full doc read).
    const [raceResultsCountSnap, predictionsCountSnap] = await Promise.all([
      db.collection('race_results').count().get(),
      db.collectionGroup('predictions').count().get(),
    ]);
    const raceResultsCount = raceResultsCountSnap.data().count;
    const predictionsCount = predictionsCountSnap.data().count;

    // Now run the actual lib — the same code path used by /api/standings and the email.
    const [{ scores }, names] = await Promise.all([
      computeRaceScores(db),
      buildTeamNamesMap(db),
    ]);
    const standings = aggregateStandings(scores, names);
    const responseTimeMs = Math.round(performance.now() - startedAt);

    const warnings = detectDegradation({
      raceResultsCount,
      predictionsCount,
      scoresCount: scores.length,
      standings,
    });

    const status: HealthStatus = warnings.length === 0 ? 'healthy' : 'degraded';

    return NextResponse.json({
      status,
      responseTimeMs,
      raceResultsCount,
      predictionsCount,
      scoresCount: scores.length,
      topFive: standings.slice(0, 5),
      warnings,
      errorCode: warnings.length > 0 ? ERRORS.STANDINGS_HEALTH_DEGRADED.code : undefined,
      correlationId,
      checkedAt: new Date().toISOString(),
    } as HealthResponse);
  } catch (err: any) {
    // computeRaceScores already logged the error inside the lib (PX-5008). Just surface it.
    const responseTimeMs = Math.round(performance.now() - startedAt);
    return NextResponse.json({
      status: 'down',
      responseTimeMs,
      raceResultsCount: 0,
      warnings: [],
      error: err?.definition?.message ?? err?.message ?? 'Compute failed',
      errorCode: err?.definition?.code ?? ERRORS.SCORE_STANDINGS_FAILED.code,
      correlationId: err?.correlationId ?? correlationId,
      checkedAt: new Date().toISOString(),
    } as HealthResponse);
  }
}
