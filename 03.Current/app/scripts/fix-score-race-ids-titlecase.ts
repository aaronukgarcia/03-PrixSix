/**
 * Fix score raceIds to Title-Case
 *
 * The scores have lowercase race IDs but standings page expects Title-Case
 */

import * as admin from 'firebase-admin';
import * as path from 'path';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');

function toTitleCase(raceId: string): string {
  return raceId
    .split('-')
    .map(word => {
      const upper = word.toUpperCase();
      // Keep GP, Sprint, II, III, IV as all-caps
      if (['GP', 'SPRINT', 'II', 'III', 'IV', 'I', 'V'].includes(upper)) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('-');
}

async function fixScoreRaceIds() {
  console.log('\n🔧 FIX SCORE RACE IDS TO TITLE-CASE');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE UPDATE'}\n`);

  const scoresSnapshot = await db.collection('scores').get();
  console.log(`📊 Found ${scoresSnapshot.size} scores to check\n`);

  let needsUpdate = 0;
  const batch = db.batch();

  scoresSnapshot.forEach(doc => {
    const data = doc.data();
    const currentRaceId = data.raceId;

    if (!currentRaceId) {
      console.log(`⚠️  Skipping ${doc.id} - no raceId`);
      return;
    }

    const titleCaseRaceId = toTitleCase(currentRaceId);

    if (currentRaceId !== titleCaseRaceId) {
      needsUpdate++;
      if (needsUpdate <= 5) {
        console.log(`  ${currentRaceId} → ${titleCaseRaceId}`);
      }

      if (!DRY_RUN) {
        batch.update(doc.ref, { raceId: titleCaseRaceId });
      }
    }
  });

  if (needsUpdate > 5) {
    console.log(`  ... and ${needsUpdate - 5} more`);
  }

  console.log(`\n📊 Summary: ${needsUpdate} scores need Title-Case update\n`);

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN - No changes made.');
    console.log('   Run with --live to update scores.\n');
    return;
  }

  if (needsUpdate === 0) {
    console.log('✅ All scores already in Title-Case!\n');
    return;
  }

  console.log('💾 Updating scores...');
  await batch.commit();
  console.log(`✅ Updated ${needsUpdate} scores to Title-Case!\n`);
}

fixScoreRaceIds()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
