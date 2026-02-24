// GUID: SCRIPT-DATA-003-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Data
// [Intent] Targeted restore of R1 and R2 race results from backup — used after accidental deletion of early-season data.
// [Usage] node scripts/restore-r1-r2.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Restore only R1 and R2 races from backup
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function restoreR1R2() {
  console.log('\n📦 Restoring R1 and R2 races from backup...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Find the most recent backup file
  const files = fs.readdirSync(__dirname).filter(f => f.startsWith('race_results_backup_'));
  if (files.length === 0) {
    console.log('❌ No backup files found\n');
    process.exit(1);
  }

  const backupFile = files.sort().reverse()[0];
  console.log(`Using backup: ${backupFile}\n`);

  const backupData = JSON.parse(fs.readFileSync(path.join(__dirname, backupFile), 'utf8'));

  // Filter for R1 and R2 races
  const racesToRestore = backupData.documents.filter(item => {
    const id = item.id;
    return id === 'australian-grand-prix-gp' || // R1
           id === 'chinese-grand-prix-gp' ||     // R2 GP
           id === 'chinese-grand-prix-sprint';   // R2 Sprint
  });

  console.log(`Found ${racesToRestore.length} races to restore:\n`);
  racesToRestore.forEach(r => console.log(`  - ${r.id}`));
  console.log('');

  // Restore each race
  const batch = db.batch();
  racesToRestore.forEach(item => {
    const docRef = db.collection('race_results').doc(item.id);
    const data = { ...item.data };
    if (data.submittedAt && data.submittedAt._seconds) {
      data.submittedAt = admin.firestore.Timestamp.fromMillis(
        data.submittedAt._seconds * 1000 + data.submittedAt._nanoseconds / 1000000
      );
    }
    batch.set(docRef, data);
  });

  await batch.commit();

  console.log(`\n✅ Successfully restored ${racesToRestore.length} race results\n`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

restoreR1R2().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
