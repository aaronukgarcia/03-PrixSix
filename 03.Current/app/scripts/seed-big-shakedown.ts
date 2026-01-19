/**
 * BIG SHAKEDOWN Seed Script v3
 *
 * Populates the database with 2000 teams and simulates a full 24-race season.
 * Each race: 2000 submissions → admin enters results → scores calculated
 *
 * Usage:
 *   npm run seed:big-shakedown
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, WriteBatch } from 'firebase-admin/firestore';
import * as path from 'path';

// Load service account from JSON file
const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
const serviceAccount = require(serviceAccountPath);

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();

// ============================================================================
// CONFIGURATION
// ============================================================================

// Protected admin accounts (never delete these)
const PROTECTED_EMAILS = [
  'aaron.garcia@hotmail.co.uk',
  'aaron@garcia.ltd',
];

// Number of test users to create
const NUM_USERS = 2000;

// Top 10 drivers for random selection (predictions and results)
const TOP_10_DRIVERS = [
  'verstappen', 'norris', 'leclerc', 'piastri', 'hamilton',
  'russell', 'sainz', 'alonso', 'perez', 'ocon'
];

// Race Schedule (24 races) - matches RaceSchedule in data.ts
const RACES = [
  { name: 'Australian Grand Prix', id: 'Australian-Grand-Prix' },
  { name: 'Chinese Grand Prix', id: 'Chinese-Grand-Prix' },
  { name: 'Japanese Grand Prix', id: 'Japanese-Grand-Prix' },
  { name: 'Bahrain Grand Prix', id: 'Bahrain-Grand-Prix' },
  { name: 'Saudi Arabian Grand Prix', id: 'Saudi-Arabian-Grand-Prix' },
  { name: 'Miami Grand Prix', id: 'Miami-Grand-Prix' },
  { name: 'Canadian Grand Prix', id: 'Canadian-Grand-Prix' },
  { name: 'Monaco Grand Prix', id: 'Monaco-Grand-Prix' },
  { name: 'Spanish Grand Prix', id: 'Spanish-Grand-Prix' },
  { name: 'Austrian Grand Prix', id: 'Austrian-Grand-Prix' },
  { name: 'British Grand Prix', id: 'British-Grand-Prix' },
  { name: 'Belgian Grand Prix', id: 'Belgian-Grand-Prix' },
  { name: 'Hungarian Grand Prix', id: 'Hungarian-Grand-Prix' },
  { name: 'Dutch Grand Prix', id: 'Dutch-Grand-Prix' },
  { name: 'Italian Grand Prix', id: 'Italian-Grand-Prix' },
  { name: 'Spanish Grand Prix II', id: 'Spanish-Grand-Prix-II' },
  { name: 'Azerbaijan Grand Prix', id: 'Azerbaijan-Grand-Prix' },
  { name: 'Singapore Grand Prix', id: 'Singapore-Grand-Prix' },
  { name: 'United States Grand Prix', id: 'United-States-Grand-Prix' },
  { name: 'Mexican Grand Prix', id: 'Mexican-Grand-Prix' },
  { name: 'Brazilian Grand Prix', id: 'Brazilian-Grand-Prix' },
  { name: 'Las Vegas Grand Prix', id: 'Las-Vegas-Grand-Prix' },
  { name: 'Qatar Grand Prix', id: 'Qatar-Grand-Prix' },
  { name: 'Abu Dhabi Grand Prix', id: 'Abu-Dhabi-Grand-Prix' },
];

// Team name generators
const ADJECTIVES = [
  'Racing', 'Speed', 'Turbo', 'Fast', 'Lightning', 'Thunder', 'Storm', 'Fire',
  'Ice', 'Shadow', 'Dark', 'Bright', 'Golden', 'Silver', 'Red', 'Blue', 'Green',
  'Black', 'White', 'Royal', 'Elite', 'Prime', 'Ultra', 'Mega', 'Super', 'Hyper',
  'Apex', 'Peak', 'Max', 'Pro', 'Alpha', 'Omega', 'Delta', 'Sigma', 'Phantom',
  'Ghost', 'Spirit', 'Wild', 'Savage', 'Fierce', 'Bold', 'Brave', 'Noble', 'Grand'
];

const NOUNS = [
  'Racers', 'Motors', 'Racing', 'Speed', 'Wheels', 'Drivers', 'Team', 'Crew',
  'Squad', 'Force', 'Power', 'Energy', 'Dynamics', 'Velocity', 'Momentum',
  'Thrust', 'Boost', 'Nitro', 'Fuel', 'Grip', 'Drift', 'Apex', 'Circuit',
  'Pit', 'Podium', 'Champs', 'Legends', 'Stars', 'Kings', 'Knights', 'Warriors',
  'Wolves', 'Lions', 'Eagles', 'Falcons', 'Hawks', 'Panthers', 'Tigers', 'Bears',
  'Sharks', 'Vipers', 'Cobras', 'Dragons', 'Phoenix', 'Titans', 'Giants', 'Legends'
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateUserId(index: number): string {
  return `user_${String(index).padStart(4, '0')}`;
}

function generateTeamName(index: number): string {
  const adj = ADJECTIVES[index % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(index / ADJECTIVES.length) % NOUNS.length];
  const num = Math.floor(index / (ADJECTIVES.length * NOUNS.length));
  return num > 0 ? `${adj} ${noun} ${num + 1}` : `${adj} ${noun}`;
}

function generateEmail(index: number): string {
  return `user${index}@prixsix-test.com`;
}

function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function pickRandomDrivers(count: number): string[] {
  return shuffleArray(TOP_10_DRIVERS).slice(0, count);
}

function calculateScore(predictions: string[], actualTop6: string[]): { points: number; breakdown: string } {
  let correctCount = 0;
  const breakdownParts: string[] = [];

  predictions.forEach((driverId) => {
    if (actualTop6.includes(driverId)) {
      correctCount++;
      breakdownParts.push(`${driverId} (+1)`);
    } else {
      breakdownParts.push(`${driverId} (miss)`);
    }
  });

  let totalPoints = correctCount;

  if (correctCount === 5) {
    totalPoints += 3;
    breakdownParts.push('5/6 bonus +3');
  } else if (correctCount === 6) {
    totalPoints += 5;
    breakdownParts.push('6/6 bonus +5');
  }

  return {
    points: totalPoints,
    breakdown: breakdownParts.join(', '),
  };
}

// ============================================================================
// BATCH WRITE HELPER
// ============================================================================

async function commitBatches(batches: WriteBatch[]): Promise<void> {
  for (const batch of batches) {
    await batch.commit();
  }
}

function createBatchedWrites<T>(
  items: T[],
  batchSize: number = 500
): { batches: WriteBatch[]; addToBatch: (index: number, operation: (batch: WriteBatch) => void) => void } {
  const batches: WriteBatch[] = [];
  let currentBatch = db.batch();
  let currentCount = 0;
  batches.push(currentBatch);

  const addToBatch = (index: number, operation: (batch: WriteBatch) => void) => {
    if (currentCount >= batchSize) {
      currentBatch = db.batch();
      batches.push(currentBatch);
      currentCount = 0;
    }
    operation(currentBatch);
    currentCount++;
  };

  return { batches, addToBatch };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function batchDelete(docs: FirebaseFirestore.QueryDocumentSnapshot[], label: string): Promise<number> {
  const batchSize = 500;
  let deleted = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + batchSize);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  console.log(`  🗑️ Deleted ${deleted} ${label}`);
  return deleted;
}

async function clearExistingData() {
  console.log('🧹 Clearing existing data (preserving admin accounts)...');

  // First, identify protected user IDs by email
  const protectedUserIds = new Set<string>();
  const usersSnapshot = await db.collection('users').get();

  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    if (data.email && PROTECTED_EMAILS.includes(data.email.toLowerCase())) {
      protectedUserIds.add(doc.id);
      console.log(`  🛡️ Protecting: ${data.teamName || data.email} (${doc.id})`);
    }
  }

  // Collect all users to delete (except protected)
  const usersToDelete = usersSnapshot.docs.filter((doc) => !protectedUserIds.has(doc.id));

  // Delete user predictions subcollections in bulk
  console.log('  Clearing user predictions subcollections...');
  for (const userDoc of usersToDelete) {
    const predictionsSnapshot = await db.collection('users').doc(userDoc.id).collection('predictions').get();
    if (predictionsSnapshot.docs.length > 0) {
      await batchDelete(predictionsSnapshot.docs, `predictions for ${userDoc.id}`);
    }
  }

  // Delete users in bulk
  await batchDelete(usersToDelete, 'users');

  // Delete scores (except for protected users) in bulk
  const scoresSnapshot = await db.collection('scores').get();
  const scoresToDelete = scoresSnapshot.docs.filter((doc) => !protectedUserIds.has(doc.data().userId));
  await batchDelete(scoresToDelete, 'scores');

  // Delete ALL race results in bulk
  const resultsSnapshot = await db.collection('race_results').get();
  await batchDelete(resultsSnapshot.docs, 'race results');

  // Delete presence docs (except protected) in bulk
  const presenceSnapshot = await db.collection('presence').get();
  const presenceToDelete = presenceSnapshot.docs.filter((doc) => !protectedUserIds.has(doc.id));
  await batchDelete(presenceToDelete, 'presence docs');

  // Delete prediction_submissions (except protected) in bulk
  const submissionsSnapshot = await db.collection('prediction_submissions').get();
  const submissionsToDelete = submissionsSnapshot.docs.filter((doc) => !protectedUserIds.has(doc.data().userId));
  await batchDelete(submissionsToDelete, 'prediction submissions');

  // Delete audit_logs in bulk
  const auditSnapshot = await db.collection('audit_logs').get();
  await batchDelete(auditSnapshot.docs, 'audit logs');

  console.log('✅ Existing data cleared (admin accounts preserved)');
}

async function createUsers() {
  console.log(`\n👥 Creating ${NUM_USERS} users...`);

  const batchSize = 500;
  let created = 0;

  for (let batchStart = 0; batchStart < NUM_USERS; batchStart += batchSize) {
    const batch = db.batch();
    const batchEnd = Math.min(batchStart + batchSize, NUM_USERS);

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = generateUserId(i + 1);
      const userRef = db.collection('users').doc(userId);
      const presenceRef = db.collection('presence').doc(userId);

      batch.set(userRef, {
        id: userId,
        email: generateEmail(i + 1),
        teamName: generateTeamName(i + 1),
        isAdmin: false,
        mustChangePin: false,
        badLoginAttempts: 0,
        createdAt: FieldValue.serverTimestamp(),
      });

      batch.set(presenceRef, {
        online: false,
        sessions: [],
      });

      created++;
    }

    await batch.commit();
    process.stdout.write(`\r  Created ${created}/${NUM_USERS} users`);
  }

  console.log(`\n✅ ${NUM_USERS} users created`);
}

async function simulateRace(raceIndex: number, race: { name: string; id: string }) {
  const raceNum = raceIndex + 1;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏁 Race ${raceNum}/24: ${race.name}`);
  console.log('='.repeat(60));

  // Step 1: Generate predictions for all users
  console.log(`\n📋 Generating ${NUM_USERS} predictions...`);

  const userPredictions: Map<string, string[]> = new Map();
  const batchSize = 250; // Smaller batches for subcollection writes
  let predictionsCreated = 0;

  for (let batchStart = 0; batchStart < NUM_USERS; batchStart += batchSize) {
    const batch = db.batch();
    const batchEnd = Math.min(batchStart + batchSize, NUM_USERS);

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = generateUserId(i + 1);
      const teamName = generateTeamName(i + 1);
      const predictions = pickRandomDrivers(6);
      userPredictions.set(userId, predictions);

      const predictionId = `${userId}_${race.id}`;

      // Subcollection prediction
      const predRef = db.collection('users').doc(userId).collection('predictions').doc(predictionId);
      batch.set(predRef, {
        id: predictionId,
        userId,
        teamId: userId,
        teamName,
        raceId: race.id,
        raceName: race.name,
        predictions,
        submissionTimestamp: FieldValue.serverTimestamp(),
      });

      predictionsCreated++;
    }

    await batch.commit();
    process.stdout.write(`\r  Predictions: ${predictionsCreated}/${NUM_USERS}`);
  }

  // Also create prediction_submissions (denormalized)
  console.log(`\n  Creating prediction_submissions...`);
  let submissionsCreated = 0;

  for (let batchStart = 0; batchStart < NUM_USERS; batchStart += batchSize) {
    const batch = db.batch();
    const batchEnd = Math.min(batchStart + batchSize, NUM_USERS);

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = generateUserId(i + 1);
      const teamName = generateTeamName(i + 1);
      const predictions = userPredictions.get(userId)!;

      const predictionId = `${userId}_${race.id}`;
      const subRef = db.collection('prediction_submissions').doc(predictionId);

      batch.set(subRef, {
        id: predictionId,
        oduserId: null,
        odteamId: null,
        userId,
        teamId: userId,
        teamName,
        raceId: race.id,
        raceName: race.name,
        predictions: {
          P1: predictions[0],
          P2: predictions[1],
          P3: predictions[2],
          P4: predictions[3],
          P5: predictions[4],
          P6: predictions[5],
        },
        submissionTimestamp: FieldValue.serverTimestamp(),
      });

      submissionsCreated++;
    }

    await batch.commit();
    process.stdout.write(`\r  Submissions: ${submissionsCreated}/${NUM_USERS}`);
  }

  console.log('');

  // Step 1b: Create audit log entries for submissions
  console.log(`  Creating audit logs...`);
  let auditLogsCreated = 0;

  for (let batchStart = 0; batchStart < NUM_USERS; batchStart += batchSize) {
    const batch = db.batch();
    const batchEnd = Math.min(batchStart + batchSize, NUM_USERS);

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = generateUserId(i + 1);
      const predictions = userPredictions.get(userId)!;

      const auditRef = db.collection('audit_logs').doc();
      batch.set(auditRef, {
        userId,
        action: 'prediction_submit',
        details: {
          raceId: race.id,
          raceName: race.name,
          predictions,
        },
        correlationId: generateGuid(),
        timestamp: FieldValue.serverTimestamp(),
      });

      auditLogsCreated++;
    }

    await batch.commit();
    process.stdout.write(`\r  Audit logs: ${auditLogsCreated}/${NUM_USERS}`);
  }

  console.log('');

  // Step 2: Admin enters race results (random top 6)
  const raceResults = pickRandomDrivers(6);
  console.log(`\n🏆 Admin enters results: ${raceResults.map((d, i) => `P${i + 1}:${d}`).join(', ')}`);

  await db.collection('race_results').doc(race.id).set({
    id: race.id,
    raceId: race.name,
    driver1: raceResults[0],
    driver2: raceResults[1],
    driver3: raceResults[2],
    driver4: raceResults[3],
    driver5: raceResults[4],
    driver6: raceResults[5],
    submittedAt: FieldValue.serverTimestamp(),
  });

  // Step 3: Calculate and save scores
  console.log(`\n📊 Calculating ${NUM_USERS} scores...`);
  let scoresCreated = 0;
  let totalPoints = 0;
  const scoreDistribution: Map<number, number> = new Map();

  for (let batchStart = 0; batchStart < NUM_USERS; batchStart += batchSize) {
    const batch = db.batch();
    const batchEnd = Math.min(batchStart + batchSize, NUM_USERS);

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = generateUserId(i + 1);
      const predictions = userPredictions.get(userId)!;
      const { points, breakdown } = calculateScore(predictions, raceResults);

      totalPoints += points;
      scoreDistribution.set(points, (scoreDistribution.get(points) || 0) + 1);

      const scoreRef = db.collection('scores').doc(`${race.id}_${userId}`);
      batch.set(scoreRef, {
        userId,
        raceId: race.id,
        totalPoints: points,
        breakdown,
      });

      scoresCreated++;
    }

    await batch.commit();
    process.stdout.write(`\r  Scores: ${scoresCreated}/${NUM_USERS}`);
  }

  console.log('');

  // Print score distribution for this race
  const avgScore = (totalPoints / NUM_USERS).toFixed(2);
  console.log(`\n📈 Race ${raceNum} Stats:`);
  console.log(`   Average score: ${avgScore} points`);
  console.log(`   Distribution:`);

  const sortedScores = Array.from(scoreDistribution.entries()).sort((a, b) => b[0] - a[0]);
  for (const [score, count] of sortedScores) {
    const pct = ((count / NUM_USERS) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / NUM_USERS * 50));
    console.log(`     ${score.toString().padStart(2)} pts: ${count.toString().padStart(4)} users (${pct.padStart(5)}%) ${bar}`);
  }
}

async function printFinalStandings() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🏆 FINAL STANDINGS');
  console.log('='.repeat(60));

  // Aggregate scores
  const scoresSnapshot = await db.collection('scores').get();
  const userTotals = new Map<string, number>();

  scoresSnapshot.forEach((doc) => {
    const data = doc.data();
    const userId = data.userId;
    if (userId && userId.startsWith('user_')) {
      userTotals.set(userId, (userTotals.get(userId) || 0) + (data.totalPoints || 0));
    }
  });

  // Get team names
  const usersSnapshot = await db.collection('users').get();
  const userMap = new Map<string, string>();
  usersSnapshot.forEach((doc) => {
    userMap.set(doc.id, doc.data().teamName || 'Unknown');
  });

  // Sort and rank
  const standings = Array.from(userTotals.entries())
    .map(([userId, totalPoints]) => ({
      userId,
      teamName: userMap.get(userId) || 'Unknown',
      totalPoints,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  // Print top 20
  console.log('\nTop 20:');
  console.log(`${'Rank'.padEnd(6)}${'Team'.padEnd(30)}${'Points'.padStart(10)}`);
  console.log('-'.repeat(50));

  let currentRank = 1;
  standings.slice(0, 20).forEach((entry, index) => {
    if (index > 0 && entry.totalPoints < standings[index - 1].totalPoints) {
      currentRank = index + 1;
    }
    console.log(`${currentRank.toString().padEnd(6)}${entry.teamName.padEnd(30)}${entry.totalPoints.toString().padStart(10)}`);
  });

  // Print bottom 5
  console.log('\nBottom 5:');
  standings.slice(-5).forEach((entry, index) => {
    const rank = standings.length - 4 + index;
    console.log(`${rank.toString().padEnd(6)}${entry.teamName.padEnd(30)}${entry.totalPoints.toString().padStart(10)}`);
  });

  // Stats
  const points = standings.map(s => s.totalPoints);
  const avg = points.reduce((a, b) => a + b, 0) / points.length;
  const max = Math.max(...points);
  const min = Math.min(...points);

  console.log(`\nSeason Stats:`);
  console.log(`  Average: ${avg.toFixed(1)} points`);
  console.log(`  Highest: ${max} points`);
  console.log(`  Lowest: ${min} points`);
  console.log(`  Theoretical max: ${24 * 11} = 264 points`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runBigShakedown() {
  console.log('🏎️  BIG SHAKEDOWN v3 - 2000 Teams, 24 Races');
  console.log('==========================================\n');
  console.log(`Total data to create:`);
  console.log(`  • ${NUM_USERS.toLocaleString()} users`);
  console.log(`  • ${(NUM_USERS * 24).toLocaleString()} predictions (in user subcollections)`);
  console.log(`  • ${(NUM_USERS * 24).toLocaleString()} prediction_submissions (denormalized)`);
  console.log(`  • ${(NUM_USERS * 24).toLocaleString()} audit_logs (submission trail)`);
  console.log(`  • 24 race_results`);
  console.log(`  • ${(NUM_USERS * 24).toLocaleString()} scores`);
  console.log(`  • Total documents: ${(NUM_USERS + NUM_USERS + (NUM_USERS * 24 * 4) + 24).toLocaleString()}`);
  console.log('');

  const startTime = Date.now();

  // Step 1: Clear existing data
  await clearExistingData();

  // Step 2: Create all users
  await createUsers();

  // Step 3: Simulate each race
  for (let i = 0; i < RACES.length; i++) {
    await simulateRace(i, RACES[i]);
  }

  // Step 4: Print final standings
  await printFinalStandings();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ BIG SHAKEDOWN COMPLETE in ${elapsed} minutes!`);
}

// Run the script
runBigShakedown()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed:', error);
    process.exit(1);
  });
