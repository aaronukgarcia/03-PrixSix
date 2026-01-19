/**
 * Debug score lookup issues
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

async function debugScores() {
  console.log('=== DEBUG SCORE LOOKUP ===\n');

  const raceId = 'Australian-Grand-Prix';

  // Get submissions for this race
  console.log(`--- Submissions for ${raceId} ---`);
  const submissions = await db.collection('prediction_submissions')
    .where('raceId', '==', raceId)
    .limit(10)
    .get();

  const submissionData: { teamName: string; oduserId: string; userId: string }[] = [];
  submissions.forEach(doc => {
    const data = doc.data();
    submissionData.push({
      teamName: data.teamName,
      oduserId: data.oduserId || 'MISSING',
      userId: data.userId || 'MISSING',
    });
  });

  submissionData.forEach(s => {
    console.log(`  ${s.teamName}: oduserId="${s.oduserId}", userId="${s.userId}"`);
  });

  // Get scores for this race
  console.log(`\n--- Scores for ${raceId} ---`);
  const scores = await db.collection('scores')
    .where('raceId', '==', raceId)
    .limit(10)
    .get();

  const scoreData: { oduserId: string; userId: string; points: number }[] = [];
  scores.forEach(doc => {
    const data = doc.data();
    scoreData.push({
      oduserId: data.oduserId || 'MISSING',
      userId: data.userId || 'MISSING',
      points: data.totalPoints,
    });
  });

  scoreData.forEach(s => {
    console.log(`  oduserId="${s.oduserId}", userId="${s.userId}", points=${s.points}`);
  });

  // Check for mismatches
  console.log('\n--- Checking for score lookup mismatches ---');
  for (const sub of submissionData) {
    const matchByOduser = scoreData.find(s => s.oduserId === sub.oduserId);
    const matchByUser = scoreData.find(s => s.userId === sub.userId);

    if (!matchByOduser && !matchByUser) {
      console.log(`  ✗ NO MATCH: ${sub.teamName} (oduserId=${sub.oduserId}, userId=${sub.userId})`);
    } else if (!matchByOduser && matchByUser) {
      console.log(`  ! PARTIAL: ${sub.teamName} - matches by userId but not oduserId`);
    } else {
      console.log(`  ✓ ${sub.teamName}: ${matchByOduser?.points} pts`);
    }
  }
}

debugScores()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
