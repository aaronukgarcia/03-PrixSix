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
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Look for recently modified (last 2hr)
  const twoHrsAgo = Date.now() - 7200000;
  const recent = docs.filter(d => {
    const ts = d.updatedAt;
    if (!ts) return false;
    const millis = typeof ts.toMillis === 'function' ? ts.toMillis() : (ts._seconds ? ts._seconds * 1000 : 0);
    return millis > twoHrsAgo;
  });

  console.log(`Total tbd items: ${docs.length}`);
  console.log(`\n=== Recently modified tbd (last 2hr: ${recent.length}) ===`);
  recent.forEach(d => {
    const ts = d.updatedAt;
    const isoTime = typeof ts?.toDate === 'function' ? ts.toDate().toISOString() : '?';
    const noteFields = ['reopenNotes', 'reopen_notes', 'failReason', 'fail_reason', 'agentNotes', 'notes'];
    let note = '';
    for (const f of noteFields) {
      if (d[f] && typeof d[f] === 'string') { note = d[f].substring(0, 80); break; }
    }
    console.log(`${d.id} | ${d.guid} | ${isoTime} | ${note}`);
  });

  // Also look at all fields for any "reopen" keyword
  console.log(`\n=== Scanning ALL tbd for 'reopen' keyword ===`);
  docs.forEach(d => {
    const allText = JSON.stringify(d).toLowerCase();
    if (allText.includes('reopen') || allText.includes('re-open')) {
      console.log(d.id, '|', d.guid, '|', d.status);
    }
  });

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
