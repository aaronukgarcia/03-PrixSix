// GUID: SCRIPT-CHECK-004-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Re-run error checks after a fix deployment to confirm previously logged errors are resolved.
// [Usage] node scripts/check-errors-fixed.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Check errors with CORRECT field names
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkErrors() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const snapshot = await db.collection('error_logs')
    .where('timestamp', '>=', sevenDaysAgo)
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  console.log(`\n📋 Found ${snapshot.size} errors (using correct field names)\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const errorsByCode = {};

  snapshot.forEach((doc, index) => {
    const data = doc.data();

    // Use ACTUAL field names from API
    const errorCode = data.errorCode || 'UNKNOWN';
    const errorMsg = data.error || 'No message';
    const stack = data.stack || '';
    const guid = data.guid || null;
    const file = data.file || null;
    const module = data.module || null;

    if (!errorsByCode[errorCode]) {
      errorsByCode[errorCode] = {
        count: 0,
        examples: [],
        hasMetadata: !!guid
      };
    }

    errorsByCode[errorCode].count++;

    if (errorsByCode[errorCode].examples.length < 3) {
      errorsByCode[errorCode].examples.push({
        message: errorMsg,
        timestamp: data.timestamp?.toDate?.() || data.timestamp,
        correlationId: data.correlationId,
        guid,
        file,
        module,
        stack: stack.split('\n')[0], // First line only
        context: data.context
      });
    }
  });

  // Print summary
  const sorted = Object.entries(errorsByCode).sort((a, b) => b[1].count - a[1].count);

  sorted.forEach(([code, info]) => {
    console.log(`\n🔴 ${code} (${info.count} occurrences) ${info.hasMetadata ? '✓ Has metadata' : '❌ Missing metadata'}`);

    info.examples.forEach((ex, i) => {
      console.log(`\n  Example ${i + 1}:`);
      console.log(`    Message:       ${ex.message}`);
      console.log(`    Time:          ${ex.timestamp}`);
      console.log(`    Correlation:   ${ex.correlationId}`);
      if (ex.guid) {
        console.log(`    GUID:          ${ex.guid}`);
        console.log(`    File:          ${ex.file}`);
        console.log(`    Module:        ${ex.module}`);
      }
      if (ex.stack) {
        console.log(`    Stack:         ${ex.stack}`);
      }
      if (ex.context?.route) {
        console.log(`    Route:         ${ex.context.route}`);
      }
    });
  });

  console.log('\n\n✅ Analysis complete\n');
  process.exit(0);
}

checkErrors().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
