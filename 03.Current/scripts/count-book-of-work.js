/**
 * Quick script to count Book of Work entries in Firestore
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function countEntries() {
  const snapshot = await db.collection('book_of_work').get();
  console.log(`Total Book of Work entries: ${snapshot.size}`);

  // Count by package
  const packageCounts = {};
  snapshot.forEach(doc => {
    const pkg = doc.data().package || 'unknown';
    packageCounts[pkg] = (packageCounts[pkg] || 0) + 1;
  });

  console.log('\nBreakdown by package:');
  Object.entries(packageCounts).sort((a, b) => b[1] - a[1]).forEach(([pkg, count]) => {
    console.log(`  ${pkg}: ${count}`);
  });

  admin.app().delete();
}

countEntries().catch(console.error);
