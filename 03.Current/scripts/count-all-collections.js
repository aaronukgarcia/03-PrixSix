// GUID: SCRIPT-ANALYZE-004-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Analysis
// [Intent] Connect to Firestore via Admin SDK and output document counts for every top-level collection.
// [Usage] node scripts/count-all-collections.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Count documents in all relevant collections
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function countCollections() {
  console.log('\n📊 Document Counts Across Collections:\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const collections = [
    'race_results',    // Source of truth for actual race results
    'scores',          // Calculated scores per user per race
    'predictions',     // User predictions (input data)
    'standings',       // Global standings (if exists)
    'users'            // User accounts
  ];

  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).count().get();
    const count = snapshot.data().count;
    console.log(`  ${collectionName.padEnd(20)} ${count.toString().padStart(6)} documents`);
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('DATA FLOW ARCHITECTURE:\n');
  console.log('  1. race_results   (SOURCE OF TRUTH) → Admin enters actual results\n');
  console.log('  2. predictions    (USER INPUT)      → Users make predictions\n');
  console.log('  3. scores         (CALCULATED)      → Compare predictions vs results\n');
  console.log('  4. standings      (AGGREGATED)      → Sum scores per user\n');
  console.log('\n═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

countCollections().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
