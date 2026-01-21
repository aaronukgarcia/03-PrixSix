/**
 * Get error log by document ID or correlation ID
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

async function getLog() {
  console.log('Fetching error log for:', targetId);
  console.log('='.repeat(60));

  // Search by correlationId
  const byCorrelation = await db.collection('error_logs')
    .where('correlationId', '==', targetId)
    .get();

  if (!byCorrelation.empty) {
    byCorrelation.forEach(doc => {
      console.log('\nDocument ID:', doc.id);
      console.log('-'.repeat(60));
      const data = doc.data();

      // Pretty print the data
      console.log('Correlation ID:', data.correlationId);
      console.log('Timestamp:', data.timestamp?.toDate?.() || 'N/A');
      console.log('Version:', data.version);
      console.log('Executed By:', data.executedBy);

      if (data.summary) {
        console.log('\nSUMMARY:');
        console.log('  Total Checks:', data.summary.totalChecks);
        console.log('  Passed:', data.summary.passed);
        console.log('  Warnings:', data.summary.warnings);
        console.log('  Errors:', data.summary.errors);
      }

      if (data.categoryResults && Array.isArray(data.categoryResults)) {
        console.log('\nCATEGORY RESULTS:');
        for (const cat of data.categoryResults) {
          if (cat.issueCount > 0) {
            console.log(`\n  [${cat.status?.toUpperCase()}] ${cat.category} - ${cat.issueCount} issues`);
            if (cat.issues && cat.issues.length > 0) {
              for (const issue of cat.issues) {
                console.log(`    [${issue.severity?.toUpperCase()}] ${issue.entity || 'N/A'}`);
                console.log(`      Message: ${issue.message}`);
                if (issue.field) console.log(`      Field: ${issue.field}`);
                if (issue.details) console.log(`      Details: ${JSON.stringify(issue.details)}`);
              }
            }
          }
        }
      }

      // Also print raw data for debugging
      console.log('\n' + '='.repeat(60));
      console.log('RAW DATA:');
      console.log(JSON.stringify(data, null, 2));
    });
  } else {
    console.log('No error log found with correlationId:', targetId);
  }
}

getLog().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
