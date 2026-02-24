// GUID: SCRIPT-ANALYZE-006-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Analysis
// [Intent] Trace the origin of standings data through Firestore collections to verify Single Source of Truth compliance.
// [Usage] node scripts/investigate-standings-source.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Investigate where standings data comes from
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function investigateStandingsSource() {
  console.log('\n🔍 Investigating Standings Data Sources...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check all potentially related collections
  const collections = [
    'race_results',
    'scores',
    'standings',
    'predictions',
    'users'
  ];

  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).limit(5).get();
    console.log(`📦 ${collectionName}:`);
    console.log(`   Total documents: ${snapshot.size > 0 ? 'Multiple' : '0'}`);

    if (snapshot.size > 0) {
      const firstDoc = snapshot.docs[0];
      const data = firstDoc.data();
      console.log(`   Sample fields: ${Object.keys(data).join(', ')}`);

      // Check if it has race results embedded
      if (data.results || data.raceResults || data.positions) {
        console.log(`   ⚠️  Contains embedded results data!`);
      }
      if (data.points || data.totalPoints || data.score) {
        console.log(`   📊 Contains scoring data`);
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════\n');

  // Check for scores collection in detail
  const scoresSnapshot = await db.collection('scores').limit(3).get();
  if (scoresSnapshot.size > 0) {
    console.log('📊 SCORES COLLECTION SAMPLE:\n');
    scoresSnapshot.forEach((doc, i) => {
      console.log(`Score #${i + 1} (${doc.id}):`);
      const data = doc.data();
      console.log(JSON.stringify({
        userId: data.userId,
        raceId: data.raceId,
        score: data.score,
        hasResults: !!data.results || !!data.actualResults,
        fields: Object.keys(data)
      }, null, 2));
      console.log('');
    });
  }

  process.exit(0);
}

investigateStandingsSource().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
