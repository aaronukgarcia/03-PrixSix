import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function query() {
  try {
    console.log('Querying error_logs...');
    const recent = await db.collection('error_logs')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();

    console.log(`Found ${recent.size} recent documents`);

    recent.forEach(doc => {
      const data = doc.data();
      console.log('===================================');
      console.log('Document ID:', doc.id);
      console.log('Full data:', JSON.stringify(data, null, 2));
    });
  } catch (e) {
    console.error('Error:', e);
  }
}

query().then(() => process.exit(0));
