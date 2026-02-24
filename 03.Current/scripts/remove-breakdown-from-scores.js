// GUID: SCRIPT-DATA-006-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Data
// [Intent] One-time migration: removes the legacy breakdown field from all score documents in Firestore (Golden Rule #3 compliance).
// [Usage] node scripts/remove-breakdown-from-scores.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
// Remove breakdown field from all score documents
// Golden Rule #3: breakdown is denormalized data - should be calculated in real-time from race_results
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, 'scripts', 'service-account.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function removeBreakdownField() {
  console.log('\n🧹 Removing breakdown field from scores collection...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const snapshot = await db.collection('scores').get();

  if (snapshot.empty) {
    console.log('✅ Collection is empty. Nothing to do.\n');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} score documents\n`);

  // Process in batches (max 500 per batch)
  const batchSize = 500;
  let processed = 0;
  let updated = 0;

  while (processed < snapshot.size) {
    const batch = db.batch();
    const docsToProcess = snapshot.docs.slice(processed, processed + batchSize);

    docsToProcess.forEach(doc => {
      const data = doc.data();
      // Only update if breakdown field exists
      if (data.breakdown !== undefined) {
        batch.update(doc.ref, {
          breakdown: FieldValue.delete()
        });
        updated++;
      }
    });

    await batch.commit();
    processed += docsToProcess.length;

    console.log(`  Processed ${processed}/${snapshot.size} documents (${updated} updated)...`);
  }

  console.log(`\n✅ Successfully removed breakdown field from ${updated} score documents`);
  console.log(`   ${snapshot.size - updated} documents had no breakdown field\n`);
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Golden Rule #3: Breakdowns are now calculated in real-time from race_results\n');

  process.exit(0);
}

removeBreakdownField().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
