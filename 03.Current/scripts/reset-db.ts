// GUID: SCRIPTS_RESET_DB-000-v02
// @PHASE_4B: Added safety checks to prevent production execution (DEPLOY-003 mitigation).
// [Intent] DESTRUCTIVE: Deletes entire database (users, races). For dev/test environments ONLY.
// [Inbound Trigger] Manual execution by developer for clean slate testing.
// [Downstream Impact] TOTAL DATA LOSS - all users and races deleted. Now blocked on production.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runSafetyChecks } from '../app/scripts/_safety-checks';

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

async function resetDatabase() {
  // GUID: SCRIPTS_RESET_DB-001-v02
  // [Intent] Safety checks - prevent production execution and require user confirmation.
  // [Inbound Trigger] First action before any database operations.
  // [Downstream Impact] Exits with error if production detected or user cancels.
  await runSafetyChecks('DELETE ENTIRE DATABASE (users, races) - TOTAL DATA LOSS');

  console.log('  WARNING: STARTING DATABASE RESET...');
  // 1. Delete USERS
  console.log('...Deleting users...');
  await db.recursiveDelete(db.collection('users'));

  // 2. Delete RACES
  console.log('...Deleting races...');
  await db.recursiveDelete(db.collection('races'));

  console.log(' CLEAN SLATE: Database is empty.');
}

resetDatabase().catch(console.error);
