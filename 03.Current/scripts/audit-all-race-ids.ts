#!/usr/bin/env tsx
/**
 * Audit all race IDs in predictions to check for format consistency.
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

async function auditRaceIds() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Audit All Race IDs in Predictions');
  console.log('═══════════════════════════════════════════════════════════\n');

  const usersSnapshot = await db.collection('users').get();
  console.log(`Scanning ${usersSnapshot.size} users...\n`);

  const raceIdCounts = new Map<string, number>();
  let totalPredictions = 0;

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;

    const predictionsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('predictions')
      .get();

    predictionsSnapshot.docs.forEach(predDoc => {
      const pred = predDoc.data();
      const raceId = pred.raceId;

      if (raceId) {
        raceIdCounts.set(raceId, (raceIdCounts.get(raceId) || 0) + 1);
        totalPredictions++;
      }
    });
  }

  console.log('Race ID Distribution:');
  console.log('═══════════════════════════════════════════════════════════\n');

  const sortedRaceIds = Array.from(raceIdCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  sortedRaceIds.forEach(([raceId, count]) => {
    const hasGpSuffix = raceId.endsWith('-GP');
    const hasSprintSuffix = raceId.endsWith('-Sprint');
    const noSuffix = !hasGpSuffix && !hasSprintSuffix;

    let indicator = '✅';
    if (noSuffix) {
      indicator = '⚠️ '; // Missing suffix
    }

    console.log(`${indicator} ${raceId.padEnd(40)} ${count.toString().padStart(3)} predictions`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`Total predictions: ${totalPredictions}`);
  console.log(`Unique race IDs: ${raceIdCounts.size}`);

  // Check for problematic patterns
  const missingGpSuffix = sortedRaceIds.filter(([raceId]) =>
    !raceId.endsWith('-GP') && !raceId.endsWith('-Sprint')
  );

  if (missingGpSuffix.length > 0) {
    console.log('\n⚠️  WARNING: Race IDs without -GP or -Sprint suffix:');
    console.log('═══════════════════════════════════════════════════════════');
    missingGpSuffix.forEach(([raceId, count]) => {
      console.log(`  ${raceId} (${count} predictions)`);
    });
    console.log('\nThese will NOT match the submissions page query!');
  } else {
    console.log('\n✅ All race IDs have proper suffix (-GP or -Sprint)');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

auditRaceIds().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
