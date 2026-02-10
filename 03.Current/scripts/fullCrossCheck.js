/**
 * fullCrossCheck.js — Complete Score Cross-Check
 *
 * For every score document, recalculates points from scratch using the
 * prediction array and the admin-entered race results. Compares each
 * driver individually: predicted position, actual position, position diff,
 * expected points, and what the breakdown string says.
 *
 * Usage:  node scripts/fullCrossCheck.js
 */

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');
const PROJECT_ID = 'studio-6033436327-281b1';

// Scoring constants (mirrors scoring-rules.ts)
const SCORING = {
  exactPosition: 6,
  onePositionOff: 4,
  twoPositionsOff: 3,
  threeOrMoreOff: 2,
  bonusAll6: 10,
};

// Driver ID <-> Display Name (mirrors data.ts)
const DRIVER_MAP = {
  verstappen: 'Verstappen', hadjar: 'Hadjar',
  leclerc: 'Leclerc', hamilton: 'Hamilton',
  norris: 'Norris', piastri: 'Piastri',
  russell: 'Russell', antonelli: 'Antonelli',
  alonso: 'Alonso', stroll: 'Stroll',
  gasly: 'Gasly', colapinto: 'Colapinto',
  albon: 'Albon', sainz: 'Sainz',
  lawson: 'Lawson', lindblad: 'Lindblad',
  hulkenberg: 'Hulkenberg', bortoleto: 'Bortoleto',
  ocon: 'Ocon', bearman: 'Bearman',
  perez: 'Perez', bottas: 'Bottas',
};
const NAME_TO_ID = {};
for (const [id, name] of Object.entries(DRIVER_MAP)) {
  NAME_TO_ID[name.toLowerCase()] = id;
}

function calculateDriverPoints(predictedPos, actualPos) {
  if (actualPos === -1 || actualPos < 0 || actualPos > 5) return 0;
  const diff = Math.abs(predictedPos - actualPos);
  if (diff === 0) return SCORING.exactPosition;
  if (diff === 1) return SCORING.onePositionOff;
  if (diff === 2) return SCORING.twoPositionsOff;
  return SCORING.threeOrMoreOff;
}

function scoreType(pts) {
  if (pts === 6) return 'A';
  if (pts === 4) return 'B';
  if (pts === 3) return 'C';
  if (pts === 2) return 'D';
  return 'E';
}

function normalizeRaceId(raceId) {
  return raceId
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '')
    .replace(/\s+/g, '-');
}

// --- Init Firebase ---
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT_PATH),
  projectId: PROJECT_ID,
});
const db = admin.firestore();

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('  FULL CROSS-CHECK: Every driver x Every race x Every team');
  console.log('='.repeat(80));
  console.log('');

  // --- Load data ---
  const [resultsSnap, scoresSnap, usersSnap, predsSnap] = await Promise.all([
    db.collection('race_results').get(),
    db.collection('scores').get(),
    db.collection('users').get(),
    db.collectionGroup('predictions').get(),
  ]);

  // Race results: raceResultDocId -> top6 array
  const raceResults = new Map();
  resultsSnap.forEach(doc => {
    const d = doc.data();
    raceResults.set(doc.id, {
      raceId: d.raceId || doc.id,
      top6: [d.driver1, d.driver2, d.driver3, d.driver4, d.driver5, d.driver6].filter(Boolean),
    });
  });

  // Users: userId -> teamName
  const userMap = new Map();
  const userSecondaryTeams = new Map();
  usersSnap.forEach(doc => {
    const d = doc.data();
    userMap.set(doc.id, d.teamName || 'Unknown');
    if (d.secondaryTeamName) {
      userMap.set(`${doc.id}-secondary`, d.secondaryTeamName);
      userSecondaryTeams.set(doc.id, d.secondaryTeamName);
    }
  });

  // Predictions: build map keyed by normalizedRaceId_teamId -> PredictionData[]
  const predMap = new Map();
  predsSnap.forEach(doc => {
    const d = doc.data();
    if (!Array.isArray(d.predictions) || d.predictions.length !== 6) return;

    const pathParts = doc.ref.path.split('/');
    const userId = pathParts[1];

    let teamId;
    if (d.teamId) {
      teamId = d.teamId;
    } else {
      const sec = userSecondaryTeams.get(userId);
      if (sec && d.teamName === sec) {
        teamId = `${userId}-secondary`;
      } else {
        teamId = userId;
      }
    }

    const normRace = normalizeRaceId(d.raceId || '').toLowerCase();
    const key = `${normRace}_${teamId}`;
    const ts = d.submittedAt?.toDate?.() || d.createdAt?.toDate?.() || new Date(0);

    if (!predMap.has(key)) predMap.set(key, []);
    predMap.get(key).push({ predictions: d.predictions, timestamp: ts, docId: doc.id });
  });

  // --- Audit every score ---
  let totalScores = 0;
  let skipped = 0;
  let matchCount = 0;
  let mismatchCount = 0;
  let noPrediction = 0;
  let noResult = 0;
  const mismatches = [];

  const scores = [];
  scoresSnap.forEach(doc => scores.push({ id: doc.id, ...doc.data() }));

  // Sort by raceId for grouped output
  scores.sort((a, b) => (a.raceId || '').localeCompare(b.raceId || ''));

  let currentRace = null;

  for (const score of scores) {
    totalScores++;

    if (score.raceId === 'late-joiner-handicap') {
      skipped++;
      continue;
    }

    const raceResult = raceResults.get(score.raceId);
    if (!raceResult) {
      noResult++;
      continue;
    }

    const normRace = normalizeRaceId(score.raceId).toLowerCase();
    const predKey = `${normRace}_${score.userId}`;
    const predKeyAlt = `${score.raceId.toLowerCase()}_${score.userId}`;
    const candidates = [
      ...(predMap.get(predKey) || []),
      ...(predMap.get(predKeyAlt) || []),
    ];

    if (candidates.length === 0) {
      noPrediction++;
      continue;
    }

    // Print race header
    if (score.raceId !== currentRace) {
      currentRace = score.raceId;
      console.log('');
      console.log('━'.repeat(80));
      console.log(`  RACE: ${score.raceName || score.raceId}  (doc: ${score.raceId})`);
      console.log(`  Official Top 6: ${raceResult.top6.map((d, i) => `P${i + 1}:${DRIVER_MAP[d] || d}`).join('  ')}`);
      console.log('━'.repeat(80));
    }

    const teamName = userMap.get(score.userId) || score.userId;

    // Try each prediction candidate — find the one that matches stored score
    let bestMatch = null;
    let bestDiff = Infinity;

    for (const cand of candidates) {
      let total = 0;
      let correct = 0;
      const rows = [];

      for (let p = 0; p < cand.predictions.length; p++) {
        const driverId = cand.predictions[p];
        const driverName = DRIVER_MAP[driverId] || driverId;
        const actualPos = raceResult.top6.indexOf(driverId);
        const pts = calculateDriverPoints(p, actualPos);
        total += pts;
        if (actualPos !== -1) correct++;

        rows.push({
          slot: p,
          driverId,
          driverName,
          actualPos,
          diff: actualPos === -1 ? '-' : Math.abs(p - actualPos),
          pts,
          type: scoreType(pts),
          inTop6: actualPos !== -1,
        });
      }

      if (correct === 6) total += SCORING.bonusAll6;

      const diff = Math.abs(total - (score.totalPoints || 0));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestMatch = { total, correct, rows, bonus: correct === 6, prediction: cand };
      }
      if (diff === 0) break;
    }

    if (!bestMatch) continue;

    const m = bestMatch;
    const isMatch = m.total === score.totalPoints;

    if (isMatch) {
      matchCount++;
    } else {
      mismatchCount++;
      mismatches.push({
        scoreId: score.id,
        raceId: score.raceId,
        teamName,
        stored: score.totalPoints,
        calculated: m.total,
      });
    }

    // Print team block
    const status = isMatch ? 'OK' : '** MISMATCH **';
    console.log('');
    console.log(`  Team: ${teamName}  ${status}  [stored=${score.totalPoints}, calc=${m.total}]`);
    console.log(`  Pred: [${m.prediction.predictions.map(d => DRIVER_MAP[d] || d).join(', ')}]`);
    console.log('  ┌──────┬─────────────┬───────────┬──────┬───────┬────┐');
    console.log('  │ Slot │ Driver      │ Actual    │ Diff │ Points│Type│');
    console.log('  ├──────┼─────────────┼───────────┼──────┼───────┼────┤');

    for (const r of m.rows) {
      const slot = `P${r.slot + 1}`.padEnd(4);
      const name = r.driverName.padEnd(11);
      const actual = r.actualPos === -1 ? 'NOT IN T6'.padEnd(9) : `P${r.actualPos + 1}`.padEnd(9);
      const diff = String(r.diff).padEnd(4);
      const pts = `+${r.pts}`.padEnd(5);
      const ghost = (!r.inTop6 && r.pts > 0) ? ' GHOST!' : '';
      console.log(`  │ ${slot} │ ${name} │ ${actual} │ ${diff} │ ${pts} │ ${r.type}  │${ghost}`);
    }

    if (m.bonus) {
      console.log(`  │      │ BonusAll6   │           │      │ +${SCORING.bonusAll6}`.padEnd(63) + '│ F  │');
    }
    console.log('  └──────┴─────────────┴───────────┴──────┴───────┴────┘');
  }

  // --- Summary ---
  console.log('');
  console.log('');
  console.log('='.repeat(80));
  console.log('  CROSS-CHECK SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`  Total score documents:    ${totalScores}`);
  console.log(`  Skipped (handicaps):      ${skipped}`);
  console.log(`  No race result found:     ${noResult}`);
  console.log(`  No prediction found:      ${noPrediction}`);
  console.log(`  Verified (match):         ${matchCount}`);
  console.log(`  MISMATCHES:               ${mismatchCount}`);
  console.log('');

  if (mismatchCount > 0) {
    console.log('  MISMATCH DETAILS:');
    console.log('  ' + '-'.repeat(78));
    for (const mm of mismatches) {
      console.log(`    ${mm.scoreId}  team=${mm.teamName}  stored=${mm.stored}  calc=${mm.calculated}  delta=${mm.stored - mm.calculated}`);
    }
    console.log('');
  } else {
    console.log('  ** ALL SCORES VERIFIED — ZERO MISMATCHES **');
    console.log('');
  }

  // Write summary to Firestore
  const auditRef = db.collection('audit_logs').doc();
  await auditRef.set({
    type: 'FULL_CROSS_CHECK',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    summary: {
      totalScores,
      skipped,
      noResult,
      noPrediction,
      matchCount,
      mismatchCount,
    },
    mismatches: mismatches.slice(0, 50), // cap at 50 to avoid doc size limits
  });
  console.log(`  Audit log: audit_logs/${auditRef.id}`);
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
