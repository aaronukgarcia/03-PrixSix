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

async function checkPredictions() {
  console.log('\n🔍 Checking for predictions...\n');

  // Check via collectionGroup
  const predsSnapshot = await db.collectionGroup('predictions').limit(10).get();
  console.log(`CollectionGroup query: ${predsSnapshot.size} predictions found\n`);

  if (predsSnapshot.size > 0) {
    console.log('Sample predictions:');
    predsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.ref.path}`);
      console.log(`    raceId: ${data.raceId}`);
      console.log(`    teamName: ${data.teamName}`);
    });
  } else {
    console.log('⚠️  No predictions found in production database.');
    console.log('   Predictions are required to calculate scores.\n');
    console.log('💡 You need to either:');
    console.log('   1. Restore predictions from backup');
    console.log('   2. Have users submit new predictions\n');
  }
}

checkPredictions().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
