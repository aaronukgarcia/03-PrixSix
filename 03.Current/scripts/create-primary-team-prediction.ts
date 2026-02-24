#!/usr/bin/env tsx
/**
 * Create primary team prediction for LREG from secondary team data.
 *
 * GUID: SCRIPT_CREATE_PRIMARY_PREDICTION-000-v01
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function createPrimaryPrediction() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Create Primary Team Prediction for LREG');
  console.log('═══════════════════════════════════════════════════════════\n');

  const email = 'aaron@garcia.ltd';
  const userSnapshot = await db.collection('users').where('email', '==', email).get();

  if (userSnapshot.empty) {
    console.log('❌ User not found\n');
    process.exit(1);
  }

  const userDoc = userSnapshot.docs[0];
  const userData = userDoc.data();
  const userId = userDoc.id;

  console.log('User:', userData.teamName);
  console.log('User ID:', userId);
  console.log('');

  // Get existing secondary team prediction
  const allPredictions = await db
    .collection('users')
    .doc(userId)
    .collection('predictions')
    .get();

  const secondaryPred = allPredictions.docs.find(doc =>
    doc.data().raceId === 'Australian-Grand-Prix-GP' &&
    doc.data().teamId?.includes('secondary')
  );

  if (!secondaryPred) {
    console.log('❌ No secondary team prediction found\n');
    process.exit(1);
  }

  const secondaryData = secondaryPred.data();
  console.log('Found secondary team prediction:');
  console.log('  Team:', secondaryData.teamName);
  console.log('  Drivers:', secondaryData.predictions?.join(', '));
  console.log('');

  // Create primary team prediction
  const primaryPredictionId = `${userId}_Australian-Grand-Prix-GP`;
  const primaryPredictionData = {
    userId: userId,
    teamId: userId, // Primary team ID is same as user ID
    teamName: userData.teamName, // Use user's primary team name (LREG)
    raceId: 'Australian-Grand-Prix-GP',
    raceName: 'Australian-Grand-Prix',
    predictions: secondaryData.predictions || [], // Copy the driver predictions
    positions: secondaryData.predictions || [], // Also set positions field
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    isCarryForward: false, // This is now a fresh prediction for this race
  };

  console.log('Creating primary team prediction:');
  console.log('  Prediction ID:', primaryPredictionId);
  console.log('  Team:', primaryPredictionData.teamName);
  console.log('  Race:', primaryPredictionData.raceId);
  console.log('  Drivers:', primaryPredictionData.predictions.join(', '));
  console.log('');

  await db
    .collection('users')
    .doc(userId)
    .collection('predictions')
    .doc(primaryPredictionId)
    .set(primaryPredictionData);

  console.log('✅ Primary team prediction created successfully!');
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ COMPLETE');
  console.log('   LREG now has a prediction for Australian-Grand-Prix-GP');
  console.log('   Drivers: ' + primaryPredictionData.predictions.join(', '));
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

createPrimaryPrediction().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
