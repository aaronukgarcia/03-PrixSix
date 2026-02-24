const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
if (!admin.apps.length) {
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'studio-6033436327-281b1' });
}
const db = admin.firestore();
async function run() {
  const snap = await db.collection('book_of_work').where('status', '==', 'tbd').get();
  const docs = snap.docs.map(d => ({
    id: d.id,
    guid: d.data().guid || '?',
    title: d.data().title || d.data().summary || '',
    severity: d.data().severity || '',
  }));
  // Sort by ID
  docs.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`Total tbd items: ${docs.length}`);
  docs.slice(0, 40).forEach(d => {
    console.log(`${d.id} | ${d.guid} | ${d.severity} | ${d.title.substring(0, 60)}`);
  });
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
