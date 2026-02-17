// GUID: SCRIPTS_RESET_SEASON-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Season reset - delete race results, scores, audit logs.
//          Preserves users, predictions, leagues. For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer to reset season data.
// [Downstream Impact] Major data deletion (race_results, scores, audit_logs). Now blocked on production.
//
// PURPOSE: Reset Prix Six to start of season while preserving predictions
//
// DELETES:
//   - All race_results collection documents
//   - All scores collection documents
//   - All audit_logs collection documents
//
// PRESERVES:
//   - All users
//   - All predictions
//   - All leagues
//   - Static data (drivers, race schedule)
//
// Usage:
//   DRY RUN: npx ts-node --project tsconfig.scripts.json scripts/reset-season-delete-results.ts --dry-run
//   LIVE:    npx ts-node --project tsconfig.scripts.json scripts/reset-season-delete-results.ts --live

import * as admin from 'firebase-admin';
import * as path from 'path';
import { runSafetyChecks } from './_safety-checks';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

async function resetSeason() {
  try {
    console.log('\n🔥 SEASON RESET - DELETE ALL RESULTS, SCORES, AND AUDIT LOGS 🔥');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (--dry-run)' : '🔴 LIVE DELETION (--live)'}\n`);

    // GUID: SCRIPTS_RESET_SEASON-001-v02
    // [Intent] Safety checks - prevent production execution (unless DRY_RUN mode).
    // [Inbound Trigger] First action before any database operations (skipped in DRY_RUN).
    // [Downstream Impact] Exits with error if production detected or user cancels.
    if (!DRY_RUN) {
      await runSafetyChecks(
        'SEASON RESET: Delete all race_results, scores, and audit_logs collections'
      );
    }

    // Collection stats
    const collections = [
      { name: 'race_results', ref: db.collection('race_results') },
      { name: 'scores', ref: db.collection('scores') },
      { name: 'audit_logs', ref: db.collection('audit_logs') },
    ];

    const stats: Record<string, number> = {};

    // Count documents in each collection
    console.log('📊 Analyzing collections...\n');
    for (const collection of collections) {
      const snapshot = await collection.ref.get();
      stats[collection.name] = snapshot.size;
      console.log(`  ${collection.name}: ${snapshot.size} documents`);
    }

    const totalDocs = Object.values(stats).reduce((sum, count) => sum + count, 0);
    console.log(`\n  TOTAL TO DELETE: ${totalDocs} documents\n`);

    if (totalDocs === 0) {
      console.log('✓ No documents to delete - collections are already empty');
      return;
    }

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - No changes made. Run with --live to delete.');
      return;
    }

    // LIVE DELETION
    console.log('🔥 Starting deletion...\n');

    for (const collection of collections) {
      const count = stats[collection.name];
      if (count === 0) {
        console.log(`  ✓ ${collection.name}: already empty`);
        continue;
      }

      console.log(`  🔥 Deleting ${collection.name} (${count} docs)...`);

      // Delete in batches of 500
      const BATCH_SIZE = 500;
      let deleted = 0;

      while (true) {
        const snapshot = await collection.ref.limit(BATCH_SIZE).get();
        if (snapshot.empty) break;

        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        deleted += snapshot.size;
        if (count > BATCH_SIZE) {
          console.log(`     Progress: ${deleted}/${count} deleted...`);
        }
      }

      console.log(`  ✅ ${collection.name}: ${deleted} documents deleted\n`);
    }

    console.log('═'.repeat(70));
    console.log('✅ SEASON RESET COMPLETE');
    console.log('═'.repeat(70));
    console.log(`\nDeleted ${totalDocs} documents across 3 collections`);
    console.log('\nPreserved:');
    console.log('  ✓ Users');
    console.log('  ✓ Predictions');
    console.log('  ✓ Leagues');
    console.log('\nThe app is now at the start of the season! 🏁\n');

  } catch (error) {
    console.error('\n❌ Reset failed:', error);
    throw error;
  }
}

resetSeason()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
