/**
 * COMPREHENSIVE Book of Work Migration Script
 * Consolidates ALL work items from:
 * - Vestige memory system
 * - RedTeam.json (security audit findings)
 * - archived-book-of-works/book-of-works-01.json
 * - Existing Firestore book_of_work collection
 *
 * Deduplicates by GUID and uploads to Firestore as single source of truth.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('../service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Severity mapping for categorization
const severityToPackage = {
  'Critical': 'security-critical',
  'High': 'security-high',
  'Medium': 'security-medium',
  'Low': 'security-low',
  'Informational': 'security-low'
};

// Category mapping
const categoryMap = {
  'security': 'security',
  'ui': 'ui',
  'ux': 'ui',
  'feature': 'feature',
  'cosmetic': 'cosmetic',
  'infrastructure': 'infrastructure',
  'error': 'system-error',
  'feedback': 'user-error'
};

/**
 * Read and parse RedTeam.json (large file)
 */
function readRedTeamEntries() {
  console.log('Reading RedTeam.json...');
  const redTeamPath = path.join(__dirname, '..', 'RedTeam.json');

  if (!fs.existsSync(redTeamPath)) {
    console.log('RedTeam.json not found, skipping');
    return [];
  }

  const redTeamData = JSON.parse(fs.readFileSync(redTeamPath, 'utf8'));
  const entries = [];

  // First entry is progress tracker, skip it
  for (let i = 1; i < redTeamData.length; i++) {
    const item = redTeamData[i];

    if (!item.guid || !item.security_issue) continue;

    const entry = {
      guid: item.guid,
      referenceId: item.guid,
      title: item.security_issue.substring(0, 100),
      description: `**File:** ${item.file || 'Unknown'}\n\n**Issue:** ${item.security_issue}\n\n**Rationale:** ${item.rationale || 'No rationale provided'}`,
      category: 'security',
      severity: item.priority?.toLowerCase() || 'medium',
      status: 'tbd',
      source: 'vestige-redteam',
      package: severityToPackage[item.priority] || 'security-medium',
      sourceData: {
        file: item.file,
        module: item.module,
        citation: item.citation,
        date: item.date
      },
      module: item.module,
      file: item.file,
      tags: ['gemini-audit', 'security', 'redteam'],
      versionReported: '1.58.0' // Approximate based on audit date
    };

    entries.push(entry);
  }

  console.log(`Found ${entries.length} entries from RedTeam.json`);
  return entries;
}

/**
 * Read archived book-of-works-01.json
 */
function readArchivedEntries() {
  console.log('Reading archived-book-of-works/book-of-works-01.json...');
  const archivePath = path.join(__dirname, '..', 'archived-book-of-works', 'book-of-works-01.json');

  if (!fs.existsSync(archivePath)) {
    console.log('book-of-works-01.json not found, skipping');
    return [];
  }

  const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  const entries = [];

  // Process criticalIssues array
  if (archiveData.criticalIssues && Array.isArray(archiveData.criticalIssues)) {
    for (const issue of archiveData.criticalIssues) {
      const entry = {
        guid: issue.id,
        referenceId: issue.id,
        title: issue.title || issue.issue || 'Untitled',
        description: issue.description || issue.details || issue.rationale || '',
        category: categoryMap[issue.category?.toLowerCase()] || 'security',
        severity: issue.severity?.toLowerCase() || 'medium',
        status: issue.status || 'tbd',
        source: 'archived-security-audit',
        package: severityToPackage[issue.severity] || 'security-medium',
        sourceData: {
          file: issue.file,
          module: issue.module,
          affectedComponent: issue.affectedComponent
        },
        module: issue.module,
        file: issue.file,
        tags: ['archived', 'security-audit'],
        versionReported: issue.versionReported || '1.50.0'
      };

      entries.push(entry);
    }
  }

  console.log(`Found ${entries.length} entries from archived file`);
  return entries;
}

/**
 * Read Vestige search results from saved file
 */
function readVestigeEntries() {
  console.log('Reading Vestige search results...');
  const vestigePath = path.join(process.env.USERPROFILE, '.claude', 'projects', 'E--GoogleDrive-Tools-Memory-source', '652fd326-449c-4cb1-b74c-b7a7f8531fc0', 'tool-results', 'mcp-vestige-search-1771522114240.txt');

  if (!fs.existsSync(vestigePath)) {
    console.log('Vestige search results not found, skipping');
    return [];
  }

  const vestigeData = JSON.parse(fs.readFileSync(vestigePath, 'utf8'));
  const entries = [];

  // Process each Vestige node
  for (const node of vestigeData) {
    if (!node.text) continue;

    // Try to extract structured data from Vestige text
    const text = node.text;

    // Look for GUID patterns (GEMINI-AUDIT-XXX, ADMINCOMP-XXX, etc.)
    const guidMatches = text.match(/([A-Z]+-[A-Z]+-\d+|[A-Z]+COMP-\d+|[A-Z]+-\d+)/g);

    if (!guidMatches || guidMatches.length === 0) continue;

    // Extract the primary GUID
    const guid = guidMatches[0];

    // Try to find severity
    let severity = 'medium';
    if (text.match(/critical/i)) severity = 'critical';
    else if (text.match(/high/i)) severity = 'high';
    else if (text.match(/low/i)) severity = 'low';

    // Create entry
    const entry = {
      guid: guid,
      referenceId: guid,
      title: text.substring(0, 100).replace(/\n/g, ' ').trim(),
      description: text,
      category: text.match(/security|xss|csrf|auth|injection/i) ? 'security' : 'feature',
      severity: severity,
      status: 'tbd',
      source: 'vestige-security',
      package: severityToPackage[severity.charAt(0).toUpperCase() + severity.slice(1)] || 'security-medium',
      sourceData: {
        nodeId: node.id,
        nodeType: node.type
      },
      tags: ['vestige', 'audit'],
      versionReported: '1.55.0'
    };

    entries.push(entry);
  }

  console.log(`Found ${entries.length} entries from Vestige`);
  return entries;
}

/**
 * Read existing Firestore entries
 */
async function readExistingEntries() {
  console.log('Reading existing Firestore entries...');
  const snapshot = await db.collection('book_of_work').get();
  const entries = [];

  snapshot.forEach(doc => {
    entries.push({
      firestoreId: doc.id,
      ...doc.data()
    });
  });

  console.log(`Found ${entries.length} existing entries in Firestore`);
  return entries;
}

/**
 * Deduplicate entries by GUID (keep first occurrence)
 */
function deduplicateEntries(allEntries) {
  console.log(`\nDeduplicating ${allEntries.length} total entries...`);

  const seen = new Set();
  const deduplicated = [];

  for (const entry of allEntries) {
    const key = entry.guid || entry.referenceId || entry.firestoreId;

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduplicated.push(entry);
  }

  console.log(`After deduplication: ${deduplicated.length} unique entries`);
  return deduplicated;
}

/**
 * Remove undefined values from object recursively
 */
function removeUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined).filter(v => v !== undefined);
  }

  if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefined(value);
      }
    }
    return cleaned;
  }

  return obj;
}

/**
 * Upload to Firestore in batches
 */
async function uploadToFirestore(entries) {
  console.log(`\nUploading ${entries.length} entries to Firestore...`);

  const BATCH_SIZE = 500;
  let uploadCount = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = entries.slice(i, Math.min(i + BATCH_SIZE, entries.length));

    for (const entry of chunk) {
      // Remove Firestore-specific fields before upload
      const { firestoreId, ...data } = entry;

      // Add timestamps if missing
      if (!data.createdAt) {
        data.createdAt = admin.firestore.Timestamp.now();
      }
      if (!data.updatedAt) {
        data.updatedAt = admin.firestore.Timestamp.now();
      }

      // Remove undefined values (Firestore doesn't allow them)
      const cleanedData = removeUndefined(data);

      // Use existing Firestore ID if available, otherwise auto-generate
      const docRef = firestoreId
        ? db.collection('book_of_work').doc(firestoreId)
        : db.collection('book_of_work').doc();

      batch.set(docRef, cleanedData, { merge: true });
      uploadCount++;
    }

    await batch.commit();
    console.log(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1} (${uploadCount} total)`);
  }

  console.log(`\n✅ Upload complete: ${uploadCount} entries`);
  return uploadCount;
}

/**
 * Main migration function
 */
async function migrate() {
  try {
    console.log('=== COMPREHENSIVE BOOK OF WORK MIGRATION ===\n');

    // Step 1: Read from all sources
    const redTeamEntries = readRedTeamEntries();
    const archivedEntries = readArchivedEntries();
    const vestigeEntries = readVestigeEntries();
    const existingEntries = await readExistingEntries();

    // Step 2: Combine all entries
    const allEntries = [
      ...existingEntries,    // Keep existing first (priority)
      ...redTeamEntries,
      ...archivedEntries,
      ...vestigeEntries
    ];

    console.log(`\nTotal entries before deduplication: ${allEntries.length}`);
    console.log(`  - Existing Firestore: ${existingEntries.length}`);
    console.log(`  - RedTeam.json: ${redTeamEntries.length}`);
    console.log(`  - Archived file: ${archivedEntries.length}`);
    console.log(`  - Vestige memory: ${vestigeEntries.length}`);

    // Step 3: Deduplicate
    const uniqueEntries = deduplicateEntries(allEntries);

    // Step 4: Upload to Firestore
    const uploadedCount = await uploadToFirestore(uniqueEntries);

    console.log('\n=== MIGRATION SUMMARY ===');
    console.log(`Total unique entries: ${uniqueEntries.length}`);
    console.log(`Uploaded to Firestore: ${uploadedCount}`);
    console.log(`\nBreakdown by package:`);

    const packageCounts = {};
    uniqueEntries.forEach(e => {
      const pkg = e.package || 'unknown';
      packageCounts[pkg] = (packageCounts[pkg] || 0) + 1;
    });

    Object.entries(packageCounts).sort((a, b) => b[1] - a[1]).forEach(([pkg, count]) => {
      console.log(`  ${pkg}: ${count}`);
    });

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    // Cleanup
    admin.app().delete();
  }
}

// Run migration
migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
