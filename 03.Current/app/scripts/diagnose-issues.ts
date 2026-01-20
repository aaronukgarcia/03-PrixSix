/**
 * Diagnose issues: email logs, CC-logs, Team-Time submission
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/diagnose-issues.ts
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

async function diagnoseIssues() {
  console.log('='.repeat(60));
  console.log('PRIX SIX DIAGNOSTIC REPORT');
  console.log('='.repeat(60));
  console.log(`Generated: ${new Date().toISOString()}\n`);

  // 1. Check CC-logs
  console.log('\n' + '='.repeat(60));
  console.log('1. CC-LOGS (Recent Consistency Checks)');
  console.log('='.repeat(60));

  const ccLogs = await db.collection('CC-logs')
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();

  if (ccLogs.empty) {
    console.log('No CC-logs found. Run the Consistency Checker first.');
  } else {
    console.log(`Found ${ccLogs.size} recent CC runs:\n`);
    ccLogs.forEach(doc => {
      const data = doc.data();
      console.log(`  Correlation ID: ${data.correlationId}`);
      console.log(`  Version: ${data.version}`);
      console.log(`  Executed: ${data.executedAt}`);
      console.log(`  Summary: ${data.summary?.passed} passed, ${data.summary?.warnings} warnings, ${data.summary?.errors} errors`);
      console.log(`  Total Issues: ${data.totalIssues}`);
      if (data.categoryResults) {
        console.log('  Categories:');
        data.categoryResults.forEach((cat: any) => {
          if (cat.issueCount > 0) {
            console.log(`    - ${cat.category}: ${cat.status} (${cat.issueCount} issues)`);
          }
        });
      }
      console.log('');
    });
  }

  // 2. Check Email Logs
  console.log('\n' + '='.repeat(60));
  console.log('2. EMAIL LOGS (Recent Email Attempts)');
  console.log('='.repeat(60));

  const emailLogs = await db.collection('email_logs')
    .orderBy('timestamp', 'desc')
    .limit(10)
    .get();

  if (emailLogs.empty) {
    console.log('No email logs found.');
  } else {
    console.log(`Found ${emailLogs.size} recent email attempts:\n`);

    let sentCount = 0;
    let failedCount = 0;
    let errorCount = 0;

    emailLogs.forEach(doc => {
      const data = doc.data();
      const status = data.status || 'unknown';

      if (status === 'sent') sentCount++;
      else if (status === 'failed') failedCount++;
      else if (status === 'error') errorCount++;

      console.log(`  To: ${data.to || data.toEmail}`);
      console.log(`  Subject: ${data.subject}`);
      console.log(`  Status: ${status}`);
      console.log(`  GUID: ${data.emailGuid || 'N/A'}`);
      if (data.error) {
        console.log(`  ERROR: ${data.error}`);
      }
      if (data.timestamp) {
        const ts = data.timestamp.toDate ? data.timestamp.toDate() : data.timestamp;
        console.log(`  Time: ${ts}`);
      }
      console.log('');
    });

    console.log(`Summary: ${sentCount} sent, ${failedCount} failed, ${errorCount} errors`);
  }

  // 3. Check Email Queue
  console.log('\n' + '='.repeat(60));
  console.log('3. EMAIL QUEUE (Pending Emails)');
  console.log('='.repeat(60));

  const emailQueue = await db.collection('email_queue').get();

  if (emailQueue.empty) {
    console.log('No emails in queue.');
  } else {
    console.log(`Found ${emailQueue.size} queued emails:\n`);
    emailQueue.forEach(doc => {
      const data = doc.data();
      console.log(`  To: ${data.toEmail}`);
      console.log(`  Subject: ${data.subject}`);
      console.log(`  Reason: ${data.reason}`);
      console.log('');
    });
  }

  // 4. Check for Team-Time
  console.log('\n' + '='.repeat(60));
  console.log('4. TEAM-TIME INVESTIGATION');
  console.log('='.repeat(60));

  // Search in users for Team-Time
  const usersSnapshot = await db.collection('users').get();
  let teamTimeUser: any = null;

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.teamName?.toLowerCase().includes('team-time') ||
        data.secondaryTeamName?.toLowerCase().includes('team-time')) {
      teamTimeUser = { id: doc.id, ...data };
    }
  });

  if (teamTimeUser) {
    console.log('\nFound Team-Time user:');
    console.log(`  User ID: ${teamTimeUser.id}`);
    console.log(`  Email: ${teamTimeUser.email}`);
    console.log(`  Primary Team: ${teamTimeUser.teamName}`);
    console.log(`  Secondary Team: ${teamTimeUser.secondaryTeamName || 'N/A'}`);
    console.log(`  Is Admin: ${teamTimeUser.isAdmin}`);

    // Check predictions for this user
    console.log('\n  Checking prediction_submissions...');
    const submissions = await db.collection('prediction_submissions')
      .where('oduserId', '==', teamTimeUser.id)
      .get();

    if (submissions.empty) {
      // Also try by teamName
      const subsByName = await db.collection('prediction_submissions')
        .where('teamName', '==', 'Team-Time')
        .get();

      if (subsByName.empty) {
        console.log('  No submissions found for Team-Time by ID or name!');
      } else {
        console.log(`  Found ${subsByName.size} submissions by teamName:`);
        subsByName.forEach(doc => {
          const data = doc.data();
          console.log(`    Race: ${data.raceId}`);
          console.log(`    Predictions: P1=${data.predictions?.P1 || 'EMPTY'}, P2=${data.predictions?.P2 || 'EMPTY'}...`);
          console.log(`    Submitted: ${data.submittedAt || 'NO DATE'}`);
        });
      }
    } else {
      console.log(`  Found ${submissions.size} submissions by oduserId:`);
      submissions.forEach(doc => {
        const data = doc.data();
        console.log(`    Race: ${data.raceId}`);
        console.log(`    Team: ${data.teamName}`);
        console.log(`    Predictions: P1=${data.predictions?.P1 || 'EMPTY'}, P2=${data.predictions?.P2 || 'EMPTY'}...`);
      });
    }

    // Check audit logs for Team-Time
    console.log('\n  Checking audit logs for Team-Time submissions...');
    const auditLogs = await db.collection('audit_logs')
      .where('userId', '==', teamTimeUser.id)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();

    if (auditLogs.empty) {
      console.log('  No audit logs found for this user.');
    } else {
      console.log(`  Found ${auditLogs.size} audit entries:`);
      auditLogs.forEach(doc => {
        const data = doc.data();
        console.log(`    Event: ${data.eventType}`);
        if (data.details) {
          console.log(`    Details: ${JSON.stringify(data.details).substring(0, 100)}...`);
        }
      });
    }
  } else {
    console.log('\nTeam-Time not found in users collection.');

    // Search directly in prediction_submissions
    console.log('\nSearching prediction_submissions for "Team-Time"...');
    const allSubs = await db.collection('prediction_submissions').get();
    let found = false;
    allSubs.forEach(doc => {
      const data = doc.data();
      if (data.teamName?.toLowerCase().includes('team-time')) {
        found = true;
        console.log(`  Found submission:`);
        console.log(`    Doc ID: ${doc.id}`);
        console.log(`    Team: ${data.teamName}`);
        console.log(`    Race: ${data.raceId}`);
        console.log(`    oduserId: ${data.oduserId}`);
        console.log(`    Predictions: ${JSON.stringify(data.predictions)}`);
      }
    });
    if (!found) {
      console.log('  No submissions found with Team-Time in teamName.');
    }
  }

  // 5. Team Count Validation
  console.log('\n' + '='.repeat(60));
  console.log('5. TEAM COUNT VALIDATION');
  console.log('='.repeat(60));

  let primaryTeams = 0;
  let secondaryTeams = 0;
  const allTeamNames = new Set<string>();

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.teamName) {
      primaryTeams++;
      allTeamNames.add(data.teamName.toLowerCase());
    }
    if (data.secondaryTeamName) {
      secondaryTeams++;
      allTeamNames.add(data.secondaryTeamName.toLowerCase());
    }
  });

  console.log(`\n  Total Users: ${usersSnapshot.size}`);
  console.log(`  Primary Teams: ${primaryTeams}`);
  console.log(`  Secondary Teams: ${secondaryTeams}`);
  console.log(`  Unique Team Names: ${allTeamNames.size}`);
  console.log(`  Expected Total: ${primaryTeams + secondaryTeams}`);

  if (allTeamNames.size !== primaryTeams + secondaryTeams) {
    console.log(`\n  WARNING: Team count mismatch! Some team names may be duplicated.`);
  }

  // List users with secondary teams
  console.log('\n  Users with secondary teams:');
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.secondaryTeamName) {
      console.log(`    ${data.email}: "${data.teamName}" + "${data.secondaryTeamName}"`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('END OF DIAGNOSTIC REPORT');
  console.log('='.repeat(60));
}

// Run diagnostics
diagnoseIssues()
  .then(() => {
    console.log('\nDiagnostics complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error running diagnostics:', error);
    process.exit(1);
  });
