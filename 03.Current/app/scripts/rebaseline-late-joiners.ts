// League-admin re-baseline (Aaron, 2026-07-26): retroactively apply the ACTIVE-FLOOR late-joiner
// rule to every team that received the old "-5 below absolute last place" handicap, in
// chronological join order, so each recalculation feeds the next.
//
// NEW RULE: a late joiner's starting total = (lowest total among ACTIVE teams at their join
// moment) - 1. "Active" = a team with at least one MANUAL (non-cloned) submission for one of the
// last 3 completed race weekends before the join, submitted before the join. Dormant husk
// accounts are therefore ignored; the old rule anchored newcomers 5 below the husks.
// The old flow also computed "last place" WITHOUT adjustments (so Fangio-F1 anchored to
// Billceleration's raw 17 scored points instead of its adjusted ~164 total) — fixed here by
// using fully-adjusted as-of totals (with earlier joiners' REVISED adjustments).
//
// Cloned prediction history is left untouched — only standings_adjustments values change:
//   newAdjustment = (floor - 1) - (joiner's own scored points at join, without adjustment)
//
// Dry run by default (full before/after table). --apply writes adjustments + audit_logs
// (ADMIN_REBASELINE_LATE_JOINER, one per team, with originalPoints for reversibility) and
// stamps users/{uid}.lateJoinerInfo.rebaselined.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import {
  computeRaceScores,
  aggregateStandings,
  buildTeamNamesMap,
  buildRaceRunMillisMap,
  ADJUSTMENT_RACE_ID,
  type ScoreData,
} from '@/lib/cumulative-standings';
import { normalizeRaceIdForComparison } from '@/lib/normalize-race-id';

const APPLY = process.argv.includes('--apply');

// Chronological by HANDICAP APPLICATION time (lateJoinerInfo.appliedAt) — the moment the team
// entered the standings and their clone snapshot was taken. For Geepers AI this is 4 days after
// account creation (manual one-off, 2026-06-15, post-Spanish-GP) and the clone includes Spain,
// so createdAt would misalign baseline vs floor; for everyone else appliedAt ≈ createdAt.
const LATE_JOINERS = [
  { uid: 'Whxawpcr1WUjH0iyyk0SHxoa9yo2', teamName: 'Geepers AI',        joinedAt: '2026-06-15T12:04:16.607Z' },
  { uid: 'N55WUB6zs1ZyNTIN2fDBait9fKG2', teamName: "Hamilton's heros",  joinedAt: '2026-07-13T14:14:06.083Z' },
  { uid: 'QHiuY8A4XkMwQjndwHIaRp6pXLE2', teamName: 'Must Be The Water', joinedAt: '2026-07-16T23:35:04.829Z' },
  { uid: 'billceleration-bot',           teamName: 'Billceleration',    joinedAt: '2026-07-20T10:05:46.463Z' },
  { uid: 'OurdQ62nuoXwEAKVG5EWHNfPG1D2', teamName: 'Fangio-F1',         joinedAt: '2026-07-25T14:59:53.307Z' },
];

function totalsFrom(rows: ScoreData[], allowed: Set<string>): Map<string, number> {
  const totals = new Map<string, number>();
  rows.forEach((r) => {
    if (!allowed.has(r.raceId)) return;
    totals.set(r.userId, (totals.get(r.userId) ?? 0) + r.totalPoints);
  });
  return totals;
}

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();

  const [{ scores }, names, runMillis] = await Promise.all([
    computeRaceScores(db),
    buildTeamNamesMap(db),
    Promise.resolve(buildRaceRunMillisMap()),
  ]);

  // Current adjustments (old values), keyed by userId.
  const adjSnap = await db.collection('standings_adjustments').get();
  const oldAdj = new Map<string, number>();
  adjSnap.forEach((d) => oldAdj.set(d.data().userId, d.data().points));

  // Per-team submission maps from ONE collectionGroup sweep:
  //  - manualSubs: non-cloned submissions (drives the "active" test)
  //  - winnerIsClone: per (teamId, raceId), whether the EFFECTIVE doc (latest submittedAt, the
  //    one the scoring engine uses) is a late-joiner clone. Drives the baseline: only races a
  //    joiner scored via clones anchor to the floor — points they earned by actually playing
  //    (e.g. Geepers AI's own Spanish GP, played before the 06-15 manual handicap) ride on top.
  const predsSnap = await db.collectionGroup('predictions').get();
  const manualSubs = new Map<string, Array<{ raceId: string; ms: number }>>();
  const winner = new Map<string, { ms: number; isClone: boolean }>(); // key `${teamId}|${raceId}`
  predsSnap.forEach((d) => {
    const p: any = d.data();
    const teamId = p.teamId || p.userId;
    const raceId = p.raceId ? normalizeRaceIdForComparison(p.raceId) : null;
    if (!teamId || !raceId) return;
    const ms = typeof p.submittedAt?.toMillis === 'function' ? p.submittedAt.toMillis() : 0;
    const isClone = !!p._clonedFromLateJoinerHandicap;
    const key = `${teamId}|${raceId}`;
    const cur = winner.get(key);
    if (!cur || ms >= cur.ms) winner.set(key, { ms, isClone });
    if (isClone) return;
    if (!manualSubs.has(teamId)) manualSubs.set(teamId, []);
    manualSubs.get(teamId)!.push({ raceId, ms });
  });

  // All scored raceIds that have a known run time, sorted chronologically.
  const scoredRaceIds = [...new Set(scores.map((s) => s.raceId))];
  const datedRaces = scoredRaceIds
    .map((id) => ({ id, ms: runMillis.get(id) }))
    .filter((r): r is { id: string; ms: number } => typeof r.ms === 'number')
    .sort((a, b) => a.ms - b.ms);

  const revised = new Map<string, number>(); // uid -> new adjustment (built chronologically)
  const plan: Array<{
    uid: string; teamName: string; joinedAt: string; window: string[]; activeCount: number;
    floorTeam: string; floorPoints: number; target: number; baseline: number; earned: number;
    oldPoints: number; newPoints: number;
  }> = [];

  for (const j of LATE_JOINERS) {
    const T = new Date(j.joinedAt).getTime();
    const completed = datedRaces.filter((r) => r.ms < T);
    const completedIds = new Set(completed.map((r) => r.id));
    // Normalised ids drop the "-gp" suffix; GP rounds are the ones NOT ending "-sprint".
    const windowGPs = completed.filter((r) => !r.id.endsWith('-sprint')).slice(-3).map((r) => r.id);
    const windowSet = new Set(windowGPs);

    // Active teams at T (excluding the joiner and their secondary team).
    const activeIds = [...manualSubs.entries()]
      .filter(([teamId, subs]) =>
        teamId !== j.uid &&
        teamId !== `${j.uid}-secondary` &&
        subs.some((s) => windowSet.has(s.raceId) && s.ms > 0 && s.ms < T))
      .map(([teamId]) => teamId);

    // As-of totals: completed races + adjustments of ALREADY-processed joiners (revised values).
    const adjRows: ScoreData[] = [...revised.entries()]
      .filter(([uid]) => uid !== j.uid)
      .map(([uid, pts]) => ({ userId: uid, raceId: ADJUSTMENT_RACE_ID, totalPoints: pts }));
    const allowed = new Set([...completedIds, ADJUSTMENT_RACE_ID]);
    const totals = totalsFrom([...scores, ...adjRows], allowed);

    const activeTotals = activeIds
      .map((id) => ({ id, pts: totals.get(id) ?? 0 }))
      .sort((a, b) => a.pts - b.pts);
    if (activeTotals.length === 0) {
      console.error(`No active teams found for ${j.teamName} — aborting.`);
      process.exit(1);
    }
    const floor = activeTotals[0];
    const target = floor.pts - 1;
    // Baseline = points scored via CLONED history only (earned points from self-played races
    // before the handicap application are kept on top of the floor anchor).
    let baseline = 0;
    let earned = 0;
    scores.filter((s) => s.userId === j.uid && completedIds.has(s.raceId)).forEach((s) => {
      // Sprint points score from the weekend's GP prediction doc — look up the base raceId.
      const w = winner.get(`${j.uid}|${s.raceId.replace(/-sprint$/, '')}`);
      if (w && !w.isClone) earned += s.totalPoints;
      else baseline += s.totalPoints;
    });
    const newPoints = target - baseline;
    revised.set(j.uid, newPoints);

    plan.push({
      uid: j.uid, teamName: j.teamName, joinedAt: j.joinedAt,
      window: windowGPs, activeCount: activeTotals.length,
      floorTeam: names.get(floor.id) ?? floor.id, floorPoints: floor.pts,
      target, baseline, earned, oldPoints: oldAdj.get(j.uid) ?? 0, newPoints,
    });
  }

  console.log('=== RE-BASELINE PLAN (chronological) ===');
  plan.forEach((p) => {
    console.log(`\n${p.teamName} (joined ${p.joinedAt})`);
    console.log(`  window        : ${p.window.join(', ')}`);
    console.log(`  actives       : ${p.activeCount} teams; floor = ${p.floorTeam} @ ${p.floorPoints}`);
    console.log(`  target total  : ${p.target} (floor - 1)`);
    console.log(`  own baseline  : ${p.baseline} cloned pts at join (+${p.earned} self-earned, kept on top)`);
    console.log(`  adjustment    : ${p.oldPoints} -> ${p.newPoints} (delta ${p.newPoints - p.oldPoints})`);
  });

  // Full standings before/after (all races, old vs new adjustments).
  const allIds = new Set([...scoredRaceIds, ADJUSTMENT_RACE_ID]);
  const oldRows: ScoreData[] = [...oldAdj.entries()].map(([uid, pts]) => ({ userId: uid, raceId: ADJUSTMENT_RACE_ID, totalPoints: pts }));
  const newRows: ScoreData[] = [...oldAdj.entries()].map(([uid, pts]) => ({
    userId: uid, raceId: ADJUSTMENT_RACE_ID, totalPoints: revised.has(uid) ? revised.get(uid)! : pts,
  }));
  const before = aggregateStandings([...scores, ...oldRows], names);
  const after = aggregateStandings([...scores, ...newRows], names);
  const beforeRank = new Map(before.map((s: any) => [s.teamName, s.rank]));
  console.log('\n=== STANDINGS AFTER (Δ rank vs before) ===');
  after.forEach((s: any) => {
    const was = beforeRank.get(s.teamName);
    const delta = was !== undefined ? was - s.rank : 0;
    const marker = plan.some((p) => p.teamName === s.teamName) ? '  ◄ re-baselined' : '';
    console.log(`${String(s.rank).padStart(2)}. ${s.teamName} — ${s.totalPoints}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}${marker}`);
  });

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
    process.exit(0);
  }

  const batch = db.batch();
  plan.forEach((p) => {
    batch.set(db.collection('standings_adjustments').doc(p.uid), {
      userId: p.uid,
      points: p.newPoints,
      label: 'Late-joiner baseline (active-floor rule)',
      reason: `Re-baselined 2026-07-26 under the active-floor rule (Aaron): start = lowest ACTIVE team at join (${p.floorTeam} @ ${p.floorPoints}, husks ignored, window ${p.window.join('/')}) minus 1 = ${p.target}; own scored baseline ${p.baseline} => adjustment ${p.newPoints}. Original points: ${p.oldPoints}.`,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('audit_logs').doc(), {
      action: 'ADMIN_REBASELINE_LATE_JOINER',
      userId: p.uid,
      teamName: p.teamName,
      originalPoints: p.oldPoints,
      newPoints: p.newPoints,
      floorTeam: p.floorTeam,
      floorPoints: p.floorPoints,
      window: p.window,
      reason: 'Active-floor late-joiner rule applied retroactively in chronological join order (Aaron, 2026-07-26). Husk (dormant) accounts ignored; floor computed with fully-adjusted as-of totals.',
      at: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('users').doc(p.uid), {
      lateJoinerInfo: { rebaselined: true, rebaselinedAt: FieldValue.serverTimestamp(), rebaselinedPoints: p.newPoints },
    }, { merge: true });
  });
  await batch.commit();
  console.log('\nAPPLIED: adjustments updated, audit entries written, user docs stamped.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
