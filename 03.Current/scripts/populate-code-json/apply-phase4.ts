#!/usr/bin/env node
/**
 * Apply Phase 4: Add calledBy to code.json
 *
 * Reads: checkpoints/phase4-calledby.json
 * Updates: code.json (populates callChain.calledBy arrays)
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  version: string;
  lastUpdated: string;
  guids: Array<{
    guid: string;
    callChain: {
      calls: string[];
      calledBy: string[];
    };
  }>;
}

interface CalledByMapping {
  [guid: string]: string[];
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_JSON_PATH = path.join(PROJECT_ROOT, 'code.json');
const CHECKPOINT_PATH = path.join(__dirname, 'checkpoints', 'phase4-calledby.json');

function main() {
  console.log('='.repeat(80));
  console.log('APPLY PHASE 4: Add CalledBy to code.json');
  console.log('='.repeat(80));
  console.log();

  // Load data
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);

  console.log('Loading phase4-calledby.json...');
  const calledByMap: CalledByMapping = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  console.log(`✓ Loaded calledBy for ${Object.keys(calledByMap).length} GUIDs`);
  console.log();

  // Apply calledBy
  console.log('Applying calledBy to GUIDs...');
  let updated = 0;
  let totalCallers = 0;
  let withCallers = 0;
  let rootNodes = 0;

  for (const guid of codeJson.guids) {
    const callers = calledByMap[guid.guid] || [];

    // Ensure callChain exists
    if (!guid.callChain) {
      guid.callChain = { calls: [], calledBy: [] };
    }

    guid.callChain.calledBy = callers;
    updated++;
    totalCallers += callers.length;

    if (callers.length > 0) {
      withCallers++;
    } else {
      rootNodes++;
    }
  }

  console.log('='.repeat(80));
  console.log('APPLICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total GUIDs: ${codeJson.guids.length}`);
  console.log(`Updated: ${updated} (${((updated/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`With callers: ${withCallers} (${((withCallers/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`Root nodes (no callers): ${rootNodes} (${((rootNodes/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`Total callers: ${totalCallers}`);
  console.log(`Average per GUID: ${(totalCallers/codeJson.guids.length).toFixed(1)}`);
  console.log();

  // Save updated code.json
  console.log('Writing updated code.json...');
  writeFileSync(CODE_JSON_PATH, JSON.stringify(codeJson, null, 2));
  console.log('✓ code.json updated successfully!');
  console.log();

  // Sample verification
  console.log('Sample verification (most popular GUIDs):');
  const sorted = codeJson.guids
    .sort((a, b) => (b.callChain?.calledBy.length || 0) - (a.callChain?.calledBy.length || 0))
    .slice(0, 3);

  for (const guid of sorted) {
    console.log(`  ${guid.guid}:`);
    console.log(`    CalledBy (${guid.callChain.calledBy.length}): ${guid.callChain.calledBy.slice(0, 5).join(', ')}${guid.callChain.calledBy.length > 5 ? '...' : ''}`);
  }
  console.log();

  // Symmetry re-validation
  console.log('Symmetry re-validation...');
  let errors = 0;

  for (const guid of codeJson.guids) {
    for (const calledGuid of guid.callChain.calls) {
      const target = codeJson.guids.find(g => g.guid === calledGuid);
      if (target && !target.callChain.calledBy.includes(guid.guid)) {
        console.error(`  ✗ ${guid.guid} calls ${calledGuid}, but ${calledGuid}.calledBy missing ${guid.guid}`);
        errors++;
      }
    }
  }

  if (errors === 0) {
    console.log('  ✓ Symmetry confirmed: 100% pass');
  } else {
    console.log(`  ✗ Symmetry errors found: ${errors}`);
  }

  console.log();
  console.log('✓ Phase 4 application complete!');
}

main();
