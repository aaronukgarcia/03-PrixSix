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

async function check() {
  const rr = await db.collection('race_results').count().get();
  const sc = await db.collection('scores').count().get();
  const pr = await db.collection('predictions').count().get();

  console.log('\n📊 Current Database State:');
  console.log(`  race_results: ${rr.data().count} documents`);
  console.log(`  scores: ${sc.data().count} documents`);
  console.log(`  predictions: ${pr.data().count} documents\n`);

  if (sc.data().count === 0) {
    console.log('⚠️  ISSUE: Standings page requires scores to display data.');
    console.log('   You have race_results but no scores.\n');
    console.log('💡 OPTIONS:');
    console.log('   1. Restore scores from backup (also in cleanroom)');
    console.log('   2. Recalculate scores from race_results + predictions\n');
  }
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
