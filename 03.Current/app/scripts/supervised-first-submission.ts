// Supervised first REAL submission for Billceleration (v3.7.0 rollout, 2026-07-20).
// Mirrors the cron route's daily slot exactly — gather inputs → picker → validate →
// persist lastPick + billceleration_log → submit through the LIVE /api/submit-prediction
// route — so the first production submission runs under human supervision before the
// schedule is enabled. Safe to re-run before the deadline (merge-overwrites the same doc).
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import { getRaceSchedule } from '@/lib/race-schedule-server';
import { getBotConfig, mintBotIdToken, buildPackSummary, submitAsBot } from '@/lib/billceleration';
import { pickBillcelerationSix } from '@/ai/flows/billceleration-picker';
import { fetchRealWdcByDriverId, buildTracksideNewsFacts } from '@/lib/cheeky-bill-context';
import { fetchF1Standings, fetchF1Headlines, getVenueWeatherLine } from '@/ai/flows/hot-news-feed';
import { sanitizeForPrompt } from '@/lib/sanitize-prompt';
import { F1Drivers } from '@/lib/data';
import { generateRaceId } from '@/lib/normalize-race-id';

const HOUR = 3600_000;

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
  const cfg = await getBotConfig(db);
  if (!cfg) { console.error('Bot not provisioned.'); process.exit(1); }
  const now = Date.now();
  const schedule = await getRaceSchedule();
  const race = schedule
    .filter((r) => new Date(r.qualifyingTime).getTime() > now)
    .sort((a, b) => new Date(a.qualifyingTime).getTime() - new Date(b.qualifyingTime).getTime())[0];
  if (!race) { console.error('No open race.'); process.exit(1); }
  const deadline = new Date(race.qualifyingTime).getTime();
  console.log(`Race: ${race.name} — quali closes ${race.qualifyingTime} (${((deadline - now) / HOUR).toFixed(1)}h away)`);

  const rosterBlock = F1Drivers.map((d) => `${d.id} — ${d.name} (${d.team})`).join('\n');
  const [packSummary, wdcFormBlock, headlines, tracksideBlock, weatherLine] = await Promise.all([
    buildPackSummary(db, generateRaceId(race.name, 'gp'), cfg.uid).catch(() => ''),
    fetchF1Standings().then((s) => s || '').catch(() => ''),
    fetchF1Headlines().then((h) => h.map((x) => `- ${x}`).join('\n')).catch(() => ''),
    buildTracksideNewsFacts(F1Drivers.slice(0, 6).map((d) => d.id)).catch(() => ''),
    getVenueWeatherLine(race.location).catch(() => ''),
  ]);

  const out = await pickBillcelerationSix({
    raceName: sanitizeForPrompt(race.name, 80) || 'the next race',
    session: 'gp',
    slot: 'daily',
    hoursToQuali: Math.round(((deadline - now) / HOUR) * 10) / 10,
    rosterBlock, packSummary, wdcFormBlock,
    headlinesBlock: headlines, tracksideBlock, weatherLine,
    previousOwnPicks: '(none yet for this race)',
    validationFeedback: '',
  });
  const verdict = validatePicks(out.picks);
  if (verdict) { console.error('Picker output invalid:', verdict); process.exit(1); }

  const raceId = generateRaceId(race.name, 'gp');
  const nameOf = (id: string) => F1Drivers.find((d) => d.id === id)?.name || id;
  console.log('\nPicks:', out.picks.map((id, i) => `P${i + 1} ${nameOf(id)}`).join(', '));
  console.log('Rationale:', out.rationale);
  console.log('SelfDoubt:', out.selfDoubt);

  const stateRef = db.collection('admin_configuration').doc('billcelerationState');
  await stateRef.set({
    lastPick: { raceId, mode: 'daily', picks: out.picks, rationale: out.rationale, selfDoubt: out.selfDoubt, at: FieldValue.serverTimestamp() },
  }, { merge: true });
  await db.collection('billceleration_log').add({
    raceId, mode: 'daily', session: 'gp', picks: out.picks, rationale: out.rationale, selfDoubt: out.selfDoubt,
    fallbackUsed: null, correlationId: 'supervised-first-submission', at: FieldValue.serverTimestamp(),
  });

  console.log('\nMinting token + submitting through the LIVE route...');
  const idToken = await mintBotIdToken(cfg.uid);
  await submitAsBot(idToken, cfg.uid, 'Billceleration', race, 'gp', out.picks);
  console.log('✅ Submitted. Verifying prediction doc...');

  const doc = await db.collection('users').doc(cfg.uid).collection('predictions').doc(`${cfg.uid}_${raceId}`).get();
  console.log('prediction doc:', doc.exists ? JSON.stringify({ raceId: doc.data()!.raceId, predictions: doc.data()!.predictions }) : 'MISSING');

  // Watch the WhatsApp queue for the splitbrain roast (written by the deployed route).
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const q = await db.collection('whatsapp_queue')
      .orderBy('createdAt', 'desc').limit(5).get();
    const hit = q.docs.find((d) => (d.data().message || '').includes('Billceleration') && (d.data().message || '').includes(race.name));
    if (hit) {
      console.log(`roast queue doc ${hit.id}: ${hit.data().status}`);
      console.log('--- message ---');
      console.log(hit.data().message);
      if (hit.data().status !== 'PENDING') process.exit(0);
    }
  }
  console.log('Roast not confirmed SENT within 90s — check /admin WhatsApp panel.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
