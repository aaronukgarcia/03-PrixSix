// GUID: SCRIPT-DATA-001-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Data
// [Intent] Backup race_results collection to a local JSON file before deletion or migration.
// [Usage] node scripts/backup-race-results.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Backup race_results before deletion
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function backupRaceResults() {
  console.log('\n💾 Backing up race_results collection...\n');

  const snapshot = await db.collection('race_results').get();

  if (snapshot.empty) {
    console.log('✅ Collection is empty - no backup needed.\n');
    process.exit(0);
  }

  const backup = {
    collection: 'race_results',
    timestamp: new Date().toISOString(),
    total_documents: snapshot.size,
    documents: []
  };

  snapshot.forEach(doc => {
    backup.documents.push({
      id: doc.id,
      data: doc.data()
    });
  });

  const backupPath = path.join(__dirname, `race_results_backup_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

  console.log(`✅ Backup complete: ${snapshot.size} documents saved`);
  console.log(`📁 Location: ${backupPath}\n`);

  process.exit(0);
}

backupRaceResults().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
