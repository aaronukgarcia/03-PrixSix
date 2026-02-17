/**
 * Per-Collection Backup Script
 *
 * Creates individual backups for each collection to enable selective restores.
 * Runs sequentially to avoid overwhelming the Firestore export API.
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
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const PROJECT_ID = 'studio-6033436327-281b1';
const BUCKET_NAME = 'prix6-backups';

// Collections to backup (in order of priority)
const COLLECTIONS_TO_BACKUP = [
  'race_results',      // Critical: race data
  'scores',            // Critical: calculated scores
  'predictions',       // Important: user predictions
  'users',             // Important: user data
  'leagues',           // Important: league data
  'audit_logs',        // Optional: audit trail
  'backup_status',     // Optional: backup metadata
];

async function backupPerCollection() {
  try {
    console.log('\n💾 PER-COLLECTION BACKUP');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE BACKUP'}\n`);

    const firestoreAdmin = new v1.FirestoreAdminClient({
      projectId: PROJECT_ID,
      keyFilename: path.resolve(__dirname, '../../service-account.json')
    });

    const databaseName = firestoreAdmin.databasePath(PROJECT_ID, '(default)');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + 'T' +
                      new Date().toISOString().replace(/[:.]/g, '').split('T')[1].substring(0, 6);

    console.log('📋 Backup Plan:');
    console.log(`  Project: ${PROJECT_ID}`);
    console.log(`  Database: (default)`);
    console.log(`  Bucket: gs://${BUCKET_NAME}`);
    console.log(`  Timestamp: ${timestamp}`);
    console.log(`  Collections: ${COLLECTIONS_TO_BACKUP.length}\n`);

    // Check collection sizes first
    console.log('📊 Collection Sizes:');
    const collectionSizes: Record<string, number> = {};

    for (const collectionId of COLLECTIONS_TO_BACKUP) {
      const snapshot = await db.collection(collectionId).count().get();
      const count = snapshot.data().count;
      collectionSizes[collectionId] = count;
      console.log(`  ${collectionId.padEnd(20)} ${count.toString().padStart(6)} documents`);
    }
    console.log('');

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Backups that would be created:\n');

      for (const collectionId of COLLECTIONS_TO_BACKUP) {
        const outputPath = `gs://${BUCKET_NAME}/${timestamp}/${collectionId}`;
        console.log(`  ${collectionId}:`);
        console.log(`    Output: ${outputPath}`);
        console.log(`    Documents: ${collectionSizes[collectionId]}`);
        console.log(`    Estimated time: ~30-60 seconds\n`);
      }

      console.log('Total estimated time: ~5-10 minutes for all collections');
      console.log('Run with --live to execute backups.\n');
      return;
    }

    // LIVE BACKUP
    console.log('🟢 Starting sequential backups...\n');

    const backupResults: Array<{
      collection: string;
      status: string;
      operation?: string;
      error?: string;
      documents: number;
    }> = [];

    for (let i = 0; i < COLLECTIONS_TO_BACKUP.length; i++) {
      const collectionId = COLLECTIONS_TO_BACKUP[i];
      const progress = `[${i + 1}/${COLLECTIONS_TO_BACKUP.length}]`;

      console.log(`${progress} Backing up ${collectionId}...`);

      if (collectionSizes[collectionId] === 0) {
        console.log(`  ⚠️  Skipping (empty collection)\n`);
        backupResults.push({
          collection: collectionId,
          status: 'skipped',
          documents: 0
        });
        continue;
      }

      try {
        const outputUriPrefix = `gs://${BUCKET_NAME}/${timestamp}/${collectionId}`;

        const [operation] = await firestoreAdmin.exportDocuments({
          name: databaseName,
          collectionIds: [collectionId],
          outputUriPrefix
        });

        console.log(`  ⏳ Export operation started: ${operation.name}`);
        console.log(`     Waiting for completion...`);

        const [response] = await operation.promise();

        console.log(`  ✓ Export complete!`);
        console.log(`     Output: ${outputUriPrefix}\n`);

        backupResults.push({
          collection: collectionId,
          status: 'success',
          operation: operation.name || undefined,
          documents: collectionSizes[collectionId]
        });

      } catch (error: any) {
        console.error(`  ❌ Export failed: ${error.message}\n`);
        backupResults.push({
          collection: collectionId,
          status: 'failed',
          error: error.message,
          documents: collectionSizes[collectionId]
        });
      }
    }

    // Summary
    console.log('📊 BACKUP SUMMARY\n');

    const successful = backupResults.filter(r => r.status === 'success');
    const failed = backupResults.filter(r => r.status === 'failed');
    const skipped = backupResults.filter(r => r.status === 'skipped');

    console.log(`  ✓ Successful: ${successful.length}`);
    console.log(`  ❌ Failed: ${failed.length}`);
    console.log(`  ⚠️  Skipped: ${skipped.length}\n`);

    if (successful.length > 0) {
      console.log('  Successful backups:');
      successful.forEach(r => {
        console.log(`    - ${r.collection} (${r.documents} docs)`);
      });
      console.log('');
    }

    if (failed.length > 0) {
      console.log('  Failed backups:');
      failed.forEach(r => {
        console.log(`    - ${r.collection}: ${r.error}`);
      });
      console.log('');
    }

    // Update backup_status collection
    console.log('📝 Updating backup status...');

    const backupStatusRef = db.collection('backup_status').doc('latest_per_collection');
    await backupStatusRef.set({
      timestamp: admin.firestore.Timestamp.now(),
      backupPath: `gs://${BUCKET_NAME}/${timestamp}`,
      collectionResults: backupResults,
      totalCollections: COLLECTIONS_TO_BACKUP.length,
      successfulCount: successful.length,
      failedCount: failed.length,
      skippedCount: skipped.length
    });

    console.log('✓ Backup status updated\n');

    console.log('✅ PER-COLLECTION BACKUP COMPLETE!\n');

    console.log('💡 To restore a specific collection:');
    console.log(`   gcloud firestore import gs://${BUCKET_NAME}/${timestamp}/<collection_name> \\`);
    console.log(`     --collection-ids=<collection_name> \\`);
    console.log(`     --project=${PROJECT_ID}\n`);

  } catch (error: any) {
    console.error('\n❌ Backup failed:', error.message);
    if (error.details) {
      console.error('Details:', error.details);
    }
    throw error;
  }
}

backupPerCollection()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(() => {
    console.error('Script failed');
    process.exit(1);
  });
