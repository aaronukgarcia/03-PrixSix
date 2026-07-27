// One-off (2026-07-24, Aaron-requested): generate a v3.8.0 variety-engine roast for a
// realistic fake submission and send it to the prix6-test SANDBOX group only. Mirrors the
// roast route's message shape and reads the REAL roast history (anti-repetition context)
// but does NOT record the test line — Bill's production memory stays clean. Never touches
// the production group.
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { generateCheekyComment } from '@/ai/flows/cheeky-bill';
import { getRecentRoastHistory } from '@/lib/cheeky-bill-history';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';

// Each scenario differs in team, facts and mode; every generated line is appended to the
// LOCAL history so later roasts must dodge the earlier ones — the anti-repetition test.
const SCENARIOS = [
  {
    teamName: 'Kwik Fitties',
    raceName: 'Belgian Grand Prix - GP',
    driverList: ['1. Lando Norris', '2. Oscar Piastri', '3. Max Verstappen', '4. George Russell', '5. Lewis Hamilton', '6. Charles Leclerc'].join('\n'),
    lastRaceFacts: 'Last race (Hungarian Grand Prix) top 6: 1. Piastri, 2. Norris, 3. Leclerc, 4. Russell, 5. Verstappen, 6. Hamilton.',
    standingsFacts: 'Kwik Fitties is currently P3 of 21 in the league championship.',
    previousSubmissionFacts: 'SUBMISSION HISTORY: identical to their previous submission — not one driver changed.',
    formFacts: '',
    mode: 'standard' as const,
  },
  {
    teamName: 'Vettel Attend',
    raceName: 'Belgian Grand Prix - GP',
    driverList: ['1. Max Verstappen', '2. Charles Leclerc', '3. Lance Stroll', '4. Lando Norris', '5. Oscar Piastri', '6. Lewis Hamilton'].join('\n'),
    lastRaceFacts: 'Last race (Hungarian Grand Prix) top 6: 1. Piastri, 2. Norris, 3. Leclerc, 4. Russell, 5. Verstappen, 6. Hamilton.',
    standingsFacts: 'Vettel Attend is currently P18 of 21 in the league championship.',
    previousSubmissionFacts: 'SUBMISSION HISTORY: wholesale changes — four new faces vs their previous submission.',
    formFacts: 'OUTSIDER ALERT: Lance Stroll picked P3 while sitting P14 in the real WDC.',
    mode: 'standard' as const,
  },
  {
    teamName: 'Zhou Mein',
    raceName: 'Belgian Grand Prix - GP',
    driverList: ['1. Oscar Piastri', '2. Lando Norris', '3. Charles Leclerc', '4. George Russell', '5. Max Verstappen', '6. Lewis Hamilton'].join('\n'),
    lastRaceFacts: 'Last race (Hungarian Grand Prix) top 6: 1. Piastri, 2. Norris, 3. Leclerc, 4. Russell, 5. Verstappen, 6. Hamilton.',
    standingsFacts: 'Zhou Mein is currently P12 of 21 in the league championship.',
    previousSubmissionFacts: '',
    formFacts: 'ZERO IMAGINATION: their picks are the last race top 6 copied in exact order.',
    mode: 'jackdee' as const,
  },
  {
    teamName: 'Schumacher Time',
    raceName: 'Belgian Grand Prix - GP',
    driverList: ['1. George Russell', '2. Lewis Hamilton', '3. Max Verstappen', '4. Fernando Alonso', '5. Lando Norris', '6. Oscar Piastri'].join('\n'),
    lastRaceFacts: 'Last race (Hungarian Grand Prix) top 6: 1. Piastri, 2. Norris, 3. Leclerc, 4. Russell, 5. Verstappen, 6. Hamilton.',
    standingsFacts: 'Schumacher Time is currently P7 of 21 in the league championship.',
    previousSubmissionFacts: '',
    formFacts: 'OUTSIDER ALERT: Fernando Alonso picked P4 while sitting P11 in the real WDC.',
    mode: 'standard' as const,
  },
  {
    teamName: 'Lights Out Losers',
    raceName: 'Belgian Grand Prix - GP',
    driverList: ['1. Max Verstappen', '2. Oscar Piastri', '3. Lando Norris', '4. Charles Leclerc', '5. George Russell', '6. Lewis Hamilton'].join('\n'),
    lastRaceFacts: 'Last race (Hungarian Grand Prix) top 6: 1. Piastri, 2. Norris, 3. Leclerc, 4. Russell, 5. Verstappen, 6. Hamilton.',
    standingsFacts: 'Lights Out Losers is currently P20 of 21 in the league championship.',
    previousSubmissionFacts: 'SUBMISSION HISTORY: same six drivers as their previous submission, order shuffled.',
    formFacts: '',
    mode: 'jackdee' as const,
  },
];

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();

  // Seed with the real production history plus the roast already sent in the first test run,
  // then accumulate this run's lines locally. Production history doc is never written.
  const prodHistory = await getRecentRoastHistory(db);
  const localHistory: string[] = [...prodHistory.lines];
  const localDevices: string[] = [...prodHistory.devices];
  localHistory.unshift("Max, Lando, Oscar and the others here; honestly, being picked by a P12 team shouldn't feel this much like an insult to our collective racing prowess...Bill");
  localDevices.unshift('picks-voice'); // the device the first sandbox roast visibly used

  const refs: { ref: FirebaseFirestore.DocumentReference; team: string }[] = [];
  for (const s of SCENARIOS) {
    const { comment: cheekyLine, device } = await generateCheekyComment({
      ...s,
      recentRoasts: localHistory.slice(0, 10).join('\n'),
      recentDevices: localDevices.slice(0, 3),
    });
    if (!cheekyLine) { console.error(`No roast generated for ${s.teamName} — skipping`); continue; }
    localHistory.unshift(cheekyLine);
    if (device) localDevices.unshift(device);

    const msg = `🧪 [TEST] 🏎️ *${s.teamName}* submitted picks for ${s.raceName}:\n\n${s.driverList}\n\n_${cheekyLine}_`;
    const ref = await db.collection('whatsapp_queue').add({
      groupName: 'prix6-test',
      message: msg,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
      source: 'v3.8.0 variety-engine sandbox test (manual)',
      testMode: true,
    });
    refs.push({ ref, team: s.teamName });
    console.log(`--- ${s.teamName} (${s.mode}) [device: ${device || 'free choice'}] → ${ref.id} ---`);
    console.log(cheekyLine);
    console.log();
  }

  await wakeWhatsAppWorker();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statuses = await Promise.all(refs.map(async ({ ref, team }) => {
      const snap = await ref.get();
      return `${team}: ${snap.exists ? (snap.data() as any).status : 'DOC GONE'}`;
    }));
    if (!statuses.some((st) => st.endsWith('PENDING'))) { console.log('Delivery:', statuses.join(' | ')); process.exit(0); }
  }
  console.log('Some still PENDING after 60s — worker may be cold-starting; check /admin WhatsApp panel.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
