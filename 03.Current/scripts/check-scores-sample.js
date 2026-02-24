// GUID: SCRIPT-CHECK-003-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Check
// [Intent] Sample and display a subset of score documents to verify field structure and point values after scoring.
// [Usage] node scripts/check-scores-sample.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkScoresSample() {
  console.log('\n🔍 Checking scores collection sample...\n');
  
  const snapshot = await db.collection('scores').limit(5).get();
  
  console.log(`Found ${snapshot.size} sample documents\n`);
  
  snapshot.forEach((doc, i) => {
    console.log(`Score #${i + 1} (${doc.id}):`);
    console.log(JSON.stringify(doc.data(), null, 2));
    console.log('');
  });
  
  // Check total count
  const countSnapshot = await db.collection('scores').count().get();
  console.log(`\nTotal scores in collection: ${countSnapshot.data().count}`);
  
  process.exit(0);
}

checkScoresSample().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
