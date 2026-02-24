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

async function countTeamTypes() {
  console.log('Analyzing primary vs secondary team predictions...\n');

  const usersSnapshot = await db.collection('users').get();
  let primaryCount = 0;
  let secondaryCount = 0;
  const examples: string[] = [];

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
      const teamId = pred.teamId || userId;
      const isSecondary = teamId.includes('secondary');

      if (isSecondary) {
        secondaryCount++;
        if (examples.length < 3) {
          examples.push(`  - ${pred.teamName || 'Unknown'} (${pred.raceId})`);
        }
      } else {
        primaryCount++;
      }
    });
  }

  console.log('Prediction counts:');
  console.log(`  Primary teams: ${primaryCount}`);
  console.log(`  Secondary teams: ${secondaryCount}`);
  console.log(`  Total: ${primaryCount + secondaryCount}\n`);

  if (secondaryCount > 0) {
    console.log('Secondary team examples:');
    examples.forEach(ex => console.log(ex));
    console.log('\n✅ Secondary teams are being tracked');
  } else {
    console.log('⚠️  No secondary team predictions found');
  }

  process.exit(0);
}

countTeamTypes().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
