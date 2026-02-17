// GUID: SCRIPTS_DELETE_SCORES-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Delete ALL scores from Firestore. For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer before recalculation.
// [Downstream Impact] All user scores deleted. Now blocked on production.
//
// Run with: npx ts-node --project tsconfig.scripts.json scripts/delete-all-scores.ts

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

async function deleteAllScores() {
  // GUID: SCRIPTS_DELETE_SCORES-001-v02
  // [Intent] Safety checks - prevent production execution and require user confirmation.
  // [Inbound Trigger] First action before any database operations.
  // [Downstream Impact] Exits with error if production detected or user cancels.
  await runSafetyChecks('DELETE ALL SCORES (entire scores collection)');

  console.log('Deleting ALL scores for fresh recalculation...\n');

  // Fetch all scores
  const scoresSnapshot = await db.collection('scores').get();
  console.log(`Found ${scoresSnapshot.size} scores to delete\n`);

  if (scoresSnapshot.size === 0) {
    console.log('No scores to delete.');
    return;
  }

  let deletedCount = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of scoresSnapshot.docs) {
    batch.delete(doc.ref);
    deletedCount++;
    batchCount++;

    // Commit batch every 400 operations
    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  Committed batch of ${batchCount} deletions (${deletedCount} total)`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  Committed batch of ${batchCount} deletions (${deletedCount} total)`);
  }

  console.log('\n========================================');
  console.log(`Deleted ${deletedCount} scores`);
  console.log('========================================\n');
}

// Run the script
deleteAllScores()
  .then(() => {
    console.log('Done! Now run recalculate-scores.ts');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
