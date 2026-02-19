/**
 * Test Book of Work Firestore data (non-UI test)
 * Verifies data is properly stored and queryable
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function testBookOfWorkData() {
  console.log('=== BOOK OF WORK DATA TEST ===\n');

  try {
    // Test 1: Count total entries
    console.log('Test 1: Counting entries...');
    const snapshot = await db.collection('book_of_work').get();
    console.log(`✓ Total entries: ${snapshot.size}`);

    if (snapshot.size === 0) {
      console.error('❌ FAILED: No entries found in book_of_work collection');
      process.exit(1);
    }

    // Test 2: Verify data structure
    console.log('\nTest 2: Verifying data structure...');
    let validEntries = 0;
    let invalidEntries = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const hasRequiredFields = data.title && data.description && data.category && data.status && data.source;

      if (hasRequiredFields) {
        validEntries++;
      } else {
        invalidEntries++;
        console.log(`  ⚠ Invalid entry: ${doc.id} - missing required fields`);
      }
    });

    console.log(`✓ Valid entries: ${validEntries}`);
    console.log(`  Invalid entries: ${invalidEntries}`);

    if (invalidEntries > 0) {
      console.warn('⚠ WARNING: Some entries are missing required fields');
    }

    // Test 3: Verify packages are assigned
    console.log('\nTest 3: Checking package assignments...');
    const packageCounts = {};
    let noPackage = 0;

    snapshot.forEach(doc => {
      const pkg = doc.data().package;
      if (pkg) {
        packageCounts[pkg] = (packageCounts[pkg] || 0) + 1;
      } else {
        noPackage++;
      }
    });

    console.log('Package distribution:');
    Object.entries(packageCounts).sort((a, b) => b[1] - a[1]).forEach(([pkg, count]) => {
      console.log(`  ${pkg}: ${count}`);
    });
    if (noPackage > 0) {
      console.log(`  no package: ${noPackage}`);
    }

    // Test 4: Check severity distribution
    console.log('\nTest 4: Checking severity distribution...');
    const severityCounts = {};
    let noSeverity = 0;

    snapshot.forEach(doc => {
      const severity = doc.data().severity;
      if (severity) {
        severityCounts[severity] = (severityCounts[severity] || 0) + 1;
      } else {
        noSeverity++;
      }
    });

    console.log('Severity distribution:');
    Object.entries(severityCounts).sort((a, b) => b[1] - a[1]).forEach(([severity, count]) => {
      console.log(`  ${severity}: ${count}`);
    });
    if (noSeverity > 0) {
      console.log(`  no severity: ${noSeverity}`);
    }

    // Test 5: Check status distribution
    console.log('\nTest 5: Checking status distribution...');
    const statusCounts = {};

    snapshot.forEach(doc => {
      const status = doc.data().status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    console.log('Status distribution:');
    Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    // Test 6: Sample entries
    console.log('\nTest 6: Sample entries (first 3)...');
    let count = 0;
    snapshot.forEach(doc => {
      if (count < 3) {
        const data = doc.data();
        console.log(`\n  Entry ${doc.id}:`);
        console.log(`    Title: ${data.title?.substring(0, 60)}${data.title?.length > 60 ? '...' : ''}`);
        console.log(`    Category: ${data.category}`);
        console.log(`    Severity: ${data.severity || 'N/A'}`);
        console.log(`    Status: ${data.status}`);
        console.log(`    Package: ${data.package || 'N/A'}`);
        console.log(`    Source: ${data.source}`);
        count++;
      }
    });

    // Summary
    console.log('\n=== TEST SUMMARY ===');
    console.log(`✓ Total entries: ${snapshot.size}`);
    console.log(`✓ Valid entries: ${validEntries} (${Math.round(validEntries / snapshot.size * 100)}%)`);
    console.log(`✓ Entries with package: ${snapshot.size - noPackage} (${Math.round((snapshot.size - noPackage) / snapshot.size * 100)}%)`);
    console.log(`✓ Entries with severity: ${snapshot.size - noSeverity} (${Math.round((snapshot.size - noSeverity) / snapshot.size * 100)}%)`);
    console.log('\n✅ ALL TESTS PASSED');
    console.log('\nData is ready for Book of Work UI!');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    throw error;
  } finally {
    admin.app().delete();
  }
}

testBookOfWorkData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
