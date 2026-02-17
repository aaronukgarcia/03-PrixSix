/**
 * Check what collections exist in the backup
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));

// Create cleanroom app to check backup
const cleanroomApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'studio-6033436327-281b1'
}, 'cleanroom-check');

const cleanroomDb = cleanroomApp.firestore();
cleanroomDb.settings({ databaseId: 'cleanroom-restore-2' });

async function checkBackup() {
  try {
    console.log('\n📊 Checking collections in backup (cleanroom database):\n');

    const collections = ['race_results', 'scores', 'predictions', 'users', 'leagues'];

    for (const coll of collections) {
      try {
        const count = await cleanroomDb.collection(coll).count().get();
        console.log(`  ${coll.padEnd(20)} ${count.data().count} documents`);
      } catch (err: any) {
        console.log(`  ${coll.padEnd(20)} ERROR: ${err.message}`);
      }
    }

    // Check for predictions in user subcollections
    console.log('\n  Checking user predictions subcollections...');
    const usersSnapshot = await cleanroomDb.collection('users').limit(5).get();
    let totalPredictions = 0;

    for (const userDoc of usersSnapshot.docs) {
      const predsCount = await cleanroomDb
        .collection('users')
        .doc(userDoc.id)
        .collection('predictions')
        .count()
        .get();

      totalPredictions += predsCount.data().count;
      if (predsCount.data().count > 0) {
        console.log(`    ${userDoc.id}: ${predsCount.data().count} predictions`);
      }
    }

    console.log(`\n  Total predictions in first 5 users: ${totalPredictions}\n`);

  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await cleanroomApp.delete();
  }
}

checkBackup().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
