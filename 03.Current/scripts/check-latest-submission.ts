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

async function checkLatestSubmission() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Check Latest Prediction Submission for LREG');
  console.log('═══════════════════════════════════════════════════════════\n');

  const email = 'aaron@garcia.ltd';
  const userSnapshot = await db.collection('users').where('email', '==', email).get();

  if (userSnapshot.empty) {
    console.log('❌ User not found\n');
    process.exit(1);
  }

  const userDoc = userSnapshot.docs[0];
  const userId = userDoc.id;

  const predictionsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('predictions')
    .get();

  console.log(`Total predictions: ${predictionsSnapshot.size}\n`);

  const australianGPPreds = predictionsSnapshot.docs
    .filter(doc => doc.data().raceId === 'Australian-Grand-Prix-GP')
    .map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

  console.log('Australian Grand Prix predictions:');
  console.log('═══════════════════════════════════════════════════════════\n');

  australianGPPreds.forEach((pred, idx) => {
    console.log(`${idx + 1}. Prediction ID: ${pred.id}`);
    console.log(`   Team ID: ${pred.teamId}`);
    console.log(`   Team Name: ${pred.teamName}`);
    console.log(`   Race ID: ${pred.raceId}`);
    console.log(`   Submitted: ${pred.submittedAt?.toDate ? pred.submittedAt.toDate() : pred.submittedAt}`);
    console.log(`   Is Carry Forward: ${pred.isCarryForward}`);

    if (pred.predictions && pred.predictions.length > 0) {
      console.log(`   Predictions field: ${pred.predictions.join(', ')}`);
    }
    if (pred.positions && pred.positions.length > 0) {
      console.log(`   Positions field: ${pred.positions.join(', ')}`);
    }

    console.log('   Full data:');
    console.log(JSON.stringify(pred, null, 2));
    console.log('\n' + '─'.repeat(60) + '\n');
  });

  console.log('═══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

checkLatestSubmission().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
