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
// GUID: LIB_LATE_JOINER-000-v02
// [Intent] Apply the league's late-joiner rule when a team registers after the season has started.
//          ACTIVE-FLOOR RULE (Aaron, 2026-07-26 — replaces "-5 below absolute last place"):
//          (1) find the lowest-placed ACTIVE team — a team with at least one manual (non-cloned)
//          submission in the last 3 completed race weekends — using FULLY-ADJUSTED standings
//          (the old flow ignored standings_adjustments, which once anchored a newcomer to the
//          bot's raw scored points); dormant husk accounts are ignored, so newcomers enter just
//          behind the living competition rather than below the graveyard;
//          (2) clone that team's predictions for every already-completed race so the newcomer's
//          prior-race scores mirror them, and (3) record a standings_adjustments value that lands
//          the newcomer's starting total exactly 1 point behind that team. Every cloned submission
//          and the team creation are written to audit_logs. The newcomer then plays their first
//          (upcoming) race on their own picks. Retro application to the five pre-rule joiners:
//          scripts/rebaseline-late-joiners.ts (2026-07-26).
// [Inbound Trigger] Called by /api/auth/signup after the user + league enrolment succeed.
// [Downstream Impact] The cloned predictions are scored by @/lib/cumulative-standings exactly like
//          any real prediction (race-specific match → not affected by the carry-forward gate). The
//          adjustment is folded into standings via readStandingsAdjustments. The user doc gains
//          lateJoiner flags that drive the welcome/acknowledgement screen.

import { getFirebaseAdmin } from '@/lib/firebase-admin';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  buildRaceRunMillisMap,
  readStandingsAdjustments,
} from '@/lib/cumulative-standings';
import { normalizeRaceIdForComparison } from '@/lib/normalize-race-id';
import { RaceSchedule } from '@/lib/data';

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdmin>>['db'];

/** Offset below the lowest ACTIVE team at which a late joiner enters. Mirrors SCORING_POINTS.lateJoinerPenalty. */
export const LATE_JOINER_PENALTY = -1;
/** A team counts as "active" if it manually submitted for one of this many most-recent completed weekends. */
export const ACTIVE_WINDOW_RACES = 3;

export interface LateJoinerResult {
  applied: boolean;
  reason?: string;
  clonedFromUserId?: string;
  clonedFromTeamName?: string;
  clonedCount?: number;
  penalty?: number;
  lastPlacePoints?: number;
  startingTotal?: number;
  adjustmentPoints?: number;
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

  // 1. Current standings via the same lib the standings page uses — WITH adjustments, so a
  //    prior late joiner's corrected baseline is what the floor calculation sees.
  const [{ scores }, names, adjustments] = await Promise.all([
    computeRaceScores(db),
    buildTeamNamesMap(db),
    readStandingsAdjustments(db),
  ]);
  const standings = aggregateStandings([...scores, ...adjustments], names);

  // Season not under way yet → no handicap; newcomer starts at 0 like everyone did.
  if (standings.length === 0) {
    return { applied: false, reason: 'Season has not started — no handicap applied' };
  }

  // 2. Which races are already completed (have results) — only clone prior races, never the
  //    upcoming one the newcomer will play themselves.
  const resultsSnap = await db.collection('race_results').get();
  const completedNormalised = new Set<string>();
  resultsSnap.forEach((d) => completedNormalised.add(normalizeRaceIdForComparison(d.id)));

  // 3. Lowest ACTIVE team (the entry anchor). Active = at least one manual (non-cloned)
  //    submission for one of the last ACTIVE_WINDOW_RACES completed GP weekends, submitted
  //    before now. Dormant husk accounts fail this test and are ignored.
  const runMillis = buildRaceRunMillisMap();
  const windowGPs = [...completedNormalised]
    .filter((id) => !id.endsWith('-sprint'))
    .map((id) => ({ id, ms: runMillis.get(id) }))
    .filter((r): r is { id: string; ms: number } => typeof r.ms === 'number' && r.ms < nowMs)
    .sort((a, b) => a.ms - b.ms)
    .slice(-ACTIVE_WINDOW_RACES)
    .map((r) => r.id);
  const windowSet = new Set(windowGPs);

  const allPredsSnap = await db.collectionGroup('predictions').get();
  const activeTeamIds = new Set<string>();
  allPredsSnap.forEach((pd) => {
    const p: any = pd.data();
    if (p._clonedFromLateJoinerHandicap) return;
    const teamId = p.teamId || p.userId;
    const predRaceId = p.raceId ? normalizeRaceIdForComparison(p.raceId) : null;
    if (!teamId || !predRaceId || !windowSet.has(predRaceId)) return;
    const ms = typeof p.submittedAt?.toMillis === 'function' ? p.submittedAt.toMillis() : 0;
    if (ms > 0 && ms < nowMs) activeTeamIds.add(teamId);
  });
  activeTeamIds.delete(uid);
  activeTeamIds.delete(`${uid}-secondary`);

  // standings is sorted desc — the last active entry in it is the lowest-placed active team.
  const activeStandings = standings.filter((s) => activeTeamIds.has(s.userId));
  if (activeStandings.length === 0) {
    // Defensive fallback: no active teams found (should not happen mid-season) — use absolute
    // last place rather than failing the signup.
    activeStandings.push(standings[standings.length - 1]);
  }
  const lastPlace = activeStandings[activeStandings.length - 1];
  const lastPlacePoints = lastPlace.totalPoints;

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

  // 5. Adjustment that lands the newcomer's starting total exactly 1 behind the lowest active
  //    team: (floor - 1) - clonedBaseline, where clonedBaseline is what the cloned predictions
  //    will actually score (the source's own scored points for completed races, without any
  //    adjustment the source may carry).
  const clonedBaseline = scores
    .filter((s) => s.userId === lastPlace.userId && completedNormalised.has(s.raceId))
    .reduce((sum, s) => sum + s.totalPoints, 0);
  const startingTotal = lastPlacePoints + LATE_JOINER_PENALTY;
  const adjustmentPoints = startingTotal - clonedBaseline;
  batch.set(db.collection('standings_adjustments').doc(uid), {
    userId: uid,
    points: adjustmentPoints,
    label: 'Late-joiner baseline (active-floor rule)',
    reason: `Joined mid-season. Prior-race scores cloned from the lowest ACTIVE team (${lastPlace.teamName}, ${lastPlacePoints} pts, window ${windowGPs.join('/')}); adjustment ${adjustmentPoints} lands the starting total at ${startingTotal} — 1 point behind them. Dormant accounts ignored per the active-floor rule (2026-07-26).`,
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
      startingTotal,
      adjustmentPoints,
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
      startingTotal,
      adjustmentPoints,
      activeWindow: windowGPs,
      rule: 'active-floor (2026-07-26)',
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
    startingTotal,
    adjustmentPoints,
    nextRaceName,
  };
}
