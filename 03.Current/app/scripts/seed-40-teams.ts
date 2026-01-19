/**
 * Seed Script - 40 Teams, Full Season
 *
 * Populates the database with 40 teams and simulates a full 24-race season.
 * Each race: 40 submissions → admin enters results → scores calculated
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = ".\service-account.json"
 *   npx ts-node --project app\tsconfig.scripts.json app\scripts\seed-40-teams.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, WriteBatch } from 'firebase-admin/firestore';
import * as path from 'path';

// Load service account from env var
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}
const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath));

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

const NUM_USERS = 40;

// Actual driver IDs from data.ts
const ALL_DRIVERS = [
  'verstappen', 'hadjar', 'leclerc', 'hamilton', 'norris', 'piastri',
  'russell', 'antonelli', 'alonso', 'stroll', 'gasly', 'colapinto',
  'albon', 'sainz', 'lawson', 'lindblad', 'hulkenberg', 'bortoleto',
  'ocon', 'bearman', 'perez', 'bottas'
];

// Top contenders for random selection (more likely to be in top 6)
const TOP_DRIVERS = [
  'verstappen', 'norris', 'leclerc', 'piastri', 'hamilton',
  'russell', 'sainz', 'alonso', 'perez', 'ocon'
];

// 24 Race Schedule - IDs must be lowercase for app compatibility
const RACES = [
  { name: 'Australian Grand Prix', id: 'australian-grand-prix' },
  { name: 'Chinese Grand Prix', id: 'chinese-grand-prix' },
  { name: 'Japanese Grand Prix', id: 'japanese-grand-prix' },
  { name: 'Bahrain Grand Prix', id: 'bahrain-grand-prix' },
  { name: 'Saudi Arabian Grand Prix', id: 'saudi-arabian-grand-prix' },
  { name: 'Miami Grand Prix', id: 'miami-grand-prix' },
  { name: 'Canadian Grand Prix', id: 'canadian-grand-prix' },
  { name: 'Monaco Grand Prix', id: 'monaco-grand-prix' },
  { name: 'Spanish Grand Prix', id: 'spanish-grand-prix' },
  { name: 'Austrian Grand Prix', id: 'austrian-grand-prix' },
  { name: 'British Grand Prix', id: 'british-grand-prix' },
  { name: 'Belgian Grand Prix', id: 'belgian-grand-prix' },
  { name: 'Hungarian Grand Prix', id: 'hungarian-grand-prix' },
  { name: 'Dutch Grand Prix', id: 'dutch-grand-prix' },
  { name: 'Italian Grand Prix', id: 'italian-grand-prix' },
  { name: 'Spanish Grand Prix II', id: 'spanish-grand-prix-ii' },
  { name: 'Azerbaijan Grand Prix', id: 'azerbaijan-grand-prix' },
  { name: 'Singapore Grand Prix', id: 'singapore-grand-prix' },
  { name: 'United States Grand Prix', id: 'united-states-grand-prix' },
  { name: 'Mexican Grand Prix', id: 'mexican-grand-prix' },
  { name: 'Brazilian Grand Prix', id: 'brazilian-grand-prix' },
  { name: 'Las Vegas Grand Prix', id: 'las-vegas-grand-prix' },
  { name: 'Qatar Grand Prix', id: 'qatar-grand-prix' },
  { name: 'Abu Dhabi Grand Prix', id: 'abu-dhabi-grand-prix' },
];

// Team name generators
const ADJECTIVES = [
  'Racing', 'Speed', 'Turbo', 'Fast', 'Lightning', 'Thunder', 'Storm', 'Fire',
  'Ice', 'Shadow', 'Dark', 'Bright', 'Golden', 'Silver', 'Red', 'Blue', 'Green',
  'Black', 'White', 'Royal', 'Elite', 'Prime', 'Ultra', 'Mega', 'Super', 'Hyper',
  'Apex', 'Peak', 'Max', 'Pro', 'Alpha', 'Omega', 'Delta', 'Sigma', 'Phantom',
  'Ghost', 'Spirit', 'Wild', 'Savage', 'Fierce'
];

const NOUNS = [
  'Racers', 'Motors', 'Racing', 'Speed', 'Wheels', 'Drivers', 'Team', 'Crew',
  'Squad', 'Force', 'Power', 'Energy', 'Dynamics', 'Velocity', 'Momentum',
  'Thrust', 'Boost', 'Nitro', 'Fuel', 'Grip', 'Drift', 'Apex', 'Circuit',
  'Pit', 'Podium', 'Champs', 'Legends', 'Stars', 'Kings', 'Knights', 'Warriors',
  'Wolves', 'Lions', 'Eagles', 'Falcons', 'Hawks', 'Panthers', 'Tigers', 'Bears'
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateUserId(index: number): string {
  return `team_${String(index).padStart(3, '0')}`;
}

function generateTeamName(index: number): string {
  const adj = ADJECTIVES[index % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(index / ADJECTIVES.length) % NOUNS.length];
  return `${adj} ${noun}`;
}

function generateEmail(index: number): string {
  return `team${index}@prixsix-test.com`;
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
  return shuffleArray(TOP_DRIVERS).slice(0, count);
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
// DATABASE OPERATIONS
// ============================================================================

async function createUsers() {
  console.log(`\n👥 Creating ${NUM_USERS} teams...`);

  const batch = db.batch();

  for (let i = 1; i <= NUM_USERS; i++) {
    const userId = generateUserId(i);
    const userRef = db.collection('users').doc(userId);
    const presenceRef = db.collection('presence').doc(userId);

    batch.set(userRef, {
      id: userId,
      email: generateEmail(i),
      teamName: generateTeamName(i),
      isAdmin: false,
      mustChangePin: false,
      badLoginAttempts: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(presenceRef, {
      online: false,
      sessions: [],
    });
  }

  await batch.commit();
  console.log(`✅ ${NUM_USERS} teams created`);
}

async function simulateRace(raceIndex: number, race: { name: string; id: string }) {
  const raceNum = raceIndex + 1;
  // Race ID for app uses name.replace(/\s+/g, '-') format
  const appRaceId = race.name.replace(/\s+/g, '-');

  console.log(`\n🏁 Race ${raceNum}/24: ${race.name}`);

  // Step 1: Generate predictions for all users
  const userPredictions: Map<string, string[]> = new Map();
  const predictionsBatch = db.batch();
  const submissionsBatch = db.batch();

  for (let i = 1; i <= NUM_USERS; i++) {
    const userId = generateUserId(i);
    const teamName = generateTeamName(i);
    const predictions = pickRandomDrivers(6);
    userPredictions.set(userId, predictions);

    const predictionId = `${userId}_${appRaceId}`;

    // Subcollection prediction - needs BOTH formats:
    // - driver1, driver2, etc. for Teams page
    // - predictions array for CC validation
    const predRef = db.collection('users').doc(userId).collection('predictions').doc(predictionId);
    predictionsBatch.set(predRef, {
      id: predictionId,
      oduserId: userId,
      userId,
      teamId: userId,
      teamName,
      raceId: appRaceId,
      raceName: race.name,
      // Individual driver fields for Teams page compatibility
      driver1: predictions[0],
      driver2: predictions[1],
      driver3: predictions[2],
      driver4: predictions[3],
      driver5: predictions[4],
      driver6: predictions[5],
      // Array format for CC validation
      predictions: predictions,
      submissionTimestamp: FieldValue.serverTimestamp(),
    });

    // Denormalized submission - uses {P1, P2, ...} object format for Results page
    const subRef = db.collection('prediction_submissions').doc(predictionId);
    submissionsBatch.set(subRef, {
      id: predictionId,
      oduserId: userId,
      odteamId: userId,
      userId,
      teamId: userId,
      teamName,
      raceId: appRaceId,
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
  }

  await predictionsBatch.commit();
  await submissionsBatch.commit();
  console.log(`   📋 ${NUM_USERS} predictions submitted`);

  // Step 2: Admin enters race results - doc ID must be lowercase for app query
  const raceResults = pickRandomDrivers(6);
  const lowercaseRaceId = race.id; // Already lowercase

  await db.collection('race_results').doc(lowercaseRaceId).set({
    id: lowercaseRaceId,
    raceId: race.name, // Human readable name
    driver1: raceResults[0],
    driver2: raceResults[1],
    driver3: raceResults[2],
    driver4: raceResults[3],
    driver5: raceResults[4],
    driver6: raceResults[5],
    submittedAt: FieldValue.serverTimestamp(),
  });
  console.log(`   🏆 Results: ${raceResults.join(', ')}`);

  // Step 3: Calculate and save scores
  const scoresBatch = db.batch();
  let totalPoints = 0;

  for (let i = 1; i <= NUM_USERS; i++) {
    const userId = generateUserId(i);
    const predictions = userPredictions.get(userId)!;
    const { points, breakdown } = calculateScore(predictions, raceResults);
    totalPoints += points;

    // Score doc uses appRaceId format to match what app expects
    const scoreRef = db.collection('scores').doc(`${appRaceId}_${userId}`);
    scoresBatch.set(scoreRef, {
      oduserId: userId,
      userId,
      raceId: appRaceId,
      totalPoints: points,
      breakdown,
    });
  }

  await scoresBatch.commit();
  const avgScore = (totalPoints / NUM_USERS).toFixed(1);
  console.log(`   📊 Scores calculated (avg: ${avgScore} pts)`);
}

async function printFinalStandings() {
  console.log(`\n${'='.repeat(50)}`);
  console.log('🏆 FINAL STANDINGS');
  console.log('='.repeat(50));

  // Aggregate scores
  const scoresSnapshot = await db.collection('scores').get();
  const userTotals = new Map<string, number>();

  scoresSnapshot.forEach((doc) => {
    const data = doc.data();
    const oduserId = data.oduserId || data.userId;
    if (oduserId && oduserId.startsWith('team_')) {
      userTotals.set(oduserId, (userTotals.get(oduserId) || 0) + (data.totalPoints || 0));
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
    .map(([oduserId, totalPoints]) => ({
      oduserId,
      teamName: userMap.get(oduserId) || 'Unknown',
      totalPoints,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  // Print all 40
  console.log(`\n${'Rank'.padEnd(6)}${'Team'.padEnd(25)}${'Points'.padStart(8)}`);
  console.log('-'.repeat(45));

  let currentRank = 1;
  standings.forEach((entry, index) => {
    if (index > 0 && entry.totalPoints < standings[index - 1].totalPoints) {
      currentRank = index + 1;
    }
    console.log(`${currentRank.toString().padEnd(6)}${entry.teamName.padEnd(25)}${entry.totalPoints.toString().padStart(8)}`);
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
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runSeed() {
  console.log('🏎️  Prix Six - 40 Teams, 24 Races');
  console.log('==================================\n');

  const startTime = Date.now();

  // Step 1: Create all users
  await createUsers();

  // Step 2: Simulate each race
  for (let i = 0; i < RACES.length; i++) {
    await simulateRace(i, RACES[i]);
  }

  // Step 3: Print final standings
  await printFinalStandings();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ SEED COMPLETE in ${elapsed} seconds!`);
}

runSeed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nScript failed:', error);
    process.exit(1);
  });
