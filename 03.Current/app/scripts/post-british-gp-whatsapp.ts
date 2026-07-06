/**
 * One-off: post the ENRICHED British GP results message to the WhatsApp group.
 * -----------------------------------------------------------------------------
 * The original resultsPublished alert for the British GP (Bill#98815) was the old bare
 * "results are in" line with no actual content. This posts the new concise summary — podium,
 * round-winning team + congrats, and Championship top 5 — using the SAME shared builder the
 * v3.4.9 scoring route now uses (whatsapp-results-message.ts), so it matches future races.
 *
 * Championship standings are reconstructed here with a faithful port of computeRaceScores
 * (all races) + standings_adjustments, aggregated exactly like the standings page.
 *
 * SAFE BY DEFAULT: dry-run (prints the exact message). --execute enqueues to whatsapp_queue and
 * wakes the worker. The worker appends the Bill#<n> trace suffix itself.
 *
 * Run (dry):  npx tsx scripts/post-british-gp-whatsapp.ts
 * Run (post): npx tsx scripts/post-british-gp-whatsapp.ts --execute
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { SCORING_POINTS, calculateDriverPoints } from '../src/lib/scoring-rules';
import { F1Drivers, RaceSchedule } from '../src/lib/data';
import { normalizeRaceIdForComparison, generateRaceId } from '../src/lib/normalize-race-id';
import { buildResultsWhatsAppMessage } from '../src/lib/whatsapp-results-message';

// Load WHATSAPP_APP_SECRET / WHATSAPP_WORKER_URL from app/.env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i === -1) continue;
    const k = t.slice(0, i).trim(); let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const RESULT_DOC_ID = 'British-Grand-Prix-GP';
const RACE_NAME = 'British Grand Prix - GP';
const GROUP = 'Prix6.Win';
const EXECUTE = process.argv.includes('--execute');
const WORKER_URL_FALLBACK = 'https://prixsix-whatsapp.delightfulmushroom-6fa10cd0.uksouth.azurecontainerapps.io';

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '../../service-account.json'))) });
const db = admin.firestore();
const nameOf = (id: string) => F1Drivers.find(d => d.id === id)?.name || id;

async function main() {
  console.log(`\n=== Post enriched British GP WhatsApp message (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

  // 1) Load all race results + all predictions once (SSOT reconstruction, mirrors computeRaceScores)
  const [rrSnap, predSnap, usersSnap, adjSnap] = await Promise.all([
    db.collection('race_results').get(),
    db.collectionGroup('predictions').get(),
    db.collection('users').get(),
    db.collection('standings_adjustments').get(),
  ]);

  const userMap = new Map<string, string>();
  usersSnap.forEach(doc => { const d: any = doc.data(); if (d?.teamName) userMap.set(doc.id, d.teamName); if (d?.secondaryTeamName) userMap.set(`${doc.id}-secondary`, d.secondaryTeamName); });

  const raceResultsMap = new Map<string, string[]>();
  rrSnap.forEach(doc => { const d: any = doc.data(); if (d) raceResultsMap.set(doc.id, [d.driver1, d.driver2, d.driver3, d.driver4, d.driver5, d.driver6]); });

  const teamPredictionsByRace = new Map<string, Map<string, { predictions: string[]; timestamp: number }>>();
  predSnap.forEach(pd => {
    const p: any = pd.data();
    if (!Array.isArray(p.predictions) || p.predictions.length !== 6) return;
    const teamId: string = p.teamId || pd.ref.path.split('/')[1];
    let tsv = 0; if (p.submittedAt?.toMillis) tsv = p.submittedAt.toMillis(); else if (p.createdAt?.toMillis) tsv = p.createdAt.toMillis();
    const rid = p.raceId ? normalizeRaceIdForComparison(p.raceId) : null; if (!rid) return;
    if (!teamPredictionsByRace.has(teamId)) teamPredictionsByRace.set(teamId, new Map());
    const m = teamPredictionsByRace.get(teamId)!; const ex = m.get(rid);
    if (!ex || tsv > ex.timestamp) m.set(rid, { predictions: p.predictions, timestamp: tsv });
  });

  const raceRunMillis = new Map<string, number>();
  for (const race of RaceSchedule as any[]) {
    const gp = normalizeRaceIdForComparison(generateRaceId(race.name, 'gp')); if (race.raceTime) raceRunMillis.set(gp, new Date(race.raceTime).getTime());
    if (race.hasSprint && race.sprintTime) { const sp = normalizeRaceIdForComparison(generateRaceId(race.name, 'sprint')); raceRunMillis.set(sp, new Date(race.sprintTime).getTime()); }
  }
  const earliestByTeam = new Map<string, number>();
  teamPredictionsByRace.forEach((races, tid) => { let e = Number.POSITIVE_INFINITY; races.forEach(({ timestamp }) => { if (timestamp > 0 && timestamp < e) e = timestamp; }); earliestByTeam.set(tid, Number.isFinite(e) ? e : 0); });

  // Score a single (result, team) → points, breakdown-less. Faithful port of computeRaceScores.
  const scoreTeamForRace = (normResultId: string, actualResults: string[], teamId: string, races: Map<string, { predictions: string[]; timestamp: number }>): number | null => {
    let preds: string[] | null = null; let carried = false;
    if (races.has(normResultId)) preds = races.get(normResultId)!.predictions;
    else if (normResultId.endsWith('-sprint')) { const base = normResultId.replace(/-sprint$/, ''); if (races.has(base)) preds = races.get(base)!.predictions; }
    if (!preds) { let latest = 0; races.forEach(({ predictions, timestamp }) => { if (timestamp > latest) { latest = timestamp; preds = predictions; } }); carried = !!preds; }
    if (!preds) return null;
    if (carried) { const ranAt = raceRunMillis.get(normResultId); const joinedAt = earliestByTeam.get(teamId) ?? 0; if (ranAt !== undefined && joinedAt > 0 && ranAt < joinedAt) return null; }
    let total = 0, correct = 0;
    (preds as string[]).forEach((driverId, pos) => { const actual = actualResults.indexOf(driverId); total += calculateDriverPoints(pos, actual); if (actual !== -1) correct++; });
    if (correct === 6) total += SCORING_POINTS.bonusAll6;
    return total;
  };

  // 2) Cumulative championship (all races + adjustments), aggregated like the standings page
  const totals = new Map<string, number>();
  raceResultsMap.forEach((actual, docId) => {
    const norm = normalizeRaceIdForComparison(docId);
    teamPredictionsByRace.forEach((races, tid) => { const pts = scoreTeamForRace(norm, actual, tid, races); if (pts !== null) totals.set(tid, (totals.get(tid) || 0) + pts); });
  });
  adjSnap.forEach(doc => { const a: any = doc.data(); if (a && typeof a.userId === 'string' && typeof a.points === 'number') totals.set(a.userId, (totals.get(a.userId) || 0) + a.points); });

  const sorted = Array.from(totals.entries()).map(([userId, totalPoints]) => ({ userId, teamName: userMap.get(userId) || 'Unknown Team', totalPoints })).sort((a, b) => b.totalPoints - a.totalPoints);
  let rank = 1, prev = -1;
  const championship = sorted.map((e, i) => { if (e.totalPoints !== prev) { rank = i + 1; prev = e.totalPoints; } return { rank, teamName: e.teamName, totalPoints: e.totalPoints }; });

  // 3) British GP specifics — podium + round winner(s)
  const gp = raceResultsMap.get(RESULT_DOC_ID); if (!gp) throw new Error(`race_results/${RESULT_DOC_ID} missing`);
  const podium = gp.slice(0, 3).map(nameOf);
  const normGp = normalizeRaceIdForComparison(RESULT_DOC_ID);
  const gpScores: { teamName: string; points: number }[] = [];
  teamPredictionsByRace.forEach((races, tid) => { const pts = scoreTeamForRace(normGp, gp, tid, races); if (pts !== null) gpScores.push({ teamName: userMap.get(tid) || 'Unknown', points: pts }); });
  const maxPts = gpScores.reduce((m, s) => Math.max(m, s.points), 0);
  const roundWinners = gpScores.filter(s => s.points === maxPts && s.teamName !== 'Unknown').map(s => s.teamName);

  const message = buildResultsWhatsAppMessage({ raceName: RACE_NAME, podium, roundWinners, roundWinnerPoints: maxPts, standings: championship, standingsTopN: 5 });

  console.log('----- MESSAGE PREVIEW (worker will append Bill#<n>) -----');
  console.log(message);
  console.log('---------------------------------------------------------\n');

  if (!EXECUTE) { console.log('[DRY RUN] Not enqueued. Re-run with --execute to post to the group.'); return; }

  await db.collection('whatsapp_queue').add({
    groupName: GROUP,
    message,
    status: 'PENDING',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    retryCount: 0,
    source: 'manual:results-enrich-british-gp',
    testMode: false,
  });
  console.log('[EXECUTE] Enqueued PENDING to whatsapp_queue for', GROUP);

  // Wake the worker (HMAC), best-effort
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const url = process.env.WHATSAPP_WORKER_URL || WORKER_URL_FALLBACK;
    const sig = `sha256=${crypto.createHmac('sha256', secret).update('process-queue').digest('hex')}`;
    try {
      const res = await fetch(`${url}/process-queue`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, signal: AbortSignal.timeout(8000) });
      console.log('[EXECUTE] Woke worker /process-queue →', res.status);
    } catch (e: any) { console.log('[EXECUTE] Wake ping failed (worker will drain PENDING on its own):', e?.message); }
  } else {
    console.log('[EXECUTE] No WHATSAPP_APP_SECRET — worker will drain PENDING on its next poll.');
  }
  console.log('\n✅ Done. Check the group for the message (Bill#<n> suffix).');
}

main().then(() => process.exit(0)).catch(e => { console.error('FAILED:', e); process.exit(1); });
