/**
 * CLI script to run Prix Six Consistency Checker
 *
 * Purpose: Run all consistency checks and display results without requiring UI interaction.
 * This allows programmatic validation and bug fixing.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/run-consistency-check.ts
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import {
  checkUsers,
  checkDrivers,
  checkRaces,
  checkPredictions,
  checkTeamCoverage,
  checkRaceResults,
  checkScores,
  checkStandings,
  checkLeagues,
  generateSummary,
  type CheckResult,
  type ConsistencyCheckSummary,
  type UserData,
  type PredictionData,
  type RaceResultData,
  type ScoreData,
  type LeagueData,
} from '../src/lib/consistency';

// Initialize Firebase Admin
const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function runConsistencyCheck(): Promise<ConsistencyCheckSummary> {
  console.log('\n=== Prix Six Consistency Checker ===\n');

  const results: CheckResult[] = [];

  try {
    // 1. Check Users
    console.log('[1/9] Checking users...');
    const usersSnap = await db.collection('users').get();
    const userData: UserData[] = usersSnap.docs.map(doc => {
      const u = doc.data();
      return {
        id: doc.id,
        email: u.email,
        teamName: u.teamName,
        isAdmin: u.isAdmin,
        secondaryTeamName: u.secondaryTeamName,
        secondaryEmail: u.secondaryEmail,
        secondaryEmailVerified: u.secondaryEmailVerified,
      };
    });
    results.push(checkUsers(userData));

    // 2. Check Drivers (static)
    console.log('[2/9] Checking drivers...');
    results.push(checkDrivers());

    // 3. Check Races (static)
    console.log('[3/9] Checking races...');
    results.push(checkRaces());

    // 4. Check Predictions
    console.log('[4/9] Checking predictions...');
    const predictionsSnap = await db.collectionGroup('predictions').get();

    // Build map of user secondary team names
    const userSecondaryTeams = new Map<string, string>();
    for (const u of userData) {
      if (u.secondaryTeamName) {
        userSecondaryTeams.set(u.id, u.secondaryTeamName);
      }
    }

    const predData: PredictionData[] = predictionsSnap.docs.map(doc => {
      const p = doc.data();
      // Extract userId from document path: users/{userId}/predictions/{predId}
      const pathParts = doc.ref.path.split('/');
      const extractedUserId = pathParts.length >= 2 ? pathParts[1] : undefined;
      const userId = p.userId || p.teamId || extractedUserId;

      // Check if this prediction is for a secondary team
      let effectiveUserId = userId;
      if (userId && p.teamName && userSecondaryTeams.get(userId) === p.teamName) {
        effectiveUserId = `${userId}-secondary`;
      }

      return {
        id: doc.id,
        userId: effectiveUserId,
        teamId: p.teamId,
        teamName: p.teamName,
        raceId: p.raceId,
        predictions: p.predictions,
      };
    });
    results.push(checkPredictions(predData, userData));

    // 5. Check Team Coverage
    console.log('[5/9] Checking team coverage...');
    results.push(checkTeamCoverage(userData, predData));

    // 6. Check Race Results
    console.log('[6/9] Checking race results...');
    const raceResultsSnap = await db.collection('race_results').get();
    const resultData: RaceResultData[] = raceResultsSnap.docs.map(doc => {
      const r = doc.data();
      return {
        id: doc.id,
        raceId: r.raceId,
        driver1: r.driver1,
        driver2: r.driver2,
        driver3: r.driver3,
        driver4: r.driver4,
        driver5: r.driver5,
        driver6: r.driver6,
      };
    });
    results.push(checkRaceResults(resultData));

    // 7. Check Scores
    console.log('[7/9] Checking scores...');
    const scoresSnap = await db.collection('scores').get();
    const scoreData: ScoreData[] = scoresSnap.docs.map(doc => {
      const s = doc.data();
      return {
        id: doc.id,
        userId: s.userId,
        raceId: s.raceId,
        totalPoints: s.totalPoints,
        breakdown: s.breakdown,
      };
    });
    results.push(checkScores(scoreData, resultData, predData, userData));

    // 8. Check Standings
    console.log('[8/9] Checking standings...');
    results.push(checkStandings(scoreData, userData));

    // 9. Check Leagues
    console.log('[9/9] Checking leagues...');
    const leaguesSnap = await db.collection('leagues').get();
    const leagueData: LeagueData[] = leaguesSnap.docs.map(doc => {
      const l = doc.data();
      return {
        id: doc.id,
        name: l.name,
        ownerId: l.ownerId,
        memberUserIds: l.memberUserIds,
        isGlobal: l.isGlobal,
        inviteCode: l.inviteCode,
      };
    });
    results.push(checkLeagues(leagueData, userData));

    // Generate summary
    console.log('\n=== Generating Summary ===\n');
    const summary = generateSummary(results);

    return summary;
  } catch (error) {
    console.error('\n❌ Consistency check failed:', error);
    throw error;
  }
}

function displayResults(summary: ConsistencyCheckSummary) {
  console.log('='.repeat(70));
  console.log('CONSISTENCY CHECK SUMMARY');
  console.log('='.repeat(70));
  console.log(`Correlation ID: ${summary.correlationId}`);
  console.log(`Timestamp: ${summary.timestamp.toISOString()}`);
  console.log(`Total Checks: ${summary.totalChecks}`);
  console.log(`✓ Passed: ${summary.passed}`);
  console.log(`⚠ Warnings: ${summary.warnings}`);
  console.log(`✗ Errors: ${summary.errors}`);
  console.log('='.repeat(70));

  // Summary table
  console.log('\n' + '='.repeat(70));
  console.log('CATEGORY BREAKDOWN');
  console.log('='.repeat(70));
  console.log(`${'Category'.padEnd(20)} ${'Total'.padStart(8)} ${'Valid'.padStart(8)} ${'Issues'.padStart(8)} ${'Status'.padStart(10)}`);
  console.log('-'.repeat(70));

  for (const result of summary.results) {
    const statusSymbol = result.status === 'pass' ? '✓' : result.status === 'warning' ? '⚠' : '✗';
    console.log(
      `${result.category.padEnd(20)} ${String(result.total).padStart(8)} ${String(result.valid).padStart(8)} ${String(result.issues.length).padStart(8)} ${(statusSymbol + ' ' + result.status.toUpperCase()).padStart(10)}`
    );
  }
  console.log('='.repeat(70));

  // Score type breakdown (if available)
  const scoresResult = summary.results.find(r => r.category === 'scores');
  if (scoresResult?.scoreTypeCounts) {
    const sc = scoresResult.scoreTypeCounts;
    console.log('\n' + '='.repeat(70));
    console.log('SCORE TYPE BREAKDOWN');
    console.log('='.repeat(70));
    console.log(`Type A (+6 Exact Position):        ${sc.typeA}`);
    console.log(`Type B (+4 One Position Off):      ${sc.typeB}`);
    console.log(`Type C (+3 Two Positions Off):     ${sc.typeC}`);
    console.log(`Type D (+2 Three+ Positions Off):  ${sc.typeD}`);
    console.log(`Type E (+0 Not in Top 6):          ${sc.typeE}`);
    console.log(`Type F (+10 Perfect 6 Bonus):      ${sc.typeF}`);
    console.log(`Type G (Late Joiner Handicap):     ${sc.typeG}`);
    console.log(`Total Race Scores:                 ${sc.totalRaceScores}`);
    console.log(`Total Driver Predictions:          ${sc.totalDriverPredictions}`);
    console.log('='.repeat(70));
  }

  // Detailed issues
  const totalIssues = summary.results.reduce((sum, r) => sum + r.issues.length, 0);
  if (totalIssues > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('DETAILED ISSUES');
    console.log('='.repeat(70));

    for (const result of summary.results) {
      if (result.issues.length > 0) {
        console.log(`\n${result.category.toUpperCase()} (${result.issues.length} issues):`);
        console.log('-'.repeat(70));

        for (const issue of result.issues) {
          const severitySymbol = issue.severity === 'info' ? 'ℹ' : issue.severity === 'warning' ? '⚠' : '✗';
          console.log(`  ${severitySymbol} [${issue.severity.toUpperCase()}] ${issue.entity}`);
          if (issue.field) {
            console.log(`    Field: ${issue.field}`);
          }
          console.log(`    ${issue.message}`);
          if (issue.details) {
            console.log(`    Details: ${JSON.stringify(issue.details, null, 2).split('\n').map((line, i) => i === 0 ? line : '             ' + line).join('\n')}`);
          }
          console.log('');
        }
      }
    }
    console.log('='.repeat(70));
  } else {
    console.log('\n✓ ALL CHECKS PASSED - No issues found!');
  }
}

// Main execution
runConsistencyCheck()
  .then(summary => {
    displayResults(summary);

    const hasErrors = summary.errors > 0;
    const hasWarnings = summary.warnings > 0;

    console.log('\n' + '='.repeat(70));
    console.log('NEXT STEPS');
    console.log('='.repeat(70));
    if (hasErrors) {
      console.log('✗ ERRORS DETECTED - Fix errors before proceeding');
      console.log('  Review the detailed issues above and fix at root level');
      console.log('  Golden Rule #3: Single Source of Truth - fix data, not validators');
    } else if (hasWarnings) {
      console.log('⚠ WARNINGS DETECTED - Review and fix if necessary');
      console.log('  Warnings may be informational or require data cleanup');
    } else {
      console.log('✓ ALL CHECKS PASSED - Database is consistent!');
    }
    console.log('='.repeat(70) + '\n');

    process.exit(hasErrors ? 1 : 0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error during consistency check:', error);
    process.exit(1);
  });
