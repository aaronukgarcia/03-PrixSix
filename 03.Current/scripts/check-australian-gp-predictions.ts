#!/usr/bin/env tsx
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

async function checkAustralianGP() {
  console.log('Checking Australian Grand Prix predictions...\n');

  // Possible race ID variations
  const possibleRaceIds = [
    'Australian-Grand-Prix',
    'Australian-Grand-Prix-GP',
    'australian-grand-prix',
    'australian-grand-prix-gp',
    'Australia-Grand-Prix',
    'australia-grand-prix'
  ];

  for (const raceId of possibleRaceIds) {
    console.log(`\nSearching for raceId: "${raceId}"`);

    let totalFound = 0;

    // Check all users' prediction subcollections
    const usersSnapshot = await db.collection('users').get();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      const predictionsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('predictions')
        .where('raceId', '==', raceId)
        .get();

      if (!predictionsSnapshot.empty) {
        totalFound += predictionsSnapshot.size;
        predictionsSnapshot.docs.forEach(predDoc => {
          const pred = predDoc.data();
          console.log(`  ✅ ${userData.teamName || userId}: ${pred.positions ? pred.positions.join(', ') : 'no positions'}`);
        });
      }
    }

    if (totalFound === 0) {
      console.log(`  ❌ No predictions found`);
    } else {
      console.log(`  Total: ${totalFound} predictions`);
    }
  }

  // Also check the user's specific predictions
  console.log('\n' + '='.repeat(60));
  console.log('Your account (aaron@garcia.ltd) predictions:');
  console.log('='.repeat(60));

  const userSnapshot = await db.collection('users').where('email', '==', 'aaron@garcia.ltd').get();
  if (!userSnapshot.empty) {
    const userId = userSnapshot.docs[0].id;
    const allPreds = await db.collection('users').doc(userId).collection('predictions').get();

    console.log(`\nTotal predictions: ${allPreds.size}`);
    allPreds.docs.forEach(doc => {
      const pred = doc.data();
      console.log(`  - ${pred.raceId}: ${pred.positions ? pred.positions.join(', ') : 'no positions'}`);
    });
  }

  process.exit(0);
}

checkAustralianGP().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
