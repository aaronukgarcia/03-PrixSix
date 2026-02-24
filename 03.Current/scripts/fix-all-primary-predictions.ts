#!/usr/bin/env tsx
/**
 * Create primary team predictions for all users who only have secondary team predictions.
 *
 * GUID: SCRIPT_FIX_ALL_PRIMARY_PREDICTIONS-000-v01
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

async function fixAllPrimaryPredictions() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Fix Primary Predictions for All Users');
  console.log('═══════════════════════════════════════════════════════════\n');

  const usersSnapshot = await db.collection('users').get();
  console.log(`Scanning ${usersSnapshot.size} users...\n`);

  let usersFixed = 0;
  let usersAlreadyHavePrimary = 0;
  let usersWithNoSecondary = 0;

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const userData = userDoc.data();
    const teamName = userData.teamName || 'Unknown';

    const predictionsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('predictions')
      .get();

    if (predictionsSnapshot.empty) {
      continue;
    }

    const predictions = predictionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Find Australian GP predictions
    const australianGPPreds = predictions.filter(p =>
      p.raceId === 'Australian-Grand-Prix-GP'
    );

    if (australianGPPreds.length === 0) {
      continue;
    }

    // Check if there's a primary and secondary prediction
    const primaryPred = australianGPPreds.find(p =>
      !p.teamId?.includes('secondary')
    );

    const secondaryPred = australianGPPreds.find(p =>
      p.teamId?.includes('secondary')
    );

    if (primaryPred) {
      // User already has primary prediction
      usersAlreadyHavePrimary++;
      console.log(`  ✓ ${teamName}: Already has primary prediction`);
      continue;
    }

    if (!secondaryPred) {
      // User has no secondary prediction to copy from
      usersWithNoSecondary++;
      continue;
    }

    // Create primary prediction from secondary
    console.log(`  🔧 ${teamName}: Creating primary from secondary...`);
    console.log(`     Drivers: ${secondaryPred.predictions?.join(', ') || 'none'}`);

    const primaryPredictionId = `${userId}_Australian-Grand-Prix-GP`;
    const primaryPredictionData = {
      userId: userId,
      teamId: userId,
      teamName: teamName,
      raceId: 'Australian-Grand-Prix-GP',
      raceName: 'Australian-Grand-Prix',
      predictions: secondaryPred.predictions || [],
      positions: secondaryPred.predictions || [],
      submittedAt: secondaryPred.submittedAt || admin.firestore.FieldValue.serverTimestamp(),
      isCarryForward: false,
    };

    await db
      .collection('users')
      .doc(userId)
      .collection('predictions')
      .doc(primaryPredictionId)
      .set(primaryPredictionData);

    usersFixed++;
    console.log(`     ✅ Created primary prediction\n`);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ COMPLETE');
  console.log(`   Users already with primary: ${usersAlreadyHavePrimary}`);
  console.log(`   Users fixed (primary created): ${usersFixed}`);
  console.log(`   Users with no secondary: ${usersWithNoSecondary}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

fixAllPrimaryPredictions().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
