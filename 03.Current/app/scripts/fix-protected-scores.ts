/**
 * Check and fix protected user scores
 * Also fix driver casing in user predictions subcollection
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}

const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const PROTECTED_EMAILS = [
  'aaron@garcia.ltd',
  'aaron.garcia@hotmail.co.uk',
];

function calculateScore(predictions: string[], actualTop6: string[]): { points: number; breakdown: string } {
  let correctCount = 0;
  const breakdownParts: string[] = [];

  // Normalize to lowercase for comparison
  const normalizedActual = actualTop6.map(d => d.toLowerCase());

  predictions.forEach((driverId) => {
    const normalizedDriver = driverId.toLowerCase();
    if (normalizedActual.includes(normalizedDriver)) {
      correctCount++;
      breakdownParts.push(`${normalizedDriver} (+1)`);
    } else {
      breakdownParts.push(`${normalizedDriver} (miss)`);
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

async function fixProtectedScores() {
  console.log('=== FIX PROTECTED USER SCORES ===\n');

  // 1. Get protected user IDs
  const usersSnapshot = await db.collection('users').get();
  const protectedUsers: { id: string; email: string; teamName: string }[] = [];

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (PROTECTED_EMAILS.includes(data.email)) {
      protectedUsers.push({
        id: doc.id,
        email: data.email,
        teamName: data.teamName || 'Unknown',
      });
    }
  });

  console.log('Protected users:');
  protectedUsers.forEach(u => console.log(`  - ${u.teamName} (${u.id})`));
  console.log('');

  // 2. Get all race results
  const resultsSnapshot = await db.collection('race_results').get();
  const raceResults = new Map<string, string[]>();

  resultsSnapshot.forEach(doc => {
    const data = doc.data();
    const drivers = [
      data.driver1, data.driver2, data.driver3,
      data.driver4, data.driver5, data.driver6
    ].filter(Boolean);
    // Store with both lowercase and mixed case keys
    raceResults.set(doc.id, drivers);
    // Also map from raceId field to drivers
    if (data.raceId) {
      const normalizedId = data.raceId.replace(/\s+/g, '-');
      raceResults.set(normalizedId, drivers);
    }
  });

  console.log(`Race results loaded: ${raceResults.size / 2} races\n`);

  // 3. Get existing scores for protected users
  const scoresSnapshot = await db.collection('scores').get();
  const existingScores = new Set<string>();

  scoresSnapshot.forEach(doc => {
    existingScores.add(doc.id);
  });

  // 4. Check protected user predictions and create missing scores
  let scoresCreated = 0;
  let predictionsFixed = 0;

  for (const user of protectedUsers) {
    console.log(`\nProcessing ${user.teamName}...`);

    // Get predictions from prediction_submissions for this user
    const submissions = await db.collection('prediction_submissions')
      .where('userId', '==', user.id)
      .get();

    // Also check oduserId
    const submissionsByOduser = await db.collection('prediction_submissions')
      .where('oduserId', '==', user.id)
      .get();

    const allSubmissions = new Map<string, admin.firestore.DocumentData>();
    submissions.forEach(doc => allSubmissions.set(doc.id, { ref: doc.ref, ...doc.data() }));
    submissionsByOduser.forEach(doc => allSubmissions.set(doc.id, { ref: doc.ref, ...doc.data() }));

    console.log(`  Found ${allSubmissions.size} submissions`);

    for (const [docId, data] of allSubmissions) {
      const raceId = data.raceId;
      if (!raceId) continue;

      // Get predictions
      let predictions: string[] = [];
      if (data.predictions) {
        if (data.predictions.P1) {
          predictions = [
            data.predictions.P1, data.predictions.P2, data.predictions.P3,
            data.predictions.P4, data.predictions.P5, data.predictions.P6
          ].filter(Boolean).map(d => d.toLowerCase());
        } else if (Array.isArray(data.predictions)) {
          predictions = data.predictions.map((d: string) => d.toLowerCase());
        }
      }

      if (predictions.length !== 6) {
        console.log(`  Skipping ${raceId} - invalid predictions`);
        continue;
      }

      // Get race results - try multiple formats
      let actualTop6 = raceResults.get(raceId.toLowerCase()) ||
                       raceResults.get(raceId) ||
                       raceResults.get(raceId.replace(/\s+/g, '-'));

      if (!actualTop6) {
        console.log(`  No results for ${raceId}`);
        continue;
      }

      // Check if score exists
      const scoreId = `${raceId}_${user.id}`;
      if (existingScores.has(scoreId)) {
        console.log(`  Score exists for ${raceId}`);
        continue;
      }

      // Calculate and create score
      const { points, breakdown } = calculateScore(predictions, actualTop6);

      await db.collection('scores').doc(scoreId).set({
        oduserId: user.id,
        odteamId: user.id,
        odteamName: user.teamName,
        userId: user.id,
        raceId: raceId,
        totalPoints: points,
        breakdown: breakdown,
      });

      console.log(`  Created score for ${raceId}: ${points} pts`);
      scoresCreated++;
    }

    // 5. Also fix casing in users/*/predictions subcollection
    const userPreds = await db.collection('users').doc(user.id).collection('predictions').get();

    for (const predDoc of userPreds.docs) {
      const predData = predDoc.data();
      const updates: Record<string, any> = {};
      let needsUpdate = false;

      // Fix driver1-6 fields
      ['driver1', 'driver2', 'driver3', 'driver4', 'driver5', 'driver6'].forEach(field => {
        if (predData[field] && predData[field] !== predData[field].toLowerCase()) {
          updates[field] = predData[field].toLowerCase();
          needsUpdate = true;
        }
      });

      // Fix predictions array if exists
      if (Array.isArray(predData.predictions)) {
        const fixedPreds = predData.predictions.map((d: string) => d?.toLowerCase() || d);
        if (JSON.stringify(fixedPreds) !== JSON.stringify(predData.predictions)) {
          updates.predictions = fixedPreds;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await predDoc.ref.update(updates);
        predictionsFixed++;
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Scores created: ${scoresCreated}`);
  console.log(`Predictions fixed (casing): ${predictionsFixed}`);
}

fixProtectedScores()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
