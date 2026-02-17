// GUID: SCRIPTS_RECALC_SCORES-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Recalculate all scores using current carry-forward logic.
//          Deletes existing scores and recalculates from race results.
//          For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer after scoring logic changes.
// [Downstream Impact] All scores regenerated - may change user standings. Now blocked on production.
//
// This script re-runs the scoring logic for all existing race results.
// It will:
// 1. Use the existing race results (no changes to results)
// 2. Recalculate scores using the current carry-forward logic
// 3. Create missing prediction documents for carry-forward teams
//
// Run with: npx ts-node --project tsconfig.scripts.json scripts/recalculate-all-scores.ts

import * as admin from 'firebase-admin';
import * as path from 'path';
import { runSafetyChecks } from './_safety-checks';

// Import shared normalization functions (Golden Rule #3: Single Source of Truth)
import { normalizeRaceId, normalizeRaceIdForComparison } from '../src/lib/normalize-race-id';

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Scoring constants (from scoring-rules.ts)
const SCORING_POINTS = {
  exactPosition: 6,
  onePositionOff: 4,
  twoPositionsOff: 3,
  threeOrMoreOff: 2,
  bonusAll6: 10,
};

// Driver data for name lookups
const F1_DRIVERS: Record<string, string> = {
  'norris': 'Norris',
  'verstappen': 'Verstappen',
  'leclerc': 'Leclerc',
  'russell': 'Russell',
  'hamilton': 'Hamilton',
  'piastri': 'Piastri',
  'sainz': 'Sainz',
  'perez': 'Perez',
  'alonso': 'Alonso',
  'stroll': 'Stroll',
  'ocon': 'Ocon',
  'gasly': 'Gasly',
  'albon': 'Albon',
  'tsunoda': 'Tsunoda',
  'hulkenberg': 'Hulkenberg',
  'magnussen': 'Magnussen',
  'bottas': 'Bottas',
  'zhou': 'Zhou',
  'antonelli': 'Antonelli',
  'bearman': 'Bearman',
  'lawson': 'Lawson',
  'hadjar': 'Hadjar',
  'colapinto': 'Colapinto',
  'doohan': 'Doohan',
  'bortoleto': 'Bortoleto',
  'lindblad': 'Lindblad',
};

function calculateDriverPoints(predictedPosition: number, actualPosition: number): number {
  if (actualPosition === -1) return 0; // Driver not in top 6
  const positionDiff = Math.abs(predictedPosition - actualPosition);
  if (positionDiff === 0) return SCORING_POINTS.exactPosition;
  if (positionDiff === 1) return SCORING_POINTS.onePositionOff;
  if (positionDiff === 2) return SCORING_POINTS.twoPositionsOff;
  return SCORING_POINTS.threeOrMoreOff;
}

// Removed duplicate normalizeRaceId function - now using shared normalizeRaceId from lib
// (Golden Rule #3: Single Source of Truth - no duplication)

// Helper to convert race ID to Title-Case for prediction document storage (matches existing prediction format)
function toTitleCase(raceId: string): string {
  return raceId.split('-').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join('-');
}

async function recalculateAllScores() {
  // GUID: SCRIPTS_RECALC_SCORES-001-v02
  // [Intent] Safety checks - prevent production execution and require user confirmation.
  // [Inbound Trigger] First action before any database operations.
  // [Downstream Impact] Exits with error if production detected or user cancels.
  await runSafetyChecks('RECALCULATE ALL SCORES: Delete and regenerate all scores using current logic');

  console.log('Starting score recalculation for all races...\n');

  // Step 1: Get all race results
  console.log('Step 1: Loading race results...');
  const raceResultsSnapshot = await db.collection('race_results').get();
  console.log(`  Found ${raceResultsSnapshot.size} race results\n`);

  if (raceResultsSnapshot.size === 0) {
    console.log('No race results found. Nothing to recalculate.');
    return;
  }

  // Step 2: Get all users
  console.log('Step 2: Loading users...');
  const usersSnapshot = await db.collection('users').get();
  const userMap = new Map<string, string>();
  const userSecondaryTeamNames = new Map<string, string>();

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    userMap.set(doc.id, data.teamName || 'Unknown');
    if (data.secondaryTeamName) {
      userMap.set(`${doc.id}-secondary`, data.secondaryTeamName);
      userSecondaryTeamNames.set(doc.id, data.secondaryTeamName);
    }
  });
  console.log(`  Found ${userMap.size} teams (including secondary)\n`);

  // Step 3: Get all predictions
  console.log('Step 3: Loading all predictions...');
  const allPredictionsSnapshot = await db.collectionGroup('predictions').get();

  // Build map: teamId -> raceId -> prediction
  const teamPredictionsByRace = new Map<string, Map<string, {
    predictions: string[];
    timestamp: Date;
    teamName?: string;
  }>>();

  allPredictionsSnapshot.forEach(predDoc => {
    const predData = predDoc.data();
    if (!Array.isArray(predData.predictions) || predData.predictions.length !== 6) {
      return;
    }

    // CRITICAL: Skip carry-forward predictions - only use real user predictions as sources for carry-forwards
    // Otherwise we create circular carry-forwards that perpetuate wrong data
    if (predData.isCarryForward === true) {
      return;
    }

    const pathParts = predDoc.ref.path.split('/');
    const userId = pathParts[1];

    let teamId: string;
    if (predData.teamId) {
      teamId = predData.teamId;
    } else {
      const userSecondaryTeam = userSecondaryTeamNames.get(userId);
      if (userSecondaryTeam && predData.teamName === userSecondaryTeam) {
        teamId = `${userId}-secondary`;
      } else {
        teamId = userId;
      }
    }

    const timestamp = predData.submittedAt?.toDate?.() || predData.createdAt?.toDate?.() || new Date(0);
    // Use case-insensitive normalization for map keys to match race results (lowercase) with predictions (Title-Case)
    const predRaceId = predData.raceId ? normalizeRaceIdForComparison(predData.raceId) : null;

    if (!teamPredictionsByRace.has(teamId)) {
      teamPredictionsByRace.set(teamId, new Map());
    }
    const teamRaces = teamPredictionsByRace.get(teamId)!;
    const raceKey = predRaceId || 'unknown';
    const existing = teamRaces.get(raceKey);

    if (!existing || timestamp > existing.timestamp) {
      teamRaces.set(raceKey, {
        predictions: predData.predictions,
        timestamp,
        teamName: predData.teamName,
      });
    }
  });
  console.log(`  Loaded ${allPredictionsSnapshot.size} predictions across ${teamPredictionsByRace.size} teams\n`);

  // Step 4: Process each race result
  console.log('Step 4: Recalculating scores for each race...\n');

  let totalScoresUpdated = 0;
  let totalPredictionsCreated = 0;

  for (const raceResultDoc of raceResultsSnapshot.docs) {
    const resultData = raceResultDoc.data();
    const resultDocId = raceResultDoc.id; // e.g., "spanish-grand-prix-gp"
    const raceName = resultData.raceId || resultDocId; // Display name

    console.log(`Processing: ${raceName} (${resultDocId})`);

    const actualResults = [
      resultData.driver1,
      resultData.driver2,
      resultData.driver3,
      resultData.driver4,
      resultData.driver5,
      resultData.driver6,
    ];

    // Use case-insensitive normalization to match predictions (case-insensitive lookup)
    const normalizedRaceId = normalizeRaceIdForComparison(resultDocId);

    // Resolve predictions for this race
    const latestPredictions = new Map<string, {
      predictions: string[];
      timestamp: Date;
      teamName?: string;
      isCarryForward: boolean;
    }>();

    teamPredictionsByRace.forEach((raceMap, teamId) => {
      if (raceMap.has(normalizedRaceId)) {
        const racePrediction = raceMap.get(normalizedRaceId)!;
        latestPredictions.set(teamId, { ...racePrediction, isCarryForward: false });
        return;
      }

      // Fall back to latest prediction
      const allPreds = Array.from(raceMap.values());
      const sorted = allPreds.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      if (sorted.length > 0) {
        latestPredictions.set(teamId, { ...sorted[0], isCarryForward: true });
      }
    });

    const carryForwardCount = Array.from(latestPredictions.values()).filter(p => p.isCarryForward).length;
    console.log(`  Teams: ${latestPredictions.size} (${carryForwardCount} carry-forwards)`);

    // Calculate scores and write
    const batch = db.batch();
    let scoresInBatch = 0;
    let predictionsInBatch = 0;

    latestPredictions.forEach((predData, teamId) => {
      const userPredictions = predData.predictions;

      let totalPoints = 0;
      let correctCount = 0;

      userPredictions.forEach((driverId, predictedPosition) => {
        const actualPosition = actualResults.indexOf(driverId);
        const points = calculateDriverPoints(predictedPosition, actualPosition);
        totalPoints += points;

        if (actualPosition !== -1) {
          correctCount++;
        }
      });

      if (correctCount === 6) {
        totalPoints += SCORING_POINTS.bonusAll6;
      }

      // Write score
      // Golden Rule #3: Store only totalPoints (aggregate), not breakdown (denormalized data)
      // Breakdown is calculated in real-time from race_results source of truth
      const scoreDocRef = db.collection('scores').doc(`${resultDocId}_${teamId}`);
      batch.set(scoreDocRef, {
        userId: teamId,
        raceId: raceName,  // Use Title-Case raceName to match race_results and RaceSchedule
        raceName: raceName,
        totalPoints,
        calculatedAt: FieldValue.serverTimestamp(),
      });
      scoresInBatch++;

      // Create prediction document for carry-forwards
      if (predData.isCarryForward) {
        const isSecondary = teamId.endsWith('-secondary');
        const baseUserId = isSecondary ? teamId.replace(/-secondary$/, '') : teamId;
        // Use Title-Case for prediction document IDs and raceId field (matches existing prediction format)
        const titleCaseRaceId = toTitleCase(normalizedRaceId);
        const predDocId = `${teamId}_${titleCaseRaceId}`;
        const predDocRef = db.collection('users').doc(baseUserId).collection('predictions').doc(predDocId);

        batch.set(predDocRef, {
          userId: baseUserId,
          teamId: teamId,
          teamName: predData.teamName || userMap.get(teamId) || 'Unknown',
          raceId: titleCaseRaceId,
          raceName: raceName.replace(/\s*-\s*(GP|Sprint)$/i, ''),
          predictions: predData.predictions,
          submittedAt: FieldValue.serverTimestamp(),
          isCarryForward: true,
        }, { merge: true }); // merge to avoid overwriting existing predictions
        predictionsInBatch++;
      }
    });

    await batch.commit();
    console.log(`  Scores: ${scoresInBatch}, Predictions created: ${predictionsInBatch}\n`);
    totalScoresUpdated += scoresInBatch;
    totalPredictionsCreated += predictionsInBatch;
  }

  console.log('='.repeat(50));
  console.log('Recalculation complete!');
  console.log(`  Total scores updated: ${totalScoresUpdated}`);
  console.log(`  Total predictions created: ${totalPredictionsCreated}`);
}

// Run the script
recalculateAllScores()
  .then(() => {
    console.log('\nScript finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed with error:', error);
    process.exit(1);
  });
