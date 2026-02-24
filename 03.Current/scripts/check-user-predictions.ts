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

async function checkUser() {
  const email = 'aaron@garcia.ltd';

  console.log('Checking user:', email);

  const usersSnapshot = await db.collection('users').where('email', '==', email).get();

  if (usersSnapshot.empty) {
    console.log('❌ No user found with email:', email);
    return;
  }

  const userDoc = usersSnapshot.docs[0];
  const userData = userDoc.data();
  const userId = userDoc.id;

  console.log('\n✅ User found:');
  console.log('  User ID:', userId);
  console.log('  Team Name:', userData.teamName);
  console.log('  Email:', userData.email);
  console.log('  Created:', userData.createdAt?.toDate());

  const predictionsSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('predictions')
    .orderBy('submittedAt', 'desc')
    .get();

  console.log('\n📊 Predictions:', predictionsSnapshot.size);

  if (!predictionsSnapshot.empty) {
    predictionsSnapshot.forEach((predDoc, idx) => {
      const pred = predDoc.data();
      console.log(`  ${idx + 1}. ID: ${predDoc.id}, Race: ${pred.raceId}, Submitted: ${pred.submittedAt?.toDate()}`);
    });
  }

  process.exit(0);
}

checkUser().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
