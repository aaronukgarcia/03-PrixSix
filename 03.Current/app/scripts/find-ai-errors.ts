/**
 * Find AI-related errors in error_logs
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

async function findAIErrors() {
  console.log('Searching for AI errors...');

  const snap = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get();

  console.log('Total docs checked:', snap.size);

  let found = 0;
  snap.forEach(doc => {
    const data = doc.data();
    const route = data.context?.route || data.route || '';
    const errorCode = data.context?.additionalInfo?.errorCode || '';
    const action = data.context?.action || data.action || '';

    if (route.includes('ai') || errorCode === 'PX-3101' || route.includes('analysis') || action.includes('ai')) {
      found++;
      console.log('\n--- AI ERROR FOUND ---');
      console.log('correlationId:', data.correlationId);
      console.log('route:', route);
      console.log('errorCode:', errorCode);
      console.log('error:', typeof data.error === 'string' ? data.error.substring(0, 300) : JSON.stringify(data.error));
      console.log('timestamp:', data.timestamp?.toDate?.() || 'N/A');
    }
  });

  console.log('\nTotal AI errors found:', found);

  if (found === 0) {
    console.log('\nNo AI-related errors (PX-3101) in the last 50 error logs.');
    console.log('This means either:');
    console.log('1. The error logging failed silently (fixed in v1.20.25)');
    console.log('2. The error was generated client-side only');
    console.log('3. The correlation ID was not logged to Firestore');
  }
}

findAIErrors()
  .then(() => process.exit(0))
  .catch(e => { console.error('Script error:', e); process.exit(1); });
