// GUID: SCRIPT-CODEJSON-004-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] CodeJson
// [Intent] Remove stale consistency-report checkpoint files left by previous GUID audit runs.
// [Usage] node scripts/cleanup-consistency-reports.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Remove consistency check reports from error_logs collection
// These were incorrectly written to error_logs instead of consistency_reports
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function cleanupConsistencyReports() {
  console.log('\n🔍 Finding consistency check reports in error_logs collection...\n');

  const snapshot = await db.collection('error_logs')
    .where('type', '==', 'consistency_check')
    .get();

  if (snapshot.empty) {
    console.log('✅ No consistency check reports found in error_logs collection.\n');
    process.exit(0);
  }

  console.log(`📋 Found ${snapshot.size} consistency check reports to remove:\n`);

  const batch = db.batch();
  let count = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    console.log(`  - ${doc.id} (correlationId: ${data.correlationId}, ${data.summary?.totalChecks || '?'} checks)`);
    batch.delete(doc.ref);
    count++;
  });

  console.log(`\n🗑️  Deleting ${count} consistency check reports from error_logs...\n`);

  await batch.commit();

  console.log(`✅ Successfully removed ${count} consistency check reports from error_logs collection.`);
  console.log(`\nℹ️  Future consistency reports will be saved to the 'consistency_reports' collection.\n`);

  process.exit(0);
}

cleanupConsistencyReports().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
