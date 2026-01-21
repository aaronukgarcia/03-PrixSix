/**
 * Get specific CC log by correlationId
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/get-cc-log.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

const db = getFirestore();

const correlationId = process.argv[2] || 'cc_1768939399261_mros4n';

async function getCCLog() {
  console.log(`\nSearching for CC log: ${correlationId}\n`);
  console.log('='.repeat(80));

  const ccLogs = await db.collection('CC-logs')
    .where('correlationId', '==', correlationId)
    .get();

  if (ccLogs.empty) {
    console.log('No CC log found with that correlationId.');
    console.log('\nRecent CC logs:');
    const recent = await db.collection('CC-logs')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();
    recent.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${data.correlationId} (${data.executedAt})`);
    });
    return;
  }

  const doc = ccLogs.docs[0];
  const data = doc.data();

  console.log(`\nCC LOG: ${data.correlationId}`);
  console.log('='.repeat(80));
  console.log(`Version: ${data.version}`);
  console.log(`Executed: ${data.executedAt}`);
  console.log(`Executed By: ${data.executedBy}`);
  console.log(`\nSUMMARY:`);
  console.log(`  Total Checks: ${data.summary?.totalChecks}`);
  console.log(`  Passed: ${data.summary?.passed}`);
  console.log(`  Warnings: ${data.summary?.warnings}`);
  console.log(`  Errors: ${data.summary?.errors}`);
  console.log(`  Total Issues: ${data.totalIssues}`);

  console.log('\n' + '='.repeat(80));
  console.log('CATEGORY RESULTS:');
  console.log('='.repeat(80));

  if (data.categoryResults && Array.isArray(data.categoryResults)) {
    for (const cat of data.categoryResults) {
      console.log(`\n[${cat.status?.toUpperCase()}] ${cat.category} - ${cat.issueCount} issues`);

      if (cat.issues && cat.issues.length > 0) {
        console.log('-'.repeat(60));
        for (const issue of cat.issues) {
          const severity = issue.severity?.toUpperCase() || 'UNKNOWN';
          console.log(`  [${severity}] ${issue.entity || 'N/A'}`);
          console.log(`    Field: ${issue.field || 'N/A'}`);
          console.log(`    Message: ${issue.message}`);
          if (issue.details) {
            console.log(`    Details: ${JSON.stringify(issue.details)}`);
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('END OF CC LOG');
  console.log('='.repeat(80));
}

getCCLog()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
