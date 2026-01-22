/**
 * Backfill Missing Predictions Script
 *
 * This script finds all scores that don't have corresponding prediction documents
 * and creates them using the carry-forward logic (latest previous prediction).
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/backfill-predictions.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

/**
 * Normalize raceId to match the format used by predictions (base race name only).
 */
function normalizeRaceIdForPredictions(raceId: string): string {
  let baseName = raceId
    .replace(/\s*-\s*gp$/i, '')
    .replace(/\s*-\s*sprint$/i, '');
  return baseName.replace(/\s+/g, '-');
}

/**
 * Convert lowercase raceId back to title case for storage
 */
function toTitleCase(raceId: string): string {
  return raceId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('-');
}

async function backfillPredictions() {
  console.log('Starting prediction backfill...\n');

  // Step 1: Get all users and their team names
  console.log('Step 1: Loading users...');
  const usersSnapshot = await db.collection('users').get();
  const userMap = new Map<string, { teamName: string; secondaryTeamName?: string }>();

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    userMap.set(doc.id, {
      teamName: data.teamName || 'Unknown',
      secondaryTeamName: data.secondaryTeamName,
    });
  });
  console.log(`  Found ${userMap.size} users\n`);

  // Step 2: Get all predictions and organise by team and race
  console.log('Step 2: Loading all predictions...');
  const allPredictionsSnapshot = await db.collectionGroup('predictions').get();

  // Map: teamId -> raceId -> prediction data
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

    const pathParts = predDoc.ref.path.split('/');
    const userId = pathParts[1];

    // Determine teamId
    let teamId: string;
    if (predData.teamId) {
      teamId = predData.teamId;
    } else {
      const userData = userMap.get(userId);
      if (userData?.secondaryTeamName && predData.teamName === userData.secondaryTeamName) {
        teamId = `${userId}-secondary`;
      } else {
        teamId = userId;
      }
    }

    const timestamp = predData.submittedAt?.toDate?.() || predData.createdAt?.toDate?.() || new Date(0);
    const predRaceId = predData.raceId ? normalizeRaceIdForPredictions(predData.raceId) : null;

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
  console.log(`  Found ${allPredictionsSnapshot.size} total predictions across ${teamPredictionsByRace.size} teams\n`);

  // Step 3: Get all scores and find those without predictions
  console.log('Step 3: Finding scores without predictions...');
  const scoresSnapshot = await db.collection('scores').get();

  // Group scores by raceId
  const scoresByRace = new Map<string, Array<{ scoreId: string; userId: string; raceId: string }>>();

  scoresSnapshot.forEach(doc => {
    const data = doc.data();
    const raceId = data.raceId; // e.g., "canadian-grand-prix-gp"
    if (!scoresByRace.has(raceId)) {
      scoresByRace.set(raceId, []);
    }
    scoresByRace.get(raceId)!.push({
      scoreId: doc.id,
      userId: data.userId,
      raceId: data.raceId,
    });
  });
  console.log(`  Found ${scoresSnapshot.size} scores across ${scoresByRace.size} races\n`);

  // Step 4: For each race, find scores without matching predictions
  console.log('Step 4: Identifying missing predictions...\n');
  const missingPredictions: Array<{
    userId: string;
    teamId: string;
    raceId: string;
    normalizedRaceId: string;
    predictions: string[];
    teamName: string;
  }> = [];

  for (const [scoreRaceId, scores] of scoresByRace) {
    const normalizedRaceId = normalizeRaceIdForPredictions(scoreRaceId);

    for (const score of scores) {
      const teamId = score.userId;
      const teamRaces = teamPredictionsByRace.get(teamId);

      // Check if prediction exists for this specific race
      if (teamRaces && teamRaces.has(normalizedRaceId)) {
        continue; // Has race-specific prediction, skip
      }

      // No race-specific prediction - need to find carry-forward
      if (!teamRaces || teamRaces.size === 0) {
        console.log(`  WARNING: Team ${teamId} has score for ${scoreRaceId} but NO predictions at all`);
        continue;
      }

      // Find latest prediction from any race using Array.from to avoid TS forEach issues
      const allTeamPreds = Array.from(teamRaces.values());
      const sortedPreds = allTeamPreds.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const latestPred = sortedPreds[0];

      if (latestPred) {
        // Extract base userId
        const isSecondary = teamId.endsWith('-secondary');
        const baseUserId = isSecondary ? teamId.replace(/-secondary$/, '') : teamId;
        const userData = userMap.get(baseUserId);

        const teamName = latestPred.teamName ||
          (isSecondary ? userData?.secondaryTeamName : userData?.teamName) ||
          'Unknown';

        missingPredictions.push({
          userId: baseUserId,
          teamId,
          raceId: scoreRaceId,
          normalizedRaceId,
          predictions: latestPred.predictions,
          teamName,
        });
      }
    }
  }

  console.log(`Found ${missingPredictions.length} scores needing prediction documents\n`);

  if (missingPredictions.length === 0) {
    console.log('No missing predictions to backfill. All done!');
    return;
  }

  // Step 5: Create missing prediction documents
  console.log('Step 5: Creating missing prediction documents...\n');

  // Use batched writes (max 500 per batch)
  const BATCH_SIZE = 500;
  let totalCreated = 0;

  for (let i = 0; i < missingPredictions.length; i += BATCH_SIZE) {
    const batchItems = missingPredictions.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of batchItems) {
      const predDocId = `${item.teamId}_${item.normalizedRaceId}`;
      const predDocRef = db
        .collection('users')
        .doc(item.userId)
        .collection('predictions')
        .doc(predDocId);

      // Convert normalizedRaceId to title case for storage
      const titleCaseRaceId = toTitleCase(item.normalizedRaceId);

      batch.set(predDocRef, {
        userId: item.userId,
        teamId: item.teamId,
        teamName: item.teamName,
        raceId: titleCaseRaceId,
        raceName: titleCaseRaceId.replace(/-/g, ' '),
        predictions: item.predictions,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        isCarryForward: true,
        backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`  Creating: ${item.teamName} -> ${item.normalizedRaceId}`);
    }

    await batch.commit();
    totalCreated += batchItems.length;
    console.log(`  Batch committed: ${totalCreated}/${missingPredictions.length}\n`);
  }

  console.log(`\nBackfill complete! Created ${totalCreated} prediction documents.`);
}

// Run the script
backfillPredictions()
  .then(() => {
    console.log('\nScript finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed with error:', error);
    process.exit(1);
  });
