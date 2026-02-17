/**
 * Fix Spanish Grand Prix II predictions
 * Change "Spanish-Grand-Prix-Ii" to "Spanish-Grand-Prix-II"
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function fixSpanishIIPredictions() {
  console.log('\n🔧 FIX SPANISH GRAND PRIX II PREDICTIONS');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE UPDATE'}\n`);

  // Query all predictions with incorrect raceId
  const predictionsSnapshot = await db.collectionGroup('predictions')
    .where('raceId', '==', 'Spanish-Grand-Prix-Ii')
    .get();

  console.log(`📊 Found ${predictionsSnapshot.size} predictions to fix\n`);

  if (predictionsSnapshot.size === 0) {
    console.log('✅ No predictions need fixing!\n');
    return;
  }

  const batch = db.batch();
  let count = 0;

  predictionsSnapshot.forEach(doc => {
    console.log(`  Fixing: ${doc.ref.path}`);
    if (!DRY_RUN) {
      batch.update(doc.ref, { raceId: 'Spanish-Grand-Prix-II' });
      count++;
    }
  });

  if (DRY_RUN) {
    console.log(`\n⚠️  DRY RUN - Would fix ${predictionsSnapshot.size} predictions`);
    console.log('   Run with --live to update.\n');
    return;
  }

  console.log('\n💾 Updating predictions...');
  await batch.commit();
  console.log(`✅ Fixed ${count} predictions!\n`);
}

fixSpanishIIPredictions()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
