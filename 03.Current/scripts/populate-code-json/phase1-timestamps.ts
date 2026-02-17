#!/usr/bin/env node
/**
 * Phase 1: Extract Git Timestamps for all files in code.json
 *
 * For each unique file path:
 * - Created: First commit (git log --diff-filter=A)
 * - LastUpdated: Most recent commit (git log -1)
 *
 * Output: checkpoints/phase1-timestamps.json
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  guids: Array<{
    guid: string;
    location: {
      filePath: string;
    };
  }>;
}

interface FileTimestamps {
  [filePath: string]: {
    created: string | null;
    lastUpdated: string | null;
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_JSON_PATH = path.join(PROJECT_ROOT, 'code.json');
const CHECKPOINT_PATH = path.join(__dirname, 'checkpoints', 'phase1-timestamps.json');

function execGit(command: string): string {
  try {
    return execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    return '';
  }
}

function parseGitTimestamp(gitOutput: string): string | null {
  if (!gitOutput) return null;

  // Parse: "2026-01-26 02:13:39 +0000" → "2026-01-26T02:13:39Z"
  const match = gitOutput.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/);
  if (!match) return null;

  const [, date, time, _timezone] = match;
  return `${date}T${time}Z`;
}

function getFileTimestamps(filePath: string): { created: string | null; lastUpdated: string | null } {
  console.log(`  Querying git for: ${filePath}`);

  // Get creation timestamp (first commit)
  const createdOutput = execGit(`git log --diff-filter=A --format="%ai" --follow -- "${filePath}"`);
  const createdLines = createdOutput.split('\n').filter(Boolean);
  const created = createdLines.length > 0 ? parseGitTimestamp(createdLines[createdLines.length - 1]) : null;

  // Get last updated timestamp
  const lastUpdatedOutput = execGit(`git log -1 --format="%ai" -- "${filePath}"`);
  const lastUpdated = parseGitTimestamp(lastUpdatedOutput);

  return { created, lastUpdated };
}

function main() {
  console.log('='.repeat(80));
  console.log('PHASE 1: Git Timestamp Extraction');
  console.log('='.repeat(80));
  console.log();

  // Load code.json
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);
  console.log();

  // Extract unique file paths
  const uniquePaths = Array.from(new Set(
    codeJson.guids.map(g => g.location.filePath)
  )).sort();

  console.log(`Found ${uniquePaths.length} unique file paths`);
  console.log();

  // Process each file
  const timestamps: FileTimestamps = {};
  let processed = 0;
  let withTimestamps = 0;
  let withoutTimestamps = 0;

  for (const filePath of uniquePaths) {
    processed++;
    const percentage = ((processed / uniquePaths.length) * 100).toFixed(1);

    console.log(`Processing file ${processed}/${uniquePaths.length} (${percentage}%)...`);
    console.log(`  File: ${filePath}`);

    const { created, lastUpdated } = getFileTimestamps(filePath);
    timestamps[filePath] = { created, lastUpdated };

    if (created && lastUpdated) {
      console.log(`  ✓ Created: ${created}`);
      console.log(`  ✓ Last Updated: ${lastUpdated}`);
      withTimestamps++;
    } else {
      console.log(`  ⚠ No git history found (file may not be committed)`);
      withoutTimestamps++;
    }

    // Count GUIDs for this file
    const guidCount = codeJson.guids.filter(g => g.location.filePath === filePath).length;
    console.log(`  → GUIDs affected: ${guidCount}`);
    console.log();
  }

  // Summary
  console.log('='.repeat(80));
  console.log('PHASE 1 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total files processed: ${processed}`);
  console.log(`Files with timestamps: ${withTimestamps} (${((withTimestamps/processed)*100).toFixed(1)}%)`);
  console.log(`Files without timestamps: ${withoutTimestamps} (${((withoutTimestamps/processed)*100).toFixed(1)}%)`);
  console.log();

  // Save checkpoint
  console.log(`Writing checkpoint: ${CHECKPOINT_PATH}`);
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(timestamps, null, 2));
  console.log('✓ Phase 1 complete!');
  console.log();

  // Cross-check known file
  const attackMonitorPath = 'app/src/app/(app)/admin/_components/AttackMonitor.tsx';
  if (timestamps[attackMonitorPath]) {
    console.log('Cross-check validation:');
    console.log(`  AttackMonitor.tsx created: ${timestamps[attackMonitorPath].created}`);
    console.log(`  Expected: 2026-01-26 (from plan)`);
    const match = timestamps[attackMonitorPath].created?.startsWith('2026-01-26');
    console.log(`  ${match ? '✓ MATCH' : '✗ MISMATCH'}`);
  }
}

main();
