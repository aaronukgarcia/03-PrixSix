/**
 * Inspect sample data to debug smoke test failures
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

async function inspectData() {
  console.log('\n🔍 INSPECTING SAMPLE DATA\n');

  // Inspect race_result
  console.log('📊 Sample race_result:');
  console.log('═'.repeat(60));
  const raceResultSnapshot = await db.collection('race_results').limit(1).get();
  if (!raceResultSnapshot.empty) {
    const doc = raceResultSnapshot.docs[0];
    console.log(`Document ID: ${doc.id}`);
    console.log('Fields:', Object.keys(doc.data()));
    console.log('Full data:', JSON.stringify(doc.data(), null, 2));
  } else {
    console.log('No race_results found');
  }

  console.log('\n📊 Sample score:');
  console.log('═'.repeat(60));
  const scoreSnapshot = await db.collection('scores').limit(1).get();
  if (!scoreSnapshot.empty) {
    const doc = scoreSnapshot.docs[0];
    console.log(`Document ID: ${doc.id}`);
    console.log('Fields:', Object.keys(doc.data()));
    console.log('Full data:', JSON.stringify(doc.data(), null, 2));
  } else {
    console.log('No scores found');
  }
}

inspectData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
