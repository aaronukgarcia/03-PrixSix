#!/usr/bin/env tsx
/**
 * Comprehensive dependency audit - checks all packages, tools, MCP servers, and runtimes for updates.
 * GUID: SCRIPT_DEPENDENCY_AUDIT-000-v01
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface UpdateInfo {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  breaking: boolean;
  priority: 'critical' | 'major' | 'minor' | 'patch';
}

function exec(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function compareVersions(current: string, latest: string): 'major' | 'minor' | 'patch' | 'none' {
  const c = current.match(/(\d+)\.(\d+)\.(\d+)/);
  const l = latest.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!c || !l) return 'none';

  if (l[1] !== c[1]) return 'major';
  if (l[2] !== c[2]) return 'minor';
  if (l[3] !== c[3]) return 'patch';
  return 'none';
}

console.log('═══════════════════════════════════════════════════════════');
console.log('   COMPREHENSIVE DEPENDENCY AUDIT');
console.log('   Prix Six - Complete System Check');
console.log('═══════════════════════════════════════════════════════════\n');

// 1. RUNTIME VERSIONS
console.log('1️⃣  RUNTIME VERSIONS');
console.log('─'.repeat(60));

const nodeVersion = exec('node --version').replace('v', '');
const nodeLTS = '24.13.0'; // Current LTS as of 2026
const pythonVersion = exec('python --version').replace('Python ', '');
const gitVersion = exec('git --version').replace('git version ', '').split('.windows')[0];
const npmVersion = exec('npm --version');

console.log(`Node.js:  ${nodeVersion} ${nodeVersion.startsWith('25') ? '(⚠️  Latest, not LTS)' : ''}`);
console.log(`          LTS available: ${nodeLTS}`);
console.log(`Python:   ${pythonVersion}`);
console.log(`Git:      ${gitVersion}`);
console.log(`npm:      ${npmVersion}`);

// 2. GLOBAL NPM PACKAGES
console.log('\n2️⃣  GLOBAL NPM TOOLS');
console.log('─'.repeat(60));

const firebaseToolsCurrent = exec('npm list -g firebase-tools --depth=0').match(/firebase-tools@([\d.]+)/)?.[1] || 'not installed';
const firebaseToolsLatest = exec('npm view firebase-tools version');
const npmCurrent = npmVersion;
const npmLatest = exec('npm view npm version');

console.log(`firebase-tools: ${firebaseToolsCurrent} → ${firebaseToolsLatest} ${firebaseToolsCurrent !== firebaseToolsLatest ? '⬆️' : '✅'}`);
console.log(`npm:            ${npmCurrent} → ${npmLatest} ${npmCurrent !== npmLatest ? '⬆️' : '✅'}`);

// 3. NPM PACKAGES (from npm outdated output)
console.log('\n3️⃣  NPM PACKAGES (app/package.json)');
console.log('─'.repeat(60));

const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'app', 'package.json'), 'utf8'));
const outdated = exec('cd ../app && npm outdated --json');

if (outdated) {
  const packages = JSON.parse(outdated);
  const updates: UpdateInfo[] = [];

  Object.entries(packages).forEach(([name, info]: [string, any]) => {
    const updateType = compareVersions(info.current, info.latest);
    const breaking = updateType === 'major';

    updates.push({
      name,
      current: info.current,
      wanted: info.wanted,
      latest: info.latest,
      breaking,
      priority: breaking ? 'major' : updateType === 'minor' ? 'minor' : 'patch'
    });
  });

  // Group by priority
  const breaking = updates.filter(u => u.breaking);
  const minor = updates.filter(u => !u.breaking && u.priority === 'minor');
  const patch = updates.filter(u => u.priority === 'patch');

  if (breaking.length > 0) {
    console.log('\n⚠️  BREAKING UPDATES (Major versions):');
    breaking.forEach(u => {
      console.log(`  ${u.name.padEnd(30)} ${u.current.padEnd(10)} → ${u.latest}`);
    });
  }

  if (minor.length > 0) {
    console.log('\n🔄 MINOR UPDATES (New features):');
    minor.forEach(u => {
      console.log(`  ${u.name.padEnd(30)} ${u.current.padEnd(10)} → ${u.latest}`);
    });
  }

  if (patch.length > 0) {
    console.log('\n🔧 PATCH UPDATES (Bug fixes):');
    patch.forEach(u => {
      console.log(`  ${u.name.padEnd(30)} ${u.current.padEnd(10)} → ${u.latest}`);
    });
  }

  console.log(`\nTotal packages with updates: ${updates.length}`);
} else {
  console.log('✅ All packages up to date');
}

// 4. MCP SERVERS
console.log('\n4️⃣  MCP SERVERS');
console.log('─'.repeat(60));

const mcpPath = 'E:\\GoogleDrive\\Tools\\MCP';

// Check Vestige
console.log('Vestige:        v1.1.2 (binary - check manually)');

// Check Sequential Thinking
const seqThinkingPath = join(mcpPath, 'sequential-thinking', 'package.json');
if (existsSync(seqThinkingPath)) {
  const pkg = JSON.parse(readFileSync(seqThinkingPath, 'utf8'));
  console.log(`Sequential:     ${pkg.version || 'unknown'}`);
}

// Check Context7
const context7Path = join(mcpPath, 'context7', 'package.json');
if (existsSync(context7Path)) {
  const pkg = JSON.parse(readFileSync(context7Path, 'utf8'));
  console.log(`Context7:       ${pkg.version || 'unknown'}`);
}

// Check Azure MCP
const azureMcpPath = join(mcpPath, 'azure-mcp', 'package.json');
if (existsSync(azureMcpPath)) {
  const pkg = JSON.parse(readFileSync(azureMcpPath, 'utf8'));
  console.log(`Azure MCP:      ${pkg.version || 'unknown'}`);
}

// Check MS 365 MCP
const ms365McpPath = join(mcpPath, 'ms-365', 'package.json');
if (existsSync(ms365McpPath)) {
  const pkg = JSON.parse(readFileSync(ms365McpPath, 'utf8'));
  console.log(`MS 365 MCP:     ${pkg.version || 'unknown'}`);
}

console.log('GitHub MCP:     Go binary (check manually)');
console.log('Firebase MCP:   Uses firebase-tools');

// 5. PYTHON PACKAGES
console.log('\n5️⃣  PYTHON PACKAGES (Cloud Functions)');
console.log('─'.repeat(60));

const pipOutdated = exec('pip list --outdated --format=json');
if (pipOutdated) {
  const outdatedPython = JSON.parse(pipOutdated);
  if (outdatedPython.length > 0) {
    outdatedPython.slice(0, 10).forEach((pkg: any) => {
      console.log(`  ${pkg.name.padEnd(25)} ${pkg.version.padEnd(12)} → ${pkg.latest_version}`);
    });
    if (outdatedPython.length > 10) {
      console.log(`  ... and ${outdatedPython.length - 10} more`);
    }
  } else {
    console.log('✅ All Python packages up to date');
  }
}

// 6. CLAUDE CODE CLI
console.log('\n6️⃣  CLAUDE CODE & RELATED');
console.log('─'.repeat(60));

const claudeVersion = exec('claude --version').split('\n')[0];
console.log(`Claude Code:    ${claudeVersion || 'unknown'}`);
console.log('                (Check: https://github.com/anthropics/claude-code)');

// 7. SUMMARY
console.log('\n═══════════════════════════════════════════════════════════');
console.log('📋 AUDIT SUMMARY');
console.log('═══════════════════════════════════════════════════════════');

const totalUpdates = outdated ? Object.keys(JSON.parse(outdated)).length : 0;

console.log(`  Node.js:        ${nodeVersion === nodeLTS ? '✅ LTS' : '⚠️  Not LTS'}`);
console.log(`  npm:            ${npmCurrent === npmLatest ? '✅ Latest' : '⬆️  Update available'}`);
console.log(`  firebase-tools: ${firebaseToolsCurrent === firebaseToolsLatest ? '✅ Latest' : '⬆️  Update available'}`);
console.log(`  npm packages:   ${totalUpdates} updates available`);
console.log(`  Python:         ${pythonVersion}`);

console.log('\n💡 RECOMMENDATIONS:');
if (totalUpdates > 0) {
  console.log('  - Review breaking changes before major version updates');
  console.log('  - Test minor/patch updates in development first');
  console.log('  - Update firebase-tools and npm globally');
}
if (nodeVersion.startsWith('25')) {
  console.log('  - Consider switching to Node.js LTS (v24.x) for stability');
}

console.log('\n═══════════════════════════════════════════════════════════\n');

process.exit(0);
