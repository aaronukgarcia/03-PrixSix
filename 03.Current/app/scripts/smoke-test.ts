/**
 * Smoke Test - Quick validation of critical system paths
 * Part of backup/restore validation cycle
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

async function runSmokeTest(): Promise<TestResult[]> {
  console.log('\n🔥 SMOKE TEST\n');
  const results: TestResult[] = [];

  // Test 1: Check race_results collection
  console.log('[1/6] Checking race_results collection...');
  try {
    const raceResultsCount = await db.collection('race_results').count().get();
    const count = raceResultsCount.data().count;
    const passed = count === 30;
    results.push({
      name: 'race_results count',
      passed,
      message: passed
        ? `✓ Found expected 30 race_results`
        : `✗ Expected 30 race_results, found ${count}`
    });
  } catch (err: any) {
    results.push({
      name: 'race_results count',
      passed: false,
      message: `✗ Error: ${err.message}`
    });
  }

  // Test 2: Read a sample race_result
  console.log('[2/6] Reading sample race_result...');
  try {
    const snapshot = await db.collection('race_results').limit(1).get();
    if (snapshot.empty) {
      results.push({
        name: 'read race_result',
        passed: false,
        message: '✗ No race_results found to read'
      });
    } else {
      const doc = snapshot.docs[0];
      const data = doc.data();
      const hasRequiredFields = data.raceId && data.driver1 && data.driver2;
      results.push({
        name: 'read race_result',
        passed: hasRequiredFields,
        message: hasRequiredFields
          ? `✓ Successfully read ${data.raceId}`
          : '✗ Race result missing required fields'
      });
    }
  } catch (err: any) {
    results.push({
      name: 'read race_result',
      passed: false,
      message: `✗ Error: ${err.message}`
    });
  }

  // Test 3: Check scores collection
  console.log('[3/6] Checking scores collection...');
  try {
    const scoresCount = await db.collection('scores').count().get();
    const count = scoresCount.data().count;
    const passed = count === 690;
    results.push({
      name: 'scores count',
      passed,
      message: passed
        ? `✓ Found expected 690 scores`
        : `✗ Expected 690 scores, found ${count}`
    });
  } catch (err: any) {
    results.push({
      name: 'scores count',
      passed: false,
      message: `✗ Error: ${err.message}`
    });
  }

  // Test 4: Read a sample score
  console.log('[4/6] Reading sample score...');
  try {
    const snapshot = await db.collection('scores').limit(1).get();
    if (snapshot.empty) {
      results.push({
        name: 'read score',
        passed: false,
        message: '✗ No scores found to read'
      });
    } else {
      const doc = snapshot.docs[0];
      const data = doc.data();
      const hasRequiredFields = data.raceId && data.userId && typeof data.totalPoints === 'number';
      results.push({
        name: 'read score',
        passed: hasRequiredFields,
        message: hasRequiredFields
          ? `✓ Successfully read score for ${data.raceId}`
          : '✗ Score missing required fields'
      });
    }
  } catch (err: any) {
    results.push({
      name: 'read score',
      passed: false,
      message: `✗ Error: ${err.message}`
    });
  }

  // Test 5: Check users collection
  console.log('[5/6] Checking users collection...');
  try {
    const usersCount = await db.collection('users').count().get();
    const count = usersCount.data().count;
    const passed = count > 0;
    results.push({
      name: 'users count',
      passed,
      message: passed
        ? `✓ Found ${count} users`
        : '✗ No users found'
    });
  } catch (err: any) {
    results.push({
      name: 'users count',
      passed: false,
      message: `✗ Error: ${err.message}`
    });
  }

  // Test 6: Verify race ID format consistency
  console.log('[6/6] Checking race ID format consistency...');
  try {
    const raceResults = await db.collection('race_results').limit(5).get();
    const scores = await db.collection('scores').limit(5).get();

    let allTitleCase = true;
    const raceIds: string[] = [];

    raceResults.forEach(doc => {
      const raceId = doc.data().raceId;
      raceIds.push(raceId);
      // Check if raceId follows Title-Case format (first letter of each word capitalized)
      const words = raceId.split('-');
      for (const word of words) {
        if (word.length > 0 && word[0] !== word[0].toUpperCase()) {
          allTitleCase = false;
        }
      }
    });

    scores.forEach(doc => {
      const raceId = doc.data().raceId;
      if (!raceIds.includes(raceId)) {
        raceIds.push(raceId);
      }
      const words = raceId.split('-');
      for (const word of words) {
        if (word.length > 0 && word[0] !== word[0].toUpperCase()) {
          allTitleCase = false;
        }
      }
    });

    results.push({
      name: 'race ID format',
      passed: allTitleCase,
      message: allTitleCase
        ? '✓ All race IDs in Title-Case format'
        : '✗ Some race IDs not in Title-Case format'
    });
  } catch (err: any) {
    results.push({
      name: 'race ID format',
      passed: false,
      message: `✗ Error: ${err.message}`
    });
  }

  return results;
}

async function main() {
  const results = await runSmokeTest();

  console.log('\n📊 SMOKE TEST RESULTS\n');
  console.log('═'.repeat(60));

  results.forEach(result => {
    console.log(`${result.passed ? '✓' : '✗'} ${result.name.padEnd(25)} ${result.message}`);
  });

  console.log('═'.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\nTotal: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n✅ ALL SMOKE TESTS PASSED!\n');
    process.exit(0);
  } else {
    console.log('\n❌ SOME SMOKE TESTS FAILED!\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
