import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

// Initialize Firebase Admin with service account
if (!getApps().length) {
  const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}
const db = getFirestore();

async function runQA() {
  console.log('🕵️‍♂️ STARTING INDEPENDENT QA VERIFICATION...');
  console.log('Target: Live Cloud Database\n');

  let errors = 0;
  const check = (name: string, actual: any, expected: any) => {
    if (actual === expected) {
      console.log(`✅ ${name}: PASS (${actual})`);
    } else {
      console.error(`❌ ${name}: FAIL (Expected ${expected}, Got ${actual})`);
      errors++;
    }
  };

  // --- CHECK 1: THE DOMINATORS (User 01) ---
  // Expecting 24 races * 11 points = 264
  const user01 = await db.collection('users').doc('user_01').get();
  const data01 = user01.data();
  check('Dominator Score (User 01)', data01?.totalPoints, 264);

  // --- CHECK 2: THE QUITTERS (User 11) ---
  // Expecting 5 races * 11 points = 55 (then stopped)
  const user11 = await db.collection('users').doc('user_11').get();
  const data11 = user11.data();
  check('Quitter Score (User 11)', data11?.totalPoints, 55);

  // --- CHECK 3: THE LATE JOINERS (User 16) ---
  // Expecting 15 races (10-24) * 11 points = 165
  const user16 = await db.collection('users').doc('user_16').get();
  const data16 = user16.data();
  check('Late Joiner Score (User 16)', data16?.totalPoints, 165);

  // --- CHECK 4: THE CLONES (User 19 vs User 20) ---
  // They must be identical.
  const user19 = await db.collection('users').doc('user_19').get();
  const user20 = await db.collection('users').doc('user_20').get();

  if (user19.data()?.totalPoints === user20.data()?.totalPoints) {
     console.log(`✅ Clone Integrity: PASS (Both have ${user19.data()?.totalPoints})`);
  } else {
     console.error(`❌ Clone Integrity: FAIL (User 19: ${user19.data()?.totalPoints}, User 20: ${user20.data()?.totalPoints})`);
     errors++;
  }

  // --- REPORT ---
  console.log('\n-----------------------------------');
  if (errors === 0) {
    console.log('🏆 QA RESULT: ALL SYSTEMS GO. READY FOR PRODUCTION.');
  } else {
    console.log(`⚠️ QA RESULT: ${errors} DEFECTS FOUND.`);
  }
}

runQA().catch(console.error);
