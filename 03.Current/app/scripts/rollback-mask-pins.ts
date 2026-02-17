// GUID: SCRIPT_ROLLBACK_MASK_PINS-000-v01
// @SECURITY_FIX: EMAIL-006 Phase 1B - Rollback script for PIN masking migration.
// [Intent] Restore original plaintext PINs from backup if migration fails or needs to be reverted.
//          Use with extreme caution - only for emergency rollback.
// [Inbound Trigger] Run manually via: npx ts-node --project tsconfig.scripts.json scripts/rollback-mask-pins.ts
// [Downstream Impact] Restores email_logs documents to pre-migration state from backup JSON file.

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// GUID: SCRIPT_ROLLBACK_MASK_PINS-001-v01
// [Intent] Configuration for rollback script with safety controls.
// [Inbound Trigger] Read at script start.
// [Downstream Impact] Controls dry-run mode and batch size for rollback.
const CONFIG = {
  dryRun: true, // MUST be true first to preview rollback
  batchSize: 500,
  backupDir: path.join(__dirname, '../../email-logs-backup'),
};

// GUID: SCRIPT_ROLLBACK_MASK_PINS-002-v01
// [Intent] Initialize Firebase Admin SDK.
// [Inbound Trigger] Called once at script start.
// [Downstream Impact] Required for Firestore access.
function initializeFirebase(): admin.firestore.Firestore {
  const serviceAccountPath = path.join(__dirname, '../../service-account.json');

  if (!fs.existsSync(serviceAccountPath)) {
    console.error('❌ ERROR: service-account.json not found');
    process.exit(1);
  }

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
    });
  }

  return admin.firestore();
}

// GUID: SCRIPT_ROLLBACK_MASK_PINS-003-v01
// [Intent] Find the most recent backup file to restore from.
// [Inbound Trigger] Called at script start.
// [Downstream Impact] Returns path to backup JSON file.
function findLatestBackup(): string | null {
  if (!fs.existsSync(CONFIG.backupDir)) {
    console.error(`❌ Backup directory not found: ${CONFIG.backupDir}`);
    return null;
  }

  const backupDirs = fs.readdirSync(CONFIG.backupDir)
    .filter(name => name.startsWith('backup-'))
    .sort()
    .reverse();

  if (backupDirs.length === 0) {
    console.error('❌ No backup directories found');
    return null;
  }

  const latestBackupDir = backupDirs[0];
  const backupFile = path.join(CONFIG.backupDir, latestBackupDir, 'email-logs-plaintext-pins.json');

  if (!fs.existsSync(backupFile)) {
    console.error(`❌ Backup file not found: ${backupFile}`);
    return null;
  }

  return backupFile;
}

// GUID: SCRIPT_ROLLBACK_MASK_PINS-004-v01
// [Intent] Load backup data from JSON file.
// [Inbound Trigger] After finding backup file.
// [Downstream Impact] Returns array of documents to restore.
function loadBackup(backupPath: string): Array<{ id: string; data: any }> {
  console.log(`📂 Loading backup from: ${backupPath}`);

  const backupContent = fs.readFileSync(backupPath, 'utf8');
  const backup = JSON.parse(backupContent);

  console.log(`   Backup timestamp: ${backup.timestamp}`);
  console.log(`   Documents count: ${backup.documentsCount}`);

  return backup.documents;
}

// GUID: SCRIPT_ROLLBACK_MASK_PINS-005-v01
// [Intent] Prompt user for confirmation before executing rollback.
//          Requires explicit "YES" to proceed.
// [Inbound Trigger] Called before rollback in live mode.
// [Downstream Impact] Prevents accidental execution.
async function confirmRollback(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      '\n⚠️  WARNING: This will restore PLAINTEXT PINs to Firestore!\n' +
      '   Type "YES" to confirm rollback: ',
      (answer) => {
        rl.close();
        resolve(answer === 'YES');
      }
    );
  });
}

// GUID: SCRIPT_ROLLBACK_MASK_PINS-006-v01
// [Intent] Restore documents from backup to Firestore.
//          Removes migration metadata fields.
// [Inbound Trigger] After user confirmation.
// [Downstream Impact] Overwrites current documents with backup data.
async function rollbackDocuments(
  db: admin.firestore.Firestore,
  documents: Array<{ id: string; data: any }>
): Promise<{ restored: number; errors: number }> {
  if (CONFIG.dryRun) {
    console.log('🔬 DRY RUN MODE - No documents will be modified\n');

    const samples = documents.slice(0, 3);
    samples.forEach((doc, i) => {
      console.log(`Sample ${i + 1}:`);
      console.log(`   Document ID: ${doc.id}`);
      console.log(`   Will restore PIN: "${doc.data.pin}"`);
      console.log(`   Will remove: migrated, migratedAt, migratedBy`);
      console.log('');
    });

    if (documents.length > 3) {
      console.log(`... and ${documents.length - 3} more documents\n`);
    }

    return { restored: 0, errors: 0 };
  }

  console.log('🔄 Starting rollback (LIVE MODE)...\n');

  let restored = 0;
  let errors = 0;

  for (let i = 0; i < documents.length; i += CONFIG.batchSize) {
    const batch = db.batch();
    const batchDocs = documents.slice(i, i + CONFIG.batchSize);

    batchDocs.forEach((doc) => {
      const docRef = db.collection('email_logs').doc(doc.id);

      // Restore original PIN and remove migration metadata
      batch.update(docRef, {
        pin: doc.data.pin, // Restore plaintext PIN
        migrated: admin.firestore.FieldValue.delete(),
        migratedAt: admin.firestore.FieldValue.delete(),
        migratedBy: admin.firestore.FieldValue.delete(),
      });
    });

    try {
      await batch.commit();
      restored += batchDocs.length;
      console.log(`   ✅ Batch ${Math.floor(i / CONFIG.batchSize) + 1}: Restored ${batchDocs.length} documents`);
    } catch (err: any) {
      errors += batchDocs.length;
      console.log(`   ❌ Batch ${Math.floor(i / CONFIG.batchSize) + 1} FAILED: ${err.message}`);
    }
  }

  return { restored, errors };
}

// GUID: SCRIPT_ROLLBACK_MASK_PINS-007-v01
// [Intent] Main rollback orchestrator function.
// [Inbound Trigger] Script entry point.
// [Downstream Impact] Executes complete rollback workflow.
async function main(): Promise<void> {
  console.log('🔙 EMAIL-006 Phase 1B Rollback Script');
  console.log(`   Mode: ${CONFIG.dryRun ? 'DRY RUN' : '⚠️  LIVE'}`);
  console.log('');

  // Find backup
  const backupPath = findLatestBackup();
  if (!backupPath) {
    console.error('\n❌ Cannot proceed without backup file');
    process.exit(1);
  }

  // Load backup
  const documents = loadBackup(backupPath);

  if (documents.length === 0) {
    console.log('\n✅ No documents to rollback');
    return;
  }

  // Confirm rollback (only in live mode)
  if (!CONFIG.dryRun) {
    const confirmed = await confirmRollback();
    if (!confirmed) {
      console.log('\n❌ Rollback cancelled by user');
      return;
    }
  }

  // Initialize Firebase
  const db = initializeFirebase();
  console.log('✅ Firebase initialized\n');

  // Execute rollback
  const result = await rollbackDocuments(db, documents);

  // Report results
  console.log('\n' + '='.repeat(70));
  console.log('📊 ROLLBACK SUMMARY');
  console.log('='.repeat(70));

  if (CONFIG.dryRun) {
    console.log(`DRY RUN MODE - No changes made`);
    console.log(`Documents that WOULD be restored: ${documents.length}`);
    console.log('\nTo execute rollback:');
    console.log('1. Set CONFIG.dryRun = false in rollback-mask-pins.ts');
    console.log('2. Re-run this script');
    console.log('3. Type "YES" when prompted');
  } else {
    console.log(`Documents restored: ${result.restored}`);
    console.log(`Errors: ${result.errors}`);
    console.log(`Status: ${result.errors === 0 ? '✅ SUCCESS' : '⚠️  PARTIAL'}`);

    if (result.errors === 0) {
      console.log('\n⚠️  WARNING: Plaintext PINs are now back in email_logs!');
      console.log('   You should now:');
      console.log('   1. Investigate what went wrong with the migration');
      console.log('   2. Fix the issue');
      console.log('   3. Re-run the migration script');
    }
  }

  console.log('='.repeat(70) + '\n');
}

// Run rollback
main();
