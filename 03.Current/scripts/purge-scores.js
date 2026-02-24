// GUID: SCRIPT-DATA-005-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Data
// [Intent] Purge all documents from the scores Firestore collection. Derivative data per Golden Rule #3 — safe to rebuild.
// [Usage] node scripts/purge-scores.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Purge all scores (derivative data from race_results)
// Golden Rule #3: When source of truth is deleted, derived data must also be deleted
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function purgeScores() {
  console.log('\n🗑️  Purging scores collection (derived from race_results)...\n');

  const snapshot = await db.collection('scores').get();

  if (snapshot.empty) {
    console.log('✅ Collection is already empty.\n');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} score documents to delete\n`);

  // Delete in batches (max 500 per batch)
  const batchSize = 500;
  let deleted = 0;

  while (deleted < snapshot.size) {
    const batch = db.batch();
    const docsToDelete = snapshot.docs.slice(deleted, deleted + batchSize);

    docsToDelete.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    deleted += docsToDelete.length;

    console.log(`  Deleted ${deleted}/${snapshot.size} documents...`);
  }

  console.log(`\n✅ Successfully purged ${snapshot.size} scores from collection`);
  console.log(`\n📊 Golden Rule #3: Scores are derived from race_results (single source of truth)\n`);

  process.exit(0);
}

purgeScores().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
