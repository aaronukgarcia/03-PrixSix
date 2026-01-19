/**
 * Check data consistency - drivers, races, teams casing
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}

const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Expected formats from data.ts
const VALID_DRIVERS = new Set([
  'verstappen', 'hadjar', 'leclerc', 'hamilton', 'norris', 'piastri',
  'russell', 'antonelli', 'alonso', 'stroll', 'gasly', 'colapinto',
  'albon', 'sainz', 'lawson', 'lindblad', 'hulkenberg', 'bortoleto',
  'ocon', 'bearman', 'perez', 'bottas'
]);

const VALID_RACE_IDS = new Set([
  'Australian-Grand-Prix', 'Chinese-Grand-Prix', 'Japanese-Grand-Prix',
  'Bahrain-Grand-Prix', 'Saudi-Arabian-Grand-Prix', 'Miami-Grand-Prix',
  'Canadian-Grand-Prix', 'Monaco-Grand-Prix', 'Spanish-Grand-Prix',
  'Austrian-Grand-Prix', 'British-Grand-Prix', 'Belgian-Grand-Prix',
  'Hungarian-Grand-Prix', 'Dutch-Grand-Prix', 'Italian-Grand-Prix',
  'Spanish-Grand-Prix-II', 'Azerbaijan-Grand-Prix', 'Singapore-Grand-Prix',
  'United-States-Grand-Prix', 'Mexican-Grand-Prix', 'Brazilian-Grand-Prix',
  'Las-Vegas-Grand-Prix', 'Qatar-Grand-Prix', 'Abu-Dhabi-Grand-Prix'
]);

interface Issue {
  collection: string;
  docId: string;
  field: string;
  value: string;
  expected: string;
  type: 'case' | 'invalid' | 'missing';
}

async function checkDataConsistency() {
  console.log('=== DATA CONSISTENCY CHECK ===\n');
  const issues: Issue[] = [];

  // 1. Check prediction_submissions
  console.log('--- Checking prediction_submissions ---');
  const submissions = await db.collection('prediction_submissions').get();
  console.log(`Total docs: ${submissions.size}`);

  const submissionDriverIssues = new Map<string, number>();
  const submissionRaceIssues = new Map<string, number>();

  submissions.forEach(doc => {
    const data = doc.data();

    // Check raceId
    if (data.raceId && !VALID_RACE_IDS.has(data.raceId)) {
      const key = `raceId: "${data.raceId}"`;
      submissionRaceIssues.set(key, (submissionRaceIssues.get(key) || 0) + 1);
    }

    // Check predictions (P1-P6 format)
    if (data.predictions) {
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].forEach(pos => {
        const driver = data.predictions[pos];
        if (driver && !VALID_DRIVERS.has(driver)) {
          // Check if it's a case issue
          const lowerDriver = driver.toLowerCase();
          if (VALID_DRIVERS.has(lowerDriver)) {
            const key = `driver "${driver}" should be "${lowerDriver}"`;
            submissionDriverIssues.set(key, (submissionDriverIssues.get(key) || 0) + 1);
          } else {
            const key = `invalid driver "${driver}"`;
            submissionDriverIssues.set(key, (submissionDriverIssues.get(key) || 0) + 1);
          }
        }
      });
    }
  });

  if (submissionRaceIssues.size > 0) {
    console.log('  Race ID issues:');
    submissionRaceIssues.forEach((count, issue) => console.log(`    ${issue} (${count} docs)`));
  } else {
    console.log('  ✓ All raceIds valid');
  }

  if (submissionDriverIssues.size > 0) {
    console.log('  Driver issues:');
    submissionDriverIssues.forEach((count, issue) => console.log(`    ${issue} (${count} docs)`));
  } else {
    console.log('  ✓ All drivers valid (lowercase)');
  }

  // 2. Check users/*/predictions subcollections
  console.log('\n--- Checking users/*/predictions subcollections ---');
  const users = await db.collection('users').get();
  let totalPredictions = 0;
  const predDriverIssues = new Map<string, number>();
  const predRaceIssues = new Map<string, number>();

  for (const userDoc of users.docs) {
    const preds = await db.collection('users').doc(userDoc.id).collection('predictions').get();
    totalPredictions += preds.size;

    preds.forEach(predDoc => {
      const data = predDoc.data();

      // Check raceId
      if (data.raceId && !VALID_RACE_IDS.has(data.raceId)) {
        const key = `raceId: "${data.raceId}"`;
        predRaceIssues.set(key, (predRaceIssues.get(key) || 0) + 1);
      }

      // Check driver1-6 fields
      ['driver1', 'driver2', 'driver3', 'driver4', 'driver5', 'driver6'].forEach(field => {
        const driver = data[field];
        if (driver && !VALID_DRIVERS.has(driver)) {
          const lowerDriver = driver.toLowerCase();
          if (VALID_DRIVERS.has(lowerDriver)) {
            const key = `${field} "${driver}" should be "${lowerDriver}"`;
            predDriverIssues.set(key, (predDriverIssues.get(key) || 0) + 1);
          } else {
            const key = `invalid ${field} "${driver}"`;
            predDriverIssues.set(key, (predDriverIssues.get(key) || 0) + 1);
          }
        }
      });

      // Check predictions array if exists
      if (Array.isArray(data.predictions)) {
        data.predictions.forEach((driver: string, i: number) => {
          if (driver && !VALID_DRIVERS.has(driver)) {
            const lowerDriver = driver.toLowerCase();
            if (VALID_DRIVERS.has(lowerDriver)) {
              const key = `predictions[${i}] "${driver}" should be "${lowerDriver}"`;
              predDriverIssues.set(key, (predDriverIssues.get(key) || 0) + 1);
            } else {
              const key = `invalid predictions[${i}] "${driver}"`;
              predDriverIssues.set(key, (predDriverIssues.get(key) || 0) + 1);
            }
          }
        });
      }
    });
  }

  console.log(`Total predictions: ${totalPredictions}`);

  if (predRaceIssues.size > 0) {
    console.log('  Race ID issues:');
    predRaceIssues.forEach((count, issue) => console.log(`    ${issue} (${count} docs)`));
  } else {
    console.log('  ✓ All raceIds valid');
  }

  if (predDriverIssues.size > 0) {
    console.log('  Driver issues:');
    predDriverIssues.forEach((count, issue) => console.log(`    ${issue} (${count} docs)`));
  } else {
    console.log('  ✓ All drivers valid (lowercase)');
  }

  // 3. Check race_results
  console.log('\n--- Checking race_results ---');
  const results = await db.collection('race_results').get();
  console.log(`Total docs: ${results.size}`);

  const resultDocIdIssues: string[] = [];
  const resultDriverIssues = new Map<string, number>();

  results.forEach(doc => {
    const data = doc.data();

    // Check doc ID is lowercase
    const expectedLowercaseId = doc.id.toLowerCase();
    if (doc.id !== expectedLowercaseId) {
      resultDocIdIssues.push(`Doc ID "${doc.id}" should be lowercase "${expectedLowercaseId}"`);
    }

    // Check driver1-6 fields
    ['driver1', 'driver2', 'driver3', 'driver4', 'driver5', 'driver6'].forEach(field => {
      const driver = data[field];
      if (driver && !VALID_DRIVERS.has(driver)) {
        const lowerDriver = driver.toLowerCase();
        if (VALID_DRIVERS.has(lowerDriver)) {
          const key = `${field} "${driver}" should be "${lowerDriver}"`;
          resultDriverIssues.set(key, (resultDriverIssues.get(key) || 0) + 1);
        } else {
          const key = `invalid ${field} "${driver}"`;
          resultDriverIssues.set(key, (resultDriverIssues.get(key) || 0) + 1);
        }
      }
    });
  });

  if (resultDocIdIssues.length > 0) {
    console.log('  Doc ID issues:');
    resultDocIdIssues.forEach(issue => console.log(`    ${issue}`));
  } else {
    console.log('  ✓ All doc IDs lowercase');
  }

  if (resultDriverIssues.size > 0) {
    console.log('  Driver issues:');
    resultDriverIssues.forEach((count, issue) => console.log(`    ${issue} (${count} docs)`));
  } else {
    console.log('  ✓ All drivers valid (lowercase)');
  }

  // 4. Check scores
  console.log('\n--- Checking scores ---');
  const scores = await db.collection('scores').get();
  console.log(`Total docs: ${scores.size}`);

  const scoreRaceIssues = new Map<string, number>();

  scores.forEach(doc => {
    const data = doc.data();

    // Check raceId
    if (data.raceId && !VALID_RACE_IDS.has(data.raceId)) {
      const key = `raceId: "${data.raceId}"`;
      scoreRaceIssues.set(key, (scoreRaceIssues.get(key) || 0) + 1);
    }
  });

  if (scoreRaceIssues.size > 0) {
    console.log('  Race ID issues:');
    scoreRaceIssues.forEach((count, issue) => console.log(`    ${issue} (${count} docs)`));
  } else {
    console.log('  ✓ All raceIds valid');
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  const totalIssues =
    submissionDriverIssues.size + submissionRaceIssues.size +
    predDriverIssues.size + predRaceIssues.size +
    resultDocIdIssues.length + resultDriverIssues.size +
    scoreRaceIssues.size;

  if (totalIssues === 0) {
    console.log('✓ All data is consistent - no casing issues found');
  } else {
    console.log(`✗ Found ${totalIssues} types of issues`);
  }
}

checkDataConsistency()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
