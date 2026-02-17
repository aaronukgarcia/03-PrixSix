#!/usr/bin/env node
/**
 * Apply Phase 2: Add dependencies to code.json
 *
 * Reads: checkpoints/phase2-dependencies.json
 * Updates: code.json (populates dependencies arrays)
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  version: string;
  lastUpdated: string;
  guids: Array<{
    guid: string;
    dependencies: string[];
  }>;
}

interface GuidDependencies {
  [guid: string]: {
    filePath: string;
    imports: string[];
    dependencies: string[];
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_JSON_PATH = path.join(PROJECT_ROOT, 'code.json');
const CHECKPOINT_PATH = path.join(__dirname, 'checkpoints', 'phase2-dependencies.json');

function main() {
  console.log('='.repeat(80));
  console.log('APPLY PHASE 2: Add Dependencies to code.json');
  console.log('='.repeat(80));
  console.log();

  // Load data
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);

  console.log('Loading phase2-dependencies.json...');
  const dependencies: GuidDependencies = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  console.log(`✓ Loaded dependencies for ${Object.keys(dependencies).length} GUIDs`);
  console.log();

  // Apply dependencies
  console.log('Applying dependencies to GUIDs...');
  let updated = 0;
  let totalDeps = 0;
  let empty = 0;

  for (const guid of codeJson.guids) {
    const depData = dependencies[guid.guid];

    if (depData) {
      guid.dependencies = depData.dependencies;
      updated++;
      totalDeps += depData.dependencies.length;

      if (depData.dependencies.length === 0) {
        empty++;
      }
    } else {
      // GUID not in checkpoint (shouldn't happen)
      guid.dependencies = [];
      empty++;
    }
  }

  console.log('='.repeat(80));
  console.log('APPLICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total GUIDs: ${codeJson.guids.length}`);
  console.log(`Updated: ${updated} (${((updated/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`Total dependencies: ${totalDeps}`);
  console.log(`Average per GUID: ${(totalDeps/codeJson.guids.length).toFixed(1)}`);
  console.log(`Empty dependencies: ${empty} (${((empty/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log();

  // Save updated code.json
  console.log('Writing updated code.json...');
  writeFileSync(CODE_JSON_PATH, JSON.stringify(codeJson, null, 2));
  console.log('✓ code.json updated successfully!');
  console.log();

  // Sample verification
  console.log('Sample verification (first 3 GUIDs with dependencies):');
  const withDeps = codeJson.guids.filter(g => g.dependencies.length > 0).slice(0, 3);
  for (const guid of withDeps) {
    console.log(`  ${guid.guid}:`);
    console.log(`    Dependencies (${guid.dependencies.length}): ${guid.dependencies.slice(0, 5).join(', ')}${guid.dependencies.length > 5 ? '...' : ''}`);
  }
  console.log();
  console.log('✓ Phase 2 application complete!');
}

main();
