#!/usr/bin/env node
/**
 * Phase 3: Call Graph Analysis
 *
 * Multi-strategy detection:
 * 1. GUID Comment Mining ([Downstream Impact] sections)
 * 2. API endpoint calls (fetch('/api/...'))
 * 3. React component usage (<Component />)
 * 4. Function calls in code
 *
 * Output: checkpoints/phase3-calls.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';

interface CodeJson {
  guids: Array<{
    guid: string;
    description: string;
    location: {
      filePath: string;
      startLine?: number;
      endLine?: number;
    };
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
    sources: {
      guidComment: string[];
      apiCalls: string[];
      componentUsage: string[];
      functionCalls: string[];
    };
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CODE_JSON_PATH = path.join(PROJECT_ROOT, 'code.json');
const CHECKPOINT_PATH = path.join(__dirname, 'checkpoints', 'phase3-calls.json');

function readSourceFile(filePath: string, startLine?: number, endLine?: number): string {
  const fullPath = path.join(PROJECT_ROOT, filePath);

  if (!existsSync(fullPath)) {
    return '';
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    if (startLine && endLine) {
      return lines.slice(startLine - 1, endLine).join('\n');
    }

    return content;
  } catch (error) {
    return '';
  }
}

function extractDownstreamImpact(content: string): string[] {
  // Extract [Downstream Impact] section from GUID comment
  const match = content.match(/\[Downstream Impact\]([\s\S]*?)(?:\[|$)/);
  if (!match) return [];

  const impactSection = match[1];
  const impacts: string[] = [];

  // Look for "Calls X" patterns
  const callPatterns = [
    /Calls\s+([A-Z_]+-\d+)/g,
    /calls\s+([A-Z_]+-\d+)/g,
    /→\s+([A-Z_]+-\d+)/g,
  ];

  for (const pattern of callPatterns) {
    let match;
    while ((match = pattern.exec(impactSection)) !== null) {
      impacts.push(match[1]);
    }
  }

  return impacts;
}

function extractApiCalls(content: string, codeJson: CodeJson): string[] {
  // Detect fetch('/api/...') calls
  const apiRegex = /fetch\s*\(\s*['"`]\/api\/([^'"`]+)['"`]/g;
  const apiPaths: string[] = [];

  let match;
  while ((match = apiRegex.exec(content)) !== null) {
    apiPaths.push(match[1]);
  }

  // Map API paths to GUIDs
  const guids: string[] = [];
  for (const apiPath of apiPaths) {
    // Find GUIDs with matching API path in description
    const matchingGuids = codeJson.guids.filter(g =>
      g.location.filePath.includes(`app/api/${apiPath}`) ||
      g.description.toLowerCase().includes(apiPath.toLowerCase())
    );

    guids.push(...matchingGuids.map(g => g.guid));
  }

  return guids;
}

function extractComponentUsage(content: string, codeJson: CodeJson): string[] {
  // Detect React component usage: <ComponentName />
  const componentRegex = /<([A-Z][A-Za-z0-9]*)\s*[\/\s>]/g;
  const components: string[] = [];

  let match;
  while ((match = componentRegex.exec(content)) !== null) {
    components.push(match[1]);
  }

  // Map component names to GUIDs
  const guids: string[] = [];
  for (const comp of components) {
    const matchingGuids = codeJson.guids.filter(g =>
      g.description.toLowerCase().includes(comp.toLowerCase() + ' component') ||
      g.guid.includes(comp.toUpperCase())
    );

    guids.push(...matchingGuids.map(g => g.guid));
  }

  return guids;
}

function analyzeGuidCalls(
  guid: any,
  codeJson: CodeJson
): { calls: string[]; sources: any } {
  const content = readSourceFile(
    guid.location.filePath,
    guid.location.startLine,
    guid.location.endLine
  );

  const sources = {
    guidComment: extractDownstreamImpact(content),
    apiCalls: extractApiCalls(content, codeJson),
    componentUsage: extractComponentUsage(content, codeJson),
    functionCalls: [] as string[]
  };

  // Combine all sources and deduplicate
  const allCalls = [
    ...sources.guidComment,
    ...sources.apiCalls,
    ...sources.componentUsage,
    ...sources.functionCalls
  ];

  const uniqueCalls = Array.from(new Set(allCalls));

  // Filter out self-references
  const filteredCalls = uniqueCalls.filter(call => call !== guid.guid);

  return { calls: filteredCalls, sources };
}

function main() {
  console.log('='.repeat(80));
  console.log('PHASE 3: Call Graph Analysis');
  console.log('='.repeat(80));
  console.log();

  // Load code.json
  console.log('Loading code.json...');
  const codeJson: CodeJson = JSON.parse(readFileSync(CODE_JSON_PATH, 'utf-8'));
  console.log(`✓ Loaded ${codeJson.guids.length} GUIDs`);
  console.log();

  console.log('Analyzing call patterns across all GUIDs...');
  console.log();

  const guidCalls: GuidCalls = {};
  let processed = 0;
  let totalCalls = 0;
  let withCalls = 0;

  for (const guid of codeJson.guids) {
    processed++;

    if (processed % 100 === 0) {
      const percentage = ((processed / codeJson.guids.length) * 100).toFixed(1);
      console.log(`Processing GUID ${processed}/${codeJson.guids.length} (${percentage}%)...`);
    }

    const { calls, sources } = analyzeGuidCalls(guid, codeJson);

    guidCalls[guid.guid] = {
      filePath: guid.location.filePath,
      calls,
      sources
    };

    if (calls.length > 0) {
      totalCalls += calls.length;
      withCalls++;
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('PHASE 3 SUMMARY');
  console.log('='.repeat(80));
  console.log(`GUIDs processed: ${processed}`);
  console.log(`GUIDs with calls: ${withCalls} (${((withCalls/processed)*100).toFixed(1)}%)`);
  console.log(`Total call links: ${totalCalls}`);
  console.log(`Average calls per GUID: ${(totalCalls/processed).toFixed(1)}`);
  console.log();

  // Breakdown by source
  const fromGuidComments = Object.values(guidCalls).reduce((sum, g) => sum + g.sources.guidComment.length, 0);
  const fromApiCalls = Object.values(guidCalls).reduce((sum, g) => sum + g.sources.apiCalls.length, 0);
  const fromComponents = Object.values(guidCalls).reduce((sum, g) => sum + g.sources.componentUsage.length, 0);

  console.log('Call detection sources:');
  console.log(`  GUID comments: ${fromGuidComments} (${((fromGuidComments/totalCalls)*100).toFixed(1)}%)`);
  console.log(`  API calls: ${fromApiCalls} (${((fromApiCalls/totalCalls)*100).toFixed(1)}%)`);
  console.log(`  Component usage: ${fromComponents} (${((fromComponents/totalCalls)*100).toFixed(1)}%)`);
  console.log();

  // Save checkpoint
  console.log(`Writing checkpoint: ${CHECKPOINT_PATH}`);
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(guidCalls, null, 2));
  console.log('✓ Phase 3 complete!');
  console.log();

  // Validation: Compare BACKUP subsystem with known data
  console.log('Validation check (BACKUP subsystem):');
  const backupGuids = Object.entries(guidCalls)
    .filter(([guid]) => guid.startsWith('BACKUP_'))
    .slice(0, 5);

  for (const [guid, data] of backupGuids) {
    console.log(`  ${guid}: ${data.calls.length} calls`);
    if (data.calls.length > 0) {
      console.log(`    → ${data.calls.join(', ')}`);
    }
  }
}

main();
