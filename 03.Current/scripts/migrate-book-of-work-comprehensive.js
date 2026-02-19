/**
 * Comprehensive Book of Work Migration Script
 *
 * Migrates ALL work items from multiple sources into Firestore book_of_work collection:
 * 1. Existing Firestore items (31 UX items)
 * 2. Archived security audit (141 critical issues)
 * 3. Vestige memory (if available)
 *
 * Each item tagged with source and package flags for filtering
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');
const fs = require('fs');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'studio-6033436327-281b1'
});

const db = admin.firestore();

// Category mapping for different sources
const SOURCE_CATEGORIES = {
  UX_AUDIT: 'ui',
  SECURITY_AUDIT: 'security',
  INFRASTRUCTURE: 'infrastructure',
  SYSTEM_ERROR: 'system-error',
  USER_ERROR: 'user-error',
  FEATURE: 'feature',
  COSMETIC: 'cosmetic'
};

// Package types for filtering
const PACKAGES = {
  VIRGIN_UX: 'virgin-ux-audit',
  SECURITY_CRITICAL: 'security-critical',
  SECURITY_HIGH: 'security-high',
  SECURITY_MEDIUM: 'security-medium',
  SECURITY_LOW: 'security-low',
  VESTIGE_AUDIT: 'vestige-audit'
};

async function migrateAllSources() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE BOOK OF WORK MIGRATION');
  console.log('='.repeat(80));
  console.log();

  // Track all items to upload
  const allItems = [];

  // ========================================================================
  // SOURCE 1: Existing Firestore items (keep them, just add package flags)
  // ========================================================================
  console.log('[1/3] Reading existing Firestore items...');
  const existingSnapshot = await db.collection('book_of_work').get();
  console.log(`Found ${existingSnapshot.size} existing items in Firestore`);

  const existingIds = new Set();
  existingSnapshot.forEach(doc => {
    existingIds.add(doc.id);
    const data = doc.data();
    allItems.push({
      id: doc.id,
      ...data,
      package: PACKAGES.VIRGIN_UX, // Tag existing UX items
      source: 'firestore-existing',
      migrated: false // Already in Firestore
    });
  });
  console.log(`✓ Cataloged ${existingIds.size} existing items\n`);

  // ========================================================================
  // SOURCE 2: Archived security audit critical issues
  // ========================================================================
  console.log('[2/3] Reading archived security audit file...');
  const archivePath = path.join(__dirname, '../archived-book-of-works/book-of-works-01.json');

  if (fs.existsSync(archivePath)) {
    const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    const criticalIssues = archiveData.criticalIssues || [];

    console.log(`Found ${criticalIssues.length} critical issues in archive`);

    let addedFromArchive = 0;
    criticalIssues.forEach((issue, index) => {
      // Generate deterministic ID from issue content
      const issueId = issue.id || `SECURITY-${String(index + 1).padStart(3, '0')}`;

      // Skip if already exists
      if (existingIds.has(issueId)) {
        console.log(`  Skipping duplicate: ${issueId}`);
        return;
      }

      // Determine severity-based package
      let packageType = PACKAGES.SECURITY_MEDIUM;
      if (issue.severity === 'critical') packageType = PACKAGES.SECURITY_CRITICAL;
      else if (issue.severity === 'high') packageType = PACKAGES.SECURITY_HIGH;
      else if (issue.severity === 'low') packageType = PACKAGES.SECURITY_LOW;

      allItems.push({
        id: issueId,
        title: issue.issue || issue.title || 'Untitled Security Issue',
        description: issue.impact || issue.description || '',
        category: SOURCE_CATEGORIES.SECURITY_AUDIT,
        severity: issue.severity || 'medium',
        status: 'tbd',
        priority: issue.severity === 'critical' ? 1 : issue.severity === 'high' ? 2 : 3,
        source: 'archived-security-audit',
        package: packageType,
        sourceData: {
          module: issue.module,
          file: issue.file,
          archiveDate: '2026-02-17'
        },
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        versionReported: '1.57.4',
        module: issue.module,
        file: issue.file,
        guid: `SECURITY-AUDIT-${issueId}`,
        referenceId: issue.id,
        migrated: true // Needs to be added to Firestore
      });

      addedFromArchive++;
    });

    console.log(`✓ Added ${addedFromArchive} new items from archive\n`);
  } else {
    console.log(`⚠ Archive file not found at ${archivePath}\n`);
  }

  // ========================================================================
  // SOURCE 3: Check for additional sources (virgin.json, RedTeam.json, etc.)
  // ========================================================================
  console.log('[3/3] Checking for additional source files...');

  const additionalSources = [
    '../virgin.json',
    '../RedTeam.json'
  ];

  for (const sourcePath of additionalSources) {
    const fullPath = path.join(__dirname, sourcePath);
    if (fs.existsSync(fullPath)) {
      try {
        const sourceData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        console.log(`  Found ${path.basename(fullPath)}`);

        // Parse based on file type
        if (sourcePath.includes('virgin.json') && sourceData.findings) {
          sourceData.findings.forEach((finding, index) => {
            const findingId = finding.id || `VIRGIN-${String(index + 1).padStart(3, '0')}`;

            if (!existingIds.has(findingId)) {
              allItems.push({
                id: findingId,
                title: finding.issue || finding.title || 'UX Issue',
                description: finding.details || finding.description || '',
                category: SOURCE_CATEGORIES.UX_AUDIT,
                severity: finding.severity || 'medium',
                status: 'tbd',
                priority: 3,
                source: 'virgin-ux-audit',
                package: PACKAGES.VIRGIN_UX,
                sourceData: {
                  page: finding.page,
                  userType: finding.userType
                },
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now(),
                guid: `VIRGIN-${findingId}`,
                migrated: true
              });
            }
          });
        }

        if (sourcePath.includes('RedTeam.json') && sourceData.issues) {
          sourceData.issues.forEach((issue, index) => {
            const issueId = issue.guid || `REDTEAM-${String(index + 1).padStart(3, '0')}`;

            if (!existingIds.has(issueId)) {
              allItems.push({
                id: issueId,
                title: issue.title || 'Security Finding',
                description: issue.description || '',
                category: SOURCE_CATEGORIES.SECURITY_AUDIT,
                severity: issue.severity || 'high',
                status: issue.status || 'tbd',
                priority: 2,
                source: 'redteam-security-audit',
                package: PACKAGES.SECURITY_HIGH,
                sourceData: {
                  cve: issue.cve,
                  owasp: issue.owasp
                },
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now(),
                guid: issueId,
                migrated: true
              });
            }
          });
        }
      } catch (err) {
        console.log(`  ⚠ Error reading ${path.basename(fullPath)}:`, err.message);
      }
    }
  }

  console.log();

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('='.repeat(80));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(80));

  const byPackage = {};
  const bySource = {};
  const byStatus = {};
  const toMigrate = allItems.filter(i => i.migrated);

  allItems.forEach(item => {
    byPackage[item.package] = (byPackage[item.package] || 0) + 1;
    bySource[item.source] = (bySource[item.source] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  });

  console.log(`Total items found: ${allItems.length}`);
  console.log(`  - Already in Firestore: ${existingIds.size}`);
  console.log(`  - New items to migrate: ${toMigrate.length}`);
  console.log();

  console.log('By Package:');
  Object.entries(byPackage).sort((a, b) => b[1] - a[1]).forEach(([pkg, count]) => {
    console.log(`  ${pkg}: ${count}`);
  });
  console.log();

  console.log('By Source:');
  Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([src, count]) => {
    console.log(`  ${src}: ${count}`);
  });
  console.log();

  console.log('By Status:');
  Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  console.log();

  // ========================================================================
  // MIGRATION CONFIRMATION
  // ========================================================================
  if (toMigrate.length === 0) {
    console.log('✓ All items already in Firestore - no migration needed');
    return;
  }

  console.log('='.repeat(80));
  console.log(`READY TO MIGRATE ${toMigrate.length} NEW ITEMS TO FIRESTORE`);
  console.log('='.repeat(80));
  console.log();
  console.log('This will:');
  console.log(`  1. Add ${toMigrate.length} new documents to book_of_work collection`);
  console.log(`  2. Preserve ${existingIds.size} existing documents`);
  console.log('  3. Tag all items with source and package flags for filtering');
  console.log();

  // Auto-proceed (for production use, add confirmation prompt here)
  console.log('Starting migration...\n');

  // Batch upload in chunks of 500 (Firestore batch limit)
  const BATCH_SIZE = 500;
  let uploaded = 0;

  for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toMigrate.slice(i, Math.min(i + BATCH_SIZE, toMigrate.length));

    chunk.forEach(item => {
      const { id, migrated, ...data } = item;
      const docRef = db.collection('book_of_work').doc(id);
      batch.set(docRef, data);
    });

    await batch.commit();
    uploaded += chunk.length;
    console.log(`  Uploaded ${uploaded} / ${toMigrate.length} items...`);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('✓ MIGRATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total items in book_of_work collection: ${allItems.length}`);
  console.log(`  - Migrated this run: ${toMigrate.length}`);
  console.log(`  - Pre-existing: ${existingIds.size}`);
  console.log();
  console.log('Available package filters in admin panel:');
  Object.values(PACKAGES).forEach(pkg => {
    const count = byPackage[pkg] || 0;
    console.log(`  - ${pkg}: ${count} items`);
  });
}

// Run migration
migrateAllSources()
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n✗ Migration failed:', err);
    process.exit(1);
  });
