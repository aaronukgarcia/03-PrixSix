/**
 * GUID: SCRIPT_IMPORT_VIRGIN-000-v01
 * Intent: Import UX audit findings from virgin.json into book_of_work collection
 * Trigger: Centralized Book of Work system needs all virgin user audit findings
 * Impact: Creates ~28 entries from comprehensive UX audit by Violet (2026-02-17)
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import type { BookOfWorkCategory, BookOfWorkStatus, BookOfWorkSeverity, BookOfWorkSource } from '../app/src/lib/types/book-of-work';

// Initialize Firebase Admin SDK with service account
if (getApps().length === 0) {
  const serviceAccount = require(path.join(__dirname, 'service-account.json'));
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();
const COLLECTION = 'book_of_work';
const VIRGIN_JSON_PATH = path.join(__dirname, '..', 'virgin.json');

/**
 * GUID: SCRIPT_IMPORT_VIRGIN-001
 * Intent: Define virgin.json structure for TypeScript type safety
 * Trigger: Need to parse virgin.json findings
 * Impact: Type-safe access to UX audit data
 */
interface VirginFinding {
  id: string;
  page: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  issue: string;
  description: string;
  impact: string;
  recommendation: string;
  priority?: number;
  rank?: number;
  fixed?: boolean;
  fixedInVersion?: string;
}

interface VirginJsonStructure {
  audit: {
    taskInitiated: string;
    auditor: string;
    [key: string]: any;
  };
  findings: {
    critical: VirginFinding[];
    high: VirginFinding[];
    medium: VirginFinding[];
    low: VirginFinding[];
  };
}

/**
 * GUID: SCRIPT_IMPORT_VIRGIN-002
 * Intent: Transform virgin.json finding to BookOfWorkEntry
 * Trigger: Each finding needs to be converted to centralized schema
 * Impact: Consistent data structure in book_of_work collection
 */
function transformFindingToEntry(finding: VirginFinding) {
  const auditDate = new Date('2026-02-17T18:15:00Z'); // Virgin audit start time

  // Build sourceData without undefined values (Firestore doesn't allow them)
  const sourceData: any = {
    referenceId: finding.id,
    page: finding.page,
  };
  if (finding.rank !== undefined) sourceData.rank = finding.rank;
  if (finding.priority !== undefined) sourceData.priority = finding.priority;

  // Build entry without undefined values
  const entry: any = {
    title: `${finding.id}: ${finding.issue.substring(0, 80)}`,
    description: `**Page**: ${finding.page}
**Severity**: ${finding.severity}

**Issue**: ${finding.issue}

**Description**: ${finding.description}

**Impact**: ${finding.impact}

**Recommendation**: ${finding.recommendation}`,
    category: 'ui' as BookOfWorkCategory,
    severity: finding.severity,
    status: (finding.fixed ? 'done' : 'tbd') as BookOfWorkStatus,
    source: 'virgin-ux' as BookOfWorkSource,
    sourceData,
    priority: finding.priority || (finding.severity === 'critical' ? 10 : finding.severity === 'high' ? 7 : finding.severity === 'medium' ? 5 : 3),
    createdAt: Timestamp.fromDate(auditDate),
    updatedAt: Timestamp.now(),
    tags: ['virgin-audit', 'ux', 'onboarding', finding.page.toLowerCase().replace(/\s+/g, '-')],
  };

  if (finding.fixedInVersion) entry.versionFixed = finding.fixedInVersion;
  if (finding.fixed) entry.completedAt = Timestamp.fromDate(new Date());

  return entry;
}

/**
 * GUID: SCRIPT_IMPORT_VIRGIN-003
 * Intent: Main script execution - import virgin.json to Firestore
 * Trigger: Run via: npx ts-node --project app/tsconfig.scripts.json scripts/import-virgin-ux.ts
 * Impact: Populates book_of_work collection with all 28 UX audit findings
 */
async function importVirginUX() {
  console.log('🔧 Importing Virgin UX Audit Findings to book_of_work...\n');

  // Read and parse virgin.json
  if (!fs.existsSync(VIRGIN_JSON_PATH)) {
    console.error(`❌ Error: virgin.json not found at ${VIRGIN_JSON_PATH}`);
    process.exit(1);
  }

  const virginData: VirginJsonStructure = JSON.parse(
    fs.readFileSync(VIRGIN_JSON_PATH, 'utf8')
  );

  console.log(`📋 Audit Info:`);
  console.log(`   Auditor: ${virginData.audit.auditor}`);
  console.log(`   Date: ${virginData.audit.taskInitiated}`);
  console.log(`   Findings: ${virginData.findings.critical.length} critical, ${virginData.findings.high.length} high, ${virginData.findings.medium.length} medium, ${virginData.findings.low.length} low\n`);

  // Collect all findings across severity levels
  const allFindings: VirginFinding[] = [
    ...virginData.findings.critical,
    ...virginData.findings.high,
    ...virginData.findings.medium,
    ...virginData.findings.low,
  ];

  console.log(`📊 Total findings to import: ${allFindings.length}\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const finding of allFindings) {
    try {
      const entry = transformFindingToEntry(finding);

      // Add to Firestore (auto-generates document ID)
      const docRef = await db.collection(COLLECTION).add(entry);

      console.log(`✅ Imported: ${finding.id} - ${finding.issue.substring(0, 60)}...`);
      console.log(`   Doc ID: ${docRef.id}`);
      console.log(`   Page: ${finding.page} | Severity: ${finding.severity} | Status: ${entry.status}\n`);

      successCount++;
    } catch (error) {
      console.error(`❌ Failed to import: ${finding.id}`);
      console.error(`   Error: ${error}\n`);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successfully imported: ${successCount}`);
  console.log(`   ❌ Failed: ${errorCount}`);
  console.log(`   📁 Total findings: ${allFindings.length}`);
  console.log(`\n💡 Breakdown by severity:`);
  console.log(`   🔴 Critical: ${virginData.findings.critical.length}`);
  console.log(`   🟠 High: ${virginData.findings.high.length}`);
  console.log(`   🟡 Medium: ${virginData.findings.medium.length}`);
  console.log(`   🟢 Low: ${virginData.findings.low.length}`);
}

// Run the script
importVirginUX()
  .then(() => {
    console.log('\n✨ Virgin UX audit import complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error during import:', error);
    process.exit(1);
  });
