import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Initialize Firebase Admin
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = getFirestore();

async function checkSubmissions() {
  console.log('=== Checking prediction_submissions for Australian race ===\n');

  // Check various possible raceId formats
  const possibleRaceIds = [
    'Australian-Grand-Prix',
    'australian-grand-prix',
    'Australian Grand Prix',
    'Australian-Grand-Prix---GP',
    'australian-grand-prix---gp',
  ];

  for (const raceId of possibleRaceIds) {
    const snapshot = await db.collection('prediction_submissions')
      .where('raceId', '==', raceId)
      .get();

    if (snapshot.size > 0) {
      console.log(`Found ${snapshot.size} submissions with raceId: "${raceId}"`);
      console.log('Sample document:');
      const sample = snapshot.docs[0].data();
      console.log(JSON.stringify(sample, null, 2));
      console.log('\n');
    }
  }

  // Also list all unique raceIds in prediction_submissions
  console.log('=== All unique raceIds in prediction_submissions ===\n');
  const allSubmissions = await db.collection('prediction_submissions').get();
  const raceIds = new Set<string>();
  allSubmissions.forEach(doc => {
    const data = doc.data();
    if (data.raceId) raceIds.add(data.raceId);
  });
  console.log('Unique raceIds:', Array.from(raceIds));
  console.log(`Total documents: ${allSubmissions.size}`);

  // Check users/{userId}/predictions subcollection
  console.log('\n=== Checking users/*/predictions subcollections ===\n');
  const usersSnapshot = await db.collection('users').get();
  let totalPredictions = 0;
  const predictionRaceIds = new Set<string>();

  for (const userDoc of usersSnapshot.docs) {
    const predictionsSnapshot = await db.collection('users').doc(userDoc.id).collection('predictions').get();
    totalPredictions += predictionsSnapshot.size;
    predictionsSnapshot.forEach(predDoc => {
      const data = predDoc.data();
      if (data.raceId) predictionRaceIds.add(data.raceId);
    });
  }

  console.log(`Total predictions in users/*/predictions: ${totalPredictions}`);
  console.log('Unique raceIds:', Array.from(predictionRaceIds));

  // Check for Australian specifically
  console.log('\n=== Australian race predictions in users/*/predictions ===\n');
  for (const userDoc of usersSnapshot.docs) {
    const predictionsSnapshot = await db.collection('users').doc(userDoc.id).collection('predictions')
      .where('raceId', '==', 'Australian-Grand-Prix')
      .get();

    if (predictionsSnapshot.size > 0) {
      console.log(`User ${userDoc.id} has ${predictionsSnapshot.size} Australian prediction(s)`);
    }
  }
}

checkSubmissions().catch(console.error);
