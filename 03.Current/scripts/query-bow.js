// GUID: SCRIPT-BOW-003-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] BOW
// [Intent] Query Firestore book_of_work collection and print all items. Used to verify Firestore/local JSON parity.
// [Usage] node scripts/query-bow.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const admin = require('firebase-admin');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH = 'E:/GoogleDrive/Papers/03-PrixSix/03.Current/service-account.json';
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'studio-6033436327-281b1' });
}
const db = admin.firestore();

async function main() {
  const snap = await db.collection('book_of_work')
    .where('status', '==', 'tbd')
    .get();
  
  // Sort by severity: critical > high > medium > low
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const docs = snap.docs.sort((a, b) => {
    const sA = severityOrder[a.data().severity] ?? 9;
    const sB = severityOrder[b.data().severity] ?? 9;
    return sA - sB;
  });
  
  docs.slice(0, 20).forEach(doc => {
    const d = doc.data();
    console.log(`${doc.id} | ${d.severity || 'unknown'} | ${d.guid || 'no-guid'} | ${d.file || 'no-file'} | ${d.title || 'no-title'}`);
  });
  console.log(`Total tbd: ${docs.length}`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
