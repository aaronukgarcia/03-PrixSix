// GUID: SCRIPT-CHECK-002-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Query and display all documents in the race_results collection for manual review.
// [Usage] node scripts/check-race-results.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Check race_results collection before purging
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkRaceResults() {
  console.log('\n📋 Analyzing race_results collection...\n');

  const snapshot = await db.collection('race_results').get();

  console.log(`Total Documents: ${snapshot.size}\n`);

  if (snapshot.empty) {
    console.log('✅ Collection is already empty.\n');
    process.exit(0);
  }

  // Group by race
  const byRace = {};
  snapshot.forEach(doc => {
    const data = doc.data();
    const raceId = data.raceId || 'unknown';
    if (!byRace[raceId]) {
      byRace[raceId] = [];
    }
    byRace[raceId].push({
      id: doc.id,
      raceId: data.raceId,
      position: data.position,
      driverId: data.driverId,
      timestamp: data.timestamp?.toDate?.() || data.timestamp
    });
  });

  console.log('Results by Race:\n');
  Object.entries(byRace).forEach(([raceId, results]) => {
    console.log(`  ${raceId}: ${results.length} results`);
  });

  console.log('\n══════════════════════════════════════════════════════════\n');
  console.log(`⚠️  WARNING: About to delete ${snapshot.size} race results across ${Object.keys(byRace).length} races`);
  console.log('\n══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

checkRaceResults().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
