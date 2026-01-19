/**
 * Verification Script for BIG SHAKEDOWN
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/verify-big-shakedown.ts
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Firebase Admin using application default credentials
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

const db = getFirestore();

interface TestResult {
  group: string;
  expected: string;
  actual: string;
  pass: boolean;
  details: string[];
}

async function getStandings(): Promise<Map<string, { totalPoints: number; rank: number; teamName: string }>> {
  // Aggregate scores per user
  const scoresSnapshot = await db.collection('scores').get();
  const userTotals = new Map<string, number>();

  scoresSnapshot.forEach((doc) => {
    const data = doc.data();
    const userId = data.userId;
    const points = data.totalPoints || 0;
    userTotals.set(userId, (userTotals.get(userId) || 0) + points);
  });

  // Get team names
  const usersSnapshot = await db.collection('users').get();
  const userMap = new Map<string, string>();
  usersSnapshot.forEach((doc) => {
    userMap.set(doc.id, doc.data().teamName || 'Unknown');
  });

  // Build and sort standings
  const sortedEntries = Array.from(userTotals.entries())
    .map(([userId, totalPoints]) => ({
      userId,
      teamName: userMap.get(userId) || 'Unknown',
      totalPoints,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  // Assign ranks with ties
  const result = new Map<string, { totalPoints: number; rank: number; teamName: string }>();
  let currentRank = 1;

  sortedEntries.forEach((entry, index) => {
    if (index > 0 && entry.totalPoints < sortedEntries[index - 1].totalPoints) {
      currentRank = index + 1;
    }
    result.set(entry.userId, {
      totalPoints: entry.totalPoints,
      rank: currentRank,
      teamName: entry.teamName,
    });
  });

  return result;
}

async function verify() {
  console.log('\n🔍 BIG SHAKEDOWN VERIFICATION');
  console.log('='.repeat(60));

  const standings = await getStandings();
  const results: TestResult[] = [];

  // Print full standings for reference
  console.log('\n📊 FULL STANDINGS:');
  console.log('-'.repeat(60));
  console.log(`${'Rank'.padEnd(6)}${'User ID'.padEnd(12)}${'Team'.padEnd(25)}${'Points'.padStart(8)}`);
  console.log('-'.repeat(60));

  const sortedStandings = Array.from(standings.entries())
    .sort((a, b) => a[1].rank - b[1].rank);

  for (const [userId, data] of sortedStandings) {
    console.log(`${data.rank.toString().padEnd(6)}${userId.padEnd(12)}${data.teamName.padEnd(25)}${data.totalPoints.toString().padStart(8)}`);
  }

  // Test 1: The Dominators (Users 1-3) should have exactly 264 points
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: The Dominators (Users 1-3)');
  console.log('-'.repeat(60));
  const dominatorIds = ['user_01', 'user_02', 'user_03'];
  const dominatorDetails: string[] = [];
  let dominatorsPass = true;

  for (const userId of dominatorIds) {
    const data = standings.get(userId);
    const points = data?.totalPoints || 0;
    const pass = points === 264;
    dominatorsPass = dominatorsPass && pass;
    dominatorDetails.push(`  ${userId}: ${points} pts ${pass ? '✅' : '❌ (expected 264)'}`);
  }

  results.push({
    group: 'Dominators',
    expected: '264 points each (24 × 11)',
    actual: dominatorDetails.join('\n'),
    pass: dominatorsPass,
    details: dominatorDetails,
  });

  console.log(`Expected: 264 points each (24 races × 11 pts)`);
  dominatorDetails.forEach(d => console.log(d));
  console.log(`Result: ${dominatorsPass ? 'PASS ✅' : 'FAIL ❌'}`);

  // Test 2: The Quitters (Users 11-15) should have exactly 55 points
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: The Quitters (Users 11-15)');
  console.log('-'.repeat(60));
  const quitterIds = ['user_11', 'user_12', 'user_13', 'user_14', 'user_15'];
  const quitterDetails: string[] = [];
  let quittersPass = true;

  for (const userId of quitterIds) {
    const data = standings.get(userId);
    const points = data?.totalPoints || 0;
    const pass = points === 55;
    quittersPass = quittersPass && pass;
    quitterDetails.push(`  ${userId}: ${points} pts ${pass ? '✅' : '❌ (expected 55)'}`);
  }

  results.push({
    group: 'Quitters',
    expected: '55 points each (5 × 11)',
    actual: quitterDetails.join('\n'),
    pass: quittersPass,
    details: quitterDetails,
  });

  console.log(`Expected: 55 points each (5 races × 11 pts)`);
  quitterDetails.forEach(d => console.log(d));
  console.log(`Result: ${quittersPass ? 'PASS ✅' : 'FAIL ❌'}`);

  // Test 3: The Late Joiners (Users 16-18) should have exactly 165 points
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: The Late Joiners (Users 16-18)');
  console.log('-'.repeat(60));
  const lateJoinerIds = ['user_16', 'user_17', 'user_18'];
  const lateJoinerDetails: string[] = [];
  let lateJoinersPass = true;

  for (const userId of lateJoinerIds) {
    const data = standings.get(userId);
    const points = data?.totalPoints || 0;
    const pass = points === 165;
    lateJoinersPass = lateJoinersPass && pass;
    lateJoinerDetails.push(`  ${userId}: ${points} pts ${pass ? '✅' : '❌ (expected 165)'}`);
  }

  results.push({
    group: 'Late Joiners',
    expected: '165 points each (15 × 11)',
    actual: lateJoinerDetails.join('\n'),
    pass: lateJoinersPass,
    details: lateJoinerDetails,
  });

  console.log(`Expected: 165 points each (15 races × 11 pts)`);
  lateJoinerDetails.forEach(d => console.log(d));
  console.log(`Result: ${lateJoinersPass ? 'PASS ✅' : 'FAIL ❌'}`);

  // Test 4: The Clones (Users 19-20) should have identical scores and ranks
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: The Clones (Users 19-20)');
  console.log('-'.repeat(60));
  const clone1 = standings.get('user_19');
  const clone2 = standings.get('user_20');
  const clone1Points = clone1?.totalPoints || 0;
  const clone2Points = clone2?.totalPoints || 0;
  const clone1Rank = clone1?.rank || 0;
  const clone2Rank = clone2?.rank || 0;

  const clonesScoreMatch = clone1Points === clone2Points;
  const clonesRankMatch = clone1Rank === clone2Rank;
  const clonesPass = clonesScoreMatch && clonesRankMatch;

  const cloneDetails = [
    `  user_19: ${clone1Points} pts, Rank ${clone1Rank}`,
    `  user_20: ${clone2Points} pts, Rank ${clone2Rank}`,
    `  Scores match: ${clonesScoreMatch ? '✅' : '❌'}`,
    `  Ranks match: ${clonesRankMatch ? '✅' : '❌'}`,
  ];

  results.push({
    group: 'Clones',
    expected: 'Identical scores and ranks',
    actual: cloneDetails.join('\n'),
    pass: clonesPass,
    details: cloneDetails,
  });

  console.log(`Expected: Identical scores and identical ranks`);
  cloneDetails.forEach(d => console.log(d));
  console.log(`Result: ${clonesPass ? 'PASS ✅' : 'FAIL ❌'}`);

  // Test 5: Tie-Breakers - Are all Dominators Rank 1?
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: Tie-Breakers (Dominators should all be Rank 1)');
  console.log('-'.repeat(60));
  const tieBreakerDetails: string[] = [];
  let tieBreakerPass = true;

  for (const userId of dominatorIds) {
    const data = standings.get(userId);
    const rank = data?.rank || 0;
    const pass = rank === 1;
    tieBreakerPass = tieBreakerPass && pass;
    tieBreakerDetails.push(`  ${userId}: Rank ${rank} ${pass ? '✅' : '❌ (expected 1)'}`);
  }

  results.push({
    group: 'Tie-Breakers',
    expected: 'All dominators at Rank 1',
    actual: tieBreakerDetails.join('\n'),
    pass: tieBreakerPass,
    details: tieBreakerDetails,
  });

  console.log(`Expected: All dominators should be Rank 1 (tied)`);
  tieBreakerDetails.forEach(d => console.log(d));
  console.log(`Result: ${tieBreakerPass ? 'PASS ✅' : 'FAIL ❌'}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  const passCount = results.filter(r => r.pass).length;
  const totalCount = results.length;

  results.forEach((r) => {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.group}`);
  });

  console.log('-'.repeat(60));
  console.log(`Total: ${passCount}/${totalCount} tests passed`);
  console.log('='.repeat(60));

  return results.every(r => r.pass);
}

verify()
  .then((allPassed) => {
    console.log(allPassed ? '\n🎉 ALL TESTS PASSED!' : '\n⚠️ SOME TESTS FAILED');
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
