const admin = require('firebase-admin');
const serviceAccount = require('../../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkRecentErrors() {
  console.log('Fetching recent error logs...\n');

  const snapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(10)
    .get();

  if (snapshot.empty) {
    console.log('No error logs found');
    return;
  }

  snapshot.docs.forEach((doc, index) => {
    const data = doc.data();
    const timestamp = data.timestamp?.toDate?.() || data.createdAt || 'unknown';
    console.log(`\n[${index + 1}] ${timestamp}`);
    console.log(`Code: ${data.errorCode || 'N/A'}`);
    console.log(`Error: ${data.error || data.message || 'N/A'}`);
    console.log(`Source: ${data.context?.source || 'unknown'}`);
    console.log(`Component: ${data.context?.component || data.context?.module || 'N/A'}`);
    console.log(`Correlation: ${data.correlationId || 'N/A'}`);

    if (data.errorCode?.includes('EMAIL') || data.error?.toLowerCase?.().includes('email')) {
      console.log('** EMAIL-RELATED ERROR **');
      console.log('Full details:', JSON.stringify(data, null, 2));
    }
  });
}

checkRecentErrors().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
