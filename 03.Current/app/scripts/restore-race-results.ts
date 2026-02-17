/**
 * Restore ONLY race_results collection from backup
 *
 * PURPOSE: Selective restore to bring back race results while keeping
 *          scores and audit_logs in their current state (empty)
 *
 * RESTORES:
 *   - race_results collection only (30 documents)
 *
 * PRESERVES (untouched):
 *   - scores collection (currently empty)
 *   - audit_logs collection (currently empty)
 *   - predictions collection (690 documents)
 *   - users, leagues (all other collections)
 *
 * Usage:
 *   DRY RUN: npx ts-node --project tsconfig.scripts.json scripts/restore-race-results.ts --dry-run
 *   LIVE:    npx ts-node --project tsconfig.scripts.json scripts/restore-race-results.ts --live
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const BACKUP_PATH = 'gs://prix6-backups/2026-02-13T115410';

async function restoreRaceResults() {
  try {
    console.log('\n🔄 RESTORE RACE RESULTS FROM BACKUP');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (--dry-run)' : '🟢 LIVE RESTORE (--live)'}\n`);

    // Get latest backup info
    const backupStatusDoc = await db.collection('backup_status').doc('latest').get();
    const backupData = backupStatusDoc.data();

    console.log('📦 Backup Information:');
    console.log(`  Path: ${backupData?.lastBackupPath || BACKUP_PATH}`);
    const timestamp = backupData?.lastBackupTimestamp;
    if (timestamp) {
      const date = new Date(timestamp._seconds * 1000);
      console.log(`  Date: ${date.toISOString()}`);
    }
    console.log(`  Size: ${((backupData?.lastBackupSizeBytes || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Status: ${backupData?.lastBackupStatus || 'UNKNOWN'}\n`);

    // Check current race_results collection
    const currentResultsSnapshot = await db.collection('race_results').get();
    console.log('📊 Current State:');
    console.log(`  race_results: ${currentResultsSnapshot.size} documents\n`);

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - What will happen in LIVE mode:\n');
      console.log('  1. Import race_results collection from backup');
      console.log(`  2. Source: ${backupData?.lastBackupPath || BACKUP_PATH}`);
      console.log('  3. Target: prix6 (default) database');
      console.log('  4. Collection filter: race_results ONLY');
      console.log('  5. Other collections: UNTOUCHED (scores, audit_logs remain empty)\n');
      console.log('  Expected result: ~30 race_results documents restored\n');
      console.log('⚠️  Run with --live to execute the restore.');
      return;
    }

    // LIVE RESTORE
    console.log('🟢 Starting LIVE restore...\n');

    // Note: Firestore Admin API doesn't support collection filtering in importDocuments
    // We need to use a different approach: manually copy from backup or use gcloud
    console.log('⚠️  LIMITATION DETECTED:');
    console.log('  The Firestore Admin SDK does not support selective collection import.');
    console.log('  We need to use one of these approaches:\n');
    console.log('  Option 1: Use gcloud CLI with --collection-ids flag');
    console.log('  Option 2: Restore full backup to temp location, then copy race_results\n');

    console.log('📋 Required command (run this manually with gcloud CLI):\n');
    console.log(`gcloud firestore import ${backupData?.lastBackupPath || BACKUP_PATH} \\`);
    console.log(`  --collection-ids=race_results \\`);
    console.log(`  --project=prix6\n`);

    console.log('Alternative: I can create a script that copies from the backup export files.');
    console.log('Would you like me to create that? (This requires reading the backup metadata)');

  } catch (error) {
    console.error('\n❌ Restore check failed:', error);
    throw error;
  }
}

restoreRaceResults()
  .then(() => {
    console.log('\nScript completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nScript failed:', error);
    process.exit(1);
  });
