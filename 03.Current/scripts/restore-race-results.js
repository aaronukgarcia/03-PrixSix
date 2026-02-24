// GUID: SCRIPT-DATA-002-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Data
// [Intent] Restore race_results collection from a local JSON backup file.
// [Usage] node scripts/restore-race-results.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Restore race_results from backup
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function restoreRaceResults() {
  console.log('\n📦 Restoring race_results from backup...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Find the most recent backup file
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('race_results_backup_'));
  if (files.length === 0) {
    console.log('❌ No backup files found\n');
    process.exit(1);
  }

  // Sort by filename (timestamp) and get most recent
  const backupFile = files.sort().reverse()[0];
  console.log(`Using backup: ${backupFile}\n`);

  const backupData = JSON.parse(fs.readFileSync(path.join(__dirname, backupFile), 'utf8'));
  console.log(`Backup contains ${backupData.total_documents} documents\n`);
  console.log(`Backup timestamp: ${backupData.timestamp}\n`);

  // Restore in batches (max 500 per batch)
  const batchSize = 500;
  let restored = 0;

  while (restored < backupData.documents.length) {
    const batch = db.batch();
    const docsToRestore = backupData.documents.slice(restored, restored + batchSize);

    docsToRestore.forEach(item => {
      const docRef = db.collection('race_results').doc(item.id);
      // Convert Firestore timestamp format back
      const data = { ...item.data };
      if (data.submittedAt && data.submittedAt._seconds) {
        data.submittedAt = admin.firestore.Timestamp.fromMillis(
          data.submittedAt._seconds * 1000 + data.submittedAt._nanoseconds / 1000000
        );
      }
      batch.set(docRef, data);
    });

    await batch.commit();
    restored += docsToRestore.length;

    console.log(`  Restored ${restored}/${backupData.documents.length} documents...`);
  }

  console.log(`\n✅ Successfully restored ${restored} race results to collection\n`);
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Golden Rule #3: Standings will now display from race_results (single source of truth)\n');

  process.exit(0);
}

restoreRaceResults().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
