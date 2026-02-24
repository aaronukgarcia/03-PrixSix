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

  const possibleRaceIds = [
    'Australian-Grand-Prix',
    'Australian-Grand-Prix-GP',
    'australian-grand-prix',
    'australian-grand-prix-gp'
  ];

  const usersSnapshot = await db.collection('users').get();
  console.log(`Scanning ${usersSnapshot.size} users...\n`);

  const foundPredictions: any[] = [];

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const userData = userDoc.data();

    const predictionsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('predictions')
      .get();

    predictionsSnapshot.docs.forEach(predDoc => {
      const pred = predDoc.data();
      if (possibleRaceIds.includes(pred.raceId)) {
        foundPredictions.push({
          teamName: userData.teamName || userId,
          email: userData.email,
          raceId: pred.raceId,
          positions: pred.positions || [],
          submittedAt: pred.submittedAt?.toDate()
        });
      }
    });
  }

  console.log('Australian Grand Prix predictions:');
  console.log('='.repeat(60));

  if (foundPredictions.length === 0) {
    console.log('❌ NO PREDICTIONS FOUND for Australian Grand Prix\n');
    console.log('This explains why the predictions page is empty!\n');
  } else {
    foundPredictions.forEach((pred, idx) => {
      console.log(`${idx + 1}. ${pred.teamName} (${pred.email})`);
      console.log(`   Race ID: ${pred.raceId}`);
      console.log(`   Positions: ${pred.positions.join(', ')}`);
      console.log(`   Submitted: ${pred.submittedAt}`);
      console.log('');
    });
    console.log(`Total: ${foundPredictions.length} predictions\n`);
  }

  // Check what predictions aaron@garcia.ltd has
  console.log('='.repeat(60));
  console.log('Your predictions (aaron@garcia.ltd):');
  console.log('='.repeat(60));

  const userSnapshot = await db.collection('users').where('email', '==', 'aaron@garcia.ltd').get();
  if (!userSnapshot.empty) {
    const userId = userSnapshot.docs[0].id;
    const allPreds = await db.collection('users').doc(userId).collection('predictions').get();

    if (allPreds.empty) {
      console.log('❌ No predictions at all\n');
    } else {
      console.log(`\nTotal: ${allPreds.size} prediction(s)\n`);
      allPreds.docs.forEach(doc => {
        const pred = doc.data();
        console.log(`  - ${pred.raceId}`);
        console.log(`    Positions: ${pred.positions ? pred.positions.join(', ') : 'none'}`);
        console.log(`    Submitted: ${pred.submittedAt?.toDate()}`);
        console.log('');
      });
    }
  }

  process.exit(0);
}

checkAustralianGP().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
