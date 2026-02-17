// GUID: SCRIPTS_DELETE_RACE_RESULTS-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Delete all race_results from database. For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer during backup/restore validation.
// [Downstream Impact] All race results deleted. Now blocked on production.
//
// Part of backup/restore validation cycle

import * as admin from 'firebase-admin';
import * as path from 'path';
import { runSafetyChecks } from './_safety-checks';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function deleteRaceResults() {
  // GUID: SCRIPTS_DELETE_RACE_RESULTS-001-v02
  // [Intent] Safety checks - prevent production execution (unless DRY_RUN mode).
  // [Inbound Trigger] First action before any database operations (skipped in DRY_RUN).
  // [Downstream Impact] Exits with error if production detected or user cancels.
  if (!DRY_RUN) {
    await runSafetyChecks('DELETE ALL RACE RESULTS (race_results collection)');
  }

  console.log('\n🗑️  DELETE ALL RACE RESULTS');
  console.log(`Mode: ${DRY_RUN ? '⚠️  DRY RUN' : '🔴 LIVE DELETE'}\n`);

  const snapshot = await db.collection('race_results').get();
  console.log(`📊 Found ${snapshot.size} race_results documents\n`);

  if (snapshot.size === 0) {
    console.log('✅ No race_results to delete!\n');
    return;
  }

  if (DRY_RUN) {
    console.log('📋 Would delete:');
    snapshot.docs.slice(0, 10).forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: ${data.raceName} (${data.raceId})`);
    });
    if (snapshot.size > 10) {
      console.log(`  ... and ${snapshot.size - 10} more`);
    }
    console.log(`\n⚠️  DRY RUN - Would delete ${snapshot.size} documents`);
    console.log('   Run with --live to delete.\n');
    return;
  }

  console.log('🔴 DELETING race_results...');
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log(`✅ Deleted ${snapshot.size} race_results!\n`);
}

deleteRaceResults()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
