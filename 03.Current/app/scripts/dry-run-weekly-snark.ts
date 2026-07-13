// GUID: SCRIPT_DRY_RUN_WEEKLY_SNARK-000-v01
// [Intent] Dry-run for the v3.5.2 weekly-standings "Bill's take": composes the EXACT WhatsApp
//          message the Monday cron would send (standings incl. adjustments + two snark lines)
//          against live prod data and prints it. NO WhatsApp queue writes, no state changes.
// [Inbound Trigger] Manual: npx tsx scripts/dry-run-weekly-snark.ts (from app/, with
//          GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT set).
// [Downstream Impact] Read-only against Firestore; one Vertex AI generate call.

import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { computeRaceScores, aggregateStandings, buildTeamNamesMap, readStandingsAdjustments } from '@/lib/cumulative-standings';
import { buildWeeklyStandingsFacts } from '@/lib/cheeky-bill-context';
import { generateWeeklyStandingsSnark } from '@/ai/flows/cheeky-bill';

(async () => {
  const { db } = await getFirebaseAdmin();

  const [{ scores }, adjustments, names] = await Promise.all([
    computeRaceScores(db),
    readStandingsAdjustments(db),
    buildTeamNamesMap(db),
  ]);
  const standings = aggregateStandings([...scores, ...adjustments], names);
  const standingsText = standings.slice(0, 10)
    .map((s, i) => `${i + 1}. ${s.teamName} — ${s.totalPoints}`)
    .join('\n');

  const facts = await buildWeeklyStandingsFacts(db);
  console.log('=== VERIFIED FACT LINES ===');
  console.log(facts ? facts.factLines : '(null — no facts)');

  let snark = '';
  if (facts) {
    const take = await generateWeeklyStandingsSnark({ topTen: standingsText, factLines: facts.factLines });
    if (take) snark = `\n\n💬 *Bill's take:*\n${take}`;
  }

  console.log('\n=== EXACT MESSAGE THAT WOULD BE SENT ===');
  console.log(`📊 *Prix Six — Weekly Standings*\n\n${standingsText}${snark}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
