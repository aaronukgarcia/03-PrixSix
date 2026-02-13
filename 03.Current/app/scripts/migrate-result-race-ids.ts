/**
 * Migration script to fix raceId field in race_results collection
 *
 * PROBLEM: Race results were stored with display format (spaces) instead of normalized format (hyphens)
 * - Old: "British Grand Prix - Sprint"
 * - New: "British-Grand-Prix-Sprint"
 *
 * This script updates the raceId field to match the document ID format (Title-Case with hyphens).
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function migrateResultRaceIds() {
  try {
    console.log('\n=== Race Result raceId Migration ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (--dry-run)' : 'LIVE (--live)'}\n`);

    // Get all race results
    const resultsSnapshot = await db.collection('race_results').get();
    console.log(`Found ${resultsSnapshot.size} race result documents\n`);

    let updatedCount = 0;
    const batch = db.batch();

    resultsSnapshot.forEach(doc => {
      const data = doc.data();
      const docId = doc.id;
      const currentRaceId = data.raceId;

      // Check if raceId contains spaces (old format)
      if (currentRaceId && currentRaceId.includes(' ')) {
        // Convert to Title-Case hyphenated format to match predictions
        // "British Grand Prix - Sprint" -> "British-Grand-Prix-Sprint"
        const newRaceId = currentRaceId
          .replace(/\s+-\s+/g, '-')  // Replace " - " with "-"
          .replace(/\s+/g, '-');     // Replace remaining spaces with "-"

        console.log(`  Doc ID: ${docId}`);
        console.log(`  Current raceId: "${currentRaceId}"`);
        console.log(`  New raceId: "${newRaceId}"`);

        if (!DRY_RUN) {
          batch.update(doc.ref, {
            raceId: newRaceId
          });
        }

        updatedCount++;
        console.log('');
      }
    });

    console.log(`\nSummary:`);
    console.log(`  Documents needing update: ${updatedCount}`);
    console.log(`  Documents unchanged: ${resultsSnapshot.size - updatedCount}`);

    if (!DRY_RUN && updatedCount > 0) {
      console.log(`\nCommitting batch update...`);
      await batch.commit();
      console.log(`✓ Successfully updated ${updatedCount} race result documents`);
    } else if (DRY_RUN && updatedCount > 0) {
      console.log(`\n⚠ DRY RUN - No changes written. Run with --live to apply changes.`);
    } else {
      console.log(`\n✓ No updates needed - all race results already in correct format`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  }
}

migrateResultRaceIds()
  .then(() => {
    console.log('\nMigration completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nMigration failed:', error);
    process.exit(1);
  });
