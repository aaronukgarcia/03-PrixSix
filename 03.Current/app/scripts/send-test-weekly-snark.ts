// One-off (2026-07-13, Aaron-approved): compose the weekly standings + Bill's take message
// and send it to the prix6-test SANDBOX group only. Mirrors sendWhatsAppAlert's queue doc
// shape; never touches the production group.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { computeRaceScores, aggregateStandings, buildTeamNamesMap, readStandingsAdjustments } from '@/lib/cumulative-standings';
import { buildWeeklyStandingsFacts } from '@/lib/cheeky-bill-context';
import { generateWeeklyStandingsSnark } from '@/ai/flows/cheeky-bill';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();

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
  if (!facts) { console.error('No facts — aborting'); process.exit(1); }
  const take = await generateWeeklyStandingsSnark({ topTen: standingsText, factLines: facts.factLines });
  if (!take) { console.error('No snark generated — aborting'); process.exit(1); }

  const message = `🧪 [TEST] 📊 *Prix Six — Weekly Standings*\n\n${standingsText}\n\n💬 *Bill's take:*\n${take}`;
  const ref = await db.collection('whatsapp_queue').add({
    groupName: 'prix6-test',
    message,
    status: 'PENDING',
    createdAt: FieldValue.serverTimestamp(),
    retryCount: 0,
    source: 'alert:weeklyStandingsUpdate (manual sandbox preview)',
    testMode: true,
  });
  await wakeWhatsAppWorker();
  console.log('Queued to prix6-test as', ref.id);
  console.log('--- message ---');
  console.log(message);

  // Wait and report delivery status
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const snap = await ref.get();
    const status = snap.exists ? (snap.data() as any).status : 'DOC GONE';
    if (status !== 'PENDING') { console.log('Delivery status:', status); process.exit(0); }
  }
  console.log('Still PENDING after 60s — worker may be cold-starting; check /admin WhatsApp panel.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
