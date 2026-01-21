/**
 * Verify specific score calculation
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

// Prix Six scoring
const SCORING = { exactPosition: 5, wrongPosition: 3, bonusAll6: 10 };

function calculateScore(predicted: string[], actual: string[]): { total: number; breakdown: string } {
  const normalizedActual = actual.map(d => d.toLowerCase());
  const normalizedPredicted = predicted.map(d => d.toLowerCase());

  let totalPoints = 0;
  let correctCount = 0;
  const breakdown: string[] = [];

  normalizedPredicted.forEach((driver, index) => {
    const actualPos = normalizedActual.indexOf(driver);
    if (actualPos === index) {
      totalPoints += SCORING.exactPosition;
      correctCount++;
      breakdown.push(`P${index+1}:${driver}=EXACT(+5)`);
    } else if (actualPos !== -1) {
      totalPoints += SCORING.wrongPosition;
      correctCount++;
      breakdown.push(`P${index+1}:${driver}=WRONG_POS(+3,actual:P${actualPos+1})`);
    } else {
      breakdown.push(`P${index+1}:${driver}=NOT_IN_TOP6(0)`);
    }
  });

  if (correctCount === 6) {
    totalPoints += SCORING.bonusAll6;
    breakdown.push(`BONUS(+10)`);
  }

  return { total: totalPoints, breakdown: breakdown.join(', ') };
}

async function verify() {
  console.log('='.repeat(70));
  console.log('VERIFY SCORE CALCULATION');
  console.log('='.repeat(70));

  // Get current race result
  const resultDoc = await db.collection('race_results').doc('australian-grand-prix-gp').get();
  if (!resultDoc.exists) {
    console.log('Race result not found!');
    return;
  }
  const result = resultDoc.data()!;
  const actualTop6 = [result.driver1, result.driver2, result.driver3, result.driver4, result.driver5, result.driver6];
  console.log('Actual Top 6:', actualTop6.join(', '));

  // Check specific user from CC error
  const userId = 'caPArwBSQHaZU48HHF2YjFDoxo93';
  console.log('\n--- Checking user:', userId, '---');

  // Get stored score
  const scoreDoc = await db.collection('scores').doc(`Australian-Grand-Prix_${userId}`).get();
  if (scoreDoc.exists) {
    const scoreData = scoreDoc.data()!;
    console.log('Stored score:', scoreData.totalPoints);
    console.log('Stored breakdown:', scoreData.breakdown);
  } else {
    console.log('No score found for this user');
  }

  // Get prediction from prediction_submissions
  const predSnap = await db.collection('prediction_submissions')
    .where('userId', '==', userId)
    .get();

  predSnap.forEach(doc => {
    const data = doc.data();
    const raceId = data.raceId || '';
    if (raceId.toLowerCase().includes('australian')) {
      console.log('\nPrediction doc:', doc.id);
      let predictions: string[] = [];
      if (Array.isArray(data.predictions)) {
        predictions = data.predictions;
      } else if (data.predictions) {
        predictions = [data.predictions.P1, data.predictions.P2, data.predictions.P3,
                      data.predictions.P4, data.predictions.P5, data.predictions.P6].filter(Boolean);
      }
      console.log('Predicted:', predictions.join(', '));

      const calc = calculateScore(predictions, actualTop6);
      console.log('Calculated score:', calc.total);
      console.log('Breakdown:', calc.breakdown);
    }
  });

  // Also check users subcollection
  const userPredSnap = await db.collection('users').doc(userId).collection('predictions').get();
  userPredSnap.forEach(doc => {
    const data = doc.data();
    const raceId = data.raceId || doc.id || '';
    if (raceId.toLowerCase().includes('australian')) {
      console.log('\nUser prediction doc:', doc.id);
      const predictions = Array.isArray(data.predictions) ? data.predictions : [];
      console.log('Predicted:', predictions.join(', '));

      if (predictions.length === 6) {
        const calc = calculateScore(predictions, actualTop6);
        console.log('Calculated score:', calc.total);
        console.log('Breakdown:', calc.breakdown);
      }
    }
  });
}

verify().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
