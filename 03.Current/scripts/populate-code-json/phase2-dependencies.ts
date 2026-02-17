#!/usr/bin/env node
/**
 * Phase 2: Extract Dependencies via Import Analysis
 *
 * Strategy:
 * 1. Parse TypeScript AST for each file
 * 2. Extract import statements
 * 3. Resolve @/ path aliases to actual files
 * 4. Map imported files to GUID prefixes
 * 5. Build dependencies array
 *
 * Output: checkpoints/phase2-dependencies.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  guids: Array<{
    guid: string;
    location: {
      filePath: string;
    };
    dependencies?: string[];
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

// Simple import regex (handles most cases)
// Matches: import { x } from 'y' or import x from 'y' or import 'y'
const IMPORT_REGEX = /import\s+(?:{[^}]*}|[^'"]*)\s+from\s+['"]([^'"]+)['"]/g;
const SIMPLE_IMPORT_REGEX = /import\s+['"]([^'"]+)['"]/g;

function resolveImportPath(importPath: string, fromFile: string): string | null {
  // Handle @/ alias (maps to app/src/)
  if (importPath.startsWith('@/')) {
    return importPath.replace('@/', 'app/src/');
  }

  // Handle relative imports
  if (importPath.startsWith('.')) {
    const dir = path.dirname(fromFile);
    const resolved = path.normalize(path.join(dir, importPath));
    return resolved.replace(/\\/g, '/');
  }

  // External package - ignore
  return null;
}

function findFileWithExtensions(basePath: string): string | null {
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

  for (const ext of extensions) {
    const fullPath = path.join(PROJECT_ROOT, basePath + ext);
    if (existsSync(fullPath)) {
      return (basePath + ext).replace(/\\/g, '/');
    }
  }

  return null;
}

function extractImports(filePath: string): string[] {
  const fullPath = path.join(PROJECT_ROOT, filePath);

  if (!existsSync(fullPath)) {
    return [];
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const imports: string[] = [];

    // Extract from standard imports
    let match;
    while ((match = IMPORT_REGEX.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Extract from simple imports (import 'x')
    IMPORT_REGEX.lastIndex = 0;
    while ((match = SIMPLE_IMPORT_REGEX.exec(content)) !== null) {
      if (!imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }

    return imports;
  } catch (error) {
    console.error(`  ⚠ Error reading ${filePath}:`, error);
    return [];
  }
}

function mapFileToPrefixes(filePath: string, codeJson: CodeJson): string[] {
  // Find all GUIDs for this file
  const guids = codeJson.guids
    .filter(g => g.location.filePath === filePath)
    .map(g => g.guid);

  return guids;
}

function main() {
  console.log('='.repeat(80));
  console.log('PHASE 2: Dependency Extraction (Import Analysis)');
  console.log('='.repeat(80));
  console.log();

  // Load code.json
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);
  console.log();

  // Get unique files
  const uniqueFiles = Array.from(new Set(
    codeJson.guids.map(g => g.location.filePath)
  )).sort();

  console.log(`Processing ${uniqueFiles.length} files...`);
  console.log();

  const guidDependencies: GuidDependencies = {};
  let processed = 0;
  let totalImports = 0;
  let totalDependencies = 0;

  for (const filePath of uniqueFiles) {
    processed++;
    const percentage = ((processed / uniqueFiles.length) * 100).toFixed(1);

    console.log(`Processing file ${processed}/${uniqueFiles.length} (${percentage}%)...`);
    console.log(`  File: ${filePath}`);

    // Extract imports
    const imports = extractImports(filePath);
    console.log(`  Imports found: ${imports.length}`);

    // Resolve imports to file paths
    const resolvedFiles: string[] = [];
    for (const imp of imports) {
      const resolved = resolveImportPath(imp, filePath);
      if (resolved) {
        const withExtension = findFileWithExtensions(resolved);
        if (withExtension) {
          resolvedFiles.push(withExtension);
        }
      }
    }

    // Map to GUIDs
    const dependencyGuids: string[] = [];
    for (const resolvedFile of resolvedFiles) {
      const guids = mapFileToPrefixes(resolvedFile, codeJson);
      dependencyGuids.push(...guids);
    }

    // Remove duplicates
    const uniqueDeps = Array.from(new Set(dependencyGuids));

    console.log(`  Resolved files: ${resolvedFiles.length}`);
    console.log(`  Dependency GUIDs: ${uniqueDeps.length}`);

    if (uniqueDeps.length > 0 && uniqueDeps.length <= 5) {
      console.log(`    Sample: ${uniqueDeps.slice(0, 5).join(', ')}`);
    }

    // Store for all GUIDs in this file
    const fileGuids = codeJson.guids.filter(g => g.location.filePath === filePath);
    for (const guid of fileGuids) {
      guidDependencies[guid.guid] = {
        filePath,
        imports,
        dependencies: uniqueDeps
      };
    }

    totalImports += imports.length;
    totalDependencies += uniqueDeps.length * fileGuids.length;
    console.log(`  → GUIDs updated: ${fileGuids.length}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('PHASE 2 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Files processed: ${processed}`);
  console.log(`Total imports detected: ${totalImports}`);
  console.log(`Total dependency links created: ${totalDependencies}`);
  console.log(`Average dependencies per GUID: ${(totalDependencies / codeJson.guids.length).toFixed(1)}`);
  console.log();

  // Save checkpoint
  console.log(`Writing checkpoint: ${CHECKPOINT_PATH}`);
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(guidDependencies, null, 2));
  console.log('✓ Phase 2 complete!');
  console.log();

  // Sample verification
  console.log('Sample verification (AttackMonitor.tsx):');
  const attackMonitorGuids = Object.entries(guidDependencies)
    .filter(([_, data]) => data.filePath.includes('AttackMonitor.tsx'))
    .slice(0, 2);

  for (const [guid, data] of attackMonitorGuids) {
    console.log(`  ${guid}:`);
    console.log(`    Imports: ${data.imports.length}`);
    console.log(`    Dependencies: ${data.dependencies.length}`);
    if (data.dependencies.length > 0) {
      console.log(`    Sample deps: ${data.dependencies.slice(0, 3).join(', ')}`);
    }
  }
}

main();
