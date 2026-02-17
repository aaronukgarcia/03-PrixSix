#!/usr/bin/env node
/**
 * Phase 4: Reverse Mapping (CalledBy Population)
 *
 * Algorithm:
 * For each GUID A that calls GUID B:
 *   Add A to B's calledBy array
 *
 * Validation:
 * - Symmetry check: If A calls B, then B.calledBy contains A
 *
 * Output: checkpoints/phase4-calledby.json
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
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
  console.log('PHASE 4: Reverse Mapping (CalledBy Population)');
  console.log('='.repeat(80));
  console.log();

  // Load code.json
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);
  console.log();

  console.log('Building reverse call graph...');
  const calledByMap: CalledByMapping = {};

  // Initialize empty arrays
  for (const guid of codeJson.guids) {
    calledByMap[guid.guid] = [];
  }

  // Build reverse mapping
  let processed = 0;
  let totalLinks = 0;

  for (const guid of codeJson.guids) {
    processed++;

    if (processed % 100 === 0) {
      const percentage = ((processed / codeJson.guids.length) * 100).toFixed(1);
      console.log(`  Processing GUID ${processed}/${codeJson.guids.length} (${percentage}%)...`);
    }

    const calls = guid.callChain?.calls || [];

    for (const calledGuid of calls) {
      // Add this GUID to the calledBy of the called GUID
      if (calledByMap[calledGuid]) {
        if (!calledByMap[calledGuid].includes(guid.guid)) {
          calledByMap[calledGuid].push(guid.guid);
          totalLinks++;
        }
      } else {
        // Called GUID doesn't exist - orphaned reference
        console.warn(`  ⚠ Orphaned reference: ${guid.guid} calls non-existent ${calledGuid}`);
      }
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('PHASE 4 SUMMARY');
  console.log('='.repeat(80));
  console.log(`GUIDs processed: ${processed}`);
  console.log(`Reverse links created: ${totalLinks}`);
  console.log();

  // Statistics
  const withCallers = Object.values(calledByMap).filter(arr => arr.length > 0).length;
  const neverCalled = Object.values(calledByMap).filter(arr => arr.length === 0).length;
  const maxCallers = Math.max(...Object.values(calledByMap).map(arr => arr.length));
  const avgCallers = totalLinks / codeJson.guids.length;

  console.log('Statistics:');
  console.log(`  GUIDs with callers: ${withCallers} (${((withCallers/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`  Never called: ${neverCalled} (${((neverCalled/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`  Most popular GUID: ${maxCallers} callers`);
  console.log(`  Average callers per GUID: ${avgCallers.toFixed(1)}`);
  console.log();

  // Find most popular GUIDs
  console.log('Top 10 most-called GUIDs:');
  const sorted = Object.entries(calledByMap)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 10);

  for (const [guid, callers] of sorted) {
    console.log(`  ${guid}: ${callers.length} callers`);
  }
  console.log();

  // Symmetry validation
  console.log('Symmetry validation...');
  let symmetryErrors = 0;

  for (const guid of codeJson.guids) {
    const calls = guid.callChain?.calls || [];

    for (const calledGuid of calls) {
      if (calledByMap[calledGuid] && !calledByMap[calledGuid].includes(guid.guid)) {
        console.error(`  ✗ Symmetry error: ${guid.guid} calls ${calledGuid}, but ${calledGuid}.calledBy missing ${guid.guid}`);
        symmetryErrors++;
      }
    }
  }

  if (symmetryErrors === 0) {
    console.log('  ✓ Symmetry validation PASSED (0 errors)');
  } else {
    console.log(`  ✗ Symmetry validation FAILED (${symmetryErrors} errors)`);
  }
  console.log();

  // Save checkpoint
  console.log(`Writing checkpoint: ${CHECKPOINT_PATH}`);
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(calledByMap, null, 2));
  console.log('✓ Phase 4 complete!');
  console.log();

  // Sample verification
  console.log('Sample verification (BACKUP_DASHBOARD-000 callers):');
  const backupCallers = calledByMap['BACKUP_DASHBOARD-000'] || [];
  console.log(`  ${backupCallers.length} GUIDs call BACKUP_DASHBOARD-000`);
  if (backupCallers.length > 0) {
    console.log(`  Sample: ${backupCallers.slice(0, 5).join(', ')}`);
  }
}

main();
