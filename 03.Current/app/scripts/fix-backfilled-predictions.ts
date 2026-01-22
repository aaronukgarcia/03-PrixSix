/**
 * Fix Backfilled Predictions Script
 *
 * This script fixes prediction documents that were incorrectly backfilled
 * by extracting the actual prediction from the score breakdown field.
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/fix-backfilled-predictions.ts
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

// Driver name to ID mapping (from F1Drivers in data.ts)
const DRIVER_NAME_TO_ID: Record<string, string> = {
  'Norris': 'norris',
  'Verstappen': 'verstappen',
  'Leclerc': 'leclerc',
  'Russell': 'russell',
  'Hamilton': 'hamilton',
  'Piastri': 'piastri',
  'Sainz': 'sainz',
  'Perez': 'perez',
  'Alonso': 'alonso',
  'Stroll': 'stroll',
  'Ocon': 'ocon',
  'Gasly': 'gasly',
  'Albon': 'albon',
  'Tsunoda': 'tsunoda',
  'Hulkenberg': 'hulkenberg',
  'Magnussen': 'magnussen',
  'Bottas': 'bottas',
  'Zhou': 'zhou',
  'Antonelli': 'antonelli',
  'Bearman': 'bearman',
  'Lawson': 'lawson',
  'Hadjar': 'hadjar',
  'Colapinto': 'colapinto',
  'Doohan': 'doohan',
  'Bortoleto': 'bortoleto',
  'Lindblad': 'lindblad',
};

/**
 * Parse the score breakdown to extract driver order (prediction)
 * Format: "Norris+6, Russell+2, Verstappen+6, Leclerc+4, Piastri+2, Perez+0"
 */
function parseBreakdown(breakdown: string): string[] | null {
  if (!breakdown) return null;

  const parts = breakdown.split(', ');
  const driverIds: string[] = [];

  for (const part of parts) {
    // Skip bonus entries
    if (part.startsWith('Bonus')) continue;

    // Extract driver name (everything before the +)
    const match = part.match(/^([A-Za-z]+)\+/);
    if (match) {
      const driverName = match[1];
      const driverId = DRIVER_NAME_TO_ID[driverName];
      if (driverId) {
        driverIds.push(driverId);
      } else {
        console.warn(`  Unknown driver name: ${driverName}`);
        return null;
      }
    }
  }

  return driverIds.length === 6 ? driverIds : null;
}

/**
 * Convert raceId format for lookup
 * Prediction raceId: "Spanish-Grand-Prix" (title case)
 * Score raceId: "spanish-grand-prix-gp" (lowercase with suffix)
 */
function predictionRaceIdToScoreRaceId(predRaceId: string): { gp: string; sprint: string } {
  const lower = predRaceId.toLowerCase();
  return {
    gp: `${lower}-gp`,
    sprint: `${lower}-sprint`,
  };
}

async function fixBackfilledPredictions() {
  console.log('Starting backfilled predictions fix...\n');

  // Step 1: Find all backfilled predictions (filter in memory to avoid index requirement)
  console.log('Step 1: Finding backfilled predictions...');
  const allPredictionsSnapshot = await db.collectionGroup('predictions').get();
  const backfilledDocs = allPredictionsSnapshot.docs.filter(doc => doc.data().isCarryForward === true);

  console.log(`  Found ${backfilledDocs.length} backfilled predictions (out of ${allPredictionsSnapshot.size} total)\n`);

  const predictionsSnapshot = { docs: backfilledDocs, size: backfilledDocs.length };

  if (predictionsSnapshot.size === 0) {
    console.log('No backfilled predictions to fix.');
    return;
  }

  // Step 2: Load all scores for lookup
  console.log('Step 2: Loading all scores...');
  const scoresSnapshot = await db.collection('scores').get();
  const scoresMap = new Map<string, { breakdown: string; totalPoints: number }>();

  scoresSnapshot.forEach(doc => {
    const data = doc.data();
    // Key: "{raceId}_{userId}" e.g., "australian-grand-prix-gp_EaIZIOyjPiM7EkWX2HXUm07fftF3"
    scoresMap.set(doc.id, {
      breakdown: data.breakdown,
      totalPoints: data.totalPoints,
    });
  });
  console.log(`  Loaded ${scoresMap.size} scores\n`);

  // Step 3: Fix each backfilled prediction
  console.log('Step 3: Fixing predictions...\n');
  const BATCH_SIZE = 500;
  let fixedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  const updates: Array<{ ref: FirebaseFirestore.DocumentReference; newPredictions: string[] }> = [];

  for (const predDoc of predictionsSnapshot.docs) {
    const predData = predDoc.data();
    const predRaceId = predData.raceId; // e.g., "Spanish-Grand-Prix"
    const teamId = predData.teamId; // e.g., "userId" or "userId-secondary"

    // Find the corresponding score
    const scoreIds = predictionRaceIdToScoreRaceId(predRaceId);
    let scoreKey = `${scoreIds.gp}_${teamId}`;
    let score = scoresMap.get(scoreKey);

    // If not found as GP, try sprint
    if (!score) {
      scoreKey = `${scoreIds.sprint}_${teamId}`;
      score = scoresMap.get(scoreKey);
    }

    if (!score) {
      console.log(`  SKIP: No score found for ${predDoc.id} (tried ${scoreIds.gp}_${teamId})`);
      skippedCount++;
      continue;
    }

    // Parse the breakdown to get the correct prediction
    const correctPredictions = parseBreakdown(score.breakdown);
    if (!correctPredictions) {
      console.log(`  ERROR: Could not parse breakdown for ${predDoc.id}: ${score.breakdown}`);
      errorCount++;
      continue;
    }

    // Check if already correct
    const currentPredictions = predData.predictions || [];
    if (JSON.stringify(currentPredictions) === JSON.stringify(correctPredictions)) {
      console.log(`  OK: ${predDoc.id} already has correct predictions`);
      skippedCount++;
      continue;
    }

    console.log(`  FIX: ${predDoc.id}`);
    console.log(`        Old: [${currentPredictions.join(', ')}]`);
    console.log(`        New: [${correctPredictions.join(', ')}]`);

    updates.push({
      ref: predDoc.ref,
      newPredictions: correctPredictions,
    });
  }

  // Step 4: Apply updates in batches
  if (updates.length > 0) {
    console.log(`\nStep 4: Applying ${updates.length} fixes...\n`);

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batchItems = updates.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const update of batchItems) {
        batch.update(update.ref, {
          predictions: update.newPredictions,
          fixedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
      fixedCount += batchItems.length;
      console.log(`  Batch committed: ${fixedCount}/${updates.length}`);
    }
  }

  console.log(`\nFix complete!`);
  console.log(`  Fixed: ${fixedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log(`  Errors: ${errorCount}`);
}

// Run the script
fixBackfilledPredictions()
  .then(() => {
    console.log('\nScript finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed with error:', error);
    process.exit(1);
  });
