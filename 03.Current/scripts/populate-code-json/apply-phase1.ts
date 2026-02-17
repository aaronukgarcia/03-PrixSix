#!/usr/bin/env node
/**
 * Apply Phase 1: Add timestamps to code.json
 *
 * Reads: checkpoints/phase1-timestamps.json
 * Updates: code.json (adds created/lastUpdated to each GUID)
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  version: string;
  lastUpdated: string;
  guids: Array<{
    guid: string;
    location: {
      filePath: string;
    };
    created?: string;
    lastUpdated?: string;
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

function main() {
  console.log('='.repeat(80));
  console.log('APPLY PHASE 1: Add Timestamps to code.json');
  console.log('='.repeat(80));
  console.log();

  // Load data
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);

  console.log('Loading phase1-timestamps.json...');
  const timestamps: FileTimestamps = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  console.log(`✓ Loaded ${Object.keys(timestamps).length} file timestamps`);
  console.log();

  // Apply timestamps
  console.log('Applying timestamps to GUIDs...');
  let updated = 0;
  let skipped = 0;

  for (const guid of codeJson.guids) {
    const filePath = guid.location.filePath;
    const fileTimestamp = timestamps[filePath];

    if (fileTimestamp && fileTimestamp.created && fileTimestamp.lastUpdated) {
      guid.created = fileTimestamp.created;
      guid.lastUpdated = fileTimestamp.lastUpdated;
      updated++;
    } else {
      // File has no git history - use current timestamp as fallback
      const now = new Date().toISOString();
      guid.created = now;
      guid.lastUpdated = now;
      skipped++;

      if (skipped === 1) {
        console.log(`  ⚠ Files without git history (using current timestamp):`);
      }
      console.log(`    - ${filePath} (GUID: ${guid.guid})`);
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('APPLICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total GUIDs: ${codeJson.guids.length}`);
  console.log(`Updated with git timestamps: ${updated} (${((updated/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`Fallback to current time: ${skipped} (${((skipped/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log();

  // Save updated code.json
  console.log('Writing updated code.json...');
  writeFileSync(CODE_JSON_PATH, JSON.stringify(codeJson, null, 2));
  console.log('✓ code.json updated successfully!');
  console.log();

  // Sample verification
  console.log('Sample verification (first 3 GUIDs with timestamps):');
  for (let i = 0; i < Math.min(3, codeJson.guids.length); i++) {
    const guid = codeJson.guids[i];
    console.log(`  ${guid.guid}:`);
    console.log(`    File: ${guid.location.filePath}`);
    console.log(`    Created: ${guid.created}`);
    console.log(`    Last Updated: ${guid.lastUpdated}`);
  }
  console.log();
  console.log('✓ Phase 1 application complete!');
}

main();
