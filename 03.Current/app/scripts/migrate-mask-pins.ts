// GUID: SCRIPT_MIGRATE_MASK_PINS-000-v01
// @SECURITY_FIX: EMAIL-006 Phase 1B - Retroactive PIN masking migration script.
// [Intent] Scan all email_logs documents for plaintext PINs and mask them retroactively.
//          Created as part of EMAIL-006 remediation (v1.55.28) to clean up historical data.
// [Inbound Trigger] Run manually via: npx ts-node --project tsconfig.scripts.json scripts/migrate-mask-pins.ts
// [Downstream Impact] Updates email_logs collection with masked PINs. Prevents credential exposure.
//                     Creates backup before modification for rollback capability.

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// GUID: SCRIPT_MIGRATE_MASK_PINS-001-v01
// [Intent] Configuration for the migration script with safety controls.
// [Inbound Trigger] Read at script start.
// [Downstream Impact] Controls dry-run mode, backup creation, and batch size.
const CONFIG = {
  dryRun: false, // Set to false to actually update documents
  createBackup: true, // Create JSON backup before modifying
  batchSize: 500, // Firestore batch write limit
  backupDir: path.join(__dirname, '../../email-logs-backup'),
  logFile: path.join(__dirname, '../../migration-logs/mask-pins-log.txt'),
};

// GUID: SCRIPT_MIGRATE_MASK_PINS-002-v01
// [Intent] Initialize Firebase Admin SDK with service account credentials.
// [Inbound Trigger] Called once at script start.
// [Downstream Impact] Establishes connection to Firestore. Required for all database operations.
function initializeFirebase(): admin.firestore.Firestore {
  const serviceAccountPath = path.join(__dirname, '../../service-account.json');

  if (!fs.existsSync(serviceAccountPath)) {
    console.error('❌ ERROR: service-account.json not found');
    console.error(`   Expected location: ${serviceAccountPath}`);
    process.exit(1);
  }

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
    });
  }

  return admin.firestore();
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-003-v01
// [Intent] Mask a PIN value using the same logic as maskPin() in utils.ts.
//          Returns fixed-length masking string to prevent length-based disclosure.
// [Inbound Trigger] Called for each PIN value that needs masking.
// [Downstream Impact] Replaces plaintext PINs with '••••••' for security.
function maskPin(pin: string | undefined): string {
  if (!pin) return '••••••';
  return '••••••';
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-004-v01
// [Intent] Determine if a PIN value is plaintext (needs masking) or already masked.
// [Inbound Trigger] Called for each email_logs document with a pin field.
// [Downstream Impact] Identifies documents that require migration.
function isPlaintextPin(pin: any): boolean {
  if (!pin || typeof pin !== 'string') return false;

  // Already masked if it's exactly 6 bullet characters
  if (pin === '••••••') return false;

  // Already masked if it contains bullet characters
  if (pin.includes('•')) return false;

  // Already masked if it's all asterisks
  if (/^\*+$/.test(pin)) return false;

  // Plaintext if it's numeric (6-digit PIN)
  if (/^\d{6}$/.test(pin)) return true;

  // Plaintext if it's any other non-masked value
  return pin.length > 0;
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-005-v01
// [Intent] Create timestamped backup directory and ensure log directory exists.
// [Inbound Trigger] Called before migration starts.
// [Downstream Impact] Creates directories for backup files and migration logs.
function prepareDirectories(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const backupPath = path.join(CONFIG.backupDir, `backup-${timestamp}`);

  if (CONFIG.createBackup && !fs.existsSync(backupPath)) {
    fs.mkdirSync(backupPath, { recursive: true });
    console.log(`📁 Created backup directory: ${backupPath}`);
  }

  const logDir = path.dirname(CONFIG.logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return backupPath;
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-006-v01
// [Intent] Log migration events to both console and file for audit trail.
// [Inbound Trigger] Called throughout migration process.
// [Downstream Impact] Creates detailed log file for post-migration review.
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  console.log(message);

  try {
    fs.appendFileSync(CONFIG.logFile, logMessage);
  } catch (err) {
    console.error('Warning: Could not write to log file:', err);
  }
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-007-v01
// [Intent] Scan email_logs collection and identify documents with plaintext PINs.
// [Inbound Trigger] Called after Firebase initialization.
// [Downstream Impact] Returns list of documents that need migration.
async function scanEmailLogs(db: admin.firestore.Firestore): Promise<{
  total: number;
  withPins: number;
  needsMigration: number;
  documents: Array<{ id: string; data: any }>;
}> {
  log('🔍 Scanning email_logs collection...');

  const snapshot = await db.collection('email_logs').get();
  const total = snapshot.size;

  const documentsNeedingMigration: Array<{ id: string; data: any }> = [];
  let withPins = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (data.pin !== undefined) {
      withPins++;

      if (isPlaintextPin(data.pin)) {
        documentsNeedingMigration.push({
          id: doc.id,
          data: {
            to: data.to,
            subject: data.subject,
            pin: data.pin,
            timestamp: data.timestamp,
            status: data.status,
          },
        });
      }
    }
  });

  log(`   Total documents: ${total}`);
  log(`   Documents with PIN field: ${withPins}`);
  log(`   Documents needing migration: ${documentsNeedingMigration.length}`);

  return {
    total,
    withPins,
    needsMigration: documentsNeedingMigration.length,
    documents: documentsNeedingMigration,
  };
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-008-v01
// [Intent] Create JSON backup of documents that will be modified.
// [Inbound Trigger] Called before migration if CONFIG.createBackup is true.
// [Downstream Impact] Saves original data for rollback if needed.
function createBackup(documents: Array<{ id: string; data: any }>, backupPath: string): void {
  if (!CONFIG.createBackup) {
    log('⚠️  Backup creation disabled in config');
    return;
  }

  const backupFile = path.join(backupPath, 'email-logs-plaintext-pins.json');
  const backupData = {
    timestamp: new Date().toISOString(),
    script: 'migrate-mask-pins.ts',
    documentsCount: documents.length,
    documents: documents,
  };

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
  log(`💾 Backup created: ${backupFile}`);
  log(`   Documents backed up: ${documents.length}`);
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-009-v01
// [Intent] Update documents in batches to mask plaintext PINs.
//          Uses Firestore batch writes for atomicity and performance.
// [Inbound Trigger] Called in dry-run or live mode after scanning.
// [Downstream Impact] Updates email_logs documents with masked PINs.
async function migrateDocuments(
  db: admin.firestore.Firestore,
  documents: Array<{ id: string; data: any }>
): Promise<{ updated: number; errors: number }> {
  if (CONFIG.dryRun) {
    log('🔬 DRY RUN MODE - No documents will be modified');

    // Show sample of what would be updated
    const samples = documents.slice(0, 5);
    samples.forEach((doc, i) => {
      log(`   Sample ${i + 1}:`);
      log(`      Document ID: ${doc.id}`);
      log(`      To: ${doc.data.to}`);
      log(`      Subject: ${doc.data.subject}`);
      log(`      Current PIN: "${doc.data.pin}"`);
      log(`      Masked PIN: "${maskPin(doc.data.pin)}"`);
    });

    if (documents.length > 5) {
      log(`   ... and ${documents.length - 5} more documents`);
    }

    return { updated: 0, errors: 0 };
  }

  log('🔄 Starting migration (LIVE MODE)...');

  let updated = 0;
  let errors = 0;

  // Process in batches of 500 (Firestore limit)
  for (let i = 0; i < documents.length; i += CONFIG.batchSize) {
    const batch = db.batch();
    const batchDocs = documents.slice(i, i + CONFIG.batchSize);

    batchDocs.forEach((doc) => {
      const docRef = db.collection('email_logs').doc(doc.id);
      batch.update(docRef, {
        pin: maskPin(doc.data.pin),
        migrated: true,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        migratedBy: 'migrate-mask-pins.ts',
      });
    });

    try {
      await batch.commit();
      updated += batchDocs.length;
      log(`   ✅ Batch ${Math.floor(i / CONFIG.batchSize) + 1}: Updated ${batchDocs.length} documents`);
    } catch (err: any) {
      errors += batchDocs.length;
      log(`   ❌ Batch ${Math.floor(i / CONFIG.batchSize) + 1} FAILED: ${err.message}`);
    }
  }

  return { updated, errors };
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-010-v01
// [Intent] Verify migration by re-scanning and checking for remaining plaintext PINs.
// [Inbound Trigger] Called after migration completes.
// [Downstream Impact] Confirms all PINs are masked, reports any failures.
async function verifyMigration(db: admin.firestore.Firestore): Promise<boolean> {
  log('\n🔎 Verifying migration...');

  const snapshot = await db.collection('email_logs').get();
  let remainingPlaintext = 0;
  const failures: string[] = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.pin && isPlaintextPin(data.pin)) {
      remainingPlaintext++;
      failures.push(doc.id);
    }
  });

  if (remainingPlaintext === 0) {
    log('   ✅ SUCCESS: All PINs are masked');
    return true;
  } else {
    log(`   ❌ FAILURE: ${remainingPlaintext} documents still have plaintext PINs`);
    log(`   Failed document IDs: ${failures.join(', ')}`);
    return false;
  }
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-011-v01
// [Intent] Generate migration summary report with statistics and next steps.
// [Inbound Trigger] Called at script completion.
// [Downstream Impact] Provides actionable summary for next phases.
function generateReport(stats: {
  total: number;
  withPins: number;
  needsMigration: number;
  updated: number;
  errors: number;
  verified: boolean;
}): void {
  log('\n' + '='.repeat(70));
  log('📊 MIGRATION SUMMARY REPORT');
  log('='.repeat(70));
  log(`Email Logs Total:           ${stats.total}`);
  log(`Documents with PIN field:   ${stats.withPins}`);
  log(`Documents needing masking:  ${stats.needsMigration}`);

  if (CONFIG.dryRun) {
    log(`\nDRY RUN MODE - No changes made`);
    log(`Documents that WOULD be updated: ${stats.needsMigration}`);
  } else {
    log(`\nDocuments updated:          ${stats.updated}`);
    log(`Errors:                     ${stats.errors}`);
    log(`Verification:               ${stats.verified ? '✅ PASSED' : '❌ FAILED'}`);
  }

  log('\n' + '='.repeat(70));
  log('📋 NEXT STEPS');
  log('='.repeat(70));

  if (CONFIG.dryRun) {
    log('1. Review the sample output above');
    log('2. Check the log file for full details');
    log('3. If satisfied, set CONFIG.dryRun = false');
    log('4. Re-run the script to perform actual migration');
  } else if (stats.verified) {
    log('✅ Phase 1B COMPLETE - All PINs masked successfully');
    log('\nProceed to Phase 1C:');
    log('1. Review backup files for exposed credentials');
    log('2. Identify any secrets that need rotation');
    log('3. Update Firebase API keys if needed');
    log('4. Rotate service account credentials');
    log('5. Document credential rotation in security audit log');
  } else {
    log('⚠️  Migration completed with errors');
    log('1. Review error logs above');
    log('2. Check failed document IDs');
    log('3. Manually verify/fix failures');
    log('4. Re-run verification');
  }

  log('\n' + '='.repeat(70));
  log(`Log file: ${CONFIG.logFile}`);
  if (CONFIG.createBackup) {
    log(`Backup directory: ${CONFIG.backupDir}`);
  }
  log('='.repeat(70) + '\n');
}

// GUID: SCRIPT_MIGRATE_MASK_PINS-012-v01
// [Intent] Main migration orchestrator function.
// [Inbound Trigger] Script entry point.
// [Downstream Impact] Executes complete migration workflow with safety checks.
async function main(): Promise<void> {
  log('🚀 EMAIL-006 Phase 1B Migration Script');
  log('   Script: migrate-mask-pins.ts');
  log(`   Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  log(`   Backup: ${CONFIG.createBackup ? 'ENABLED' : 'DISABLED'}`);
  log('');

  try {
    // Initialize Firebase
    const db = initializeFirebase();
    log('✅ Firebase initialized\n');

    // Prepare directories
    const backupPath = prepareDirectories();

    // Scan for documents needing migration
    const scanResults = await scanEmailLogs(db);

    if (scanResults.needsMigration === 0) {
      log('\n✅ No documents need migration - all PINs are already masked');
      log('   Phase 1B is already complete!\n');
      return;
    }

    // Create backup
    if (CONFIG.createBackup) {
      createBackup(scanResults.documents, backupPath);
    }

    // Migrate documents
    const migrationResults = await migrateDocuments(db, scanResults.documents);

    // Verify migration (only in live mode)
    let verified = false;
    if (!CONFIG.dryRun) {
      verified = await verifyMigration(db);
    }

    // Generate report
    generateReport({
      total: scanResults.total,
      withPins: scanResults.withPins,
      needsMigration: scanResults.needsMigration,
      updated: migrationResults.updated,
      errors: migrationResults.errors,
      verified,
    });

  } catch (error: any) {
    log(`\n❌ FATAL ERROR: ${error.message}`);
    log(`   Stack: ${error.stack}`);
    process.exit(1);
  }
}

// Run the migration
main();
