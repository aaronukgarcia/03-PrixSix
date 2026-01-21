import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function check() {
  const userId = 'caPArwBSQHaZU48HHF2YjFDoxo93';

  // Get users subcollection predictions
  console.log('Users subcollection predictions:');
  const userPredSnap = await db.collection('users').doc(userId).collection('predictions').get();
  userPredSnap.forEach(doc => {
    if (doc.id.toLowerCase().includes('australian')) {
      const d = doc.data();
      console.log('  Doc:', doc.id);
      console.log('  Predictions:', d.predictions?.join(', ') || JSON.stringify(d.predictions));
    }
  });

  // Get prediction_submissions for this user
  console.log('\nprediction_submissions for user:');
  const subSnap = await db.collection('prediction_submissions')
    .where('userId', '==', userId)
    .get();

  subSnap.forEach(doc => {
    const d = doc.data();
    const raceId = d.raceId;
    if (raceId?.toLowerCase().includes('australian')) {
      const preds = d.predictions;
      console.log('  Doc:', doc.id, '- raceId:', raceId, '- teamName:', d.teamName);
      if (preds?.P1) {
        console.log('  Predictions:', [preds.P1, preds.P2, preds.P3, preds.P4, preds.P5, preds.P6].join(', '));
      } else if (Array.isArray(preds)) {
        console.log('  Predictions:', preds.join(', '));
      }
    }
  });

  // Get scores
  console.log('\nScores:');
  const scoreDoc = await db.collection('scores').doc('Australian-Grand-Prix_' + userId).get();
  if (scoreDoc.exists) {
    const s = scoreDoc.data()!;
    console.log('  Primary:', s.totalPoints, '-', s.breakdown);
  }

  const scoreDoc2 = await db.collection('scores').doc('Australian-Grand-Prix_' + userId + '-secondary').get();
  if (scoreDoc2.exists) {
    const s = scoreDoc2.data()!;
    console.log('  Secondary:', s.totalPoints, '-', s.breakdown);
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
