// GUID: SCRIPT-BOW-004-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] BOW
// [Intent] Query Firestore book_of_work for items currently in_progress status across all agents.
// [Usage] node scripts/query-bow-inprogress.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH = path.join('E:\GoogleDrive\Papers\03-PrixSix\03.Current', 'service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'studio-6033436327-281b1' });

const db = admin.firestore();

async function main() {
  const snap = await db.collection('book_of_work').where('status', '==', 'in_progress').get();
  snap.docs.forEach(doc => {
    const d = doc.data();
    console.log(`${doc.id} | ${d.checkedOutTo || 'unknown'} | ${d.guid || 'no-guid'} | ${d.title || 'no-title'}`);
  });
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
