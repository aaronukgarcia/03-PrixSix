// backfill-fia-urls.js
// One-off script to patch fiaClassificationUrl onto existing race_results docs
// for Chinese GP and Chinese Sprint (2026) which were submitted before this field existed.
//
// FIA GP URL confirmed working:
//   https://www.fia.com/system/files/decision-document/2026_chinese_grand_prix_-_final_race_classification.pdf
//
// FIA Sprint URL — pattern from downloaded file "2026 Chinese Grand Prix - Final Sprint Qualifying Classification":
//   https://www.fia.com/system/files/decision-document/2026_chinese_grand_prix_-_final_sprint_qualifying_classification.pdf
//   *** Verify this URL opens before running with DRY_RUN=false ***
//
// Usage:
//   DRY_RUN=true  node scripts/backfill-fia-urls.js   ← show what would change, no writes
//   DRY_RUN=false node scripts/backfill-fia-urls.js   ← apply patches

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

if (!getApps().length) {
  initializeApp({ credential: cert(path.resolve(__dirname, '../service-account.json')) });
}
const db = getFirestore();

const DRY_RUN = process.env.DRY_RUN !== 'false';

// Edit these if the doc IDs or URLs need correcting.
const PATCHES = [
  {
    docId: 'Chinese-Grand-Prix-GP',
    fiaClassificationUrl: 'https://www.fia.com/system/files/decision-document/2026_chinese_grand_prix_-_final_race_classification.pdf',
    label: 'Chinese GP',
  },
  {
    docId: 'Chinese-Grand-Prix-Sprint',
    // *** Verify this URL before running with DRY_RUN=false ***
    fiaClassificationUrl: 'https://www.fia.com/system/files/decision-document/2026_chinese_grand_prix_-_final_sprint_qualifying_classification.pdf',
    label: 'Chinese Sprint',
  },
];

async function run() {
  console.log(DRY_RUN ? '[DRY RUN — no writes]' : '[LIVE — writing to Firestore]');
  console.log('');

  for (const patch of PATCHES) {
    const ref = db.collection('race_results').doc(patch.docId);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log(`❌  ${patch.label} (${patch.docId}) — doc NOT FOUND in race_results`);
      continue;
    }

    const current = snap.data();
    if (current.fiaClassificationUrl) {
      console.log(`⚠️   ${patch.label} — already has fiaClassificationUrl: ${current.fiaClassificationUrl}`);
      continue;
    }

    console.log(`✅  ${patch.label} — will set fiaClassificationUrl:`);
    console.log(`    ${patch.fiaClassificationUrl}`);

    if (!DRY_RUN) {
      await ref.update({ fiaClassificationUrl: patch.fiaClassificationUrl });
      console.log(`    → written.`);
    }
  }

  console.log('');
  console.log(DRY_RUN ? 'Dry run complete. Set DRY_RUN=false to apply.' : 'Done.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
