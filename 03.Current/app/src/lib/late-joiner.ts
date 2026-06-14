// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       race_results (ids), users/{lastPlace}/predictions, + cumulative-standings reads
// Writes:      users/{uid}/predictions (cloned), standings_adjustments/{uid}, audit_logs (many)
// Errors:      caught by caller; this lib throws on hard failure
// Idempotent:  NO — re-running clones again; call once per new late joiner
// SSOT:        Single source of truth for the late-joiner handicap mechanic. Used by
//                - /api/auth/signup (on registration when the season is under way)
//              The manual one-off correction for "Geepers AI" (2026-06-14) applied the same shape
//              by hand; this lib is what makes every future late joiner consistent.
// ──────────────────────────────────────────────────────────────────
// GUID: LIB_LATE_JOINER-000-v01
// [Intent] Apply the league's late-joiner rule when a team registers after the season has started:
//          (1) clone the CURRENT last-place team's predictions for every already-completed race so
//          the newcomer's prior-race scores mirror last place, and (2) record a one-time -5 penalty
//          in standings_adjustments so they start exactly 5 points behind last place going into their
//          first race. Every cloned submission and the team creation are written to audit_logs for
//          full transparency. The newcomer then plays their first (upcoming) race on their own picks.
// [Inbound Trigger] Called by /api/auth/signup after the user + league enrolment succeed.
// [Downstream Impact] The cloned predictions are scored by @/lib/cumulative-standings exactly like
//          any real prediction (race-specific match → not affected by the carry-forward gate). The
//          -5 adjustment is folded into standings via readStandingsAdjustments. The user doc gains
//          lateJoiner flags that drive the welcome/acknowledgement screen.

import { getFirebaseAdmin } from '@/lib/firebase-admin';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
} from '@/lib/cumulative-standings';
import { normalizeRaceIdForComparison } from '@/lib/normalize-race-id';
import { RaceSchedule } from '@/lib/data';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

/** The one-time penalty (points) every late joiner receives. Mirrors SCORING_POINTS.lateJoinerPenalty. */
export const LATE_JOINER_PENALTY = -5;

export interface LateJoinerResult {
  applied: boolean;
  reason?: string;
  clonedFromUserId?: string;
  clonedFromTeamName?: string;
  clonedCount?: number;
  penalty?: number;
  lastPlacePoints?: number;
  nextRaceName?: string;
}

// GUID: LIB_LATE_JOINER-001-v01
// [Intent] The next race the new joiner will actually play on their own — the first race whose start
//          is still in the future. Shown on the welcome screen. Falls back to the final race if the
//          season is over (defensive; late joins should not happen then).
function getNextRaceName(nowMs: number): string {
  const upcoming = RaceSchedule.find((r) => new Date(r.raceTime).getTime() > nowMs);
  return (upcoming ?? RaceSchedule[RaceSchedule.length - 1])?.name ?? 'the next race';
}

// GUID: LIB_LATE_JOINER-002-v01
// [Intent] Apply the full late-joiner handicap (clone + penalty + flags + audit) for a freshly
//          created user. Returns {applied:false} when the season has not started (no scored races),
//          in which case the caller leaves the user at a normal zero start.
// [Inbound Trigger] /api/auth/signup.
// [Downstream Impact] See file contract. Throws only on unexpected Firestore failure; the caller
//          wraps this in try/catch so a handicap failure never blocks account creation.
export async function applyLateJoinerHandicap(
  db: AdminFirestore,
  uid: string,
  teamName: string,
): Promise<LateJoinerResult> {
  const { FieldValue } = await getFirebaseAdmin();
  const nowMs = Date.now();

  // 1. Current standings via the same lib the standings page uses.
  const [{ scores }, names] = await Promise.all([
    computeRaceScores(db),
    buildTeamNamesMap(db),
  ]);
  const standings = aggregateStandings(scores, names);

  // Season not under way yet → no handicap; newcomer starts at 0 like everyone did.
  if (standings.length === 0) {
    return { applied: false, reason: 'Season has not started — no handicap applied' };
  }

  // 2. Last-place team (lowest total). standings is already sorted desc, so take the last entry.
  const lastPlace = standings[standings.length - 1];
  const lastPlacePoints = lastPlace.totalPoints;

  // 3. Which races are already completed (have results) — only clone prior races, never the
  //    upcoming one the newcomer will play themselves.
  const resultsSnap = await db.collection('race_results').get();
  const completedNormalised = new Set<string>();
  resultsSnap.forEach((d) => completedNormalised.add(normalizeRaceIdForComparison(d.id)));

  // 4. Clone last-place team's predictions for those completed races into the new user.
  //    Secondary teams (`${uid}-secondary`) can be last place — strip the suffix to read the
  //    owning user's predictions subcollection.
  const sourceUserId = lastPlace.userId.replace(/-secondary$/, '');
  const sourcePredsSnap = await db
    .collection('users').doc(sourceUserId)
    .collection('predictions').get();

  const batch = db.batch();
  let clonedCount = 0;
  const auditEntries: Array<{ raceId: string; predictions: string[] }> = [];

  sourcePredsSnap.forEach((pd) => {
    const data: any = pd.data();
    if (!Array.isArray(data.predictions) || data.predictions.length !== 6) return;
    const norm = data.raceId ? normalizeRaceIdForComparison(data.raceId) : null;
    if (!norm || !completedNormalised.has(norm)) return; // only completed/prior races

    const newDocId = `${uid}_${data.raceId}`;
    const ref = db.collection('users').doc(uid).collection('predictions').doc(newDocId);
    batch.set(ref, {
      userId: uid,
      teamId: uid,
      teamName,
      raceId: data.raceId,
      raceName: data.raceName || data.raceId,
      predictions: data.predictions,
      submittedAt: data.submittedAt || FieldValue.serverTimestamp(),
      id: newDocId,
      _clonedFromLateJoinerHandicap: true,
      _clonedFrom: sourceUserId,
      _clonedAt: FieldValue.serverTimestamp(),
    });
    auditEntries.push({ raceId: data.raceId, predictions: data.predictions });
    clonedCount++;
  });

  // 5. One-time -5 penalty adjustment (folded into standings by readStandingsAdjustments).
  batch.set(db.collection('standings_adjustments').doc(uid), {
    userId: uid,
    points: LATE_JOINER_PENALTY,
    label: 'Late-joining penalty',
    reason: `Joined mid-season. Prior-race scores cloned from last place (${lastPlace.teamName}); one-time ${LATE_JOINER_PENALTY} late-joining penalty so the team starts 5 points behind last place.`,
    createdAt: FieldValue.serverTimestamp(),
  });

  const nextRaceName = getNextRaceName(nowMs);

  // 6. User-doc flags that drive the welcome/acknowledgement screen.
  batch.set(db.collection('users').doc(uid), {
    lateJoiner: true,
    lateJoinerAcknowledged: false,
    lateJoinerInfo: {
      clonedFromUserId: sourceUserId,
      clonedFromTeamName: lastPlace.teamName,
      clonedCount,
      penalty: LATE_JOINER_PENALTY,
      lastPlacePoints,
      nextRaceName,
      appliedAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  // 7. Audit: team creation as a late joiner.
  batch.set(db.collection('audit_logs').doc(), {
    userId: uid,
    action: 'LATE_JOINER_TEAM_CREATED',
    details: {
      teamName,
      clonedFromUserId: sourceUserId,
      clonedFromTeamName: lastPlace.teamName,
      lastPlacePoints,
      clonedCount,
      penalty: LATE_JOINER_PENALTY,
      nextRaceName,
    },
    timestamp: FieldValue.serverTimestamp(),
  });

  // 8. Audit: EVERY cloned submission, individually — full transparency for all teams.
  auditEntries.forEach((e) => {
    batch.set(db.collection('audit_logs').doc(), {
      userId: uid,
      action: 'LATE_JOINER_PREDICTION_CLONED',
      details: {
        teamName,
        raceId: e.raceId,
        predictions: e.predictions,
        clonedFromUserId: sourceUserId,
        clonedFromTeamName: lastPlace.teamName,
      },
      timestamp: FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();

  return {
    applied: true,
    clonedFromUserId: sourceUserId,
    clonedFromTeamName: lastPlace.teamName,
    clonedCount,
    penalty: LATE_JOINER_PENALTY,
    lastPlacePoints,
    nextRaceName,
  };
}
