// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      GET
// Auth:        Firebase ID token (Authorization: Bearer <token>)
// Reads:       race_results (all), collectionGroup(predictions) (all), users, leagues (optional)
// Writes:      none
// Errors:      PX-2001 (auth), PX-5008 (compute), PX-5011 (fetch wrapper)
// Idempotent:  yes
// Side-effects: none
// Query:       ?leagueId=<id>  (optional; restricts standings to that league's members)
// Returns:     { scores: ScoreData[], standings: CumulativeStanding[], computedAt: ISO }
// ──────────────────────────────────────────────────────────────────
// GUID: API_STANDINGS-000-v01
// [Intent] Server-side cumulative standings endpoint. Single source of truth for the
//          standings page (replacing client-side compute) and any future consumer.
//          Delegates all algorithm to @/lib/cumulative-standings — this route is purely
//          auth + transport + optional league filter.
// [Inbound Trigger] GET request from /standings page (and any future consumer).
// [Downstream Impact] Replaces the inline collectionGroup compute previously done in
//                     the standings page client component. Caching is left to the caller
//                     for now — the page uses onSnapshot(race_results) as a refetch trigger.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  readStandingsAdjustments,
} from '@/lib/cumulative-standings';

export const dynamic = 'force-dynamic';

// GUID: API_STANDINGS-001-v01
// [Intent] Resolve a league document to its memberUserIds array, returning null if
//          the leagueId is missing or the league is global (which means "no filter").
//          Returns an empty array if the league exists but has no members — caller
//          should render an empty standings table in that case.
// [Inbound Trigger] Called by GET when ?leagueId is supplied.
// [Downstream Impact] memberUserIds is passed to aggregateStandings as a filter.
async function resolveLeagueMembers(
  db: Awaited<ReturnType<typeof getFirebaseAdmin>>['db'],
  leagueId: string,
): Promise<string[] | null> {
  const leagueDoc = await db.collection('leagues').doc(leagueId).get();
  if (!leagueDoc.exists) return null;
  const data: any = leagueDoc.data();
  if (data?.isGlobal) return null; // global = no filter
  return Array.isArray(data?.memberUserIds) ? data.memberUserIds : [];
}

// GUID: API_STANDINGS-002-v01
// [Intent] GET handler. Verifies the bearer token, optionally resolves a league filter,
//          calls the shared compute lib, and returns the granular ScoreData[] plus the
//          ranked CumulativeStanding[] in one payload. The page can rebuild its existing
//          memos (chartData, raceWinners) from scores without changing their shapes.
// [Inbound Trigger] Standings page on mount and on every onSnapshot(race_results) tick.
// [Downstream Impact] Errors logged to error_logs via logTracedError. The client surfaces
//                     PX-5011 with the correlation ID if the response is non-OK.
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuthToken(request.headers.get('authorization'));
    if (!auth) {
      const correlationId = generateCorrelationId();
      const traced = createTracedError(ERRORS.AUTH_INVALID_TOKEN, {
        correlationId,
        context: { route: '/api/standings', action: 'GET' },
      });
      await logTracedError(traced, (await getFirebaseAdmin()).db);
      return NextResponse.json(
        {
          success: false,
          error: traced.definition.message,
          errorCode: traced.definition.code,
          correlationId,
        },
        { status: 401 },
      );
    }

    const { db } = await getFirebaseAdmin();
    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');

    let leagueMemberUserIds: string[] | undefined;
    if (leagueId) {
      const members = await resolveLeagueMembers(db, leagueId);
      if (members !== null) leagueMemberUserIds = members;
    }

    // computeRaceScores + buildTeamNamesMap + adjustments are independent — fetch in parallel.
    const [{ scores: raceScores }, names, adjustmentRows] = await Promise.all([
      computeRaceScores(db),
      buildTeamNamesMap(db),
      readStandingsAdjustments(db),
    ]);

    // Fold late-joiner adjustments into the score stream as synthetic rows so the page, email,
    // and health probe all sum them identically (see readStandingsAdjustments / ADJUSTMENT_RACE_ID).
    const scores = [...raceScores, ...adjustmentRows];

    const standings = aggregateStandings(scores, names, { leagueMemberUserIds });

    return NextResponse.json({
      success: true,
      scores,
      standings,
      computedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    // computeRaceScores throws a TracedError already — preserve its correlationId/code
    // so the client can show the same Ref the user would see in the error log.
    const correlationId = error?.correlationId ?? generateCorrelationId();
    const code = error?.definition?.code ?? ERRORS.SCORE_STANDINGS_FAILED.code;
    const message = error?.definition?.message ?? 'Failed to load standings';

    if (!error?.definition) {
      // Wasn't a TracedError — wrap it now so the catch block matches the others' shape.
      const traced = createTracedError(ERRORS.SCORE_STANDINGS_FAILED, {
        correlationId,
        context: { route: '/api/standings', action: 'GET' },
        cause: error instanceof Error ? error : undefined,
      });
      await logTracedError(traced, (await getFirebaseAdmin()).db);
    }

    return NextResponse.json(
      {
        success: false,
        error: message,
        errorCode: code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
