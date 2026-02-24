#!/usr/bin/env tsx
/**
 * Migrate all existing predictions to Australian Grand Prix.
 * Since we're before the first race, all predictions should be for Australian GP.
 *
 * GUID: SCRIPT_MIGRATE_TO_AUSTRALIAN_GP-000-v01
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

async function migratePredictions() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Migrate All Predictions to Australian Grand Prix');
  console.log('═══════════════════════════════════════════════════════════\n');

  const targetRaceId = 'Australian-Grand-Prix-GP';

  console.log(`Target race ID: ${targetRaceId}\n`);

  const usersSnapshot = await db.collection('users').get();
  console.log(`Scanning ${usersSnapshot.size} users...\n`);

  let predictionsUpdated = 0;
  let usersProcessed = 0;
  const updates: any[] = [];

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const userData = userDoc.data();

    const predictionsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('predictions')
      .get();

    if (!predictionsSnapshot.empty) {
      for (const predDoc of predictionsSnapshot.docs) {
        const pred = predDoc.data();
        const oldRaceId = pred.raceId;

        if (oldRaceId !== targetRaceId) {
          updates.push({
            userId,
            teamName: userData.teamName || userId,
            email: userData.email,
            predictionId: predDoc.id,
            oldRaceId,
            newRaceId: targetRaceId,
            positions: pred.positions || []
          });
        }
      }
      usersProcessed++;
    }
  }

  console.log('Predictions to migrate:');
  console.log('═══════════════════════════════════════════════════════════');

  if (updates.length === 0) {
    console.log('✅ No predictions need migration - all already set to Australian GP\n');
  } else {
    updates.forEach((update, idx) => {
      console.log(`${idx + 1}. ${update.teamName} (${update.email})`);
      console.log(`   Old: ${update.oldRaceId}`);
      console.log(`   New: ${update.newRaceId}`);
      console.log(`   Positions: ${update.positions.join(', ') || 'none'}`);
      console.log('');
    });

    console.log(`\nTotal predictions to update: ${updates.length}`);
    console.log('\nPerforming migration...\n');

    // Perform the updates
    for (const update of updates) {
      await db
        .collection('users')
        .doc(update.userId)
        .collection('predictions')
        .doc(update.predictionId)
        .update({
          raceId: update.newRaceId
        });

      predictionsUpdated++;
      console.log(`✅ Updated ${update.teamName}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ MIGRATION COMPLETE');
  console.log(`   Users with predictions: ${usersProcessed}`);
  console.log(`   Predictions migrated: ${predictionsUpdated}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

migratePredictions().catch((error) => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
