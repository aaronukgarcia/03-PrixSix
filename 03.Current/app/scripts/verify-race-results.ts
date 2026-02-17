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

async function verify() {
  const snapshot = await db.collection('race_results').get();
  console.log(`\nProduction race_results: ${snapshot.size} documents\n`);

  if (snapshot.size > 0) {
    console.log('Sample documents:');
    snapshot.docs.slice(0, 5).forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: ${data.raceId}`);
    });
  }
}

verify().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
