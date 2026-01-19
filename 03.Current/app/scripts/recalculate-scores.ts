/**
 * Recalculate all scores using Prix Six scoring rules
 *
 * Prix Six Scoring:
 * - +5 points for each driver in their exact predicted position
 * - +3 points for each driver in top 6 but wrong position
 * - +10 bonus if all 6 predictions are in the top 6
 * - Max possible: 30 (all exact) + 10 (bonus) = 40 points
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/recalculate-scores.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

const db = getFirestore();

// Prix Six scoring constants
const SCORING = {
  exactPosition: 5,    // +5 for exact position match
  wrongPosition: 3,    // +3 for correct driver but wrong position
  bonusAll6: 10,       // +10 bonus if all 6 correct
};

interface RaceResult {
  id: string;
  raceId: string;
  driver1: string;
  driver2: string;
  driver3: string;
  driver4: string;
  driver5: string;
  driver6: string;
}

interface PredictionSubmission {
  id: string;
  oduserId: string;
  teamName: string;
  raceId: string;
  predictions: {
    P1: string;
    P2: string;
    P3: string;
    P4: string;
    P5: string;
    P6: string;
  };
}

function calculateScore(predictions: string[], actualTop6: string[]): { totalPoints: number; breakdown: string } {
  let totalPoints = 0;
  let correctCount = 0;
  const breakdownParts: string[] = [];

  // Normalize actual results to lowercase
  const normalizedActual = actualTop6.map(d => d?.toLowerCase());

  predictions.forEach((driverId, index) => {
    const normalizedDriver = driverId?.toLowerCase();
    const actualIndex = normalizedActual.indexOf(normalizedDriver);

    // Get driver display name (capitalize first letter)
    const displayName = driverId.charAt(0).toUpperCase() + driverId.slice(1).toLowerCase();

    if (actualIndex === index) {
      // Exact position match
      totalPoints += SCORING.exactPosition;
      correctCount++;
      breakdownParts.push(`${displayName}+${SCORING.exactPosition}`);
    } else if (actualIndex !== -1) {
      // In top 6 but wrong position
      totalPoints += SCORING.wrongPosition;
      correctCount++;
      breakdownParts.push(`${displayName}+${SCORING.wrongPosition}`);
    } else {
      // Not in top 6
      breakdownParts.push(`${displayName}+0`);
    }
  });

  // Bonus for all 6 correct
  if (correctCount === 6) {
    totalPoints += SCORING.bonusAll6;
    breakdownParts.push(`BonusAll6+${SCORING.bonusAll6}`);
  }

  return {
    totalPoints,
    breakdown: breakdownParts.join(' | '),
  };
}

async function recalculateAllScores() {
  console.log('Starting score recalculation with Prix Six rules...\n');
  console.log('Scoring rules:');
  console.log(`  +${SCORING.exactPosition} for exact position match`);
  console.log(`  +${SCORING.wrongPosition} for correct driver, wrong position`);
  console.log(`  +${SCORING.bonusAll6} bonus if all 6 correct`);
  console.log('');

  // Fetch all race results
  const resultsSnapshot = await db.collection('race_results').get();
  const raceResults: RaceResult[] = [];

  resultsSnapshot.forEach(doc => {
    raceResults.push({ id: doc.id, ...doc.data() } as RaceResult);
  });

  console.log(`Found ${raceResults.length} race results to process\n`);

  let totalScoresUpdated = 0;
  let totalScoresCreated = 0;

  for (const result of raceResults) {
    console.log(`\n=== Processing: ${result.raceId} (${result.id}) ===`);

    const actualTop6 = [
      result.driver1,
      result.driver2,
      result.driver3,
      result.driver4,
      result.driver5,
      result.driver6,
    ];

    console.log(`Official result: ${actualTop6.join(', ')}`);

    // Get the base race ID for prediction lookups (remove -GP or -Sprint suffix)
    const baseRaceId = result.id
      .replace(/-gp$/i, '')
      .replace(/-sprint$/i, '')
      .replace(/\s+/g, '-');

    // Also try the raceId field which might have different format
    const possibleRaceIds = [
      result.id,
      baseRaceId,
      result.raceId?.replace(/\s+/g, '-'),
    ].filter(Boolean);

    // Fetch all prediction submissions for this race
    let submissions: PredictionSubmission[] = [];

    for (const raceId of possibleRaceIds) {
      const submissionsSnapshot = await db.collection('prediction_submissions')
        .where('raceId', '==', raceId)
        .get();

      if (!submissionsSnapshot.empty) {
        submissionsSnapshot.forEach(doc => {
          const exists = submissions.some(s => s.id === doc.id);
          if (!exists) {
            submissions.push({ id: doc.id, ...doc.data() } as PredictionSubmission);
          }
        });
      }
    }

    console.log(`Found ${submissions.length} submissions`);

    // Process each submission
    const batch = db.batch();
    let batchCount = 0;

    for (const submission of submissions) {
      const predictions = [
        submission.predictions?.P1,
        submission.predictions?.P2,
        submission.predictions?.P3,
        submission.predictions?.P4,
        submission.predictions?.P5,
        submission.predictions?.P6,
      ].filter(Boolean);

      if (predictions.length !== 6) {
        console.log(`  Skipping ${submission.teamName}: incomplete predictions (${predictions.length}/6)`);
        continue;
      }

      const { totalPoints, breakdown } = calculateScore(predictions, actualTop6);

      // Check if score document exists
      const scoreQuery = await db.collection('scores')
        .where('oduserId', '==', submission.oduserId)
        .where('raceId', '==', result.id)
        .get();

      if (!scoreQuery.empty) {
        // Update existing score
        const scoreDoc = scoreQuery.docs[0];
        const oldScore = scoreDoc.data().totalPoints;

        if (oldScore !== totalPoints) {
          batch.update(scoreDoc.ref, {
            totalPoints,
            breakdown,
            updatedAt: new Date(),
          });
          console.log(`  Updated ${submission.teamName}: ${oldScore} → ${totalPoints}`);
          totalScoresUpdated++;
          batchCount++;
        }
      } else {
        // Create new score document
        const newScoreRef = db.collection('scores').doc();
        batch.set(newScoreRef, {
          oduserId: submission.oduserId,
          oduserId: submission.oduserId,
          teamName: submission.teamName,
          raceId: result.id,
          totalPoints,
          breakdown,
          createdAt: new Date(),
        });
        console.log(`  Created ${submission.teamName}: ${totalPoints}`);
        totalScoresCreated++;
        batchCount++;
      }

      // Commit batch every 400 operations (Firestore limit is 500)
      if (batchCount >= 400) {
        await batch.commit();
        console.log(`  Committed batch of ${batchCount} operations`);
        batchCount = 0;
      }
    }

    // Commit remaining operations
    if (batchCount > 0) {
      await batch.commit();
      console.log(`  Committed batch of ${batchCount} operations`);
    }
  }

  console.log('\n========================================');
  console.log('Score recalculation complete!');
  console.log(`  Scores updated: ${totalScoresUpdated}`);
  console.log(`  Scores created: ${totalScoresCreated}`);
  console.log('========================================\n');
}

// Run the script
recalculateAllScores()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
