/**
 * GUID: SCRIPT_IMPORT_HISTORICAL-000-v01
 * Intent: Import today's completed work (2026-02-17) into book_of_work collection
 * Trigger: Centralized Book of Work system needs historical audit trail
 * Impact: Creates ~3 entries marked as 'done' with completion metadata
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
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

/**
 * GUID: SCRIPT_IMPORT_HISTORICAL-001
 * Intent: Define historical work items completed on 2026-02-17
 * Trigger: Need to seed book_of_work with audit trail of completed tasks
 * Impact: Provides examples and baseline data for new system
 */
// Define entry type for admin SDK (uses admin Timestamp, not client Timestamp)
interface HistoricalEntry {
  title: string;
  description: string;
  category: BookOfWorkCategory;
  severity?: BookOfWorkSeverity;
  status: BookOfWorkStatus;
  source: BookOfWorkSource;
  versionFixed?: string;
  commitHash?: string;
  completedAt?: Timestamp;
  tags?: string[];
}

const historicalEntries: HistoricalEntry[] = [
  {
    title: 'UX-001: Surface hidden help content via navigation links',
    description: `Added permanent 'Getting Started' and 'Help' links to sidebar, contextual 'How Scoring Works' link to Predictions page, and smart WelcomeCTA completion check.

**Issue**: Help content was hidden behind dismissable splash screen, causing high user confusion rates.

**Solution**:
- Added Sidebar navigation links to Getting Started and Help pages
- Added contextual "How Scoring Works" link to Predictions page header
- Implemented smart WelcomeCTA completion check (hides CTA if user has viewed Getting Started)

**Impact**: Fixed 'Hidden Gem' UX problem identified in virgin.json audit. Users can now find help content without relying on one-time splash screen.`,
    category: 'ui',
    severity: 'high',
    status: 'done',
    source: 'historical',
    versionFixed: '1.56.7',
    commitHash: '61b71e7',
    completedAt: Timestamp.fromDate(new Date('2026-02-17T15:30:00Z')),
    tags: ['ux', 'onboarding', 'retention', 'navigation', 'virgin-audit'],
  },
  {
    title: 'DOCS-001: Migrate book-of-work.json to Vestige structured storage',
    description: `Purged corrupted book-of-work.json (526 security issues) and migrated all audit tracking data to Vestige memory with structured schema.

**Problem**: book-of-work.json had become unmaintainable with 526 duplicate/fragmented entries.

**Solution**:
- Exported all security audit data to Vestige with GUID-based schema
- Created structured memory nodes with FSRS retention tracking
- Moved file to archived-book-of-works/ for historical reference
- Replaced main file with redirect pointer to Vestige

**Impact**: Clean single source of truth in Vestige. All security audit data now queryable with \`"security patterns"\` keyword. Enabled creation of this centralized Book of Work system.`,
    category: 'infrastructure',
    status: 'done',
    source: 'historical',
    versionFixed: 'N/A',
    commitHash: '2d60356',
    completedAt: Timestamp.fromDate(new Date('2026-02-17T18:00:00Z')),
    tags: ['vestige', 'migration', 'documentation', 'data-cleanup'],
  },
  {
    title: 'AUDIT-001: Complete RedTeam.json security audit catalog',
    description: `Cataloged all 106 GEMINI-AUDIT security findings from RedTeam.json into Vestige memory.

**Context**: RedTeam.json contained 106 GEMINI-AUDIT entries from AI-powered security review.

**Work Done**:
- Cross-referenced all 106 GEMINI-AUDIT entries with existing book-of-work.json
- Identified 86 entries already captured under different reference IDs
- Confirmed 20 unique net-new findings
- Created Vestige memory node with full RedTeam catalog

**Result**: Complete audit trail of all RedTeam findings. No new unique security issues discovered (86/106 were duplicates).`,
    category: 'security',
    status: 'done',
    source: 'historical',
    versionFixed: 'N/A',
    commitHash: 'N/A',
    completedAt: Timestamp.fromDate(new Date('2026-02-17T20:00:00Z')),
    tags: ['audit', 'gemini', 'security', 'catalog', 'redteam'],
  },
];

/**
 * GUID: SCRIPT_IMPORT_HISTORICAL-002
 * Intent: Main script execution - import historical entries to Firestore
 * Trigger: Run via: npx ts-node --project app/tsconfig.scripts.json scripts/import-historical-work.ts
 * Impact: Populates book_of_work collection with 3 completed historical entries
 */
async function importHistoricalWork() {
  console.log('🔧 Importing Historical Work (2026-02-17) to book_of_work...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const entry of historicalEntries) {
    try {
      // Add timestamps and construct full entry
      const fullEntry = {
        ...entry,
        createdAt: entry.completedAt || Timestamp.fromDate(new Date('2026-02-17')),
        updatedAt: Timestamp.now(),
      };

      // Add to Firestore (auto-generates document ID)
      const docRef = await db.collection(COLLECTION).add(fullEntry);

      console.log(`✅ Imported: ${entry.title}`);
      console.log(`   Doc ID: ${docRef.id}`);
      console.log(`   Category: ${entry.category} | Status: ${entry.status}`);
      console.log(`   Version: ${entry.versionFixed || 'N/A'} | Commit: ${entry.commitHash || 'N/A'}\n`);

      successCount++;
    } catch (error) {
      console.error(`❌ Failed to import: ${entry.title}`);
      console.error(`   Error: ${error}\n`);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successfully imported: ${successCount}`);
  console.log(`   ❌ Failed: ${errorCount}`);
  console.log(`   📁 Total entries: ${historicalEntries.length}`);
}

// Run the script
importHistoricalWork()
  .then(() => {
    console.log('\n✨ Historical work import complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error during import:', error);
    process.exit(1);
  });
