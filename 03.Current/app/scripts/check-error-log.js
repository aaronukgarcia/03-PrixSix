// firebase-admin 14: legacy namespace removed — use modular entry points.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('../../service-account.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function checkErrorLog() {
  const correlationId = process.argv[2];

  if (!correlationId) {
    console.log('Usage: node check-error-log.js <correlationId>');
    process.exit(1);
  }

  console.log(`Searching for error log with correlation ID: ${correlationId}\n`);

  const snapshot = await db.collection('error_logs')
    .where('correlationId', '==', correlationId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.log('No error log found with that correlation ID');
    return;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  console.log('ERROR LOG FOUND:');
  console.log('================\n');
  console.log(JSON.stringify(data, null, 2));
}

checkErrorLog().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
