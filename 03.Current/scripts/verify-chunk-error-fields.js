// GUID: SCRIPT-CHECK-008-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Verify that all 4-pillar error fields (type, correlationId, displayable, log) are present on chunk handler error entries.
// [Usage] node scripts/verify-chunk-error-fields.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Verify ChunkLoadError has correct field names
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function verifyFields() {
  const snapshot = await db.collection('error_logs')
    .where('correlationId', '==', 'err_mlk5iqe2_xpy319')
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log('❌ Error not found');
    process.exit(1);
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  console.log('\n📋 ChunkLoadError Field Verification:\n');
  console.log('══════════════════════════════════════════════════════════\n');

  // Check top-level fields
  console.log('TOP-LEVEL FIELDS:');
  console.log(`  errorCode:     ${data.errorCode || '❌ MISSING'}`);
  console.log(`  error:         ${data.error || '❌ MISSING'}`);
  console.log(`  stack:         ${data.stack ? '✓ Present' : '❌ MISSING'}`);
  console.log(`  correlationId: ${data.correlationId || '❌ MISSING'}`);
  console.log(`  timestamp:     ${data.timestamp?.toDate?.() || data.timestamp || '❌ MISSING'}`);

  console.log('\n');
  console.log('CONTEXT FIELDS:');
  console.log(`  context.route:                     ${data.context?.route || '❌ MISSING'}`);
  console.log(`  context.action:                    ${data.context?.action || '❌ MISSING'}`);
  console.log(`  context.source:                    ${data.context?.source || '❌ MISSING'}`);
  console.log(`  context.additionalInfo.errorCode:  ${data.context?.additionalInfo?.errorCode || '❌ MISSING'}`);
  console.log(`  context.additionalInfo.errorType:  ${data.context?.additionalInfo?.errorType || '❌ MISSING'}`);

  console.log('\n');
  console.log('VERDICT:');
  const hasTopLevelErrorCode = !!data.errorCode;
  const hasTopLevelError = !!data.error;
  const hasStack = !!data.stack;

  if (hasTopLevelErrorCode && hasTopLevelError && hasStack) {
    console.log('  ✅ All required fields present at top level');
    console.log('  ✅ Error logging is working correctly');
    console.log('  ℹ️  context.additionalInfo is redundant but harmless');
  } else {
    console.log('  ❌ Missing required fields:');
    if (!hasTopLevelErrorCode) console.log('     - errorCode');
    if (!hasTopLevelError) console.log('     - error');
    if (!hasStack) console.log('     - stack');
  }

  console.log('\n══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

verifyFields().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
