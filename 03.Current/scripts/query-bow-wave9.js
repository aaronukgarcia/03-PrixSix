const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
if (!admin.apps.length) {
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'studio-6033436327-281b1' });
}
const db = admin.firestore();
const keywords = ['FRONTEND-001', 'AUDIT-026', 'EMAIL-001', 'EMAIL-003', 'EMAIL-004', 'EMAIL-005',
  'AUDIT-021', 'AUDIT-015', 'EMAIL-002', 'EMAIL-006', 'AUDIT-REPORT', 'FRONTEND-COMPAT'];
async function run() {
  const snap = await db.collection('book_of_work').where('status', '==', 'tbd').get();
  snap.docs.forEach(d => {
    const g = (d.data().guid || '').toUpperCase();
    if (keywords.some(k => g.includes(k))) {
      console.log(d.id + ' | ' + d.data().guid);
    }
  });
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
