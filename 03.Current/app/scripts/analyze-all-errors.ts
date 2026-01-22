import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

interface ErrorLog {
  id: string;
  correlationId: string;
  error: string;
  errorCode?: string;
  context?: {
    route?: string;
    action?: string;
    userId?: string;
    additionalInfo?: any;
  };
  createdAt: string;
  timestamp: any;
}

async function analyzeAllErrors() {
  const snapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  console.log(`\n========================================`);
  console.log(`TOTAL ERRORS IN LOG: ${snapshot.size}`);
  console.log(`========================================\n`);

  if (snapshot.empty) {
    console.log('No error logs found');
    return;
  }

  // Group errors by type
  const errorGroups: Record<string, ErrorLog[]> = {};

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const errorKey = `${data.error?.substring(0, 80) || 'Unknown'}`;

    if (!errorGroups[errorKey]) {
      errorGroups[errorKey] = [];
    }
    errorGroups[errorKey].push({
      id: doc.id,
      correlationId: data.correlationId,
      error: data.error,
      errorCode: data.context?.additionalInfo?.errorCode || data.errorCode,
      context: data.context,
      createdAt: data.createdAt,
      timestamp: data.timestamp,
    });
  });

  // Print grouped errors
  console.log('ERRORS GROUPED BY TYPE:\n');

  const sortedGroups = Object.entries(errorGroups).sort((a, b) => b[1].length - a[1].length);

  sortedGroups.forEach(([errorType, errors], index) => {
    console.log(`\n[${ index + 1}] "${errorType}" (${errors.length} occurrences)`);
    console.log(`    Routes: ${[...new Set(errors.map(e => e.context?.route))].join(', ')}`);
    console.log(`    Actions: ${[...new Set(errors.map(e => e.context?.action))].join(', ')}`);
    console.log(`    Date range: ${errors[errors.length - 1].createdAt} to ${errors[0].createdAt}`);
    console.log(`    Document IDs: ${errors.map(e => e.id).join(', ')}`);
  });

  // Summary
  console.log(`\n========================================`);
  console.log('SUMMARY');
  console.log(`========================================`);
  console.log(`Total errors: ${snapshot.size}`);
  console.log(`Unique error types: ${sortedGroups.length}`);
  console.log(`\nTop 5 most frequent errors:`);
  sortedGroups.slice(0, 5).forEach(([errorType, errors], i) => {
    console.log(`  ${i + 1}. (${errors.length}x) ${errorType}`);
  });
}

analyzeAllErrors().catch(console.error);
