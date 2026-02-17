/**
 * Extract race_results from cleanroom and copy to production
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));

// Create separate app instances for different databases
const cleanroomApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'studio-6033436327-281b1'
}, 'cleanroom');

const productionApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'studio-6033436327-281b1'
}, 'production');

// Get Firestore instances for different databases
const cleanroomDb = cleanroomApp.firestore();
cleanroomDb.settings({ databaseId: 'cleanroom-restore-2' });

const productionDb = productionApp.firestore();
// productionDb uses (default) database automatically

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function extractFromCleanroom() {
  try {
    console.log('\n📤 EXTRACT FROM CLEANROOM');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE COPY'}\n`);

    console.log('📥 Reading race_results from cleanroom database...');
    const cleanroomSnapshot = await cleanroomDb.collection('race_results').get();
    console.log(`✓ Found ${cleanroomSnapshot.size} race_results documents\n`);

    if (cleanroomSnapshot.size === 0) {
      console.log('⚠️  No race_results found in cleanroom backup.');
      return;
    }

    console.log('📄 Sample documents:');
    cleanroomSnapshot.docs.slice(0, 5).forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: raceId=${data.raceId || 'unknown'}`);
    });
    console.log('');

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Would copy these documents to production.');
      console.log('   Run with --live to execute.\n');
      return;
    }

    console.log('📤 Copying to production database...');
    const batch = productionDb.batch();
    let count = 0;

    for (const doc of cleanroomSnapshot.docs) {
      const ref = productionDb.collection('race_results').doc(doc.id);
      batch.set(ref, doc.data());
      count++;

      if (count % 500 === 0) {
        await batch.commit();
        console.log(`  Committed ${count} documents...`);
      }
    }

    // Commit remaining
    if (count % 500 !== 0) {
      await batch.commit();
    }

    console.log(`✓ Copied ${cleanroomSnapshot.size} race_results to production\n`);

    // Verify
    console.log('📊 Verification:');
    const productionSnapshot = await productionDb.collection('race_results').get();
    console.log(`  Production race_results: ${productionSnapshot.size} documents\n`);

    console.log('✅ EXTRACTION COMPLETE!\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await cleanroomApp.delete();
    await productionApp.delete();
  }
}

extractFromCleanroom()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(() => {
    console.error('Script failed');
    process.exit(1);
  });
