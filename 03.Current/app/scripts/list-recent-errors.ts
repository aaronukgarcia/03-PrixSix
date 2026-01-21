import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function listRecentErrors() {
  const recent = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(10)
    .get();

  console.log(`Recent error logs (${recent.size}):`);

  if (recent.empty) {
    console.log('No error logs found in collection');
    return;
  }

  recent.docs.forEach((d, i) => {
    const data = d.data();
    console.log(`\n--- Error ${i + 1} ---`);
    console.log('correlationId:', data.correlationId);
    console.log('error:', data.error?.substring(0, 300));
    console.log('route:', data.context?.route);
    console.log('action:', data.context?.action);
    console.log('createdAt:', data.createdAt);
  });
}

listRecentErrors().catch(console.error);
