/**
 * Fix invalid Book of Work entries by adding missing required fields
 * Required fields: title, description, category, status, source
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function fixInvalidEntries() {
  console.log('=== FIXING INVALID BOOK OF WORK ENTRIES ===\n');

  try {
    // Get all entries
    const snapshot = await db.collection('book_of_work').get();
    console.log(`Total entries: ${snapshot.size}`);

    const invalidEntries = [];
    const validEntries = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const hasRequiredFields = data.title && data.description && data.category && data.status && data.source;

      if (!hasRequiredFields) {
        invalidEntries.push({ id: doc.id, data });
      } else {
        validEntries.push({ id: doc.id, data });
      }
    });

    console.log(`Valid entries: ${validEntries.length}`);
    console.log(`Invalid entries: ${invalidEntries.length}\n`);

    if (invalidEntries.length === 0) {
      console.log('✓ No invalid entries to fix!');
      return;
    }

    // Analyze what's missing
    console.log('Analyzing missing fields...');
    const missingFields = {
      title: 0,
      description: 0,
      category: 0,
      status: 0,
      source: 0
    };

    invalidEntries.forEach(({ data }) => {
      if (!data.title) missingFields.title++;
      if (!data.description) missingFields.description++;
      if (!data.category) missingFields.category++;
      if (!data.status) missingFields.status++;
      if (!data.source) missingFields.source++;
    });

    console.log('Missing field counts:');
    Object.entries(missingFields).forEach(([field, count]) => {
      console.log(`  ${field}: ${count}`);
    });

    // Fix each invalid entry
    console.log(`\nFixing ${invalidEntries.length} entries...`);
    const batch = db.batch();
    let fixCount = 0;

    for (const { id, data } of invalidEntries) {
      const updates = {};

      // Add missing title
      if (!data.title) {
        updates.title = data.issue || data.security_issue || data.guid || data.referenceId || 'Untitled Issue';
      }

      // Add missing description
      if (!data.description) {
        updates.description = data.rationale || data.impact || data.details || 'No description available';
      }

      // Add missing category
      if (!data.category) {
        // Infer from existing data
        if (data.security_issue || data.severity || data.module?.includes('Security')) {
          updates.category = 'security';
        } else if (data.issue?.includes('UX') || data.issue?.includes('UI')) {
          updates.category = 'ui';
        } else {
          updates.category = 'feature';
        }
      }

      // Add missing status
      if (!data.status) {
        updates.status = 'tbd';
      }

      // Add missing source
      if (!data.source) {
        // Infer from ID or existing data
        if (id.startsWith('GEMINI-AUDIT')) {
          updates.source = 'vestige-redteam';
        } else if (id.startsWith('VIRGIN-')) {
          updates.source = 'virgin-ux';
        } else if (data.guid?.startsWith('GEMINI-AUDIT')) {
          updates.source = 'vestige-redteam';
        } else {
          updates.source = 'firestore-existing';
        }
      }

      // Update timestamp
      updates.updatedAt = admin.firestore.Timestamp.now();

      const docRef = db.collection('book_of_work').doc(id);
      batch.update(docRef, updates);
      fixCount++;

      if (fixCount % 50 === 0) {
        console.log(`  Fixed ${fixCount} entries...`);
      }
    }

    // Commit the batch
    await batch.commit();
    console.log(`\n✓ Fixed ${fixCount} entries`);

    // Verify the fix
    console.log('\nVerifying fixes...');
    const verifySnapshot = await db.collection('book_of_work').get();
    let stillInvalid = 0;

    verifySnapshot.forEach(doc => {
      const data = doc.data();
      const hasRequiredFields = data.title && data.description && data.category && data.status && data.source;
      if (!hasRequiredFields) {
        stillInvalid++;
        console.log(`  ⚠ Still invalid: ${doc.id}`);
      }
    });

    if (stillInvalid === 0) {
      console.log('✅ All entries now valid!');
    } else {
      console.log(`⚠ ${stillInvalid} entries still invalid`);
    }

  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    throw error;
  } finally {
    admin.app().delete();
  }
}

fixInvalidEntries()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
