#!/usr/bin/env node
/**
 * Phase 6: Data Quality Validation
 *
 * Comprehensive validation before final merge:
 * 1. Completeness - all fields populated
 * 2. Consistency - all references valid
 * 3. Symmetry - call graph is bidirectional
 * 4. Cross-validation - spot checks
 *
 * Output: checkpoints/phase6-validation-report.json
 */

import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  version: string;
  lastUpdated: string;
  guids: Array<{
    guid: string;
    created?: string;
    lastUpdated?: string;
    dependencies: string[];
    callChain: {
      calls: string[];
      calledBy: string[];
    };
  }>;
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_JSON_PATH = path.join(PROJECT_ROOT, 'code.json');
const CHECKPOINT_PATH = path.join(__dirname, 'checkpoints', 'phase6-validation-report.json');

interface ValidationReport {
  completeness: {
    timestamps: string;
    dependencies: string;
    callChain: string;
  };
  consistency: {
    orphanedDependencies: number;
    orphanedCalls: number;
    orphanedCalledBy: number;
    symmetryErrors: number;
  };
  coverage: {
    emptyDependencies: number;
    emptyCalls: number;
    emptyCalledBy: number;
  };
  errors: string[];
  warnings: string[];
}

function main() {
  console.log('='.repeat(80));
  console.log('PHASE 6: Data Quality Validation');
  console.log('='.repeat(80));
  console.log();

  // Load code.json
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);
  console.log();

  const report: ValidationReport = {
    completeness: { timestamps: '', dependencies: '', callChain: '' },
    consistency: { orphanedDependencies: 0, orphanedCalls: 0, orphanedCalledBy: 0, symmetryErrors: 0 },
    coverage: { emptyDependencies: 0, emptyCalls: 0, emptyCalledBy: 0 },
    errors: [],
    warnings: []
  };

  // Create GUID lookup
  const guidSet = new Set(codeJson.guids.map(g => g.guid));

  // 1. COMPLETENESS CHECK
  console.log('1. Completeness Check');
  console.log('-'.repeat(80));

  let withTimestamps = 0;
  let withDependencies = 0;
  let withCallChain = 0;

  for (const guid of codeJson.guids) {
    if (guid.created && guid.lastUpdated) withTimestamps++;
    if (guid.dependencies !== undefined) withDependencies++;
    if (guid.callChain?.calls !== undefined && guid.callChain?.calledBy !== undefined) withCallChain++;

    if (!guid.created || !guid.lastUpdated) {
      report.errors.push(`${guid.guid}: Missing timestamps`);
    }
    if (guid.dependencies === undefined) {
      report.errors.push(`${guid.guid}: Missing dependencies array`);
    }
    if (!guid.callChain || guid.callChain.calls === undefined || guid.callChain.calledBy === undefined) {
      report.errors.push(`${guid.guid}: Missing callChain`);
    }
  }

  report.completeness.timestamps = `${withTimestamps}/${codeJson.guids.length} (${((withTimestamps/codeJson.guids.length)*100).toFixed(1)}%)`;
  report.completeness.dependencies = `${withDependencies}/${codeJson.guids.length} (${((withDependencies/codeJson.guids.length)*100).toFixed(1)}%)`;
  report.completeness.callChain = `${withCallChain}/${codeJson.guids.length} (${((withCallChain/codeJson.guids.length)*100).toFixed(1)}%)`;

  console.log(`  ✓ Timestamps:   ${report.completeness.timestamps}`);
  console.log(`  ✓ Dependencies: ${report.completeness.dependencies}`);
  console.log(`  ✓ Call Chain:   ${report.completeness.callChain}`);
  console.log();

  // 2. CONSISTENCY CHECK
  console.log('2. Consistency Check');
  console.log('-'.repeat(80));

  for (const guid of codeJson.guids) {
    // Check dependencies reference valid GUIDs
    for (const dep of guid.dependencies || []) {
      if (!guidSet.has(dep)) {
        report.consistency.orphanedDependencies++;
        report.warnings.push(`${guid.guid}: References non-existent dependency ${dep}`);
      }
    }

    // Check calls reference valid GUIDs
    for (const call of guid.callChain?.calls || []) {
      if (!guidSet.has(call)) {
        report.consistency.orphanedCalls++;
        report.warnings.push(`${guid.guid}: Calls non-existent ${call}`);
      }
    }

    // Check calledBy reference valid GUIDs
    for (const caller of guid.callChain?.calledBy || []) {
      if (!guidSet.has(caller)) {
        report.consistency.orphanedCalledBy++;
        report.warnings.push(`${guid.guid}: CalledBy references non-existent ${caller}`);
      }
    }
  }

  console.log(`  ${report.consistency.orphanedDependencies === 0 ? '✓' : '✗'} Orphaned dependencies: ${report.consistency.orphanedDependencies}`);
  console.log(`  ${report.consistency.orphanedCalls === 0 ? '✓' : '✗'} Orphaned calls: ${report.consistency.orphanedCalls}`);
  console.log(`  ${report.consistency.orphanedCalledBy === 0 ? '✓' : '✗'} Orphaned calledBy: ${report.consistency.orphanedCalledBy}`);
  console.log();

  // 3. SYMMETRY CHECK
  console.log('3. Symmetry Check');
  console.log('-'.repeat(80));

  for (const guid of codeJson.guids) {
    for (const calledGuid of guid.callChain?.calls || []) {
      const target = codeJson.guids.find(g => g.guid === calledGuid);
      if (target && !target.callChain.calledBy.includes(guid.guid)) {
        report.consistency.symmetryErrors++;
        report.errors.push(`Symmetry: ${guid.guid} calls ${calledGuid}, but ${calledGuid}.calledBy missing ${guid.guid}`);
      }
    }
  }

  console.log(`  ${report.consistency.symmetryErrors === 0 ? '✓' : '✗'} Symmetry errors: ${report.consistency.symmetryErrors}`);
  console.log();

  // 4. COVERAGE ANALYSIS
  console.log('4. Coverage Analysis');
  console.log('-'.repeat(80));

  for (const guid of codeJson.guids) {
    if ((guid.dependencies || []).length === 0) report.coverage.emptyDependencies++;
    if ((guid.callChain?.calls || []).length === 0) report.coverage.emptyCalls++;
    if ((guid.callChain?.calledBy || []).length === 0) report.coverage.emptyCalledBy++;
  }

  console.log(`  ℹ Empty dependencies: ${report.coverage.emptyDependencies} (${((report.coverage.emptyDependencies/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`  ℹ Empty calls:        ${report.coverage.emptyCalls} (${((report.coverage.emptyCalls/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log(`  ℹ Empty calledBy:     ${report.coverage.emptyCalledBy} (${((report.coverage.emptyCalledBy/codeJson.guids.length)*100).toFixed(1)}%)`);
  console.log();

  // 5. BACKUP SUBSYSTEM VALIDATION
  console.log('5. BACKUP Subsystem Validation');
  console.log('-'.repeat(80));

  const backupGuids = codeJson.guids.filter(g => g.guid.startsWith('BACKUP_DASHBOARD'));
  console.log(`  Found ${backupGuids.length} BACKUP_DASHBOARD GUIDs`);

  for (const guid of backupGuids.slice(0, 3)) {
    console.log(`  ${guid.guid}:`);
    console.log(`    Dependencies: ${guid.dependencies.length}`);
    console.log(`    Calls: ${guid.callChain.calls.length}`);
    console.log(`    CalledBy: ${guid.callChain.calledBy.length}`);
  }
  console.log();

  // 6. SPOT CHECK
  console.log('6. Spot Check (10 random GUIDs)');
  console.log('-'.repeat(80));

  const randomGuids = [];
  for (let i = 0; i < 10; i++) {
    const idx = Math.floor(Math.random() * codeJson.guids.length);
    randomGuids.push(codeJson.guids[idx]);
  }

  for (const guid of randomGuids) {
    const hasTimestamps = guid.created && guid.lastUpdated;
    const hasDeps = guid.dependencies !== undefined;
    const hasCalls = guid.callChain?.calls !== undefined && guid.callChain?.calledBy !== undefined;

    const status = hasTimestamps && hasDeps && hasCalls ? '✓' : '✗';
    console.log(`  ${status} ${guid.guid}: ${hasTimestamps ? 'T' : '-'}${hasDeps ? 'D' : '-'}${hasCalls ? 'C' : '-'}`);
  }
  console.log();

  // FINAL VERDICT
  console.log('='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const allComplete = withTimestamps === codeJson.guids.length &&
                      withDependencies === codeJson.guids.length &&
                      withCallChain === codeJson.guids.length;

  const allConsistent = report.consistency.orphanedDependencies === 0 &&
                        report.consistency.orphanedCalls === 0 &&
                        report.consistency.orphanedCalledBy === 0 &&
                        report.consistency.symmetryErrors === 0;

  console.log(`Completeness: ${allComplete ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Consistency:  ${allConsistent ? '✓ PASS' : '✗ FAIL'}`);
  console.log();

  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log('🎉 OVERALL: PASS ✅');
    console.log('Ready for Phase 7 merge.');
  } else {
    console.log('⚠ OVERALL: ISSUES FOUND');
    console.log(`Errors: ${report.errors.length}`);
    console.log(`Warnings: ${report.warnings.length}`);

    if (report.errors.length > 0 && report.errors.length <= 10) {
      console.log('\nFirst 10 errors:');
      report.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    }
  }
  console.log();

  // Save report
  console.log(`Writing validation report: ${CHECKPOINT_PATH}`);
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(report, null, 2));
  console.log('✓ Phase 6 complete!');
}

main();
