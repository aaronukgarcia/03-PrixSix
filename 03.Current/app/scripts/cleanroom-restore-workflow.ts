/**
 * Clean Room Restore Workflow
 *
 * 1. Create temporary "cleanroom" Firestore database
 * 2. Import full backup to cleanroom
 * 3. Extract race_results from cleanroom
 * 4. Copy to production database
 * 5. Clean up cleanroom database
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import { v1 } from '@google-cloud/firestore';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const PROJECT_ID = 'studio-6033436327-281b1';
const BACKUP_PATH = 'gs://prix6-backups/2026-02-13T115410/firestore';
const CLEANROOM_DB_ID = 'cleanroom-restore';

async function cleanroomRestoreWorkflow() {
  try {
    console.log('\n🧪 CLEAN ROOM RESTORE WORKFLOW');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE EXECUTION'}\n`);

    const firestoreAdmin = new v1.FirestoreAdminClient({
      projectId: PROJECT_ID,
      keyFilename: path.resolve(__dirname, '../../service-account.json')
    });

    const parent = `projects/${PROJECT_ID}`;
    const cleanroomDbName = `${parent}/databases/${CLEANROOM_DB_ID}`;
    const productionDbName = `${parent}/databases/(default)`;

    console.log('📋 Workflow Plan:');
    console.log(`  1. Create cleanroom database: ${CLEANROOM_DB_ID}`);
    console.log(`  2. Import full backup to cleanroom`);
    console.log(`  3. Extract race_results from cleanroom`);
    console.log(`  4. Copy race_results to production (default)`);
    console.log(`  5. Delete cleanroom database\n`);

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Steps that would be executed:\n');

      console.log('STEP 1: Create cleanroom database');
      console.log(`  gcloud firestore databases create ${CLEANROOM_DB_ID} \\`);
      console.log(`    --location=us-central1 \\`);
      console.log(`    --type=firestore-native \\`);
      console.log(`    --project=${PROJECT_ID}\n`);

      console.log('STEP 2: Import full backup to cleanroom');
      console.log(`  gcloud firestore import ${BACKUP_PATH} \\`);
      console.log(`    --database=${CLEANROOM_DB_ID} \\`);
      console.log(`    --project=${PROJECT_ID}\n`);

      console.log('STEP 3 & 4: Extract and copy race_results');
      console.log('  - Query cleanroom database for all race_results documents');
      console.log('  - Copy each document to production database');
      console.log('  - Use batched writes (500 docs per batch)\n');

      console.log('STEP 5: Clean up cleanroom');
      console.log(`  gcloud firestore databases delete ${CLEANROOM_DB_ID} \\`);
      console.log(`    --project=${PROJECT_ID}\n`);

      console.log('Run with --live to execute this workflow.');
      return;
    }

    // LIVE EXECUTION
    console.log('🟢 STEP 1: Creating cleanroom database...\n');

    try {
      const [createOp] = await firestoreAdmin.createDatabase({
        parent,
        databaseId: CLEANROOM_DB_ID,
        database: {
          locationId: 'us-central1',
          type: 'FIRESTORE_NATIVE',
          concurrencyMode: 'PESSIMISTIC',
        }
      });

      console.log('  ⏳ Waiting for database creation...');
      const [cleanroomDb] = await createOp.promise();
      console.log(`  ✓ Cleanroom database created: ${cleanroomDb.name}\n`);

    } catch (err: any) {
      if (err.message?.includes('already exists')) {
        console.log(`  ⚠️  Cleanroom database already exists, using existing one\n`);
      } else {
        throw err;
      }
    }

    console.log('🟢 STEP 2: Importing full backup to cleanroom...\n');
    console.log(`  Source: ${BACKUP_PATH}`);
    console.log(`  Target: ${cleanroomDbName}\n`);

    const [importOp] = await firestoreAdmin.importDocuments({
      name: cleanroomDbName,
      inputUriPrefix: BACKUP_PATH,
    });

    console.log('  ⏳ Import operation started...');
    console.log(`  Operation: ${importOp.name}`);
    console.log('  This may take 2-5 minutes for full database...\n');

    const [importResult] = await importOp.promise();
    console.log('  ✓ Import complete!\n');

    console.log('🟢 STEP 3 & 4: Extracting and copying race_results...\n');

    // Initialize Firestore instances for both databases
    const cleanroomDb = admin.firestore();
    cleanroomDb.settings({ databaseId: CLEANROOM_DB_ID });

    const productionDb = admin.firestore();
    // productionDb uses (default) database

    // Get all race_results from cleanroom
    console.log('  📥 Reading race_results from cleanroom...');
    const cleanroomResults = await cleanroomDb.collection('race_results').get();
    console.log(`  ✓ Found ${cleanroomResults.size} race_results documents\n`);

    if (cleanroomResults.size === 0) {
      console.log('  ⚠️  No race_results found in cleanroom backup.');
      console.log('     The backup may not contain race_results data.\n');
    } else {
      console.log('  📝 Sample documents:');
      cleanroomResults.docs.slice(0, 3).forEach(doc => {
        const data = doc.data();
        console.log(`     - ${doc.id}: raceId=${data.raceId || 'unknown'}`);
      });
      console.log('');

      console.log('  📤 Copying to production database...');
      const batch = productionDb.batch();
      let count = 0;

      for (const doc of cleanroomResults.docs) {
        const ref = productionDb.collection('race_results').doc(doc.id);
        batch.set(ref, doc.data());
        count++;

        if (count % 500 === 0) {
          await batch.commit();
          console.log(`     Committed ${count} documents...`);
        }
      }

      // Commit remaining
      if (count % 500 !== 0) {
        await batch.commit();
      }

      console.log(`  ✓ Copied ${cleanroomResults.size} race_results to production\n`);
    }

    console.log('🟢 STEP 5: Cleaning up cleanroom database...\n');

    const [deleteOp] = await firestoreAdmin.deleteDatabase({
      name: cleanroomDbName
    });

    console.log('  ⏳ Deleting cleanroom database...');
    await deleteOp.promise();
    console.log('  ✓ Cleanroom database deleted\n');

    console.log('✅ WORKFLOW COMPLETE!\n');

    // Verify production
    console.log('📊 Final Verification:');
    const verifySnapshot = await productionDb.collection('race_results').get();
    console.log(`  Production race_results: ${verifySnapshot.size} documents\n`);

  } catch (error: any) {
    console.error('\n❌ Workflow failed:', error.message);
    if (error.details) {
      console.error('Details:', error.details);
    }
    console.error('\n⚠️  If cleanroom database exists, clean up manually:');
    console.error(`   gcloud firestore databases delete ${CLEANROOM_DB_ID} --project=${PROJECT_ID}`);
    throw error;
  }
}

cleanroomRestoreWorkflow()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(() => {
    console.error('Script failed');
    process.exit(1);
  });
