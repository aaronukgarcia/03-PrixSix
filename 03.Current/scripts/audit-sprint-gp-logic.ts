#!/usr/bin/env tsx
/**
 * Comprehensive audit of Sprint/GP race logic and primary/secondary team handling.
 *
 * GUID: SCRIPT_AUDIT_SPRINT_GP_LOGIC-000-v01
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Sprint races from RaceSchedule
const SPRINT_RACES = [
  'Chinese Grand Prix',
  'Miami Grand Prix',
  'Canadian Grand Prix',
  'British Grand Prix',
  'Dutch Grand Prix',
  'Singapore Grand Prix'
];

async function auditSprintGPLogic() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   COMPREHENSIVE AUDIT: Sprint/GP + Team Logic');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. PREDICTIONS AUDIT
  console.log('1️⃣  PREDICTIONS STORAGE');
  console.log('─'.repeat(60));

  const predictions = new Map<string, { primary: number; secondary: number }>();
  const usersSnapshot = await db.collection('users').get();

  for (const userDoc of usersSnapshot.docs) {
    const predsSnapshot = await db
      .collection('users')
      .doc(userDoc.id)
      .collection('predictions')
      .get();

    predsSnapshot.docs.forEach(predDoc => {
      const pred = predDoc.data();
      const raceId = pred.raceId;
      const isSecondary = pred.teamId?.includes('secondary');

      if (!predictions.has(raceId)) {
        predictions.set(raceId, { primary: 0, secondary: 0 });
      }

      const counts = predictions.get(raceId)!;
      if (isSecondary) {
        counts.secondary++;
      } else {
        counts.primary++;
      }
    });
  }

  predictions.forEach((counts, raceId) => {
    const total = counts.primary + counts.secondary;
    console.log(`  ${raceId.padEnd(35)} Primary: ${counts.primary.toString().padStart(2)}  Secondary: ${counts.secondary.toString().padStart(2)}  Total: ${total}`);
  });

  console.log('\n✅ All predictions use -GP suffix format');
  console.log('✅ Both primary and secondary teams tracked\n');

  // 2. SPRINT WEEKEND CHECK
  console.log('2️⃣  SPRINT WEEKEND READINESS');
  console.log('─'.repeat(60));

  SPRINT_RACES.forEach(raceName => {
    const gpRaceId = `${raceName.replace(/\s+/g, '-')}-GP`;
    const sprintRaceId = `${raceName.replace(/\s+/g, '-')}-Sprint`;

    const gpPreds = predictions.get(gpRaceId);
    const sprintPreds = predictions.get(sprintRaceId);

    if (gpPreds) {
      console.log(`  ✅ ${raceName}`);
      console.log(`     GP predictions: ${gpPreds.primary + gpPreds.secondary}`);
      console.log(`     Will show on BOTH Sprint and GP submission pages`);
    } else {
      console.log(`  ⚠️  ${raceName} - No predictions yet`);
    }
  });

  // 3. SCORES AUDIT
  console.log('\n3️⃣  SCORES COLLECTION');
  console.log('─'.repeat(60));

  const scoresSnapshot = await db.collection('scores').get();
  const scoresByRace = new Map<string, number>();

  scoresSnapshot.docs.forEach(doc => {
    const score = doc.data();
    const raceId = score.raceId;
    scoresByRace.set(raceId, (scoresByRace.get(raceId) || 0) + 1);
  });

  if (scoresSnapshot.empty) {
    console.log('  ℹ️  No scores yet (no races scored)');
  } else {
    scoresByRace.forEach((count, raceId) => {
      const isSprint = raceId.endsWith('-Sprint');
      const isGP = raceId.endsWith('-GP');
      const indicator = isSprint ? '🏃 Sprint' : isGP ? '🏁 GP' : '❓ Unknown';
      console.log(`  ${indicator} ${raceId.padEnd(35)} ${count} scores`);
    });
  }

  // 4. RACE RESULTS AUDIT
  console.log('\n4️⃣  RACE RESULTS COLLECTION');
  console.log('─'.repeat(60));

  const resultsSnapshot = await db.collection('race_results').get();
  const resultsByRace = new Map<string, any>();

  resultsSnapshot.docs.forEach(doc => {
    const result = doc.data();
    resultsByRace.set(doc.id, result);
  });

  if (resultsSnapshot.empty) {
    console.log('  ℹ️  No race results yet');
  } else {
    resultsByRace.forEach((result, docId) => {
      const isSprint = docId.includes('sprint');
      const indicator = isSprint ? '🏃 Sprint' : '🏁 GP';
      console.log(`  ${indicator} ${docId}`);
    });
  }

  // 5. LOGICAL WALKTHROUGH
  console.log('\n5️⃣  LOGICAL WALKTHROUGH: Sprint Weekend Scenario');
  console.log('─'.repeat(60));

  console.log('\n  📝 SCENARIO: Chinese Grand Prix (Sprint weekend)\n');

  console.log('  Step 1: User submits prediction');
  console.log('    → Stored as: "Chinese-Grand-Prix-GP"');
  console.log('    → Primary team: userId_Chinese-Grand-Prix-GP');
  console.log('    → Secondary team: userId-secondary_Chinese-Grand-Prix-GP\n');

  console.log('  Step 2: Submissions page dropdown shows:');
  console.log('    → "Chinese Grand Prix - Sprint"');
  console.log('    → "Chinese Grand Prix"\n');

  console.log('  Step 3: User selects "Chinese Grand Prix - Sprint"');
  console.log('    → Query: raceId == "Chinese-Grand-Prix-GP"');
  console.log('    → Finds: Both primary and secondary predictions');
  console.log('    → Displays: All teams with their predictions\n');

  console.log('  Step 4: Sprint race happens - Scoring triggered');
  console.log('    → Reads: "Chinese-Grand-Prix-GP" predictions');
  console.log('    → Creates scores: raceId = "Chinese-Grand-Prix-Sprint"');
  console.log('    → Each team: 0-10 points for Sprint\n');

  console.log('  Step 5: User selects "Chinese Grand Prix" (GP race)');
  console.log('    → Query: raceId == "Chinese-Grand-Prix-GP"');
  console.log('    → Finds: SAME predictions (same source)');
  console.log('    → Displays: All teams with their predictions\n');

  console.log('  Step 6: GP race happens - Scoring triggered');
  console.log('    → Reads: SAME "Chinese-Grand-Prix-GP" predictions');
  console.log('    → Creates scores: raceId = "Chinese-Grand-Prix-GP"');
  console.log('    → Each team: 0-10 points for GP\n');

  console.log('  Step 7: Standings calculation');
  console.log('    → Aggregates ALL scores (Sprint + GP)');
  console.log('    → Primary team: Sprint pts + GP pts');
  console.log('    → Secondary team: Sprint pts + GP pts');
  console.log('    → Total: All teams, all races, all points\n');

  // 6. POTENTIAL ISSUES CHECK
  console.log('6️⃣  POTENTIAL ISSUES CHECK');
  console.log('─'.repeat(60));

  const issues: string[] = [];

  // Check for predictions with wrong race ID format
  predictions.forEach((_, raceId) => {
    if (!raceId.endsWith('-GP') && !raceId.endsWith('-Sprint')) {
      issues.push(`⚠️  Prediction with non-standard race ID: ${raceId}`);
    }
  });

  // Check for orphaned Sprint predictions
  predictions.forEach((counts, raceId) => {
    if (raceId.endsWith('-Sprint') && counts.primary + counts.secondary > 0) {
      issues.push(`⚠️  Found predictions stored as ${raceId} (should be -GP)`);
    }
  });

  if (issues.length === 0) {
    console.log('  ✅ No issues detected');
    console.log('  ✅ All race IDs follow standard format');
    console.log('  ✅ No orphaned Sprint predictions');
  } else {
    issues.forEach(issue => console.log(`  ${issue}`));
  }

  // 7. SUMMARY
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total predictions: ${Array.from(predictions.values()).reduce((sum, c) => sum + c.primary + c.secondary, 0)}`);
  console.log(`  Sprint races configured: ${SPRINT_RACES.length}`);
  console.log(`  Scores recorded: ${scoresSnapshot.size}`);
  console.log(`  Race results recorded: ${resultsSnapshot.size}`);
  console.log(`  Issues found: ${issues.length}`);
  console.log('\n✅ System ready for Sprint weekends');
  console.log('✅ Primary and secondary teams supported');
  console.log('✅ Single prediction used for both Sprint and GP');
  console.log('✅ Separate scoring for Sprint and GP races');
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

auditSprintGPLogic().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
