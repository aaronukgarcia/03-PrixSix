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

async function checkBothAccounts() {
  const emails = ['aaron@garcia.ltd', 'aaron@garica.ltd'];

  for (const email of emails) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Checking: ${email}`);
    console.log('='.repeat(60));

    const usersSnapshot = await db.collection('users').where('email', '==', email).get();

    if (usersSnapshot.empty) {
      console.log('❌ No account found\n');
      continue;
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    console.log('✅ Account exists:');
    console.log('  User ID:', userId);
    console.log('  Team Name:', userData.teamName);
    console.log('  Email:', userData.email);

    const predictionsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('predictions')
      .get();

    console.log(`\n📊 Predictions: ${predictionsSnapshot.size}`);

    if (!predictionsSnapshot.empty) {
      predictionsSnapshot.docs.forEach((predDoc, idx) => {
        const pred = predDoc.data();
        const submitted = pred.submittedAt?.toDate();
        console.log(`  ${idx + 1}. Race: ${pred.raceId}`);
        console.log(`     Submitted: ${submitted}`);
        console.log(`     Doc ID: ${predDoc.id}`);
      });
    } else {
      console.log('  (none)');
    }
  }

  process.exit(0);
}

checkBothAccounts().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
