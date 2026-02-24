const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
if (!admin.apps.length) {
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'studio-6033436327-281b1' });
}
const db = admin.firestore();
const ids = process.argv.slice(2);
async function run() {
  for (const id of ids) {
    const doc = await db.collection('book_of_work').doc(id).get();
    if (doc.exists) {
      const d = doc.data();
      console.log(`\n=== ${id} ===`);
      console.log(JSON.stringify(d, null, 2));
    }
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
