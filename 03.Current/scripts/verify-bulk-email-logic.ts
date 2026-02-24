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

async function checkSpecificUser() {
  const targetEmail = 'aaron@garcia.ltd';

  const usersSnapshot = await db.collection('users').get();
  console.log(`Total users in database: ${usersSnapshot.size}\n`);

  for (const userDoc of usersSnapshot.docs) {
    const userData = userDoc.data();
    const userId = userDoc.id;
    const email = userData.email;

    if (email === targetEmail) {
      console.log('Found target user:');
      console.log('  User ID:', userId);
      console.log('  Email:', email);
      console.log('  Team Name:', userData.teamName);

      // Same logic as bulk email script
      const predictionsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('predictions')
        .limit(1)
        .get();

      console.log('\n  Predictions check (bulk email logic):');
      console.log('    snapshot.empty:', predictionsSnapshot.empty);
      console.log('    snapshot.size:', predictionsSnapshot.size);

      if (!predictionsSnapshot.empty) {
        console.log('    ✅ HAS predictions - would SKIP email');
        predictionsSnapshot.docs.forEach(doc => {
          console.log('      Doc ID:', doc.id);
          console.log('      Race:', doc.data().raceId);
        });
      } else {
        console.log('    ❌ NO predictions - would SEND email');
      }
      break;
    }
  }

  process.exit(0);
}

checkSpecificUser().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
