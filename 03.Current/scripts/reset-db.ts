import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

async function resetDatabase() {
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
