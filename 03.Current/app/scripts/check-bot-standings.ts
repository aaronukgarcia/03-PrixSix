// Rollout verification (v3.7.0, 2026-07-20): confirm Billceleration appears in the SSOT
// standings after provisioning. Read-only.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { computeRaceScores, aggregateStandings, buildTeamNamesMap, readStandingsAdjustments } from '@/lib/cumulative-standings';

(async () => {
  const { db } = await getFirebaseAdmin();
  const [{ scores }, adjustments, names] = await Promise.all([
    computeRaceScores(db),
    readStandingsAdjustments(db),
    buildTeamNamesMap(db),
  ]);
  const standings = aggregateStandings([...scores, ...adjustments], names);
  const bot = standings.find((s) => s.teamName === 'Billceleration');
  console.log('bot row:', bot ? `P${bot.rank} of ${standings.length}, ${bot.totalPoints} pts` : 'MISSING');
  console.log('tail:', standings.slice(-3).map((s) => `P${s.rank} ${s.teamName} ${s.totalPoints}`).join(' | '));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
