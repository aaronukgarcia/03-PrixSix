#!/usr/bin/env node
/**
 * Apply Phase 3: Add calls to code.json
 *
 * Reads: checkpoints/phase3-calls.json
 * Updates: code.json (populates callChain.calls arrays)
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  version: string;
  lastUpdated: string;
  guids: Array<{
    guid: string;
    callChain?: {
      calls: string[];
      calledBy: string[];
    };
  }>;
}

interface GuidCalls {
  [guid: string]: {
    filePath: string;
    calls: string[];
    sources: any;
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_JSON_PATH = path.join(PROJECT_ROOT, 'code.json');
const CHECKPOINT_PATH = path.join(__dirname, 'checkpoints', 'phase3-calls.json');

function main() {
  console.log('='.repeat(80));
  console.log('APPLY PHASE 3: Add Calls to code.json');
  console.log('='.repeat(80));
  console.log();

  // Load data
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);

  console.log('Loading phase3-calls.json...');
  const calls: GuidCalls = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  console.log(`✓ Loaded calls for ${Object.keys(calls).length} GUIDs`);
  console.log();

  // Apply calls
  console.log('Applying calls to GUIDs...');
  let updated = 0;
  let totalCalls = 0;
  let withCalls = 0;
  let empty = 0;

  for (const guid of codeJson.guids) {
    const callData = calls[guid.guid];

    if (callData) {
      // Initialize callChain if it doesn't exist
      if (!guid.callChain) {
        guid.callChain = { calls: [], calledBy: [] };
      }

      guid.callChain.calls = callData.calls;
      updated++;
      totalCalls += callData.calls.length;

      if (callData.calls.length > 0) {
        withCalls++;
      } else {
        empty++;
      }
    } else {
      // GUID not in checkpoint (shouldn't happen)
      if (!guid.callChain) {
        guid.callChain = { calls: [], calledBy: [] };
      }
      guid.callChain.calls = [];
      empty++;
    }
  }

  console.log('='.repeat(80));
  console.log('APPLICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total GUIDs: ${codeJson.guids.length}`);
  console.log(`Updated: ${updated} (${((updated/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`With calls: ${withCalls} (${((withCalls/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`Empty calls: ${empty} (${((empty/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`Total calls: ${totalCalls}`);
  console.log(`Average per GUID: ${(totalCalls/codeJson.guids.length).toFixed(1)}`);
  console.log();

  // Save updated code.json
  console.log('Writing updated code.json...');
  writeFileSync(CODE_JSON_PATH, JSON.stringify(codeJson, null, 2));
  console.log('✓ code.json updated successfully!');
  console.log();

  // Sample verification
  console.log('Sample verification (BACKUP subsystem):');
  const backupGuids = codeJson.guids
    .filter(g => g.guid.startsWith('BACKUP_DASHBOARD'))
    .slice(0, 3);

  for (const guid of backupGuids) {
    console.log(`  ${guid.guid}:`);
    console.log(`    Calls (${guid.callChain?.calls.length || 0}): ${(guid.callChain?.calls || []).slice(0, 5).join(', ')}${(guid.callChain?.calls.length || 0) > 5 ? '...' : ''}`);
  }
  console.log();
  console.log('✓ Phase 3 application complete!');
}

main();
