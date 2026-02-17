// GUID: SCRIPT_MIGRATE_RACE_ID-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] MIGRATION: Normalize all prediction race IDs to Title-Case format.
//          Fixes lowercase race IDs like "british-grand-prix-sprint" to "British-Grand-Prix-Sprint".
//          For dev/test environments ONLY (unless explicitly approved for production migration).
// [Inbound Trigger] Manually run via: npx ts-node --project tsconfig.scripts.json scripts/migrate-race-id-case.ts
// [Downstream Impact] Updates predictions collection with Title-Case race IDs. Improves consistency
//                     and resolves Consistency Checker warnings. Now blocked on production.

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { generateRaceId } from '../src/lib/normalize-race-id';
import { runSafetyChecks } from './_safety-checks';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Dry run flag - set to false to actually apply changes
const DRY_RUN = process.argv.includes('--apply') ? false : true;

interface PredictionDoc {
  id: string;
  userId: string;
  teamId: string;
  teamName: string;
  raceId: string;
  raceName?: string;
  predictions: string[];
  submittedAt: admin.firestore.Timestamp;
  isCarryForward?: boolean;
}

// GUID: SCRIPT_MIGRATE_RACE_ID-001-v01
// [Intent] Detects if a race ID needs normalization (is lowercase or mixed-case).
// [Inbound Trigger] Called for each prediction document.
// [Downstream Impact] Returns true if raceId should be updated to Title-Case.
function needsNormalization(raceId: string): boolean {
  // Check if raceId has any lowercase letters that should be uppercase
  // Title-Case format: "British-Grand-Prix-Sprint"
  // Incorrect formats: "british-grand-prix-sprint", "British-Grand-Prix-sprint", etc.

  const parts = raceId.split('-');
  for (const part of parts) {
    if (part.length > 0) {
      // First letter should be uppercase (except for Roman numerals like "II")
      if (part !== part.toUpperCase() && part[0] !== part[0].toUpperCase()) {
        return true;
      }
      // Rest should be lowercase (except "GP" and "Sprint")
      if (part !== 'GP' && part !== 'Sprint' && part !== 'II' && part !== 'III') {
        const rest = part.slice(1);
        if (rest !== rest.toLowerCase()) {
          return true;
        }
      }
    }
  }
  return false;
}

// GUID: SCRIPT_MIGRATE_RACE_ID-002-v01
// [Intent] Normalizes a race ID to Title-Case format.
// [Inbound Trigger] Called for predictions that need normalization.
// [Downstream Impact] Returns the correct Title-Case race ID.
function normalizeRaceId(raceId: string): string {
  // Extract race type (GP or Sprint)
  const isSprintRace = /sprint/i.test(raceId);

  // Remove GP/Sprint suffix and normalize to title case
  const baseName = raceId
    .replace(/-GP$/i, '')
    .replace(/-Sprint$/i, '')
    .split('-')
    .map(word => {
      // Handle special cases
      if (word.toUpperCase() === 'II' || word.toUpperCase() === 'III') {
        return word.toUpperCase();
      }
      // Capitalize first letter, lowercase rest
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  // Use generateRaceId for consistent formatting
  return generateRaceId(baseName, isSprintRace ? 'sprint' : 'gp');
}

// GUID: SCRIPT_MIGRATE_RACE_ID-003-v01
// [Intent] Main migration logic that scans all predictions and normalizes race IDs.
// [Inbound Trigger] Script execution.
// [Downstream Impact] Updates prediction documents in Firestore (if --apply flag is set).
async function migratePredictions() {
  console.log('='.repeat(80));
  console.log('Race ID Case Normalization Migration');
  console.log('='.repeat(80));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'APPLY (will update database)'}`);
  console.log('');

  // GUID: SCRIPT_MIGRATE_RACE_ID-001-v02
  // [Intent] Safety checks - prevent production execution (unless DRY_RUN mode).
  // [Inbound Trigger] First action before any database operations (skipped in DRY_RUN).
  // [Downstream Impact] Exits with error if production detected or user cancels.
  if (!DRY_RUN) {
    await runSafetyChecks('MIGRATE RACE IDS: Update all predictions to Title-Case race ID format');
  }

  let totalScanned = 0;
  let totalNeedingUpdate = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  const updates: { userId: string; docId: string; oldRaceId: string; newRaceId: string }[] = [];

  // GUID: SCRIPT_MIGRATE_RACE_ID-004-v01
  // [Intent] Scan all users and their prediction subcollections.
  // [Inbound Trigger] Main migration execution.
  // [Downstream Impact] Iterates through all predictions to find those needing normalization.
  try {
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.size} users\n`);

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const predictionsSnapshot = await db.collection('users').doc(userId).collection('predictions').get();

      for (const predictionDoc of predictionsSnapshot.docs) {
        totalScanned++;
        const data = predictionDoc.data() as PredictionDoc;
        const { raceId } = data;

        if (needsNormalization(raceId)) {
          totalNeedingUpdate++;
          const newRaceId = normalizeRaceId(raceId);

          console.log(`[${totalNeedingUpdate}] User: ${userId}`);
          console.log(`    Doc ID: ${predictionDoc.id}`);
          console.log(`    Old: ${raceId}`);
          console.log(`    New: ${newRaceId}`);
          console.log('');

          updates.push({
            userId,
            docId: predictionDoc.id,
            oldRaceId: raceId,
            newRaceId,
          });

          if (!DRY_RUN) {
            try {
              await predictionDoc.ref.update({
                raceId: newRaceId,
              });
              totalUpdated++;
            } catch (error: any) {
              console.error(`    ERROR updating: ${error.message}`);
              totalErrors++;
            }
          }
        }
      }
    }

    // Summary
    console.log('='.repeat(80));
    console.log('Migration Summary');
    console.log('='.repeat(80));
    console.log(`Total predictions scanned: ${totalScanned}`);
    console.log(`Predictions needing update: ${totalNeedingUpdate}`);

    if (!DRY_RUN) {
      console.log(`Successfully updated: ${totalUpdated}`);
      console.log(`Errors: ${totalErrors}`);
    } else {
      console.log('');
      console.log('To apply these changes, run:');
      console.log('  npx ts-node --project tsconfig.scripts.json scripts/migrate-race-id-case.ts --apply');
    }
    console.log('='.repeat(80));

    // Write migration log
    if (!DRY_RUN && updates.length > 0) {
      const logPath = path.resolve(__dirname, `migration-log-${Date.now()}.json`);
      await require('fs').promises.writeFile(
        logPath,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          totalScanned,
          totalUpdated,
          totalErrors,
          updates,
        }, null, 2)
      );
      console.log(`\nMigration log written to: ${logPath}`);
    }

  } catch (error: any) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migratePredictions()
  .then(() => {
    console.log('\nMigration complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
