// Sandbox test harness for the Billceleration AI team (v3.7.0). Three independent checks,
// none of which touch the production WhatsApp group or write prediction docs:
//
//   npx tsx --tsconfig tsconfig.scripts.json scripts/test-billceleration.ts --dry
//     Gather REAL inputs for the next race, run the picker, print picks/rationale/selfDoubt
//     + validation verdict. No writes anywhere.
//
//   npx tsx --tsconfig tsconfig.scripts.json scripts/test-billceleration.ts --roast
//     Run the picker, then generate the splitbrain roast from its rationale and queue the
//     composed message to the prix6-test group only.
//
//   npx tsx --tsconfig tsconfig.scripts.json scripts/test-billceleration.ts --token
//     Mint the bot ID token and POST a submission for a race that is already LOCKED —
//     expects HTTP 403, which proves the token mints, verifies, and the deadline gates hold,
//     with zero side effects. (Requires the bot to be provisioned.)
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { getRaceSchedule } from '@/lib/race-schedule-server';
import { getBotConfig, mintBotIdToken, buildPackSummary } from '@/lib/billceleration';
import { pickBillcelerationSix } from '@/ai/flows/billceleration-picker';
import { generateCheekyComment } from '@/ai/flows/cheeky-bill';
import { fetchRealWdcByDriverId, buildTracksideNewsFacts } from '@/lib/cheeky-bill-context';
import { fetchF1Standings, fetchF1Headlines, getVenueWeatherLine } from '@/ai/flows/hot-news-feed';
import { wakeWhatsAppWorker } from '@/lib/whatsapp-wake';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';
import { F1Drivers } from '@/lib/data';
import { generateRaceId } from '@/lib/normalize-race-id';

const mode = process.argv.find((a) => ['--dry', '--roast', '--token'].includes(a));
if (!mode) {
  console.error('Usage: test-billceleration.ts --dry | --roast | --token');
  process.exit(1);
}

function validatePicks(picks: string[]): string | null {
  if (!Array.isArray(picks) || picks.length !== 6) return 'need exactly 6 picks';
  const valid = new Set(F1Drivers.map((d) => d.id));
  const seen = new Set<string>();
  for (const p of picks) {
    if (!valid.has(p)) return `"${p}" is not a legal roster id`;
    if (seen.has(p)) return `"${p}" appears twice`;
    seen.add(p);
  }
  return null;
}

(async () => {
  const { db, FieldValue } = await getFirebaseAdmin();
  const HOUR = 3600_000;
  const now = Date.now();
  const schedule = await getRaceSchedule();

  if (mode === '--token') {
    const cfg = await getBotConfig(db);
    if (!cfg) { console.error('Bot not provisioned — run provision-billceleration.ts first.'); process.exit(1); }
    const locked = schedule
      .filter((r) => new Date(r.qualifyingTime).getTime() < now)
      .sort((a, b) => new Date(b.qualifyingTime).getTime() - new Date(a.qualifyingTime).getTime())[0];
    if (!locked) { console.error('No locked race found to test against.'); process.exit(1); }
    console.log(`Minting ID token for ${cfg.uid}...`);
    const idToken = await mintBotIdToken(cfg.uid);
    console.log(`Token minted (${idToken.length} chars). POSTing a submission for LOCKED race "${locked.name}" — expecting 403...`);
    const resp = await fetch(`${process.env.APP_URL || 'https://prix6.win'}/api/submit-prediction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        userId: cfg.uid,
        teamId: cfg.uid,
        teamName: 'Billceleration',
        raceId: generateRaceId(locked.name, 'gp'),
        raceName: locked.name,
        predictions: F1Drivers.slice(0, 6).map((d) => d.id),
      }),
    });
    const body = await resp.text();
    console.log(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    if (resp.status === 403) { console.log('✅ PASS — auth verified AND deadline gate held (no write occurred).'); process.exit(0); }
    if (resp.status === 401) { console.log('❌ FAIL — token rejected; check Token Creator role / API key.'); process.exit(1); }
    console.log(`⚠️  Unexpected status ${resp.status} — investigate before enabling the bot.`);
    process.exit(1);
  }

  // --dry and --roast share the input-gathering + picker stage.
  const race = schedule
    .filter((r) => new Date(r.qualifyingTime).getTime() > now)
    .sort((a, b) => new Date(a.qualifyingTime).getTime() - new Date(b.qualifyingTime).getTime())[0];
  if (!race) { console.error('No upcoming race in the schedule.'); process.exit(1); }
  const deadline = new Date(race.qualifyingTime).getTime();
  console.log(`Next race: ${race.name} (quali closes ${race.qualifyingTime}, in ${((deadline - now) / HOUR).toFixed(1)}h)`);

  const botUid = (await getBotConfig(db))?.uid || 'billceleration-bot';
  const rosterBlock = F1Drivers.map((d) => `${d.id} — ${d.name} (${d.team})`).join('\n');
  console.log('Gathering real inputs...');
  const [packSummary, wdcFormBlock, headlines, tracksideBlock, weatherLine] = await Promise.all([
    buildPackSummary(db, generateRaceId(race.name, 'gp'), botUid).catch(() => ''),
    fetchF1Standings().then((s) => s || '').catch(() => ''),
    fetchF1Headlines().then((h) => h.map((x) => `- ${x}`).join('\n')).catch(() => ''),
    buildTracksideNewsFacts(F1Drivers.slice(0, 6).map((d) => d.id)).catch(() => ''),
    getVenueWeatherLine(race.location).catch(() => ''),
  ]);
  console.log(`  pack: ${packSummary ? packSummary.split('\n').length + ' lines' : '(empty)'}`);
  console.log(`  wdc: ${wdcFormBlock ? 'ok' : '(empty)'} | headlines: ${headlines ? 'ok' : '(empty)'} | trackside: ${tracksideBlock ? 'ok' : '(empty)'} | weather: ${weatherLine ? 'ok' : '(empty)'}`);

  const out = await pickBillcelerationSix({
    raceName: sanitizeForPrompt(race.name, 80) || 'the next race',
    session: 'gp',
    slot: 'daily',
    hoursToQuali: Math.round(((deadline - now) / HOUR) * 10) / 10,
    rosterBlock,
    packSummary,
    wdcFormBlock,
    headlinesBlock: headlines,
    tracksideBlock,
    weatherLine,
    previousOwnPicks: '(none yet for this race)',
    validationFeedback: '',
  });

  const nameOf = (id: string) => F1Drivers.find((d) => d.id === id)?.name || id;
  console.log('\n=== PICKER OUTPUT ===');
  out.picks.forEach((id, i) => console.log(`  P${i + 1} ${nameOf(id)} (${id})`));
  console.log(`rationale: ${out.rationale}`);
  console.log(`selfDoubt: ${out.selfDoubt}`);
  const verdict = validatePicks(out.picks);
  console.log(`validation: ${verdict ? '❌ ' + verdict : '✅ legal six'}`);

  if (mode === '--roast') {
    const driverList = out.picks.map((id, i) => `${i + 1}. ${nameOf(id)}`).join('\n');
    const rationaleFacts = [
      `My public reasoning was - ${sanitizeForPrompt(out.rationale, 300)}`,
      `My private worry was - ${sanitizeForPrompt(out.selfDoubt, 200)}`,
    ].join('\n');
    const line = await generateCheekyComment({
      teamName: 'Billceleration',
      driverList,
      raceName: race.name,
      mode: 'splitbrain',
      rationaleFacts,
    });
    console.log(`\nsplitbrain roast: ${line}`);
    const message = `🧪 [TEST — splitbrain] 🏎️ *Billceleration* submitted picks for ${race.name}:\n\n${driverList}\n\n_${line}_`;
    const ref = await db.collection('whatsapp_queue').add({
      groupName: 'prix6-test',
      message,
      status: 'PENDING',
      createdAt: FieldValue.serverTimestamp(),
      retryCount: 0,
      source: 'billceleration sandbox test',
      testMode: true,
    });
    await wakeWhatsAppWorker();
    console.log('Queued to prix6-test as', ref.id);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const snap = await ref.get();
      const status = snap.exists ? (snap.data() as any).status : 'DOC GONE';
      if (status !== 'PENDING') { console.log('Delivery status:', status); process.exit(0); }
    }
    console.log('Still PENDING after 60s — worker may be cold-starting.');
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
