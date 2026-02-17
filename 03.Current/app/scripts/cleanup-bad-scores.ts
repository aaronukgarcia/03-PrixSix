// GUID: SCRIPTS_CLEANUP_BAD_SCORES-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Delete scores with invalid format (missing userId, wrong ID format).
//          For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer to clean up malformed score data.
// [Downstream Impact] Selective deletion of invalid scores. Now blocked on production.
//
// Run with: npx ts-node --project tsconfig.scripts.json scripts/cleanup-bad-scores.ts

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import { runSafetyChecks } from './_safety-checks';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

const db = getFirestore();

async function cleanupBadScores() {
  // GUID: SCRIPTS_CLEANUP_BAD_SCORES-001-v02
  // [Intent] Safety checks - prevent production execution and require user confirmation.
  // [Inbound Trigger] First action before any database operations.
  // [Downstream Impact] Exits with error if production detected or user cancels.
  await runSafetyChecks('CLEANUP INVALID SCORES: Delete scores with missing userId or wrong format');

  console.log('Starting cleanup of invalid scores...\n');

  // Fetch all scores
  const scoresSnapshot = await db.collection('scores').get();
  console.log(`Found ${scoresSnapshot.size} total scores\n`);

  let deletedCount = 0;
  let validCount = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of scoresSnapshot.docs) {
    const data = doc.data();
    const id = doc.id;

    // Check if score has proper format
    const hasUserId = !!data.userId;
    const hasProperIdFormat = id.includes('_');

    if (!hasUserId || !hasProperIdFormat) {
      batch.delete(doc.ref);
      deletedCount++;
      batchCount++;

      // Commit batch every 400 operations
      if (batchCount >= 400) {
        await batch.commit();
        console.log(`  Committed batch of ${batchCount} deletions`);
        batch = db.batch();  // Create new batch
        batchCount = 0;
      }
    } else {
      validCount++;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  Committed batch of ${batchCount} deletions`);
  }

  console.log('\n========================================');
  console.log('Cleanup complete!');
  console.log(`  Valid scores kept: ${validCount}`);
  console.log(`  Invalid scores deleted: ${deletedCount}`);
  console.log('========================================\n');
}

// Run the script
cleanupBadScores()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
