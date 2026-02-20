/**
 * GUID: SCRIPT_CONSOLIDATE_BOOKOFWORK-000
 * Intent: Establish Firestore book_of_work as single source of truth
 * Trigger: User wants to eliminate duplication between Vestige, RedTeam.json, and Firestore
 * Impact: Firestore becomes authoritative, Vestige book-of-work entries purged
 *
 * Steps:
 * 1. Read all RedTeam.json issues (120 total)
 * 2. Check git commit history to identify already-fixed issues
 * 3. Query current Firestore book_of_work collection
 * 4. Add missing RedTeam.json issues to Firestore (with fix status if already remediated)
 * 5. Verify all entries are correctly described
 * 6. Generate report of Vestige nodes to purge
 * 7. Output purge commands for user approval
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

/**
 * GUID: SCRIPT_CONSOLIDATE_BOOKOFWORK-001
 * Intent: Check git commit history to identify if issue was already fixed
 * Trigger: Need to avoid adding already-remediated issues to book-of-work
 * Impact: Sets status='done' and adds versionFixed for already-fixed issues
 */
function checkIfAlreadyFixed(guid: string, file?: string): { fixed: boolean; version?: string; commitHash?: string } {
  try {
    // Search commit messages for the GUID
    const gitLog = execSync(
      `git log --all --grep="${guid}" --pretty=format:"%H|%ai|%s" --max-count=10`,
      { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
    );

    if (!gitLog) {
      return { fixed: false };
    }

    const commits = gitLog.split('\n').filter(Boolean);

    // Look for commit messages indicating a fix
    for (const commit of commits) {
      const [hash, date, message] = commit.split('|');

      // Check if commit message indicates a fix
      if (
        message.toLowerCase().includes('fix') ||
        message.toLowerCase().includes('resolve') ||
        message.toLowerCase().includes('remediate') ||
        message.toLowerCase().includes('security:')
      ) {
        // Extract version from commit message (e.g., "v1.55.28" or "(1.55.28)")
        const versionMatch = message.match(/v?(\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : undefined;

        console.log(`  ✓ ${guid} appears FIXED in commit ${hash.substring(0, 7)} - ${message}`);
        return { fixed: true, version, commitHash: hash.substring(0, 7) };
      }
    }

    // If file specified, check if file was deleted (might indicate fix)
    if (file) {
      try {
        execSync(`git log --all --diff-filter=D --pretty=format:"%H|%s" -- "${file}"`, {
          cwd: path.join(__dirname, '..'),
          encoding: 'utf8'
        });
        // File was deleted - might be fixed
        console.log(`  ℹ ${guid} - file ${file} was deleted (possible fix)`);
      } catch {
        // File still exists
      }
    }

    return { fixed: false };
  } catch (error) {
    // Git command failed - assume not fixed
    return { fixed: false };
  }
}

/**
 * GUID: SCRIPT_CONSOLIDATE_BOOKOFWORK-002
 * Intent: Load and parse RedTeam.json
 * Trigger: Need to ensure all security findings are in Firestore
 * Impact: Source data for consolidation
 */
function loadRedTeamIssues(): any[] {
  const redTeamPath = path.join(__dirname, '..', 'RedTeam.json');
  const content = fs.readFileSync(redTeamPath, 'utf8');
  return JSON.parse(content);
}

/**
 * GUID: SCRIPT_CONSOLIDATE_BOOKOFWORK-003
 * Intent: Map RedTeam.json issue to BookOfWorkEntry format
 * Trigger: Need consistent schema for Firestore
 * Impact: Transforms RedTeam format to book_of_work format
 */
function mapRedTeamToBookOfWork(issue: any, fixStatus: { fixed: boolean; version?: string; commitHash?: string }) {
  // Determine severity from priority field
  let severity: 'critical' | 'high' | 'medium' | 'low' | 'informational' = 'medium';

  if (issue.priority === 'Critical') severity = 'critical';
  else if (issue.priority === 'High') severity = 'high';
  else if (issue.priority === 'Medium') severity = 'medium';
  else if (issue.priority === 'Low') severity = 'low';
  else if (issue.priority === 'Informational') severity = 'informational';

  // Determine category
  let category: 'security' | 'ui' | 'feature' | 'cosmetic' | 'infrastructure' | 'system-error' | 'user-error' = 'security';

  if (issue.module?.includes('UX') || issue.module?.includes('UI')) category = 'ui';
  else if (issue.module?.includes('Infrastructure')) category = 'infrastructure';

  // Build description with rationale
  const description = issue.rationale || issue.security_issue || issue.task || 'No description available';

  return {
    guid: issue.guid,
    title: issue.security_issue || issue.task || 'Untitled Issue',
    description,
    category,
    severity,
    status: fixStatus.fixed ? ('done' as const) : ('tbd' as const),
    source: 'vestige-redteam' as const,
    package: `security-${severity}` as any,
    file: issue.file,
    module: issue.module || 'Unknown',
    tags: ['redteam', 'gemini-audit', ...(issue.file ? ['firestore'] : [])],
    priority: severity === 'critical' ? 10 : severity === 'high' ? 7 : severity === 'medium' ? 5 : 3,
    versionReported: issue.version || undefined,
    versionFixed: fixStatus.version,
    commitHash: fixStatus.commitHash,
    completedAt: fixStatus.fixed ? Timestamp.now() : undefined,
  };
}

/**
 * GUID: SCRIPT_CONSOLIDATE_BOOKOFWORK-004
 * Intent: Main consolidation logic
 * Trigger: User requested single source of truth
 * Impact: Populates Firestore, generates Vestige purge report
 */
async function consolidateBookOfWork() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BOOK OF WORK CONSOLIDATION - SINGLE SOURCE OF TRUTH');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Load RedTeam.json
  console.log('📖 Step 1: Loading RedTeam.json...');
  const redTeamIssues = loadRedTeamIssues();
  console.log(`  ✓ Loaded ${redTeamIssues.length} total issues from RedTeam.json\n`);

  // Filter for valid issues (has guid field)
  const validIssues = redTeamIssues.filter(issue => issue.guid && issue.guid.startsWith('GEMINI-AUDIT-'));
  console.log(`  ✓ Found ${validIssues.length} valid GEMINI-AUDIT issues\n`);

  // Step 2: Query current Firestore collection
  console.log('🔍 Step 2: Querying current Firestore book_of_work collection...');
  const snapshot = await db.collection('book_of_work').get();
  const existingGuids = new Set<string>();

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.guid) {
      existingGuids.add(data.guid);
    }
  });

  console.log(`  ✓ Found ${snapshot.size} existing entries (${existingGuids.size} with GUIDs)\n`);

  // Step 3: Check git history for fixes
  console.log('🔎 Step 3: Checking git commit history for already-fixed issues...');
  const issuesWithFixStatus = validIssues.map(issue => {
    const fixStatus = checkIfAlreadyFixed(issue.guid, issue.file);
    return { issue, fixStatus };
  });

  const alreadyFixed = issuesWithFixStatus.filter(i => i.fixStatus.fixed).length;
  console.log(`  ✓ Found ${alreadyFixed} already-fixed issues in git history\n`);

  // Step 4: Identify missing issues
  console.log('📝 Step 4: Identifying missing issues to add...');
  const missingIssues = issuesWithFixStatus.filter(({ issue }) => !existingGuids.has(issue.guid));
  console.log(`  ✓ ${missingIssues.length} issues need to be added to Firestore\n`);

  // Step 5: Add missing issues to Firestore
  if (missingIssues.length > 0) {
    console.log('💾 Step 5: Adding missing issues to Firestore...');
    const batch = db.batch();
    const now = Timestamp.now();

    for (const { issue, fixStatus } of missingIssues) {
      const docRef = db.collection('book_of_work').doc();
      const rawEntry = {
        id: docRef.id,
        ...mapRedTeamToBookOfWork(issue, fixStatus),
        createdAt: now,
        updatedAt: now,
        sourceData: {
          originalSource: 'RedTeam.json',
          consolidationDate: '2026-02-20',
          gitHistoryChecked: true,
        },
      };

      // Filter out undefined values (Firestore doesn't accept them)
      const entry = Object.fromEntries(
        Object.entries(rawEntry).filter(([_, value]) => value !== undefined)
      );

      batch.set(docRef, entry);

      const statusIcon = fixStatus.fixed ? '✅' : '⏳';
      console.log(`  ${statusIcon} ${issue.guid} (${entry.severity}) - ${entry.status}`);
    }

    await batch.commit();
    console.log(`\n  ✓ Successfully added ${missingIssues.length} issues to Firestore\n`);
  } else {
    console.log('  ✓ No missing issues - Firestore is complete\n');
  }

  // Step 6: Generate statistics
  console.log('📊 Step 6: Generating statistics...');
  const newSnapshot = await db.collection('book_of_work').get();

  const stats = {
    total: newSnapshot.size,
    byStatus: { tbd: 0, in_progress: 0, done: 0, wont_fix: 0, duplicate: 0 },
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
    bySource: {} as Record<string, number>,
  };

  newSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.status) stats.byStatus[data.status as keyof typeof stats.byStatus]++;
    if (data.severity) stats.bySeverity[data.severity as keyof typeof stats.bySeverity]++;
    if (data.source) stats.bySource[data.source] = (stats.bySource[data.source] || 0) + 1;
  });

  console.log('\n  Firestore book_of_work Collection Statistics:');
  console.log(`  Total Entries: ${stats.total}`);
  console.log('\n  By Status:');
  Object.entries(stats.byStatus).forEach(([status, count]) => {
    console.log(`    ${status}: ${count}`);
  });
  console.log('\n  By Severity:');
  Object.entries(stats.bySeverity).forEach(([severity, count]) => {
    console.log(`    ${severity}: ${count}`);
  });
  console.log('\n  By Source:');
  Object.entries(stats.bySource).forEach(([source, count]) => {
    console.log(`    ${source}: ${count}`);
  });

  // Step 7: Generate Vestige purge report
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  VESTIGE PURGE REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('🗑️  Vestige Memory Nodes to Purge (book-of-work entries):');
  console.log('\nThe following Vestige nodes contain book-of-work data and should be deleted:');
  console.log('\n1. Node: 52a80a91-bb5b-4888-b595-1628c5c41774');
  console.log('   Content: Critical Issues (10 issues from RedTeam.json)');
  console.log('   Tags: book-of-work, firestore, security, critical');

  console.log('\n2. Node: 9e263b80-83d2-45b7-b1ae-56073dbcb011');
  console.log('   Content: High/Medium/Low Issues (7 issues from RedTeam.json)');
  console.log('   Tags: book-of-work, firestore, security, high, medium, low');

  console.log('\n3. Node: 41c4dfdc-c49d-43e6-8656-00c88d301573');
  console.log('   Content: Updated Summary (metadata tracking)');
  console.log('   Tags: book-of-work, security-audit, updated');

  console.log('\n4. Node: a50dc8a8-1a15-4b74-9d39-c47c4d41ec69');
  console.log('   Content: Previous book-of-work tracking (526 issues)');
  console.log('   Tags: book-of-work, prix six, security audit');

  console.log('\n5. Node: 399ccba5-5899-4fd6-80d4-3bb959d80a93');
  console.log('   Content: Backup book-of-work (525 issues from c9a2343)');
  console.log('   Tags: book-of-work, backup, valid json');

  console.log('\n6. Node: 09c1fe72-bbc0-4443-9efe-052010b12b04');
  console.log('   Content: FIRESTORE-001 task (race_schedule explicit rule)');
  console.log('   Tags: book-of-work, firestore, security, race_schedule');

  console.log('\n7. Node: 1dcded0a-8d63-46ca-a578-e5cd0f67d8b6');
  console.log('   Content: Centralized Book of Work Implementation session');
  console.log('   Tags: book-of-work, admin-panel, firestore');

  console.log('\n\n📋 PURGE SCRIPT:');
  console.log('\nSave this as scripts/purge-vestige-bookofwork.txt and execute manually:\n');

  const nodesToPurge = [
    '52a80a91-bb5b-4888-b595-1628c5c41774',
    '9e263b80-83d2-45b7-b1ae-56073dbcb011',
    '41c4dfdc-c49d-43e6-8656-00c88d301573',
    'a50dc8a8-1a15-4b74-9d39-c47c4d41ec69',
    '399ccba5-5899-4fd6-80d4-3bb959d80a93',
    '09c1fe72-bbc0-4443-9efe-052010b12b04',
    '1dcded0a-8d63-46ca-a578-e5cd0f67d8b6',
  ];

  const purgeCommands = nodesToPurge.map(nodeId =>
    `mcp__vestige__memory with action: "delete", id: "${nodeId}"`
  ).join('\n');

  const purgeScript = `# Vestige Book-of-Work Purge Script
# Generated: 2026-02-20
# Purpose: Remove duplicate book-of-work entries from Vestige
# Single Source of Truth: Firestore book_of_work collection

Total nodes to purge: ${nodesToPurge.length}

Execute these commands in Claude Code:

${purgeCommands}

After purging, verify with:
mcp__vestige__search "book-of-work"
(Should return 0 results or only non-duplicate entries)
`;

  fs.writeFileSync(
    path.join(__dirname, 'purge-vestige-bookofwork.txt'),
    purgeScript
  );

  console.log(purgeScript);
  console.log('\n✅ Purge script saved to: scripts/purge-vestige-bookofwork.txt\n');

  // Final summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CONSOLIDATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('✅ Firestore book_of_work: AUTHORITATIVE (Single Source of Truth)');
  console.log(`   Total Entries: ${stats.total}`);
  console.log(`   Ready to view: https://prix6.win/admin (Book of Work tab)\n`);
  console.log('⏳ Vestige Purge: READY');
  console.log(`   Nodes to purge: ${nodesToPurge.length}`);
  console.log('   Script: scripts/purge-vestige-bookofwork.txt\n');
  console.log('📝 Next Steps:');
  console.log('   1. Review Firestore book_of_work in admin panel');
  console.log('   2. Verify all issues are correctly described');
  console.log('   3. Execute Vestige purge script (manual approval required)');
  console.log('   4. Verify Vestige is clean: mcp__vestige__search "book-of-work"\n');
}

// Run consolidation
consolidateBookOfWork()
  .then(() => {
    console.log('✅ Consolidation script complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Consolidation failed:', error);
    process.exit(1);
  });
