/**
 * BIG SHAKEDOWN Seed Script
 *
 * Populates the database with 20 teams and simulates a full 24-race season.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/seed-big-shakedown.ts
 *
 * Or with environment variables:
 *   FIREBASE_PROJECT_ID=xxx FIREBASE_CLIENT_EMAIL=xxx FIREBASE_PRIVATE_KEY=xxx npx ts-node ...
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = getFirestore();
const auth = getAuth();

// ============================================================================
// CONFIGURATION
// ============================================================================

// Driver pool (Top 10 for results)
const DRIVER_POOL = [
  'verstappen', 'norris', 'leclerc', 'piastri', 'hamilton', 'russell',
  'sainz', 'alonso', 'perez', 'ocon', 'gasly', 'albon', 'stroll',
  'hulkenberg', 'bottas', 'lawson', 'hadjar', 'antonelli', 'bearman', 'bortoleto'
];

// The official Top 6 for each race (The Dominators always match this)
const OFFICIAL_TOP_6 = ['verstappen', 'norris', 'leclerc', 'piastri', 'hamilton', 'russell'];

// Bad predictions (for low scores)
const BAD_PREDICTIONS = ['bottas', 'stroll', 'lawson', 'hulkenberg', 'bortoleto', 'bearman'];

// Random but consistent predictions for "The Clones"
const CLONE_PREDICTIONS_GOOD = ['verstappen', 'norris', 'leclerc', 'hamilton', 'alonso', 'sainz']; // 5/6 correct
const CLONE_PREDICTIONS_BAD = ['gasly', 'albon', 'stroll', 'bottas', 'lawson', 'ocon']; // 1/6 correct

// Race Schedule (24 races)
const RACE_NAMES = [
  'Bahrain Grand Prix',
  'Saudi Arabian Grand Prix',
  'Australian Grand Prix',
  'Japanese Grand Prix',
  'Chinese Grand Prix',
  'Miami Grand Prix',
  'Imola Grand Prix',
  'Monaco Grand Prix',
  'Canadian Grand Prix',
  'Spanish Grand Prix',
  'Austrian Grand Prix',
  'British Grand Prix',
  'Hungarian Grand Prix',
  'Belgian Grand Prix',
  'Dutch Grand Prix',
  'Italian Grand Prix',
  'Azerbaijan Grand Prix',
  'Singapore Grand Prix',
  'United States Grand Prix',
  'Mexican Grand Prix',
  'Brazilian Grand Prix',
  'Las Vegas Grand Prix',
  'Qatar Grand Prix',
  'Abu Dhabi Grand Prix',
];

// User groups with their behavior
interface UserConfig {
  id: string;
  teamName: string;
  email: string;
  group: 'dominators' | 'midfield' | 'quitters' | 'late_joiners' | 'clones';
}

const USERS: UserConfig[] = [
  // The Dominators (user_01 - user_03): Always perfect
  { id: 'user_01', teamName: 'Scuderia Perfecta', email: 'user01@test.com', group: 'dominators' },
  { id: 'user_02', teamName: 'Always Right Racing', email: 'user02@test.com', group: 'dominators' },
  { id: 'user_03', teamName: 'Oracle Team', email: 'user03@test.com', group: 'dominators' },

  // The Midfield (user_04 - user_10): Odd=Perfect, Even=Terrible
  { id: 'user_04', teamName: 'Inconsistent FC', email: 'user04@test.com', group: 'midfield' },
  { id: 'user_05', teamName: 'Hot & Cold Racing', email: 'user05@test.com', group: 'midfield' },
  { id: 'user_06', teamName: 'Rollercoaster GP', email: 'user06@test.com', group: 'midfield' },
  { id: 'user_07', teamName: 'Zigzag Motorsport', email: 'user07@test.com', group: 'midfield' },
  { id: 'user_08', teamName: 'Flip Flop F1', email: 'user08@test.com', group: 'midfield' },
  { id: 'user_09', teamName: 'Mood Swings Racing', email: 'user09@test.com', group: 'midfield' },
  { id: 'user_10', teamName: 'Coin Toss Crew', email: 'user10@test.com', group: 'midfield' },

  // The Quitters (user_11 - user_15): Perfect for races 1-5, then stop
  { id: 'user_11', teamName: 'Early Exit Racing', email: 'user11@test.com', group: 'quitters' },
  { id: 'user_12', teamName: 'Short Season FC', email: 'user12@test.com', group: 'quitters' },
  { id: 'user_13', teamName: 'Burnout Brigade', email: 'user13@test.com', group: 'quitters' },
  { id: 'user_14', teamName: 'Gave Up GP', email: 'user14@test.com', group: 'quitters' },
  { id: 'user_15', teamName: 'Lost Interest Ltd', email: 'user15@test.com', group: 'quitters' },

  // The Late Joiners (user_16 - user_18): Join at Race 10, then perfect
  { id: 'user_16', teamName: 'Late Bloomer Racing', email: 'user16@test.com', group: 'late_joiners' },
  { id: 'user_17', teamName: 'Better Late FC', email: 'user17@test.com', group: 'late_joiners' },
  { id: 'user_18', teamName: 'Fashionably Late GP', email: 'user18@test.com', group: 'late_joiners' },

  // The Clones (user_19 - user_20): Identical random predictions
  { id: 'user_19', teamName: 'Clone Alpha', email: 'user19@test.com', group: 'clones' },
  { id: 'user_20', teamName: 'Clone Beta', email: 'user20@test.com', group: 'clones' },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateRaceId(raceName: string): string {
  return raceName.replace(/\s+/g, '-');
}

function generateRaceDate(raceIndex: number): { qualifyingTime: string; raceTime: string } {
  // Start from March 1, 2025, one race per week
  const baseDate = new Date('2025-03-01T14:00:00Z');
  baseDate.setDate(baseDate.getDate() + (raceIndex * 7));

  const qualifyingDate = new Date(baseDate);
  qualifyingDate.setDate(qualifyingDate.getDate() - 1);

  return {
    qualifyingTime: qualifyingDate.toISOString(),
    raceTime: baseDate.toISOString(),
  };
}

function getPredictionsForUser(user: UserConfig, raceNumber: number): string[] | null {
  switch (user.group) {
    case 'dominators':
      // Always predict the exact Top 6
      return [...OFFICIAL_TOP_6];

    case 'midfield':
      // Odd races: Perfect (11 pts), Even races: Terrible (1 pt)
      if (raceNumber % 2 === 1) {
        return [...OFFICIAL_TOP_6]; // Perfect
      } else {
        return [...BAD_PREDICTIONS]; // Only 1 driver might be in Top 6
      }

    case 'quitters':
      // Perfect for races 1-5, then nothing
      if (raceNumber <= 5) {
        return [...OFFICIAL_TOP_6];
      }
      return null; // No prediction

    case 'late_joiners':
      // Don't predict until race 10, then perfect
      if (raceNumber < 10) {
        return null; // Not registered yet
      }
      return [...OFFICIAL_TOP_6];

    case 'clones':
      // Alternate between good and bad predictions (both clones identical)
      if (raceNumber % 3 === 0) {
        return [...CLONE_PREDICTIONS_BAD]; // ~1 point
      } else if (raceNumber % 3 === 1) {
        return [...CLONE_PREDICTIONS_GOOD]; // ~8 points (5/6 + bonus)
      } else {
        // Mix: 4 correct
        return ['verstappen', 'norris', 'leclerc', 'piastri', 'albon', 'stroll'];
      }

    default:
      return [...OFFICIAL_TOP_6];
  }
}

// Wacky Racers scoring
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

  let totalPoints = correctCount; // +1 per correct driver

  // Bonus
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

async function clearExistingData() {
  console.log('🧹 Clearing existing test data...');

  // Delete test users
  const usersSnapshot = await db.collection('users').get();
  for (const doc of usersSnapshot.docs) {
    if (doc.id.startsWith('user_')) {
      // Delete subcollections
      const predictionsSnapshot = await db.collection('users').doc(doc.id).collection('predictions').get();
      for (const predDoc of predictionsSnapshot.docs) {
        await predDoc.ref.delete();
      }
      await doc.ref.delete();
    }
  }

  // Delete test scores
  const scoresSnapshot = await db.collection('scores').get();
  for (const doc of scoresSnapshot.docs) {
    if (doc.id.includes('user_')) {
      await doc.ref.delete();
    }
  }

  // Delete test race results
  const resultsSnapshot = await db.collection('race_results').get();
  for (const doc of resultsSnapshot.docs) {
    await doc.ref.delete();
  }

  // Delete presence docs
  const presenceSnapshot = await db.collection('presence').get();
  for (const doc of presenceSnapshot.docs) {
    if (doc.id.startsWith('user_')) {
      await doc.ref.delete();
    }
  }

  // Delete prediction_submissions
  const submissionsSnapshot = await db.collection('prediction_submissions').get();
  for (const doc of submissionsSnapshot.docs) {
    await doc.ref.delete();
  }

  console.log('✅ Existing data cleared');
}

async function createUsers(usersToCreate: UserConfig[]) {
  console.log(`👥 Creating ${usersToCreate.length} users...`);

  for (const userConfig of usersToCreate) {
    // Create user document
    await db.collection('users').doc(userConfig.id).set({
      id: userConfig.id,
      email: userConfig.email,
      teamName: userConfig.teamName,
      isAdmin: false,
      mustChangePin: false,
      badLoginAttempts: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Create presence document
    await db.collection('presence').doc(userConfig.id).set({
      online: false,
      sessions: [],
    });
  }

  console.log('✅ Users created');
}

async function submitPrediction(
  userId: string,
  teamName: string,
  raceId: string,
  raceName: string,
  predictions: string[]
) {
  const predictionId = `${userId}_${raceId}`;

  await db.collection('users').doc(userId).collection('predictions').doc(predictionId).set({
    id: predictionId,
    userId,
    teamId: userId,
    teamName,
    raceId,
    raceName,
    predictions,
    submissionTimestamp: FieldValue.serverTimestamp(),
  });
}

async function submitRaceResult(raceId: string, raceName: string, top6: string[]) {
  await db.collection('race_results').doc(raceId).set({
    id: raceId,
    raceId: raceName,
    driver1: top6[0],
    driver2: top6[1],
    driver3: top6[2],
    driver4: top6[3],
    driver5: top6[4],
    driver6: top6[5],
    submittedAt: FieldValue.serverTimestamp(),
  });
}

async function calculateAndSaveScores(raceId: string, raceName: string, actualTop6: string[]) {
  // Get all predictions for this race
  const usersSnapshot = await db.collection('users').get();

  for (const userDoc of usersSnapshot.docs) {
    if (!userDoc.id.startsWith('user_')) continue;

    const predictionId = `${userDoc.id}_${raceId}`;
    const predictionDoc = await db.collection('users').doc(userDoc.id).collection('predictions').doc(predictionId).get();

    if (!predictionDoc.exists) continue;

    const predictionData = predictionDoc.data();
    const predictions = predictionData?.predictions || [];

    if (predictions.length === 0) continue;

    const { points, breakdown } = calculateScore(predictions, actualTop6);

    // Save score
    await db.collection('scores').doc(`${raceId}_${userDoc.id}`).set({
      userId: userDoc.id,
      raceId,
      totalPoints: points,
      breakdown,
    });
  }
}

async function getStandings(): Promise<{ rank: number; teamName: string; totalPoints: number }[]> {
  // Aggregate scores per user
  const scoresSnapshot = await db.collection('scores').get();
  const userTotals = new Map<string, number>();

  scoresSnapshot.forEach((doc) => {
    const data = doc.data();
    const userId = data.userId;
    const points = data.totalPoints || 0;
    userTotals.set(userId, (userTotals.get(userId) || 0) + points);
  });

  // Get team names
  const usersSnapshot = await db.collection('users').get();
  const userMap = new Map<string, string>();
  usersSnapshot.forEach((doc) => {
    userMap.set(doc.id, doc.data().teamName || 'Unknown');
  });

  // Build and sort standings
  const sortedStandings = Array.from(userTotals.entries())
    .map(([userId, totalPoints]) => ({
      teamName: userMap.get(userId) || 'Unknown',
      totalPoints,
      rank: 0,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  // Assign ranks with ties
  let currentRank = 1;
  return sortedStandings.map((entry, index) => {
    if (index > 0 && entry.totalPoints < sortedStandings[index - 1].totalPoints) {
      currentRank = index + 1;
    }
    return { ...entry, rank: currentRank };
  });
}

function printStandings(standings: { rank: number; teamName: string; totalPoints: number }[], afterRace: number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 STANDINGS AFTER RACE ${afterRace}`);
  console.log('='.repeat(60));
  console.log(`${'Rank'.padEnd(6)}${'Team'.padEnd(30)}${'Points'.padStart(10)}`);
  console.log('-'.repeat(60));

  standings.forEach((entry) => {
    console.log(`${entry.rank.toString().padEnd(6)}${entry.teamName.padEnd(30)}${entry.totalPoints.toString().padStart(10)}`);
  });

  console.log('='.repeat(60));
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runBigShakedown() {
  console.log('🏎️  BIG SHAKEDOWN - 20 Teams, 24 Races');
  console.log('=====================================\n');

  // Step 1: Clear existing data
  await clearExistingData();

  // Step 2: Create all users (except late joiners who register at race 10)
  const initialUsers = USERS.filter(u => u.group !== 'late_joiners');
  await createUsers(initialUsers);

  // Step 3: Run through each race
  for (let raceNum = 1; raceNum <= RACE_NAMES.length; raceNum++) {
    const raceName = RACE_NAMES[raceNum - 1];
    const raceId = generateRaceId(raceName);

    console.log(`\n🏁 Race ${raceNum}: ${raceName}`);

    // Late joiners register at race 10
    if (raceNum === 10) {
      const lateJoiners = USERS.filter(u => u.group === 'late_joiners');
      console.log(`  📝 Late joiners registering: ${lateJoiners.map(u => u.teamName).join(', ')}`);
      await createUsers(lateJoiners);
    }

    // Generate predictions for each user
    let predictionCount = 0;
    for (const user of USERS) {
      const predictions = getPredictionsForUser(user, raceNum);

      if (predictions) {
        await submitPrediction(user.id, user.teamName, raceId, raceName, predictions);
        predictionCount++;
      }
    }
    console.log(`  📋 Predictions submitted: ${predictionCount}`);

    // Submit official results
    await submitRaceResult(raceId, raceName, OFFICIAL_TOP_6);
    console.log(`  🏆 Results: ${OFFICIAL_TOP_6.slice(0, 3).join(', ')}...`);

    // Calculate scores
    await calculateAndSaveScores(raceId, raceName, OFFICIAL_TOP_6);
    console.log(`  ✅ Scores calculated`);

    // Print standings at checkpoint races
    if (raceNum === 5 || raceNum === 12 || raceNum === 24) {
      const standings = await getStandings();
      printStandings(standings, raceNum);
    }
  }

  console.log('\n🏁 BIG SHAKEDOWN COMPLETE!\n');

  // Final summary
  console.log('📈 Expected Results Summary:');
  console.log('----------------------------');
  console.log('• Dominators (3 teams): 24 races × 11 pts = 264 pts each');
  console.log('• Midfield (7 teams): 12 odd × 11 + 12 even × 1 = 144 pts each');
  console.log('• Quitters (5 teams): 5 races × 11 pts = 55 pts each');
  console.log('• Late Joiners (3 teams): 15 races × 11 pts = 165 pts each');
  console.log('• Clones (2 teams): Mixed scores, should be tied');
}

// Run the script
runBigShakedown()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
