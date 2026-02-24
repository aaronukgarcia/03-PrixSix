// GUID: SCRIPT-CHECK-001-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Audit all raceId values stored in Firestore scores and race_results collections and report any format inconsistencies.
// [Usage] node scripts/check-race-id-format.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkRaceIdFormat() {
  console.log('\n🔍 Checking race ID formats...\n');
  
  // Get unique raceIds from scores
  const scoresSnapshot = await db.collection('scores').get();
  const scoreRaceIds = new Set();
  scoresSnapshot.forEach(doc => {
    const raceId = doc.data().raceId;
    scoreRaceIds.add(raceId);
  });
  
  console.log(`Scores collection race IDs (${scoreRaceIds.size} unique):`);
  Array.from(scoreRaceIds).sort().forEach(id => console.log(`  - ${id}`));
  
  // Get raceIds from race_results
  const resultsSnapshot = await db.collection('race_results').get();
  const resultRaceIds = new Set();
  resultsSnapshot.forEach(doc => {
    const raceId = doc.data().raceId;
    resultRaceIds.add(raceId);
  });
  
  console.log(`\nRace_results collection race IDs (${resultRaceIds.size} unique):`);
  Array.from(resultRaceIds).sort().forEach(id => console.log(`  - ${id}`));
  
  console.log(`\nFormat check:`);
  const sampleScoreId = Array.from(scoreRaceIds)[0];
  const sampleResultId = Array.from(resultRaceIds)[0];
  console.log(`  Score example: "${sampleScoreId}"`);
  console.log(`  Result example: "${sampleResultId}"`);
  console.log(`  Match: ${sampleScoreId === sampleResultId ? '✓' : '✗'}`);
  
  process.exit(0);
}

checkRaceIdFormat().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
