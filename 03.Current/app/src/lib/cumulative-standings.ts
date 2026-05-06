// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       race_results (all), collectionGroup(predictions) (all), users (for team names)
// Writes:      none — pure compute
// Errors:      PX-5008 (SCORE_STANDINGS_FAILED)
// Idempotent:  yes
// Side-effects: none
// SSOT:        Single source of truth for cumulative standings. Used by:
//                - /api/standings (the standings page)
//                - /api/send-results-email (results email)
//                - /api/admin/health/standings (admin health monitor)
//              Algorithm parity with the legacy client-side standings page
//              compute is enforced by app/scripts/verify-standings-parity.ts.
// Key gotcha:  carry-forward order is race-specific → strip -sprint suffix →
//              latest prior submission. Do NOT add a "submitted before race
//              start time" filter — the canonical algorithm does not have one.
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_CUMULATIVE_STANDINGS-000-v02
// [Intent] Server-side shared lib for cumulative season standings. Replaces three previous
//          implementations (standings page client-side, send-results-email inline, ad-hoc).
//          Faithfully ports the canonical algorithm from standings/page.tsx into admin SDK
//          land so the email handler, the standings API, and the admin health probe all
//          produce byte-identical output.
// [Inbound Trigger] Imported by /api/standings, /api/send-results-email, /api/admin/health/standings.
// [Downstream Impact] Any change here propagates to all three consumers — verify with
//                     scripts/verify-standings-parity.ts before deploying.

import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { calculateDriverPoints, SCORING_POINTS } from '@/lib/scoring-rules';
import { normalizeRaceIdForComparison } from '@/lib/normalize-race-id';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError } from '@/lib/traced-error';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

// GUID: LIB_CUMULATIVE_STANDINGS-001-v02
// [Intent] Granular per-(team × race) score row. Mirrors the ScoreData shape used by the
//          legacy standings page client-side compute so that downstream useMemo blocks
//          (chartData, raceWinners) consume this output unchanged once the page is migrated.
// [Inbound Trigger] Returned by computeRaceScores; consumed by aggregateStandings and by
//                   the standings page memos.
// [Downstream Impact] Adding a field is non-breaking; renaming or removing one breaks the
//                     standings page chart and the email standings table.
export interface ScoreData {
  /** Primary user UID, or `${uid}-secondary` for secondary teams. */
  userId: string;
  /** Normalised lowercase raceId (e.g., "australian-grand-prix-gp"). */
  raceId: string;
  /** Total points for this team in this race, including any bonus-all-6. */
  totalPoints: number;
}

// GUID: LIB_CUMULATIVE_STANDINGS-002-v02
// [Intent] Single ranked row in the cumulative standings table. Matches the shape expected
//          by the email handler's renderer.
// [Inbound Trigger] Returned by aggregateStandings.
// [Downstream Impact] Email HTML template and admin health sample renderer depend on this.
export interface CumulativeStanding {
  rank: number;
  userId: string;
  teamName: string;
  totalPoints: number;
}

// GUID: LIB_CUMULATIVE_STANDINGS-003-v01
// [Intent] Options for aggregateStandings. leagueMemberUserIds enables server-side league
//          filtering without making the lib aware of the league domain model.
// [Inbound Trigger] Passed by /api/standings when ?leagueId is supplied.
// [Downstream Impact] None — purely advisory.
export interface AggregateOptions {
  /** Restrict aggregation to these userIds. Undefined = include everyone. */
  leagueMemberUserIds?: string[];
  /** Restrict aggregation to scores from these raceIds (used for "after race N" snapshots). */
  limitToRaceIds?: Set<string>;
}

// GUID: LIB_CUMULATIVE_STANDINGS-004-v02
// [Intent] Compute granular per-(team × race) scores from race_results × predictions.
//          Faithful port of the canonical standings/page.tsx:220-330 algorithm.
//          Carry-forward order: race-specific → strip -sprint suffix → latest prior submission.
//          Uses SCORING_POINTS.bonusAll6 + calculateDriverPoints for parity with the
//          per-race scoring engine in /api/calculate-scores.
// [Inbound Trigger] Called by /api/standings, /api/send-results-email, /api/admin/health/standings.
// [Downstream Impact] All three consumers depend on this return shape and the precise
//                     carry-forward semantics. Errors are logged with PX-5008 and re-thrown
//                     as TracedError so callers can surface a correlation ID to the user.
export async function computeRaceScores(db: AdminFirestore): Promise<{
  scores: ScoreData[];
  raceIdsWithScores: Set<string>;
}> {
  try {
    const [raceResultsSnap, predictionsSnap] = await Promise.all([
      db.collection('race_results').get(),
      db.collectionGroup('predictions').get(),
    ]);

    // Build resultDocId → top-6 driver array. Empty driver fields are preserved as-is so
    // calculateDriverPoints sees position -1 (not in top 6) for an empty pick.
    const raceResultsMap = new Map<string, string[]>();
    raceResultsSnap.forEach((resultDoc) => {
      const data = resultDoc.data();
      if (!data) return;
      raceResultsMap.set(resultDoc.id, [
        data.driver1, data.driver2, data.driver3,
        data.driver4, data.driver5, data.driver6,
      ]);
    });

    if (raceResultsMap.size === 0) {
      return { scores: [], raceIdsWithScores: new Set() };
    }

    // Build teamId → normalisedRaceId → { predictions, timestamp }.
    // Drops malformed prediction docs (predictions array missing or wrong length).
    // Keeps the latest submission per (teamId, raceId) by submittedAt timestamp (millis).
    const teamPredictionsByRace = new Map<string, Map<string, { predictions: string[]; timestamp: number }>>();
    predictionsSnap.forEach((predDoc) => {
      const predData: any = predDoc.data();
      if (!Array.isArray(predData.predictions) || predData.predictions.length !== 6) return;

      // users/{userId}/predictions/{predId}
      const pathParts = predDoc.ref.path.split('/');
      const baseUserId = pathParts[1];
      const teamId: string = predData.teamId || baseUserId;

      // Convert to millis for safe comparison. Tolerate Timestamp, ISO string, or missing.
      let timestamp = 0;
      if (predData.submittedAt && typeof predData.submittedAt.toMillis === 'function') {
        timestamp = predData.submittedAt.toMillis();
      } else if (predData.createdAt && typeof predData.createdAt.toMillis === 'function') {
        timestamp = predData.createdAt.toMillis();
      }

      const predRaceId = predData.raceId ? normalizeRaceIdForComparison(predData.raceId) : null;
      if (!predRaceId) return;

      if (!teamPredictionsByRace.has(teamId)) {
        teamPredictionsByRace.set(teamId, new Map());
      }
      const teamRaces = teamPredictionsByRace.get(teamId)!;
      const existing = teamRaces.get(predRaceId);
      if (!existing || timestamp > existing.timestamp) {
        teamRaces.set(predRaceId, { predictions: predData.predictions, timestamp });
      }
    });

    const scores: ScoreData[] = [];
    const raceIdsWithScores = new Set<string>();

    raceResultsMap.forEach((actualResults, resultDocId) => {
      const normalizedResultId = normalizeRaceIdForComparison(resultDocId);

      teamPredictionsByRace.forEach((raceMap, teamId) => {
        let teamPredictions: string[] | null = null;

        // (1) Race-specific match
        if (raceMap.has(normalizedResultId)) {
          teamPredictions = raceMap.get(normalizedResultId)!.predictions;
        }
        // (2) Sprint → strip -sprint suffix and look up GP-style key
        else if (normalizedResultId.endsWith('-sprint')) {
          const baseRaceId = normalizedResultId.replace(/-sprint$/, '');
          if (raceMap.has(baseRaceId)) {
            teamPredictions = raceMap.get(baseRaceId)!.predictions;
          }
        }
        // (3) Carry forward — latest prior submission across all races for this team
        if (!teamPredictions) {
          let latestTs = 0;
          raceMap.forEach(({ predictions, timestamp }) => {
            if (timestamp > latestTs) {
              latestTs = timestamp;
              teamPredictions = predictions;
            }
          });
        }
        if (!teamPredictions) return;

        let totalPoints = 0;
        let correctCount = 0;
        teamPredictions.forEach((driverId, predictedPosition) => {
          const actualPosition = actualResults.indexOf(driverId);
          totalPoints += calculateDriverPoints(predictedPosition, actualPosition);
          if (actualPosition !== -1) correctCount++;
        });
        if (correctCount === 6) totalPoints += SCORING_POINTS.bonusAll6;

        scores.push({ userId: teamId, raceId: normalizedResultId, totalPoints });
        raceIdsWithScores.add(normalizedResultId);
      });
    });

    return { scores, raceIdsWithScores };
  } catch (err) {
    // Golden Rule #1 — every error logged with correlation ID and registry-sourced code.
    const correlationId = generateCorrelationId();
    await logError({
      correlationId,
      error: err instanceof Error ? err : new Error(String(err)),
      context: {
        action: 'computeRaceScores',
        additionalInfo: {
          errorKey: ERRORS.SCORE_STANDINGS_FAILED.key,
          module: 'LIB_CUMULATIVE_STANDINGS',
        },
      },
    });
    throw createTracedError(ERRORS.SCORE_STANDINGS_FAILED, {
      correlationId,
      cause: err instanceof Error ? err : undefined,
      context: { module: 'LIB_CUMULATIVE_STANDINGS', action: 'computeRaceScores' },
    });
  }
}

// GUID: LIB_CUMULATIVE_STANDINGS-005-v02
// [Intent] Sum granular ScoreData entries by userId, look up team names, sort descending,
//          assign ranks with tie handling (teams on equal points share a rank, the next
//          team's rank skips). Optional league filter restricts which userIds are summed;
//          optional limitToRaceIds restricts which races contribute (for "after race N").
// [Inbound Trigger] Called immediately after computeRaceScores by every consumer.
// [Downstream Impact] Tie-rank semantics match standings/page.tsx:540-547. Changing them
//                     diverges this lib from the canonical UI.
export function aggregateStandings(
  scores: ScoreData[],
  names: Map<string, string>,
  opts: AggregateOptions = {},
): CumulativeStanding[] {
  const allowedUsers: Set<string> | null = opts.leagueMemberUserIds
    ? new Set(opts.leagueMemberUserIds)
    : null;

  const totals = new Map<string, number>();
  scores.forEach((score) => {
    if (opts.limitToRaceIds && !opts.limitToRaceIds.has(score.raceId)) return;
    if (allowedUsers && !allowedUsers.has(score.userId)) return;
    totals.set(score.userId, (totals.get(score.userId) ?? 0) + score.totalPoints);
  });

  const sorted = Array.from(totals.entries())
    .map(([userId, totalPoints]) => ({
      userId,
      teamName: names.get(userId) ?? 'Unknown Team',
      totalPoints,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  let rank = 1;
  let previousPoints = -1;
  return sorted.map((entry, index) => {
    if (entry.totalPoints !== previousPoints) {
      rank = index + 1;
      previousPoints = entry.totalPoints;
    }
    return { ...entry, rank };
  });
}

// GUID: LIB_CUMULATIVE_STANDINGS-006-v01
// [Intent] Helper for callers: build a teamNamesByUid map from the users collection,
//          handling both primary teams and `${uid}-secondary` suffixed entries. Centralised
//          here so /api/standings, /api/send-results-email, and the health probe all
//          resolve names identically — including secondaries which the previous email
//          handler implementation silently dropped.
// [Inbound Trigger] Called by every consumer after computeRaceScores returns scores.
// [Downstream Impact] If a user doc is missing teamName, the entry is skipped — caller
//                     will see "Unknown Team" as the team name in the resulting standings.
export async function buildTeamNamesMap(db: AdminFirestore): Promise<Map<string, string>> {
  const usersSnap = await db.collection('users').get();
  const map = new Map<string, string>();
  usersSnap.docs.forEach((doc) => {
    const data: any = doc.data();
    if (data?.teamName) {
      map.set(doc.id, data.teamName);
    }
    if (data?.secondaryTeamName) {
      map.set(`${doc.id}-secondary`, data.secondaryTeamName);
    }
  });
  return map;
}
