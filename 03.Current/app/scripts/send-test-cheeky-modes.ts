// Sandbox test harness (v3.6.0) for the Cheeky Bill three-mode roasts. Mirrors
// send-test-weekly-snark.ts: queues to the prix6-test SANDBOX group only, never
// touches the production group.
//
// Usage:
//   npx tsx app/scripts/send-test-cheeky-modes.ts --mode jackdee|news|standard|all [--fake-news]
//
//   --mode all    one labelled message per mode
//   --fake-news   inject canned trackside newsFacts so news mode is verifiable when
//                 no session is live; without it the REAL OpenF1/RSS path runs and the
//                 script reports whether the eligibility gate passed or degraded.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { buildCheekyBillContext } from '@/lib/cheeky-bill-context';
import { generateCheekyComment } from '@/ai/flows/cheeky-bill';
import { buildTeamNamesMap } from '@/lib/cumulative-standings';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';
import { F1Drivers } from '@/lib/data';

type RoastMode = 'standard' | 'jackdee' | 'news';

const args = process.argv.slice(2);
const modeArg = args[args.indexOf('--mode') + 1];
const fakeNews = args.includes('--fake-news');
const modes: RoastMode[] = modeArg === 'all'
  ? ['standard', 'jackdee', 'news']
  : ['standard', 'jackdee', 'news'].includes(modeArg)
    ? [modeArg as RoastMode]
    : [];
if (!modes.length) {
  console.error('Usage: npx tsx app/scripts/send-test-cheeky-modes.ts --mode jackdee|news|standard|all [--fake-news]');
  process.exit(1);
}

// Six fixed picks: sensible front-runners + one genuine outsider (hulkenberg) so the
// OUTSIDER ALERT / form facts paths have something to chew on.
const PICKS = ['verstappen', 'norris', 'hulkenberg', 'leclerc', 'hamilton', 'piastri'];

const FAKE_NEWS_FACTS = `TRACKSIDE (Qualifying at Spa-Francorchamps, LIVE NOW):
[3 min ago] CAR 44 (HAM) OFF TRACK AND CONTINUED - CAR STOPPED AT TURN 7
[9 min ago] RED FLAG
NEWS HEADLINES:
- Hamilton under investigation after heavy qualifying crash
- Verstappen tops final practice by half a second`;

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();

  // Borrow a real team so standings/history facts are rich (read-only — nothing is
  // written to the team; the queue doc is sandbox-labelled and goes to prix6-test).
  const names = await buildTeamNamesMap(db);
  const teamId = names.keys().next().value as string | undefined;
  if (!teamId) { console.error('No teams found — aborting'); process.exit(1); }
  const userId = teamId.replace(/-secondary$/, '');
  const teamName = `${names.get(teamId)} (sandbox)`;
  const queuedRefs: FirebaseFirestore.DocumentReference[] = [];

  const driverList = PICKS
    .map((id, i) => `${i + 1}. ${F1Drivers.find((d) => d.id === id)?.name || id}`)
    .join('\n');

  for (const mode of modes) {
    console.log(`\n=== mode: ${mode} ===`);
    const ctx = await buildCheekyBillContext(db, {
      userId,
      teamId,
      raceId: 'sandbox-test-race',
      predictions: PICKS,
      includeTracksideNews: mode === 'news' && !fakeNews,
    });
    let newsFacts = ctx.newsFacts;
    let effectiveMode: RoastMode = mode;
    if (mode === 'news') {
      if (fakeNews) {
        newsFacts = FAKE_NEWS_FACTS;
        console.log('news: using injected --fake-news facts');
      } else if (!newsFacts) {
        effectiveMode = 'standard';
        console.log('news: eligibility gate found nothing relevant → degraded to standard (expected without a live session)');
      } else {
        console.log('news: eligibility gate PASSED with real facts:\n' + newsFacts);
      }
    }

    const line = await generateCheekyComment({
      teamName,
      driverList,
      raceName: 'Sandbox Test Race',
      lastRaceFacts: ctx.lastRaceFacts,
      standingsFacts: ctx.standingsFacts,
      previousSubmissionFacts: ctx.previousSubmissionFacts,
      formFacts: ctx.formFacts,
      mode: effectiveMode,
      newsFacts,
    });
    console.log(`roast: ${line}`);

    const message = `🧪 [TEST — ${mode}${effectiveMode !== mode ? `→${effectiveMode}` : ''}] 🏎️ *${teamName}* submitted picks for Sandbox Test Race:\n\n${driverList}\n\n_${line}_`;
    const ref = await db.collection('whatsapp_queue').add({
      groupName: 'prix6-test',
      message,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
      source: 'cheeky-modes sandbox test',
      testMode: true,
    });
    console.log('Queued to prix6-test as', ref.id);
    queuedRefs.push(ref);
  }

  await wakeWhatsAppWorker();

  // Wait and report delivery status of every queued doc (no query — index-free).
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const fresh = await Promise.all(queuedRefs.map((r) => r.get()));
    const statuses = fresh.map((d) => (d.data() as any)?.status || 'DOC GONE');
    if (statuses.every((s) => s !== 'PENDING')) {
      console.log('Delivery statuses:', statuses.join(', '));
      process.exit(0);
    }
  }
  console.log('Still PENDING after 60s — worker may be cold-starting; check /admin WhatsApp panel.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
