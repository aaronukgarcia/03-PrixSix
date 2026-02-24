// GUID: SCRIPT-CHECK-005-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Query the error_logs collection and print the most recent errors for live debugging.
// [Usage] node scripts/check-errors-now.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Quick script to check current error logs
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkErrors() {
  console.log('📋 Fetching recent errors from error_logs collection...\n');

  // Get errors from last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const snapshot = await db.collection('error_logs')
    .where('timestamp', '>=', sevenDaysAgo)
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  if (snapshot.empty) {
    console.log('✅ No errors in the last 7 days!\n');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} errors in the last 7 days\n`);

  // Group by error code
  const errorsByCode = {};
  const errorsByFile = {};

  snapshot.forEach(doc => {
    const data = doc.data();
    const code = data.code || 'UNKNOWN';
    const file = data.file || 'unknown';
    const guid = data.guid || 'unknown';

    if (!errorsByCode[code]) {
      errorsByCode[code] = {
        count: 0,
        examples: [],
        files: new Set(),
        guids: new Set()
      };
    }

    errorsByCode[code].count++;
    errorsByCode[code].files.add(file);
    errorsByCode[code].guids.add(guid);

    if (errorsByCode[code].examples.length < 3) {
      errorsByCode[code].examples.push({
        message: data.message,
        timestamp: data.timestamp?.toDate?.() || data.timestamp,
        correlationId: data.correlationId,
        context: data.context
      });
    }

    if (!errorsByFile[file]) {
      errorsByFile[file] = 0;
    }
    errorsByFile[file]++;
  });

  // Print summary by error code
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ERROR SUMMARY BY CODE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const sorted = Object.entries(errorsByCode).sort((a, b) => b[1].count - a[1].count);

  sorted.forEach(([code, info]) => {
    console.log(`\n🔴 ${code} (${info.count} occurrences)`);
    console.log(`   Files: ${Array.from(info.files).join(', ')}`);
    console.log(`   GUIDs: ${Array.from(info.guids).join(', ')}`);
    console.log(`   Recent examples:`);
    info.examples.forEach((ex, i) => {
      console.log(`     ${i + 1}. ${ex.message}`);
      console.log(`        Time: ${ex.timestamp}`);
      console.log(`        Correlation: ${ex.correlationId}`);
      if (ex.context && Object.keys(ex.context).length > 0) {
        console.log(`        Context: ${JSON.stringify(ex.context)}`);
      }
    });
  });

  // Print summary by file
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('ERROR SUMMARY BY FILE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const filesSorted = Object.entries(errorsByFile).sort((a, b) => b[1] - a[1]);
  filesSorted.forEach(([file, count]) => {
    console.log(`   ${count.toString().padStart(3)} errors - ${file}`);
  });

  console.log('\n✅ Analysis complete\n');
  process.exit(0);
}

checkErrors().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
