/**
 * Diagnose scores in the database
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/diagnose-scores.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

const db = getFirestore();

async function diagnoseScores() {
  console.log('Diagnosing scores collection...\n');

  const scoresSnapshot = await db.collection('scores').get();
  console.log(`Total scores: ${scoresSnapshot.size}\n`);

  // Analyze score formats
  let lowercaseIds = 0;
  let titleCaseIds = 0;
  let hasUserId = 0;
  let hasOduserId = 0;
  let oldScoringValues = 0;  // Scores <= 11 (max for Wacky Racers)

  const sampleScores: any[] = [];

  for (const doc of scoresSnapshot.docs) {
    const data = doc.data();
    const id = doc.id;

    // Check ID format
    if (id === id.toLowerCase()) {
      lowercaseIds++;
    } else {
      titleCaseIds++;
      if (sampleScores.length < 5) {
        sampleScores.push({ id, ...data });
      }
    }

    if (data.userId) hasUserId++;
    if (data.oduserId) hasOduserId++;
    if (data.totalPoints !== undefined && data.totalPoints <= 11) {
      oldScoringValues++;
    }
  }

  console.log('=== Score Format Analysis ===');
  console.log(`Lowercase IDs (new format): ${lowercaseIds}`);
  console.log(`Title-case IDs (old format): ${titleCaseIds}`);
  console.log(`Has userId field: ${hasUserId}`);
  console.log(`Has oduserId field: ${hasOduserId}`);
  console.log(`Scores with value <= 11 (possible old scoring): ${oldScoringValues}`);

  if (sampleScores.length > 0) {
    console.log('\n=== Sample Title-Case Scores ===');
    for (const score of sampleScores) {
      console.log(JSON.stringify(score, null, 2));
    }
  }

  // Check for specific problematic score
  const problemScore = await db.collection('scores').doc('British-Grand-Prix_team_020').get();
  if (problemScore.exists) {
    console.log('\n=== Problematic Score Found ===');
    console.log(JSON.stringify({ id: problemScore.id, ...problemScore.data() }, null, 2));
  }
}

diagnoseScores()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
