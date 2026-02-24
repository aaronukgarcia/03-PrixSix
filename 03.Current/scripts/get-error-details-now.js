// GUID: SCRIPT-CHECK-006-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Fetch and display full detail for a specific error document from error_logs by correlation ID.
// [Usage] node scripts/get-error-details-now.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Get full details of recent errors
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function getErrorDetails() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const snapshot = await db.collection('error_logs')
    .where('timestamp', '>=', sevenDaysAgo)
    .orderBy('timestamp', 'desc')
    .limit(11)
    .get();

  console.log(`\n📋 Full details of ${snapshot.size} recent errors:\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  snapshot.forEach((doc, index) => {
    const data = doc.data();
    console.log(`ERROR #${index + 1} (${doc.id})`);
    console.log(`─────────────────────────────────────────────────────────`);
    console.log(`Code:          ${data.code || 'MISSING'}`);
    console.log(`Message:       ${data.message || 'MISSING'}`);
    console.log(`Timestamp:     ${data.timestamp?.toDate?.() || data.timestamp}`);
    console.log(`Correlation:   ${data.correlationId || 'MISSING'}`);
    console.log(`GUID:          ${data.guid || 'MISSING'}`);
    console.log(`File:          ${data.file || 'MISSING'}`);
    console.log(`Function:      ${data.functionName || 'MISSING'}`);
    console.log(`Module:        ${data.module || 'MISSING'}`);
    console.log(`Severity:      ${data.severity || 'MISSING'}`);

    if (data.context && Object.keys(data.context).length > 0) {
      console.log(`Context:       ${JSON.stringify(data.context, null, 2)}`);
    }

    if (data.stack) {
      console.log(`Stack trace:`);
      const stackLines = data.stack.split('\n').slice(0, 10);
      stackLines.forEach(line => console.log(`  ${line}`));
      if (data.stack.split('\n').length > 10) {
        console.log(`  ... (${data.stack.split('\n').length - 10} more lines)`);
      }
    }

    console.log('');
  });

  process.exit(0);
}

getErrorDetails().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
