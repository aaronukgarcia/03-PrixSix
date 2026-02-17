// GUID: SCRIPT_REDACT_PINS-000-v01
// @SECURITY_FIX: Migration script to redact plaintext PINs from email_logs collection (EMAIL-006).
// [Intent] One-time migration script to redact historical plaintext PINs stored in the email_logs
//          Firestore collection. Updates all documents with unmasked PIN values to use '••••••'.
//          Supports dry-run mode for safe testing before production execution.
// [Inbound Trigger] Run manually via: npx tsx scripts/redact-email-pins.ts [--execute]
// [Downstream Impact] Modifies email_logs collection. No impact on user accounts or authentication.
//                     After execution, admins can no longer harvest historical PINs from logs.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

// GUID: SCRIPT_REDACT_PINS-001-v01
// [Intent] Initialize Firebase Admin SDK if not already initialized.
//          Uses default credentials from GOOGLE_APPLICATION_CREDENTIALS env var.
// [Inbound Trigger] Called at script startup.
// [Downstream Impact] Required for Firestore access. Script fails if credentials missing.
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
const MASKED_PIN = '••••••';

// GUID: SCRIPT_REDACT_PINS-002-v01
// [Intent] Check if PIN value needs redaction (not already masked or 'N/A').
//          Returns true for plaintext numeric PINs or any non-masked string.
// [Inbound Trigger] Called for each email_logs document during scan.
// [Downstream Impact] Determines which documents get updated. False positives would skip
//                     documents that need redaction; false negatives would update already-safe values.
function needsRedaction(pin: string | undefined): boolean {
  if (!pin) return false;
  if (pin === MASKED_PIN) return false;
  if (pin === 'N/A') return false;
  return true; // All other values need masking
}

// GUID: SCRIPT_REDACT_PINS-003-v01
// [Intent] Generate unique correlation ID for this migration execution.
//          Uses cryptographically secure random bytes for uniqueness.
// [Inbound Trigger] Called once at script startup.
// [Downstream Impact] Used to tag all log entries and audit records for this migration run.
//                     Enables tracing all changes back to this specific execution.
function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `redact_pins_${timestamp}_${random}`;
}

// GUID: SCRIPT_REDACT_PINS-004-v01
// [Intent] Main migration function to redact PINs in email_logs collection.
//          Scans all documents, identifies unmasked PINs, and replaces with '••••••'.
//          Supports dry-run mode (default) and execute mode (--execute flag).
// [Inbound Trigger] Called from script entry point after parsing CLI arguments.
// [Downstream Impact] In dry-run mode: reports changes without modifying database.
//                     In execute mode: permanently modifies email_logs collection.
//                     Creates audit log entry in admin_configuration for traceability.
async function redactEmailPins(dryRun: boolean = true): Promise<void> {
  const correlationId = generateCorrelationId();
  const startTime = Date.now();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EMAIL PIN REDACTION MIGRATION (EMAIL-006)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode:           ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will modify database)'}`);
  console.log(`Correlation ID: ${correlationId}`);
  console.log(`Started:        ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Fetch all email_logs documents
    console.log('📥 Fetching email_logs collection...');
    const emailLogsSnapshot = await db.collection('email_logs').get();
    const totalDocs = emailLogsSnapshot.size;
    console.log(`   Found ${totalDocs} email log documents\n`);

    // Scan for documents needing redaction
    console.log('🔍 Scanning for unmasked PINs...');
    const docsToRedact: Array<{ id: string; currentPin: string }> = [];

    emailLogsSnapshot.forEach(doc => {
      const data = doc.data();
      if (needsRedaction(data.pin)) {
        docsToRedact.push({
          id: doc.id,
          currentPin: data.pin || '(undefined)'
        });
      }
    });

    console.log(`   Found ${docsToRedact.length} documents with unmasked PINs\n`);

    if (docsToRedact.length === 0) {
      console.log('✅ All email logs already have masked PINs. No changes needed.');
      return;
    }

    // Show sample of what will be changed
    console.log('📋 Sample of documents to be redacted:');
    const sampleSize = Math.min(5, docsToRedact.length);
    docsToRedact.slice(0, sampleSize).forEach((doc, idx) => {
      console.log(`   ${idx + 1}. Document ${doc.id}`);
      console.log(`      Current PIN: "${doc.currentPin}" → New PIN: "${MASKED_PIN}"`);
    });
    if (docsToRedact.length > sampleSize) {
      console.log(`   ... and ${docsToRedact.length - sampleSize} more\n`);
    } else {
      console.log('');
    }

    if (dryRun) {
      console.log('⚠️  DRY RUN MODE: No changes will be made to the database.');
      console.log(`   To execute this migration, run: npx tsx scripts/redact-email-pins.ts --execute\n`);
      return;
    }

    // Execute mode: Apply redactions
    console.log('⚡ EXECUTE MODE: Applying redactions...');
    const batch = db.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500; // Firestore batch limit
    let totalRedacted = 0;

    for (const doc of docsToRedact) {
      const docRef = db.collection('email_logs').doc(doc.id);
      batch.update(docRef, {
        pin: MASKED_PIN,
        redactedAt: FieldValue.serverTimestamp(),
        redactedBy: correlationId
      });

      batchCount++;
      totalRedacted++;

      // Commit batch when size limit reached
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log(`   ✓ Redacted ${totalRedacted}/${docsToRedact.length} documents...`);
        batchCount = 0;
      }
    }

    // Commit remaining batch
    if (batchCount > 0) {
      await batch.commit();
      console.log(`   ✓ Redacted ${totalRedacted}/${docsToRedact.length} documents...`);
    }

    // Create audit log entry
    console.log('\n📝 Creating audit log entry...');
    await db.collection('admin_configuration').doc('pin_redaction_audit').set({
      correlationId,
      executedAt: FieldValue.serverTimestamp(),
      totalDocsScanned: totalDocs,
      totalDocsRedacted: totalRedacted,
      dryRun: false,
      status: 'completed',
      version: '1.55.28',
      securityFix: 'EMAIL-006'
    });

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Documents scanned:  ${totalDocs}`);
    console.log(`Documents redacted: ${totalRedacted}`);
    console.log(`Elapsed time:       ${elapsedTime}s`);
    console.log(`Correlation ID:     ${correlationId}`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error: any) {
    console.error('\n❌ MIGRATION FAILED');
    console.error(`Correlation ID: ${correlationId}`);
    console.error(`Error: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);

    // Log failure to Firestore if possible
    try {
      await db.collection('admin_configuration').doc('pin_redaction_audit').set({
        correlationId,
        executedAt: FieldValue.serverTimestamp(),
        dryRun,
        status: 'failed',
        error: error.message,
        version: '1.55.28',
        securityFix: 'EMAIL-006'
      });
    } catch (logError) {
      console.error('Failed to log error to Firestore:', logError);
    }

    throw error;
  }
}

// GUID: SCRIPT_REDACT_PINS-005-v01
// [Intent] Script entry point. Parse CLI arguments and execute migration.
//          Default mode is dry-run for safety. Requires explicit --execute flag to modify database.
// [Inbound Trigger] Node.js script execution via: npx tsx scripts/redact-email-pins.ts
// [Downstream Impact] Entry point for migration. Determines dry-run vs execute mode based on CLI args.
const args = process.argv.slice(2);
const executeMode = args.includes('--execute');

redactEmailPins(!executeMode)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
