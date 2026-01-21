import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function fix() {
  const userId = 'caPArwBSQHaZU48HHF2YjFDoxo93';

  // Get the secondary prediction from users subcollection
  const predDoc = await db.collection('users').doc(userId).collection('predictions')
    .doc(userId + '-secondary_Australian-Grand-Prix').get();

  if (!predDoc.exists) {
    console.log('Secondary prediction not found in users subcollection');
    return;
  }

  const predData = predDoc.data()!;
  console.log('Found secondary prediction:', predData.predictions?.join(', '));
  console.log('Team name:', predData.teamName);

  // Check if it already exists in prediction_submissions
  const existingSnap = await db.collection('prediction_submissions')
    .where('userId', '==', userId)
    .where('teamName', '==', predData.teamName)
    .where('raceId', '==', 'Australian-Grand-Prix')
    .get();

  if (!existingSnap.empty) {
    console.log('Secondary prediction already exists in prediction_submissions');
    return;
  }

  // Add to prediction_submissions
  const docRef = await db.collection('prediction_submissions').add({
    userId,
    teamName: predData.teamName || 'Team-Time',
    raceId: 'Australian-Grand-Prix',
    raceName: 'Australian Grand Prix',
    predictions: {
      P1: predData.predictions[0],
      P2: predData.predictions[1],
      P3: predData.predictions[2],
      P4: predData.predictions[3],
      P5: predData.predictions[4],
      P6: predData.predictions[5],
    },
    submittedAt: predData.submissionTimestamp || FieldValue.serverTimestamp(),
  });

  console.log('Added secondary prediction to prediction_submissions:', docRef.id);
}

fix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
