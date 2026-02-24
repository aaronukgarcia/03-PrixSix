// GUID: SCRIPT-CHECK-007-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Dump raw error_logs documents to stdout without filtering — used to inspect unparseable or malformed error entries.
// [Usage] node scripts/dump-raw-errors.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Dump RAW error document data to see exactly what fields exist
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function dumpRawErrors() {
  const snapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(3)
    .get();

  console.log(`\n📋 RAW Firestore documents (${snapshot.size} errors):\n`);

  snapshot.forEach((doc, index) => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Document ID: ${doc.id}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  console.log('\n\n✅ Raw dump complete\n');
  process.exit(0);
}

dumpRawErrors().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
