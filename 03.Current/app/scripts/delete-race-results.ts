/**
 * Delete all race_results from production database
 * Part of backup/restore validation cycle
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function deleteRaceResults() {
  console.log('\n🗑️  DELETE ALL RACE RESULTS');
  console.log(`Mode: ${DRY_RUN ? '⚠️  DRY RUN' : '🔴 LIVE DELETE'}\n`);

  const snapshot = await db.collection('race_results').get();
  console.log(`📊 Found ${snapshot.size} race_results documents\n`);

  if (snapshot.size === 0) {
    console.log('✅ No race_results to delete!\n');
    return;
  }

  if (DRY_RUN) {
    console.log('📋 Would delete:');
    snapshot.docs.slice(0, 10).forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: ${data.raceName} (${data.raceId})`);
    });
    if (snapshot.size > 10) {
      console.log(`  ... and ${snapshot.size - 10} more`);
    }
    console.log(`\n⚠️  DRY RUN - Would delete ${snapshot.size} documents`);
    console.log('   Run with --live to delete.\n');
    return;
  }

  console.log('🔴 DELETING race_results...');
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(`✅ Deleted ${snapshot.size} race_results!\n`);
}

deleteRaceResults()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
