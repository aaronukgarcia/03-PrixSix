/**
 * checkGhostPoints.js — "Leclerc Rule" Ghost Points Auditor
 *
 * Connects to Firestore and audits every score document to find "Ghost Points":
 * points awarded to a driver who did NOT appear in the official top 6 for that race.
 *
 * The scoring engine should assign 0 points to any driver not in the top 6
 * (calculateDriverPoints returns 0 when actualPosition === -1). This script
 * verifies that invariant holds across all historical data.
 *
 * Usage:  node scripts/checkGhostPoints.js
 * Output: Console report + writes to Firestore audit_logs collection
 */

const admin = require('firebase-admin');
const path = require('path');

// --- Configuration ---
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');
const PROJECT_ID = 'studio-6033436327-281b1';

// --- Driver ID <-> Display Name mapping (mirrors app/src/lib/data.ts) ---
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

// Build reverse map: display name (lowercase) -> driver ID
const NAME_TO_ID = {};
for (const [id, name] of Object.entries(DRIVER_MAP)) {
  NAME_TO_ID[name.toLowerCase()] = id;
}

// --- Initialise Firebase Admin ---
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT_PATH),
  projectId: PROJECT_ID,
});
const db = admin.firestore();

/**
 * Parse a breakdown string into per-driver scoring entries.
 * Format: "DriverName+Points, DriverName+Points, BonusAll6+10"
 * Returns: [{ driverName, driverId, points }]
 */
function parseBreakdown(breakdown) {
  if (!breakdown) return [];

  const entries = [];
  const parts = breakdown.split(',').map(p => p.trim());

  for (const part of parts) {
    // Match "DriverName+N" pattern
    const match = part.match(/^(.+?)\+(\d+)$/);
    if (!match) continue;

    const [, name, pointsStr] = match;
    const points = parseInt(pointsStr, 10);

    // Skip bonus entries
    if (name === 'BonusAll6' || name === 'Bonus') continue;

    const driverId = NAME_TO_ID[name.toLowerCase()] || name.toLowerCase();

    entries.push({
      driverName: name,
      driverId,
      points,
    });
  }

  return entries;
}

async function main() {
  console.log('');
  console.log('='.repeat(70));
  console.log('  GHOST POINTS AUDITOR — "Leclerc Rule" Check');
  console.log('  Scans every score for points awarded to drivers outside the top 6');
  console.log('='.repeat(70));
  console.log('');

  // --- Step 1: Load all race results ---
  console.log('[Phase 1] Loading race results...');
  const resultsSnap = await db.collection('race_results').get();
  const raceResults = new Map(); // raceId -> { id, top6: [driverId, ...] }

  resultsSnap.forEach(doc => {
    const data = doc.data();
    const top6 = [
      data.driver1, data.driver2, data.driver3,
      data.driver4, data.driver5, data.driver6,
    ].filter(Boolean);

    raceResults.set(doc.id, {
      id: doc.id,
      raceId: data.raceId || doc.id,
      top6,
    });
  });

  console.log(`  Found ${raceResults.size} race results`);
  for (const [id, result] of raceResults) {
    console.log(`    ${id}: [${result.top6.join(', ')}]`);
  }
  console.log('');

  // --- Step 2: Load all scores ---
  console.log('[Phase 1] Loading scores...');
  const scoresSnap = await db.collection('scores').get();
  console.log(`  Found ${scoresSnap.size} score documents`);
  console.log('');

  // --- Step 3: Load users for team name lookup ---
  console.log('[Phase 1] Loading users...');
  const usersSnap = await db.collection('users').get();
  const userMap = new Map(); // userId -> teamName
  usersSnap.forEach(doc => {
    const data = doc.data();
    userMap.set(doc.id, data.teamName || 'Unknown');
    if (data.secondaryTeamName) {
      userMap.set(`${doc.id}-secondary`, data.secondaryTeamName);
    }
  });
  console.log(`  Found ${userMap.size} team entries`);
  console.log('');

  // --- Step 4: Audit every score ---
  console.log('[Phase 2] Auditing scores for Ghost Points...');
  console.log('-'.repeat(70));

  const ghostPoints = []; // Collected violations
  let scoresChecked = 0;
  let scoresSkipped = 0;
  let driversChecked = 0;

  scoresSnap.forEach(doc => {
    const score = doc.data();
    const scoreId = doc.id;

    // Skip late-joiner handicap scores
    if (score.raceId === 'late-joiner-handicap') {
      scoresSkipped++;
      return;
    }

    // Find the matching race result
    const raceResult = raceResults.get(score.raceId);
    if (!raceResult) {
      // No race result found — can't verify
      scoresSkipped++;
      return;
    }

    if (!score.breakdown) {
      scoresSkipped++;
      return;
    }

    scoresChecked++;
    const entries = parseBreakdown(score.breakdown);
    const top6Ids = raceResult.top6.map(d => d.toLowerCase());

    for (const entry of entries) {
      driversChecked++;

      if (entry.points > 0) {
        // THE LECLERC RULE: This driver got points.
        // Verify they actually appear in the official top 6.
        const driverInTop6 = top6Ids.includes(entry.driverId.toLowerCase());

        if (!driverInTop6) {
          const teamName = userMap.get(score.userId) || 'Unknown';

          ghostPoints.push({
            scoreDocId: scoreId,
            raceId: score.raceId,
            raceName: score.raceName || score.raceId,
            teamName,
            userId: score.userId,
            driverName: entry.driverName,
            driverId: entry.driverId,
            pointsAwarded: entry.points,
            totalScoreStored: score.totalPoints,
            breakdown: score.breakdown,
            officialTop6: raceResult.top6,
          });
        }
      }
    }
  });

  // --- Step 5: Report ---
  console.log('');
  console.log('='.repeat(70));
  console.log('  AUDIT RESULTS');
  console.log('='.repeat(70));
  console.log('');
  console.log(`  Scores checked:     ${scoresChecked}`);
  console.log(`  Scores skipped:     ${scoresSkipped} (handicaps / missing results / no breakdown)`);
  console.log(`  Driver entries:     ${driversChecked}`);
  console.log(`  Ghost Points found: ${ghostPoints.length}`);
  console.log('');

  if (ghostPoints.length === 0) {
    console.log('  ** NO GHOST POINTS DETECTED **');
    console.log('  All points were awarded to drivers who appeared in the official top 6.');
    console.log('');
  } else {
    console.log('  ** GHOST POINTS DETECTED **');
    console.log('');

    // Group by race for readability
    const byRace = new Map();
    for (const gp of ghostPoints) {
      const key = gp.raceId;
      if (!byRace.has(key)) byRace.set(key, []);
      byRace.get(key).push(gp);
    }

    for (const [raceId, violations] of byRace) {
      console.log(`  Race: ${violations[0].raceName} (${raceId})`);
      console.log(`  Official Top 6: [${violations[0].officialTop6.join(', ')}]`);
      console.log('');

      for (const v of violations) {
        console.log(`    Team: ${v.teamName} (${v.userId})`);
        console.log(`    Ghost Driver: ${v.driverName} (${v.driverId})`);
        console.log(`    Points Awarded: +${v.pointsAwarded} (should be 0)`);
        console.log(`    Score Total: ${v.totalScoreStored}`);
        console.log(`    Breakdown: ${v.breakdown}`);
        console.log('');
      }
    }
  }

  // --- Step 6: Write audit log to Firestore ---
  console.log('[Phase 2] Writing audit log to Firestore...');
  const auditRef = db.collection('audit_logs').doc();
  await auditRef.set({
    type: 'GHOST_POINTS_AUDIT',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    summary: {
      scoresChecked,
      scoresSkipped,
      driversChecked,
      ghostPointsFound: ghostPoints.length,
    },
    violations: ghostPoints.map(gp => ({
      scoreDocId: gp.scoreDocId,
      raceId: gp.raceId,
      raceName: gp.raceName,
      teamName: gp.teamName,
      userId: gp.userId,
      driverName: gp.driverName,
      driverId: gp.driverId,
      pointsAwarded: gp.pointsAwarded,
      totalScoreStored: gp.totalScoreStored,
      officialTop6: gp.officialTop6,
    })),
  });

  console.log(`  Audit log written: ${auditRef.id}`);
  console.log('');
  console.log('='.repeat(70));
  console.log('  AUDIT COMPLETE');
  console.log('='.repeat(70));
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
