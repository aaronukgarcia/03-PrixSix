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

async function showUserPrediction() {
  const email = 'aaron@garcia.ltd';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('   My Predictions - Australian Grand Prix');
  console.log('═══════════════════════════════════════════════════════════\n');

  const userSnapshot = await db.collection('users').where('email', '==', email).get();

  if (userSnapshot.empty) {
    console.log('❌ User not found\n');
    process.exit(1);
  }

  const userDoc = userSnapshot.docs[0];
  const userData = userDoc.data();
  const userId = userDoc.id;

  console.log('Team Name:', userData.teamName);
  console.log('Email:', userData.email);
  console.log('');

  const predSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('predictions')
    .where('raceId', '==', 'Australian-Grand-Prix-GP')
    .get();

  if (predSnapshot.empty) {
    console.log('❌ No prediction found for Australian Grand Prix');
    console.log('   You need to submit a prediction for this race.\n');
  } else {
    const predDoc = predSnapshot.docs[0];
    const pred = predDoc.data();

    console.log('✅ Prediction found:');
    console.log('─'.repeat(60));
    console.log('Race ID:', pred.raceId);
    console.log('Submitted:', pred.submittedAt?.toDate());
    console.log('');
    console.log('Your Predicted Top 6:');
    console.log('─'.repeat(60));

    if (!pred.positions || pred.positions.length === 0) {
      console.log('⚠️  No positions selected yet');
      console.log('   Your prediction is empty - you need to select your top 6 drivers.\n');
    } else {
      pred.positions.forEach((driver: string, index: number) => {
        console.log(`  ${index + 1}. ${driver}`);
      });
      console.log('');
    }

    console.log('Full prediction data:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(pred, null, 2));
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

showUserPrediction().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
