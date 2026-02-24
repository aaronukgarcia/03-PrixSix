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
  const snap = await db.collection('book_of_work')
    .where('status', 'in', ['tbd', 'in_progress'])
    .orderBy('updatedAt', 'desc')
    .get();
  console.log(`Open items: ${snap.size}`);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(`${d.id.substring(0,10)} | ${(data.guid||'').padEnd(22)} | ${data.status} | ${(data.title||'').substring(0,60)}`);
  });
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
