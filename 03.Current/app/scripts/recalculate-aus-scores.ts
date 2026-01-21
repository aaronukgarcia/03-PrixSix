/**
 * Recalculate ALL Australian GP scores using correct race result
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

// Prix Six scoring
const SCORING = { exactPosition: 5, wrongPosition: 3, bonusAll6: 10 };

const driverNames: Record<string, string> = {
  'verstappen': 'Verstappen', 'hamilton': 'Hamilton', 'russell': 'Russell',
  'piastri': 'Piastri', 'leclerc': 'Leclerc', 'hadjar': 'Hadjar',
  'norris': 'Norris', 'sainz': 'Sainz', 'alonso': 'Alonso',
  'antonelli': 'Antonelli', 'stroll': 'Stroll', 'albon': 'Albon',
  'gasly': 'Gasly', 'colapinto': 'Colapinto',
};

function calculateScore(predicted: string[], actual: string[]): { total: number; breakdown: string } {
  const normalizedActual = actual.map(d => d.toLowerCase());
  const normalizedPredicted = predicted.map(d => d.toLowerCase());

  let totalPoints = 0;
  let correctCount = 0;
  const breakdownParts: string[] = [];

  normalizedPredicted.forEach((driver, index) => {
    const name = driverNames[driver] || driver;
    const actualPos = normalizedActual.indexOf(driver);
    if (actualPos === index) {
      totalPoints += SCORING.exactPosition;
      correctCount++;
      breakdownParts.push(`${name}+${SCORING.exactPosition}`);
    } else if (actualPos !== -1) {
      totalPoints += SCORING.wrongPosition;
      correctCount++;
      breakdownParts.push(`${name}+${SCORING.wrongPosition}`);
    } else {
      breakdownParts.push(`${name}+0`);
    }
  });

  if (correctCount === 6) {
    totalPoints += SCORING.bonusAll6;
    breakdownParts.push(`BonusAll6+${SCORING.bonusAll6}`);
  }

  return { total: totalPoints, breakdown: breakdownParts.join(', ') };
}

async function recalculate() {
  console.log('='.repeat(70));
  console.log('RECALCULATE ALL AUSTRALIAN GP SCORES');
  console.log('='.repeat(70));

  // Step 1: Get the race result
  const resultDoc = await db.collection('race_results').doc('australian-grand-prix-gp').get();
  if (!resultDoc.exists) {
    console.log('ERROR: Race result document not found!');
    return;
  }

  const result = resultDoc.data()!;
  const actualTop6 = [result.driver1, result.driver2, result.driver3, result.driver4, result.driver5, result.driver6];
  console.log('\nActual Top 6:', actualTop6.join(', '));

  // Step 2: Get ALL unique predictions for Australian GP
  // Map by composite key: `${userId}_${isPrimary}`
  const predictions = new Map<string, { userId: string; teamName: string; drivers: string[]; docId: string }>();

  // From users/{userId}/predictions subcollection (PRIMARY SOURCE)
  console.log('\nFetching predictions from users subcollections...');
  const usersSnap = await db.collection('users').get();
  const userMap = new Map<string, string>(); // userId -> teamName

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    userMap.set(userDoc.id, userData.teamName || 'Unknown');

    const predSnap = await db.collection('users').doc(userDoc.id).collection('predictions').get();
    predSnap.forEach(predDoc => {
      const data = predDoc.data();
      const raceId = (data.raceId || predDoc.id || '').toLowerCase();

      if (raceId.includes('australian')) {
        const drivers = Array.isArray(data.predictions) ? data.predictions : [];
        if (drivers.length === 6) {
          // Determine if primary or secondary based on doc ID
          const isSecondary = predDoc.id.includes('-secondary');
          const key = `${userDoc.id}_${isSecondary ? 'secondary' : 'primary'}`;
          predictions.set(key, {
            userId: userDoc.id,
            teamName: data.teamName || userData.teamName || 'Unknown',
            drivers,
            docId: predDoc.id,
          });
        }
      }
    });
  }

  console.log(`Found ${predictions.size} unique predictions from users subcollections`);

  // Step 3: Delete ALL existing Australian GP scores
  console.log('\nDeleting existing Australian GP scores...');
  const scoresSnap = await db.collection('scores').get();
  const toDelete: FirebaseFirestore.DocumentReference[] = [];

  scoresSnap.forEach(doc => {
    const docId = doc.id.toLowerCase();
    const raceId = (doc.data().raceId || '').toLowerCase();
    if (docId.includes('australian') || raceId.includes('australian')) {
      toDelete.push(doc.ref);
    }
  });

  console.log(`Deleting ${toDelete.length} existing scores...`);
  for (const ref of toDelete) {
    await ref.delete();
  }

  // Step 4: Create new scores
  console.log('\nCreating new scores...');
  const NORMALIZED_RACE_ID = 'Australian-Grand-Prix';
  let created = 0;

  for (const [key, pred] of predictions.entries()) {
    const calc = calculateScore(pred.drivers, actualTop6);
    const isSecondary = key.includes('_secondary');
    const scoreDocId = isSecondary
      ? `${NORMALIZED_RACE_ID}_${pred.userId}-secondary`
      : `${NORMALIZED_RACE_ID}_${pred.userId}`;

    await db.collection('scores').doc(scoreDocId).set({
      userId: pred.userId,
      raceId: NORMALIZED_RACE_ID,
      totalPoints: calc.total,
      breakdown: calc.breakdown,
      calculatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`  ${pred.teamName}: ${calc.total} pts (${pred.drivers.join(', ')})`);
    created++;
  }

  console.log(`\nCreated ${created} scores`);
  console.log('='.repeat(70));
  console.log('DONE');
}

recalculate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
