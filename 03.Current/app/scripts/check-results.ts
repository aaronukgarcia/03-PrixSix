import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkResults() {
  try {
    console.log('Querying race_results for Sprint races...\n');
    const results = await db.collection('race_results')
      .where('raceId', '>=', 'British')
      .where('raceId', '<=', 'Singapore')
      .get();

    console.log(`Found ${results.size} results\n`);

    results.forEach(doc => {
      const data = doc.data();
      if (data.raceId.includes('Sprint')) {
        console.log('---');
        console.log('Doc ID:', doc.id);
        console.log('Race ID:', data.raceId);
        console.log('Created:', data.createdAt?.toDate?.() || 'unknown');
      }
    });
  } catch (e) {
    console.error('Error:', e);
  }
}

checkResults().then(() => process.exit(0));
