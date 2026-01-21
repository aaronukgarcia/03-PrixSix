/**
 * Check CC logs collection
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

const targetId = process.argv[2] || 'cc_1768999989052_z4po6k';

async function check() {
  console.log('Searching for:', targetId);
  console.log('='.repeat(60));

  // Try to find by correlationId field
  let found = await db.collection('CC-logs').where('correlationId', '==', targetId).get();

  if (found.empty) {
    // Try by document ID
    const doc = await db.collection('CC-logs').doc(targetId).get();
    if (doc.exists) {
      found = { docs: [doc], empty: false, size: 1 } as any;
    }
  }

  if (!found.empty) {
    console.log('\nFOUND CC LOG:');
    const data = found.docs[0].data();
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // List all CC logs
  console.log('\nNot found. Listing all CC-logs:');
  const allLogs = await db.collection('CC-logs').get();
  console.log('Total documents:', allLogs.size);

  allLogs.forEach(doc => {
    const data = doc.data();
    console.log('\n  Doc ID:', doc.id);
    console.log('  correlationId:', data.correlationId);
    console.log('  totalIssues:', data.totalIssues);
    console.log('  executedAt:', data.executedAt);
  });

  // Also check error_logs
  console.log('\n' + '='.repeat(60));
  console.log('Checking error_logs collection:');
  const errorLogs = await db.collection('error_logs').orderBy('timestamp', 'desc').limit(10).get();
  console.log('Recent error_logs:', errorLogs.size);

  errorLogs.forEach(doc => {
    const data = doc.data();
    if (data.correlationId?.includes('cc_')) {
      console.log('  ', doc.id, '-', data.correlationId);
    }
  });
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
