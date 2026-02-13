/**
 * Migration script to fix score raceId format: lowercase → Title-Case
 *
 * PROBLEM: Legacy scores have lowercase race IDs (e.g., "abu-dhabi-grand-prix-gp")
 *          but race results and predictions use Title-Case (e.g., "Abu-Dhabi-Grand-Prix-GP")
 *
 * IMPACT: Standings page shows "no completed race weekends" even though scores exist,
 *         because Title-Case lookup fails against lowercase data
 *
 * SOLUTION: Convert all score race IDs to Title-Case to match canonical format
 *           This maintains Golden Rule #3: Single Source of Truth (RaceSchedule → Title-Case)
 *
 * Usage:
 *   DRY RUN: npx ts-node --project tsconfig.scripts.json scripts/migrate-score-race-ids-to-titlecase.ts --dry-run
 *   LIVE:    npx ts-node --project tsconfig.scripts.json scripts/migrate-score-race-ids-to-titlecase.ts --live
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

/**
 * Convert lowercase race ID to Title-Case
 * Examples:
 *   "abu-dhabi-grand-prix-gp" → "Abu-Dhabi-Grand-Prix-GP"
 *   "british-grand-prix-sprint" → "British-Grand-Prix-Sprint"
 */
function toTitleCase(raceId: string): string {
  return raceId
    .split('-')
    .map(word => {
      const upper = word.toUpperCase();
      // Keep GP, II, III, IV as all-caps
      if (['GP', 'II', 'III', 'IV', 'I', 'V'].includes(upper)) {
        return upper;
      }
      // Title-case regular words
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('-');
}

async function migrateScoreRaceIds() {
  try {
    console.log('\n=== Score Race ID Title-Case Migration ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (--dry-run)' : 'LIVE (--live)'}\\n`);

    // Fetch all scores
    const scoresSnapshot = await db.collection('scores').get();
    console.log(`Found ${scoresSnapshot.size} total scores\\n`);

    const updates: Array<{ docId: string; oldRaceId: string; newRaceId: string }> = [];
    let skipped = 0;
    let alreadyCorrect = 0;

    scoresSnapshot.forEach(doc => {
      const data = doc.data();
      const oldRaceId = data.raceId;

      if (!oldRaceId) {
        console.log(`  ⚠ Score ${doc.id} has no raceId - skipping`);
        skipped++;
        return;
      }

      const newRaceId = toTitleCase(oldRaceId);

      if (oldRaceId === newRaceId) {
        // Already Title-Case
        alreadyCorrect++;
        return;
      }

      updates.push({ docId: doc.id, oldRaceId, newRaceId });
    });

    console.log(`Analysis Results:`);
    console.log(`  Already Title-Case: ${alreadyCorrect}`);
    console.log(`  Needs update: ${updates.length}`);
    console.log(`  Skipped (no raceId): ${skipped}`);
    console.log('');

    if (updates.length === 0) {
      console.log('✓ No scores need updating');
      return;
    }

    // Display sample updates
    console.log(`Sample updates (showing first 5):`);
    updates.slice(0, 5).forEach(({ docId, oldRaceId, newRaceId }) => {
      console.log(`  ${docId}`);
      console.log(`    "${oldRaceId}" → "${newRaceId}"`);
    });
    console.log('');

    if (DRY_RUN) {
      console.log(`⚠ DRY RUN - No changes written. Run with --live to apply changes.`);
      console.log(`\\nTotal scores to update: ${updates.length}`);
      return;
    }

    // LIVE mode - batch update
    console.log(`Updating ${updates.length} scores in batches of 500...`);

    let processed = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = updates.slice(i, i + BATCH_SIZE);

      chunk.forEach(({ docId, newRaceId }) => {
        const docRef = db.collection('scores').doc(docId);
        batch.update(docRef, { raceId: newRaceId });
      });

      await batch.commit();
      processed += chunk.length;
      console.log(`  Processed ${processed}/${updates.length} scores...`);
    }

    console.log(`\\n✓ Successfully updated ${updates.length} scores to Title-Case`);

  } catch (error) {
    console.error('\\n❌ Migration failed:', error);
    throw error;
  }
}

migrateScoreRaceIds()
  .then(() => {
    console.log('\\nMigration completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('\\nMigration failed:', error);
    process.exit(1);
  });
