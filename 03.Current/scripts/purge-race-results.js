// GUID: SCRIPT-DATA-004-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Data
// [Intent] Purge all documents from the race_results Firestore collection. Destructive — use with caution.
// [Usage] node scripts/purge-race-results.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Purge all race_results (admin-entered results)
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function purgeRaceResults() {
  console.log('\n🗑️  Purging race_results collection...\n');

  const snapshot = await db.collection('race_results').get();

  if (snapshot.empty) {
    console.log('✅ Collection is already empty.\n');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} documents to delete\n`);

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

  console.log(`\n✅ Successfully purged ${snapshot.size} race results from collection`);
  console.log(`\n📁 Backup available at: race_results_backup_*.json\n`);

  process.exit(0);
}

purgeRaceResults().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
