/**
 * Backfill: British Grand Prix (main GP) results emails
 * ------------------------------------------------------
 * WHY: On 2026-07-05 the British GP was a SPRINT weekend — two results postings the same day.
 *      The Sprint batch (12:45) sent 30 emails and hit the old DAILY_GLOBAL_LIMIT of 30. When the
 *      main GP was posted at 21:09, canSendEmailAdmin saw totalSent(30) >= 30 and blocked EVERY
 *      recipient, so the entire GP results email batch was silently suppressed (0 sent).
 *      email_daily_stats/2026-07-05.totalSent is stuck at 30 with no entries after 12:45.
 *
 * WHAT: Reconstruct the exact `scores[]` payload the GP results email would have carried, then POST
 *       to the deployed /api/send-results-email so it re-sends to every opted-in player using the
 *       SAME email template + tracking (SSOT). The daily cap resets per calendar day, so run this on
 *       a day whose budget is not already exhausted (ideally after the cap-raise fix is deployed).
 *
 * PARITY: Scoring uses the REAL primitives (calculateDriverPoints, SCORING_POINTS, F1Drivers) and a
 *         faithful port of computeRaceScores' prediction-selection + carry-forward gate. Dry-run
 *         prints the full scored table for a human eyeball check before any send.
 *
 * SAFE BY DEFAULT: dry-run unless --execute is passed.
 *
 * Run (dry-run):  npx tsx scripts/backfill-british-gp-emails.ts
 * Run (send):     npx tsx scripts/backfill-british-gp-emails.ts --execute
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import { SCORING_POINTS, calculateDriverPoints } from '../src/lib/scoring-rules';
import { F1Drivers, RaceSchedule } from '../src/lib/data';
import { normalizeRaceIdForComparison, generateRaceId } from '../src/lib/normalize-race-id';

const RESULT_DOC_ID = 'British-Grand-Prix-GP';
const RACE_NAME = 'British Grand Prix - GP';
const RACE_ID = 'British-Grand-Prix-GP';
const ENDPOINT = 'https://prix6.win/api/send-results-email';
const EXECUTE = process.argv.includes('--execute');

const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
const serviceAccount = require(serviceAccountPath);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const driverName = (id: string): string => F1Drivers.find(d => d.id === id)?.name || id;

async function main() {
  console.log(`\n=== Backfill British GP results email (${EXECUTE ? 'EXECUTE — WILL SEND' : 'DRY RUN'}) ===\n`);

  // 1) Official result for the GP
  const rr = await db.collection('race_results').doc(RESULT_DOC_ID).get();
  if (!rr.exists) throw new Error(`race_results/${RESULT_DOC_ID} not found`);
  const r = rr.data()!;
  const actualResults: string[] = [r.driver1, r.driver2, r.driver3, r.driver4, r.driver5, r.driver6];
  const officialResult = actualResults.map(driverName);
  const normResultId = normalizeRaceIdForComparison(RESULT_DOC_ID);
  console.log('Official result:', officialResult.map((n, i) => `P${i + 1} ${n}`).join('  '));

  // 2) userMap (primary + secondary team names) — mirrors calculate-scores
  const usersSnap = await db.collection('users').get();
  const userMap = new Map<string, string>();
  usersSnap.forEach(doc => {
    const d: any = doc.data();
    if (d?.teamName) userMap.set(doc.id, d.teamName);
    if (d?.secondaryTeamName) userMap.set(`${doc.id}-secondary`, d.secondaryTeamName);
  });

  // 3) Faithful port of computeRaceScores' prediction selection (cumulative-standings.ts)
  const predsSnap = await db.collectionGroup('predictions').get();
  const teamPredictionsByRace = new Map<string, Map<string, { predictions: string[]; timestamp: number }>>();
  predsSnap.forEach(predDoc => {
    const p: any = predDoc.data();
    if (!Array.isArray(p.predictions) || p.predictions.length !== 6) return;
    const parts = predDoc.ref.path.split('/');
    const teamId: string = p.teamId || parts[1];
    let ts = 0;
    if (p.submittedAt?.toMillis) ts = p.submittedAt.toMillis();
    else if (p.createdAt?.toMillis) ts = p.createdAt.toMillis();
    const predRaceId = p.raceId ? normalizeRaceIdForComparison(p.raceId) : null;
    if (!predRaceId) return;
    if (!teamPredictionsByRace.has(teamId)) teamPredictionsByRace.set(teamId, new Map());
    const races = teamPredictionsByRace.get(teamId)!;
    const existing = races.get(predRaceId);
    if (!existing || ts > existing.timestamp) races.set(predRaceId, { predictions: p.predictions, timestamp: ts });
  });

  // race-run millis (for carry-forward gate)
  const raceRunMillis = new Map<string, number>();
  for (const race of RaceSchedule) {
    const gpKey = normalizeRaceIdForComparison(generateRaceId(race.name, 'gp'));
    if ((race as any).raceTime) raceRunMillis.set(gpKey, new Date((race as any).raceTime).getTime());
    if ((race as any).hasSprint && (race as any).sprintTime) {
      const sKey = normalizeRaceIdForComparison(generateRaceId(race.name, 'sprint'));
      raceRunMillis.set(sKey, new Date((race as any).sprintTime).getTime());
    }
  }
  const earliestByTeam = new Map<string, number>();
  teamPredictionsByRace.forEach((races, teamId) => {
    let earliest = Number.POSITIVE_INFINITY;
    races.forEach(({ timestamp }) => { if (timestamp > 0 && timestamp < earliest) earliest = timestamp; });
    earliestByTeam.set(teamId, Number.isFinite(earliest) ? earliest : 0);
  });

  // 4) Score every team for the GP, building the breakdown string exactly like calculate-scores
  const scores: { teamName: string; prediction: string; points: number }[] = [];
  teamPredictionsByRace.forEach((races, teamId) => {
    let teamPredictions: string[] | null = null;
    let carriedForward = false;
    if (races.has(normResultId)) {
      teamPredictions = races.get(normResultId)!.predictions;
    } else if (normResultId.endsWith('-sprint')) {
      const base = normResultId.replace(/-sprint$/, '');
      if (races.has(base)) teamPredictions = races.get(base)!.predictions;
    }
    if (!teamPredictions) {
      let latestTs = 0;
      races.forEach(({ predictions, timestamp }) => { if (timestamp > latestTs) { latestTs = timestamp; teamPredictions = predictions; } });
      carriedForward = !!teamPredictions;
    }
    if (!teamPredictions) return;
    if (carriedForward) {
      const ranAt = raceRunMillis.get(normResultId);
      const joinedAt = earliestByTeam.get(teamId) ?? 0;
      if (ranAt !== undefined && joinedAt > 0 && ranAt < joinedAt) return; // gate late joiners
    }

    let totalPoints = 0;
    let correctCount = 0;
    const breakdownParts: string[] = [];
    (teamPredictions as string[]).forEach((driverId, predictedPosition) => {
      const actualPosition = actualResults.indexOf(driverId);
      const pts = calculateDriverPoints(predictedPosition, actualPosition);
      totalPoints += pts;
      if (actualPosition !== -1) correctCount++;
      breakdownParts.push(`${driverName(driverId)}+${pts}`);
    });
    if (correctCount === 6) { totalPoints += SCORING_POINTS.bonusAll6; breakdownParts.push(`BonusAll6+${SCORING_POINTS.bonusAll6}`); }

    scores.push({ teamName: userMap.get(teamId) || 'Unknown', prediction: breakdownParts.join(', '), points: totalPoints });
  });

  scores.sort((a, b) => b.points - a.points);

  // 5) Recipients preview (endpoint decides the actual send list)
  const optedIn = usersSnap.docs.filter(d => (d.data() as any).emailPreferences?.resultsNotifications !== false);
  console.log(`\nTeams scored for GP: ${scores.length}`);
  console.log(`Opted-in users (endpoint will email these): ${optedIn.length}`);
  console.log('\nScored table (teamName — points):');
  scores.forEach(s => console.log(`  ${String(s.points).padStart(4)}  ${s.teamName}`));

  const payload = { raceId: RACE_ID, raceName: RACE_NAME, officialResult, scores, standings: [] };

  if (!EXECUTE) {
    console.log(`\n[DRY RUN] Would POST to ${ENDPOINT}`);
    console.log(`[DRY RUN] Payload: raceId=${RACE_ID}, ${scores.length} team scores, ${officialResult.length} official positions.`);
    console.log('[DRY RUN] Sample (top scorer):', JSON.stringify(scores[0]));
    console.log('\nNo emails sent. Re-run with --execute to send.');
    return;
  }

  console.log(`\n[EXECUTE] POSTing to ${ENDPOINT} ...`);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json: any = await res.json().catch(() => null);
  console.log('HTTP', res.status);
  console.log('Response:', JSON.stringify(json, null, 2));
  if (json?.globalLimitReached) {
    console.log(`\n⚠️  Daily cap still blocked ${json.suppressedCount} recipient(s). Re-run tomorrow or after the cap-raise deploy.`);
  } else {
    console.log(`\n✅ Backfill sent. ${json?.message ?? ''}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
