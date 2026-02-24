// GUID: SCRIPT_PURGE_TEST-000-v01
// [Type] Utility Script — development/testing only
// [Intent] Surgical post-test purge: deletes race_results (all), test-team scores (only),
//          test-team prediction subcollections (only). Real user predictions are preserved.
//          Real team score documents ARE deleted — they were scored against purged results
//          so are meaningless, but their predictions remain intact for the real season.
// [Usage] npx ts-node --project tsconfig.scripts.json scripts/purge-test-season.ts
//         Add --dry-run to preview without deleting.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../service-account.json');

if (!getApps().length) initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
const db = getFirestore();

function log(msg: string) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function sep() { console.log('─'.repeat(70)); }
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const BATCH_LIMIT = 400; // Firestore max batch size

async function deleteInBatches(refs: FirebaseFirestore.DocumentReference[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    if (!DRY_RUN) {
      const batch = db.batch();
      chunk.forEach(r => batch.delete(r));
      await batch.commit();
    }
    deleted += chunk.length;
    process.stdout.write('.');
  }
  console.log();
  return deleted;
}

async function main() {
  sep();
  log(`Prix Six — Surgical Test Season Purge`);
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no deletes)' : 'LIVE — deleting test data'}`);
  sep();

  // ── STEP 1: Find test user UIDs ─────────────────────────────────────────────
  log('Step 1: Identifying test users (teamName starts with "test-team-")...');
  const usersSnap = await db.collection('users')
    .where('teamName', '>=', 'test-team-')
    .where('teamName', '<=', 'test-team-\uffff')
    .get();

  if (usersSnap.empty) {
    log('  No test users found. Nothing to purge.');
    return;
  }

  const testUsers = usersSnap.docs.map(d => ({ uid: d.id, teamName: d.data().teamName as string }));
  const testUidSet = new Set(testUsers.map(u => u.uid));
  log(`  Found ${testUsers.length} test users:`);
  testUsers.forEach(u => log(`    ${u.teamName} (uid=${u.uid})`));
  sep();

  // ── STEP 2: Delete ALL race_results ────────────────────────────────────────
  // These are the documents that lock the real season. Delete all of them.
  log('Step 2: Deleting race_results (all — these unlock the real season)...');
  const raceResultsSnap = await db.collection('race_results').get();
  log(`  Found ${raceResultsSnap.size} race_results documents`);
  if (!raceResultsSnap.empty) {
    const refs = raceResultsSnap.docs.map(d => d.ref);
    log(`  Deleting...`);
    const n = await deleteInBatches(refs);
    log(`  ✓ Deleted ${n} race_results documents`);
  }
  sep();

  // ── STEP 3: Delete ALL scores ───────────────────────────────────────────────
  // Real team scores from this test are meaningless (results are gone).
  // Adjustment scores (late-joiner handicap, isAdjustment=true) are preserved.
  log('Step 3: Deleting non-adjustment scores for ALL users (results are gone)...');
  const allScoresSnap = await db.collection('scores')
    .where('isAdjustment', '!=', true)
    .get();
  log(`  Found ${allScoresSnap.size} non-adjustment score documents`);
  if (!allScoresSnap.empty) {
    const refs = allScoresSnap.docs.map(d => d.ref);
    log(`  Deleting...`);
    const n = await deleteInBatches(refs);
    log(`  ✓ Deleted ${n} score documents`);
  }

  // Also check scores that don't have isAdjustment field at all (older schema)
  const noFlagScoresSnap = await db.collection('scores').get();
  const noFlagRefs = noFlagScoresSnap.docs
    .filter(d => d.data().isAdjustment === undefined && !d.data().raceId?.includes('late-joiner'))
    .filter(d => {
      // Safety net: only delete if raceId looks like a real race (not adjustment)
      const raceId = d.data().raceId as string || '';
      return raceId !== 'late-joiner-handicap' && !d.data().isAdjustment;
    })
    .map(d => d.ref);
  if (noFlagRefs.length > 0) {
    log(`  Also found ${noFlagRefs.length} score docs without isAdjustment flag — deleting...`);
    const n = await deleteInBatches(noFlagRefs);
    log(`  ✓ Deleted ${n} additional score documents`);
  }
  sep();

  // ── STEP 4: Delete test-team prediction subcollections only ─────────────────
  // Real user predictions are untouched.
  log('Step 4: Deleting prediction subcollections for test users only...');
  let totalPredictionsDeleted = 0;
  for (const user of testUsers) {
    const predsSnap = await db.collection('users').doc(user.uid).collection('predictions').get();
    if (predsSnap.empty) {
      log(`  ${user.teamName}: no predictions`);
      continue;
    }
    log(`  ${user.teamName}: ${predsSnap.size} predictions — deleting...`);
    const refs = predsSnap.docs.map(d => d.ref);
    const n = await deleteInBatches(refs);
    totalPredictionsDeleted += n;
    await sleep(200);
  }
  log(`  ✓ Deleted ${totalPredictionsDeleted} test-team prediction documents`);
  sep();

  // ── STEP 5: Remove test users from global league ────────────────────────────
  log('Step 5: Removing test users from global league...');
  const testUids = testUsers.map(u => u.uid);
  if (!DRY_RUN && testUids.length > 0) {
    // FieldValue.arrayRemove can take multiple args
    const leagueRef = db.collection('leagues').doc('global');
    const leagueDoc = await leagueRef.get();
    if (leagueDoc.exists) {
      await leagueRef.update({ memberUserIds: FieldValue.arrayRemove(...testUids) });
      log(`  ✓ Removed ${testUids.length} test users from global league`);
    } else {
      log(`  ⚠ Global league doc not found — skipped`);
    }
  } else {
    log(`  [DRY RUN] skipped`);
  }
  sep();

  // ── STEP 6: Delete test user Firestore docs ─────────────────────────────────
  log('Step 6: Deleting test user Firestore docs (users + presence)...');
  if (!DRY_RUN) {
    const userBatch = db.batch();
    testUsers.forEach(u => {
      userBatch.delete(db.collection('users').doc(u.uid));
      userBatch.delete(db.collection('presence').doc(u.uid));
    });
    await userBatch.commit();
    log(`  ✓ Deleted ${testUsers.length} user docs + presence docs`);
  } else {
    log(`  [DRY RUN] would delete ${testUsers.length} user + presence docs`);
  }
  sep();

  sep();
  log('PURGE COMPLETE');
  sep();
  log('What was removed:');
  log('  ✓ All race_results documents (real season is now unlocked)');
  log('  ✓ All non-adjustment scores (real team scores were meaningless without results)');
  log(`  ✓ All predictions under ${testUsers.length} test-team user accounts`);
  log(`  ✓ Test users removed from global league`);
  log(`  ✓ Test user Firestore docs deleted`);
  sep();
  log('What was preserved:');
  log('  ✓ Real user accounts and profiles');
  log('  ✓ Real user predictions (ready for the actual season)');
  log('  ✓ Late-joiner adjustment scores (isAdjustment=true)');
  sep();
  log('MANUAL STEP REQUIRED — delete these Firebase Auth accounts:');
  log('  https://console.firebase.google.com/project/studio-6033436327-281b1/authentication/users');
  testUsers.forEach(u => log(`  ${u.teamName}: uid=${u.uid}`));
  sep();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
