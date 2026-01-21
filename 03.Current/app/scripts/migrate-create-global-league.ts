/**
 * Create the global league with all existing users
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/migrate-create-global-league.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

const serviceAccountPath = path.join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

const GLOBAL_LEAGUE_ID = 'global';
const SYSTEM_OWNER_ID = 'system';

async function migrateCreateGlobalLeague() {
  console.log('='.repeat(70));
  console.log('CREATE GLOBAL LEAGUE MIGRATION');
  console.log('='.repeat(70));

  // Check if global league already exists
  const globalLeagueRef = db.collection('leagues').doc(GLOBAL_LEAGUE_ID);
  const globalLeagueDoc = await globalLeagueRef.get();

  if (globalLeagueDoc.exists) {
    console.log('\nGlobal league already exists!');
    const data = globalLeagueDoc.data();
    console.log(`  Name: ${data?.name}`);
    console.log(`  Members: ${data?.memberUserIds?.length || 0}`);
    console.log('\nTo re-run this migration, first delete the global league document.');
    return;
  }

  // Get all users
  console.log('\nFetching all users...');
  const usersSnap = await db.collection('users').get();
  const userIds = usersSnap.docs.map(doc => doc.id);
  console.log(`Found ${userIds.length} users.`);

  if (userIds.length === 0) {
    console.log('\nNo users found! Cannot create global league with empty membership.');
    console.log('Run this migration after users have been created.');
    return;
  }

  // Create the global league
  console.log('\nCreating global league...');
  await globalLeagueRef.set({
    name: 'Global League',
    ownerId: SYSTEM_OWNER_ID,
    memberUserIds: userIds,
    isGlobal: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION COMPLETE');
  console.log(`Global league created with ${userIds.length} members.`);
  console.log('='.repeat(70));
}

migrateCreateGlobalLeague().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
