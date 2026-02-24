// GUID: SCRIPT-ANALYZE-005-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Analysis
// [Intent] Query a sample of score documents and print breakdown fields for manual inspection during investigation.
// [Usage] node scripts/examine-score-breakdown.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Examine a full score document to see what's denormalized
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function examineScoreBreakdown() {
  console.log('\n🔬 Examining Score Document Structure...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const snapshot = await db.collection('scores').limit(1).get();

  if (snapshot.empty) {
    console.log('❌ No scores found\n');
    process.exit(0);
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  console.log(`Document ID: ${doc.id}\n`);
  console.log('FULL DOCUMENT STRUCTURE:\n');
  console.log(JSON.stringify(data, null, 2));

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('ANALYSIS:\n');

  if (data.breakdown) {
    console.log('✓ Has breakdown field (likely contains denormalized actual results)');
  }
  if (data.totalPoints !== undefined) {
    console.log(`✓ Has totalPoints: ${data.totalPoints}`);
  }
  if (data.actualResults || data.results) {
    console.log('⚠️  DENORMALIZED RESULTS FOUND - Golden Rule #3 violation!');
  }

  console.log('\n');
  process.exit(0);
}

examineScoreBreakdown().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
