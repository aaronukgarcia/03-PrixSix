/**
 * Fix consistency checker issues:
 * 1. Add missing isAdmin field to user tF07x5SOPXTsMxzuihbEgGvtnxr1
 * 2. Calculate missing Australian GP scores for 3 predictions
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

// Prix Six hybrid scoring (from scoring-rules.ts)
function calculateDriverPoints(predictedPosition: number, actualPosition: number): number {
  if (actualPosition === -1) return 0; // Not in top 6
  const distance = Math.abs(predictedPosition - actualPosition);
  if (distance === 0) return 6; // Exact position
  if (distance === 1) return 4; // 1 off
  if (distance === 2) return 3; // 2 off
  return 2; // 3+ off but in top 6
}

function calculateScore(predicted: string[], actual: string[]): { total: number; breakdown: string } {
  const normalizedActual = actual.map(d => d.toLowerCase());
  const normalizedPredicted = predicted.map(d => d.toLowerCase());

  let totalPoints = 0;
  let correctCount = 0;
  const breakdownParts: string[] = [];

  normalizedPredicted.forEach((driver, index) => {
    const actualPos = normalizedActual.indexOf(driver);
    const pts = calculateDriverPoints(index, actualPos);
    totalPoints += pts;
    if (actualPos !== -1) correctCount++;
    breakdownParts.push(`P${index + 1}:${driver}=${pts}`);
  });

  // Bonus for all 6 in top 6
  if (correctCount === 6) {
    totalPoints += 10;
    breakdownParts.push('BonusAll6=10');
  }

  return { total: totalPoints, breakdown: breakdownParts.join(', ') };
}

async function fixIssues() {
  console.log('='.repeat(70));
  console.log('FIX CONSISTENCY CHECKER ISSUES');
  console.log('='.repeat(70));

  // ISSUE 1: Fix missing isAdmin field
  console.log('\n1. Fixing missing isAdmin field for user tF07x5SOPXTsMxzuihbEgGvtnxr1...');
  const userRef = db.collection('users').doc('tF07x5SOPXTsMxzuihbEgGvtnxr1');
  const userDoc = await userRef.get();

  if (userDoc.exists) {
    const userData = userDoc.data()!;
    if (userData.isAdmin === undefined) {
      await userRef.update({ isAdmin: false });
      console.log(`   ✓ Added isAdmin: false to user ${userData.teamName || userData.email || userDoc.id}`);
    } else {
      console.log(`   - User already has isAdmin: ${userData.isAdmin}`);
    }
  } else {
    console.log('   ✗ User document not found!');
  }

  // ISSUE 2: Calculate missing Australian GP scores
  console.log('\n2. Calculating missing Australian GP scores...');

  // Get the race result
  const resultDoc = await db.collection('race_results').doc('australian-grand-prix-gp').get();
  if (!resultDoc.exists) {
    console.log('   ✗ Race result document not found!');
    return;
  }

  const result = resultDoc.data()!;
  const actualTop6 = [result.driver1, result.driver2, result.driver3, result.driver4, result.driver5, result.driver6];
  console.log(`   Actual Top 6: ${actualTop6.join(', ')}`);

  // Users with missing scores
  const missingScores = [
    { userId: 'Rin8HI7VCMa1C3b18YRiZNlhGjd2', isSecondary: true },
    { userId: 'YwlX0LGd0PeqoXrJxjCxMRrC0R63', isSecondary: false },
    { userId: 'kr8UEJunldOXCbMO3WDk2bLs2X12', isSecondary: false },
  ];

  for (const { userId, isSecondary } of missingScores) {
    console.log(`\n   Processing ${userId}${isSecondary ? ' (secondary)' : ''}...`);

    // Get user info
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const teamName = isSecondary
      ? (userData?.secondaryTeamName || 'Unknown Secondary')
      : (userData?.teamName || 'Unknown');

    // Find the prediction
    const predSnap = await db.collection('users').doc(userId).collection('predictions').get();
    let prediction: string[] | null = null;

    for (const predDoc of predSnap.docs) {
      const data = predDoc.data();
      const raceId = (data.raceId || predDoc.id || '').toLowerCase();
      const predTeamName = data.teamName;

      // Match race and team type
      if (raceId.includes('australian')) {
        const isPredSecondary = predTeamName && userData?.secondaryTeamName === predTeamName;

        if ((isSecondary && isPredSecondary) || (!isSecondary && !isPredSecondary)) {
          if (Array.isArray(data.predictions) && data.predictions.length === 6) {
            prediction = data.predictions;
            console.log(`   Found prediction: ${prediction.join(', ')}`);
            break;
          }
        }
      }
    }

    if (!prediction) {
      console.log(`   ✗ No valid prediction found for this user`);
      continue;
    }

    // Calculate score
    const calc = calculateScore(prediction, actualTop6);

    // Create score document
    const scoreDocId = isSecondary
      ? `australian-grand-prix-gp_${userId}-secondary`
      : `australian-grand-prix-gp_${userId}`;

    // Check if score already exists
    const existingScore = await db.collection('scores').doc(scoreDocId).get();
    if (existingScore.exists) {
      console.log(`   - Score already exists: ${existingScore.data()?.totalPoints} pts`);
      continue;
    }

    await db.collection('scores').doc(scoreDocId).set({
      userId: isSecondary ? `${userId}-secondary` : userId,
      raceId: 'australian-grand-prix-gp',
      totalPoints: calc.total,
      breakdown: calc.breakdown,
      calculatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`   ✓ Created score for ${teamName}: ${calc.total} pts`);
    console.log(`     Breakdown: ${calc.breakdown}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('DONE');
}

fixIssues()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
