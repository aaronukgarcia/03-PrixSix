/**
 * Fix Australian GP scores - delete duplicates and recalculate
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/fix-australian-gp-scores.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

const db = getFirestore();

// Prix Six scoring rules
function calculateScore(predicted: string[], actual: string[]): { total: number; breakdown: any } {
  let exactMatches = 0;
  let wrongPosition = 0;

  const normalizedActual = actual.map(d => d.toLowerCase());
  const normalizedPredicted = predicted.map(d => d.toLowerCase());

  const breakdown: any = {};

  normalizedPredicted.forEach((driver, index) => {
    const position = `P${index + 1}`;
    const actualIndex = normalizedActual.indexOf(driver);

    if (actualIndex === index) {
      // Exact position match
      exactMatches++;
      breakdown[position] = { driver, points: 5, type: 'exact' };
    } else if (actualIndex !== -1) {
      // In top 6 but wrong position
      wrongPosition++;
      breakdown[position] = { driver, points: 3, type: 'wrong_position', actualPosition: actualIndex + 1 };
    } else {
      // Not in top 6
      breakdown[position] = { driver, points: 0, type: 'not_in_top6' };
    }
  });

  const basePoints = (exactMatches * 5) + (wrongPosition * 3);
  const correctCount = exactMatches + wrongPosition;

  // Bonus for all 6 correct
  const bonus = correctCount === 6 ? 10 : 0;
  const total = basePoints + bonus;

  breakdown.summary = {
    exactMatches,
    wrongPosition,
    correctCount,
    basePoints,
    bonus,
    total
  };

  return { total, breakdown };
}

async function fixAustralianGPScores() {
  console.log('='.repeat(60));
  console.log('FIXING AUSTRALIAN GP SCORES');
  console.log('='.repeat(60));

  // Get the Australian GP result
  const resultsSnap = await db.collection('race_results').get();
  let australianResult: any = null;

  resultsSnap.forEach(doc => {
    const id = doc.id.toLowerCase();
    if (id.includes('australian')) {
      australianResult = { id: doc.id, ...doc.data() };
    }
  });

  if (!australianResult) {
    console.log('No Australian GP result found!');
    return;
  }

  console.log('\nAustralian GP Result:');
  console.log(`  Doc ID: ${australianResult.id}`);
  const actualTop6 = [
    australianResult.driver1,
    australianResult.driver2,
    australianResult.driver3,
    australianResult.driver4,
    australianResult.driver5,
    australianResult.driver6,
  ].filter(Boolean);
  console.log(`  Top 6: ${actualTop6.join(', ')}`);

  // Get all scores for Australian GP (any case variation)
  const scoresSnap = await db.collection('scores').get();
  const australianScores: any[] = [];

  scoresSnap.forEach(doc => {
    const data = doc.data();
    const raceId = (data.raceId || doc.id.split('_')[0] || '').toLowerCase();
    if (raceId.includes('australian')) {
      australianScores.push({ id: doc.id, ref: doc.ref, ...data });
    }
  });

  console.log(`\nFound ${australianScores.length} Australian GP scores to check`);

  // Get predictions for Australian GP
  const predictionsSnap = await db.collection('prediction_submissions').get();
  const predictionsByUser = new Map<string, any>();

  predictionsSnap.forEach(doc => {
    const data = doc.data();
    const raceId = (data.raceId || '').toLowerCase();
    if (raceId.includes('australian')) {
      const userId = data.oduserId || data.odUserId;
      if (userId) {
        predictionsByUser.set(userId, { id: doc.id, ...data });
      }
    }
  });

  console.log(`Found ${predictionsByUser.size} predictions for Australian GP`);

  // Also check predictions subcollection
  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const predSnap = await db.collection('users').doc(userDoc.id).collection('predictions').get();
    predSnap.forEach(predDoc => {
      const data = predDoc.data();
      const raceId = (data.raceId || predDoc.id || '').toLowerCase();
      if (raceId.includes('australian')) {
        if (!predictionsByUser.has(userDoc.id)) {
          predictionsByUser.set(userDoc.id, { id: predDoc.id, ...data });
        }
      }
    });
  }

  console.log(`Total predictions (including subcollections): ${predictionsByUser.size}`);

  // Group scores by userId to find duplicates
  const scoresByUser = new Map<string, any[]>();
  australianScores.forEach(score => {
    const userId = score.userId || score.id.split('_').slice(1).join('_');
    if (!scoresByUser.has(userId)) {
      scoresByUser.set(userId, []);
    }
    scoresByUser.get(userId)!.push(score);
  });

  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING SCORES');
  console.log('='.repeat(60));

  const batch = db.batch();
  let deleteCount = 0;
  let updateCount = 0;
  let createCount = 0;

  // Process each user's scores
  for (const [userId, scores] of scoresByUser.entries()) {
    console.log(`\nUser: ${userId}`);
    console.log(`  Has ${scores.length} score(s)`);

    // Get prediction for this user
    const prediction = predictionsByUser.get(userId);

    if (!prediction) {
      console.log(`  No prediction found - deleting all scores`);
      scores.forEach(score => {
        batch.delete(score.ref);
        deleteCount++;
      });
      continue;
    }

    // Extract predicted drivers
    let predictedDrivers: string[] = [];
    if (Array.isArray(prediction.predictions)) {
      predictedDrivers = prediction.predictions;
    } else if (prediction.predictions && typeof prediction.predictions === 'object') {
      predictedDrivers = [
        prediction.predictions.P1,
        prediction.predictions.P2,
        prediction.predictions.P3,
        prediction.predictions.P4,
        prediction.predictions.P5,
        prediction.predictions.P6,
      ].filter(Boolean);
    }

    if (predictedDrivers.length === 0) {
      console.log(`  Empty prediction - deleting all scores`);
      scores.forEach(score => {
        batch.delete(score.ref);
        deleteCount++;
      });
      continue;
    }

    console.log(`  Prediction: ${predictedDrivers.join(', ')}`);

    // Calculate correct score
    const { total, breakdown } = calculateScore(predictedDrivers, actualTop6);
    console.log(`  Calculated score: ${total} points`);
    console.log(`    (${breakdown.summary.exactMatches} exact, ${breakdown.summary.wrongPosition} wrong position, ${breakdown.summary.correctCount}/6 correct)`);

    // Delete all but keep track if we need to create/update
    const normalizedRaceId = 'australian-grand-prix';
    const correctDocId = `${normalizedRaceId}_${userId}`;

    let foundCorrectDoc = false;

    for (const score of scores) {
      if (score.id === correctDocId) {
        // This is the correctly named doc - update it
        foundCorrectDoc = true;
        if (score.totalPoints !== total) {
          console.log(`  Updating ${score.id}: ${score.totalPoints} -> ${total}`);
          batch.update(score.ref, {
            totalPoints: total,
            breakdown,
            raceId: normalizedRaceId,
            updatedAt: FieldValue.serverTimestamp(),
          });
          updateCount++;
        } else {
          console.log(`  ${score.id} already correct`);
        }
      } else {
        // Delete duplicate/incorrectly named doc
        console.log(`  Deleting duplicate: ${score.id}`);
        batch.delete(score.ref);
        deleteCount++;
      }
    }

    // If no correctly named doc exists, create one
    if (!foundCorrectDoc) {
      console.log(`  Creating new score: ${correctDocId}`);
      const newScoreRef = db.collection('scores').doc(correctDocId);
      batch.set(newScoreRef, {
        userId,
        raceId: normalizedRaceId,
        totalPoints: total,
        breakdown,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      createCount++;
    }
  }

  // Check for users with predictions but no scores
  for (const [userId, prediction] of predictionsByUser.entries()) {
    if (!scoresByUser.has(userId)) {
      let predictedDrivers: string[] = [];
      if (Array.isArray(prediction.predictions)) {
        predictedDrivers = prediction.predictions;
      } else if (prediction.predictions && typeof prediction.predictions === 'object') {
        predictedDrivers = [
          prediction.predictions.P1,
          prediction.predictions.P2,
          prediction.predictions.P3,
          prediction.predictions.P4,
          prediction.predictions.P5,
          prediction.predictions.P6,
        ].filter(Boolean);
      }

      if (predictedDrivers.length > 0) {
        const { total, breakdown } = calculateScore(predictedDrivers, actualTop6);
        const normalizedRaceId = 'australian-grand-prix';
        const correctDocId = `${normalizedRaceId}_${userId}`;

        console.log(`\nCreating missing score for ${userId}: ${total} points`);
        const newScoreRef = db.collection('scores').doc(correctDocId);
        batch.set(newScoreRef, {
          userId,
          raceId: normalizedRaceId,
          totalPoints: total,
          breakdown,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        createCount++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('COMMITTING CHANGES');
  console.log('='.repeat(60));
  console.log(`  Deleting: ${deleteCount} scores`);
  console.log(`  Updating: ${updateCount} scores`);
  console.log(`  Creating: ${createCount} scores`);

  await batch.commit();

  console.log('\nDone!');
}

fixAustralianGPScores()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
