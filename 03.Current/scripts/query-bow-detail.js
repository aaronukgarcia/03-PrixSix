const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
if (!admin.apps.length) {
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'studio-6033436327-281b1' });
}
const db = admin.firestore();
const targetIds = process.argv.slice(2);
async function run() {
  for (const id of targetIds) {
    const doc = await db.collection('book_of_work').doc(id).get();
    if (doc.exists) {
      const d = doc.data();
      console.log(`\n=== ${id} ===`);
      console.log('GUID:', d.guid);
      console.log('Status:', d.status);
      console.log('Title:', d.title || d.summary || '(no title)');
      console.log('Description:', d.description || d.details || '(no description)');
      console.log('Severity:', d.severity || '(none)');
    }
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
