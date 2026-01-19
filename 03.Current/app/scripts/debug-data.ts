/**
 * Debug script to check what's in the database
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

async function debug() {
  console.log('=== DEBUG DATA ===\n');

  // Check prediction_submissions
  console.log('--- prediction_submissions ---');
  const subs = await db.collection('prediction_submissions').limit(5).get();
  console.log(`Total docs found (limit 5): ${subs.size}`);

  if (subs.size > 0) {
    const sample = subs.docs[0].data();
    console.log('Sample doc ID:', subs.docs[0].id);
    console.log('Sample raceId:', sample.raceId);
    console.log('Sample teamName:', sample.teamName);
    console.log('Sample predictions:', JSON.stringify(sample.predictions));
    console.log('');
  }

  // Check with specific raceId query
  const testRaceId = 'Australian-Grand-Prix';
  console.log(`--- Query: raceId == "${testRaceId}" ---`);
  const queryResult = await db.collection('prediction_submissions')
    .where('raceId', '==', testRaceId)
    .get();
  console.log(`Found: ${queryResult.size} docs total`);

  // Show seeded teams (team_ prefix)
  const seededTeams = queryResult.docs.filter(d => d.data().userId?.startsWith('team_'));
  console.log(`Seeded teams (team_*): ${seededTeams.length}`);
  seededTeams.slice(0, 5).forEach(doc => {
    const data = doc.data();
    console.log(`  - ${data.teamName} (${data.userId})`);
  });

  // Show protected teams
  const protectedTeams = queryResult.docs.filter(d => !d.data().userId?.startsWith('team_'));
  console.log(`Protected/other: ${protectedTeams.length}`);
  protectedTeams.forEach(doc => {
    console.log(`  - ${doc.data().teamName}`);
  });

  // Check all unique raceIds
  console.log('\n--- All unique raceIds in prediction_submissions ---');
  const allSubs = await db.collection('prediction_submissions').get();
  const raceIds = new Set<string>();
  allSubs.forEach(doc => {
    const data = doc.data();
    if (data.raceId) raceIds.add(data.raceId);
  });
  console.log('Total docs:', allSubs.size);
  console.log('Unique raceIds:', Array.from(raceIds).slice(0, 5));

  // Check race_results
  console.log('\n--- race_results ---');
  const results = await db.collection('race_results').limit(3).get();
  results.docs.forEach(doc => {
    console.log(`  Doc ID: "${doc.id}", raceId field: "${doc.data().raceId}"`);
  });
}

debug()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
