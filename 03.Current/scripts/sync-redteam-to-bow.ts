#!/usr/bin/env tsx
/**
 * Sync new RedTeam.json entries into book_of_work collection
 * GUID: SCRIPT_SYNC_REDTEAM_BOW-000-v01
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(process.cwd(), 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

interface RedTeamEntry {
  module: string;
  guid: string;
  file?: string;
  date?: string;
  time?: string;
  security_issue?: string;
  rationale?: string;
  priority?: string;
  citation?: string;
  task?: string;
  status?: string;
  progress_percent?: number;
  files_audited?: number;
  new_flaws_found_session?: number;
  last_file_audited?: string;
  last_checkpoint?: string;
  notes?: string;
}

async function syncRedTeamToBookOfWork() {
  console.log('Syncing RedTeam.json entries to book_of_work collection...\n');
  console.log('═'.repeat(80));

  // Read RedTeam.json
  const redTeamPath = join(process.cwd(), 'RedTeam.json');
  const redTeamData: RedTeamEntry[] = JSON.parse(readFileSync(redTeamPath, 'utf8'));
  console.log(`RedTeam.json entries: ${redTeamData.length}`);

  // Get all existing book-of-work entries
  const bowSnapshot = await db.collection('book_of_work').get();
  const existingGuids = new Set<string>();

  bowSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    // Check both doc.id and title for GUID patterns
    if (doc.id && doc.id.match(/^[A-Z]+-\d+$/)) {
      existingGuids.add(doc.id);
    }
    if (data.guid) {
      existingGuids.add(data.guid);
    }
    if (data.title && data.title.match(/^[A-Z]+-\d+:/)) {
      const guid = data.title.split(':')[0];
      existingGuids.add(guid);
    }
  });

  console.log(`Existing GUIDs in book_of_work: ${existingGuids.size}\n`);

  // Filter out entries that already exist and progress tracker
  const newEntries = redTeamData.filter((entry) => {
    // Skip the progress tracker entry
    if (entry.guid === 'gemini-audit-progress-tracker-2026-02-12') {
      return false;
    }
    return !existingGuids.has(entry.guid);
  });

  console.log(`New entries to add: ${newEntries.length}\n`);

  if (newEntries.length === 0) {
    console.log('✅ No new entries to add - all RedTeam entries already in book_of_work');
    process.exit(0);
  }

  console.log('Adding new entries...\n');

  const addedEntries: { guid: string; title: string; severity: string }[] = [];

  for (const entry of newEntries) {
    // Map priority to severity
    const severityMap: Record<string, string> = {
      'Critical': 'critical',
      'High': 'high',
      'Medium': 'medium',
      'Low': 'low',
      'Informational': 'informational'
    };

    const severity = severityMap[entry.priority || 'Medium'] || 'medium';

    // Create book-of-work entry
    const bowEntry = {
      title: `${entry.guid}: ${entry.security_issue || entry.module}`,
      category: 'security' as const,
      severity: severity as any,
      status: 'tbd' as const,
      package: entry.priority ? `security-${severity}` : 'dependencies',
      description: entry.security_issue || entry.notes || entry.task || 'Security issue from RedTeam audit',
      technicalDetails: entry.rationale || entry.notes || '',
      notes: `Source: RedTeam.json (${entry.citation || 'Gemini Red Team'})
File: ${entry.file || 'N/A'}
Date: ${entry.date || 'Unknown'} ${entry.time || ''}
Module: ${entry.module}

${entry.rationale || ''}`,
      createdBy: entry.citation || 'Gemini Red Team',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      guid: entry.guid,
    };

    // Use the GUID as document ID for easy lookup
    await db.collection('book_of_work').doc(entry.guid).set(bowEntry);

    addedEntries.push({
      guid: entry.guid,
      title: bowEntry.title,
      severity: severity
    });

    console.log(`✅ Added: ${entry.guid}`);
    console.log(`   ${entry.security_issue || entry.module}`);
    console.log(`   Severity: ${severity}`);
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log(`\n✅ Sync complete - Added ${addedEntries.length} new entries to book_of_work\n`);

  // Summary by severity
  const bySeverity: Record<string, number> = {};
  addedEntries.forEach((entry) => {
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
  });

  console.log('Summary of added entries by severity:');
  Object.entries(bySeverity).forEach(([severity, count]) => {
    console.log(`  ${severity}: ${count}`);
  });

  console.log('\n✅ Check Admin Panel > Book of Work tab to view new entries');

  process.exit(0);
}

syncRedTeamToBookOfWork().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
