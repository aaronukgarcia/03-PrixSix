// GUID: SCRIPT_DRY_RUN_ROAST_VARIETY-000-v01
// [Intent] Dry-run for the v3.8.0 Cheeky Bill anti-sameness overhaul: generates FOUR roasts
//          for the same realistic submission (standard + jackdee, with a synthetic
//          recent-roast history) and prints them side by side so sameness/variety is visible
//          before deploy. NO Firestore reads/writes — pure Vertex AI generate calls.
// [Inbound Trigger] Manual: npx tsx scripts/dry-run-roast-variety.ts (from app/, with
//          GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT set).
// [Downstream Impact] None — console output only.

import { generateCheekyComment } from '@/ai/flows/cheeky-bill';

const input = {
  teamName: 'Zhou Mein',
  raceName: 'Belgian Grand Prix - GP',
  driverList: [
    '1. Max Verstappen',
    '2. Lando Norris',
    '3. Oscar Piastri',
    '4. Charles Leclerc',
    '5. Lewis Hamilton',
    '6. George Russell',
  ].join('\n'),
  lastRaceFacts: 'Last race (Hungarian Grand Prix) top 6: 1. Piastri, 2. Norris, 3. Leclerc, 4. Russell, 5. Verstappen, 6. Hamilton.',
  standingsFacts: 'Zhou Mein is currently P12 of 21 in the league championship.',
  previousSubmissionFacts: 'SUBMISSION HISTORY: same six drivers as their previous submission, order shuffled.',
  formFacts: 'ZERO IMAGINATION: their picks are the current WDC top 6 in near-exact order.',
  recentRoasts: [
    'was the dartboard busy or did the dog pick this one..bill',
    'Mystic Meg rang, even she wants no part of this one...bill',
    "you've watched an F1 race before, yes? just checking..Bill",
    'six names pulled out of a bag, top work..bill',
    'a dartboard would have shown more conviction than this..bill',
  ].join('\n'),
};

(async () => {
  const usedDevices: string[] = [];
  for (let i = 0; i < 4; i++) {
    const mode = i < 2 ? 'standard' : 'jackdee';
    const out = await generateCheekyComment({ ...input, mode: mode as 'standard' | 'jackdee', recentDevices: usedDevices.slice(-3) });
    if (out.device) usedDevices.push(out.device);
    console.log(`--- run ${i + 1} (${mode}) [device: ${out.device || 'free choice'}] ---`);
    console.log(out.comment);
    console.log();
  }
})().catch((e) => { console.error(e); process.exit(1); });
