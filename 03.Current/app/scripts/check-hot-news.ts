import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (!getApps().length) {
  initializeApp({ credential: cert(path.resolve(__dirname, '../../service-account.json')) });
}
const db = getFirestore();

(async () => {
  const doc = await db.collection('app-settings').doc('hot-news').get();
  const data = doc.data();
  console.log('Current Hot News Settings:');
  console.log('- Content preview:', data?.content?.substring(0, 100) + '...');
  console.log('- lastUpdated:', data?.lastUpdated?.toDate?.() || data?.lastUpdated || 'NOT SET');
  console.log('- hotNewsFeedEnabled:', data?.hotNewsFeedEnabled);
})();
