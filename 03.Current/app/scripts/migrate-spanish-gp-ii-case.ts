/**
 * Migration script to fix Spanish GP II case mismatch
 *
 * PROBLEM: Predictions stored "Spanish-Grand-Prix-Ii" (mixed case)
 *          but RaceSchedule has "Spanish Grand Prix II" (uppercase II)
 *
 * SOLUTION: Migrate all predictions to canonical format "Spanish-Grand-Prix-II"
 *           This maintains Golden Rule #3: Single Source of Truth
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function migrateSpanishGPII() {
  try {
    console.log('\n=== Spanish GP II Case Migration ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (--dry-run)' : 'LIVE (--live)'}\n`);

    // Query for predictions with the incorrect case
    const predictionsSnapshot = await db.collectionGroup('predictions')
      .where('raceId', '==', 'Spanish-Grand-Prix-Ii')
      .get();

    console.log(`Found ${predictionsSnapshot.size} predictions with incorrect case\n`);

    if (predictionsSnapshot.empty) {
      console.log('✓ No predictions need updating');
      return;
    }

    const batch = db.batch();
    let count = 0;

    predictionsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`  Prediction: ${doc.id}`);
      console.log(`    Current raceId: "${data.raceId}"`);
      console.log(`    New raceId: "Spanish-Grand-Prix-II"`);
      console.log('');

      if (!DRY_RUN) {
        batch.update(doc.ref, {
          raceId: 'Spanish-Grand-Prix-II'
        });
      }
      count++;
    });

    console.log(`\nSummary:`);
    console.log(`  Predictions to update: ${count}`);

    if (!DRY_RUN && count > 0) {
      console.log(`\nCommitting batch update...`);
      await batch.commit();
      console.log(`✓ Successfully updated ${count} predictions`);
    } else if (DRY_RUN && count > 0) {
      console.log(`\n⚠ DRY RUN - No changes written. Run with --live to apply changes.`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  }
}

migrateSpanishGPII()
  .then(() => {
    console.log('\nMigration completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nMigration failed:', error);
    process.exit(1);
  });
