/**
 * Verify and fix admin account
 * Run: npx ts-node --project tsconfig.scripts.json scripts/verify-admin.ts
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Initialize Firebase Admin
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS not set in .env.local');
  process.exit(1);
}

const serviceAccount = require(path.resolve(__dirname, '..', serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

const ADMIN_EMAIL = 'aaron@garcia.ltd';
const ADMIN_PIN = process.env.ADMIN_PIN || (() => { throw new Error('ADMIN_PIN environment variable required'); })();

async function verifyAndFixAdmin() {
  console.log('🔍 Checking admin account:', ADMIN_EMAIL);
  console.log('');

  // Step 1: Check if user exists in Firebase Auth
  let authUser: admin.auth.UserRecord | null = null;
  try {
    authUser = await auth.getUserByEmail(ADMIN_EMAIL);
    console.log('✅ Firebase Auth user found');
    console.log('   UID:', authUser.uid);
    console.log('   Email:', authUser.email);
    console.log('   Email verified:', authUser.emailVerified);
    console.log('   Disabled:', authUser.disabled);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log('❌ User NOT found in Firebase Auth');
      console.log('   Creating new auth user...');

      authUser = await auth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PIN,
        emailVerified: true,
      });
      console.log('✅ Created auth user with UID:', authUser.uid);
    } else {
      console.error('❌ Error checking auth user:', error);
      process.exit(1);
    }
  }

  // Step 2: Check Firestore user document
  console.log('');
  console.log('🔍 Checking Firestore user document...');

  const userDocRef = db.collection('users').doc(authUser.uid);
  const userDoc = await userDocRef.get();

  if (userDoc.exists) {
    const userData = userDoc.data();
    console.log('✅ Firestore user document found');
    console.log('   Team Name:', userData?.teamName);
    console.log('   isAdmin:', userData?.isAdmin);
    console.log('   Email:', userData?.email);
    console.log('   Bad Login Attempts:', userData?.badLoginAttempts || 0);
    console.log('   Must Change PIN:', userData?.mustChangePin || false);

    // Fix issues
    const updates: any = {};

    if (!userData?.isAdmin) {
      console.log('');
      console.log('⚠️  isAdmin is not true, fixing...');
      updates.isAdmin = true;
    }

    if ((userData?.badLoginAttempts || 0) > 0) {
      console.log('⚠️  Bad login attempts detected, resetting...');
      updates.badLoginAttempts = 0;
    }

    if (userData?.mustChangePin) {
      console.log('⚠️  mustChangePin is true, clearing...');
      updates.mustChangePin = false;
    }

    if (Object.keys(updates).length > 0) {
      await userDocRef.update(updates);
      console.log('✅ Applied fixes:', updates);
    }
  } else {
    console.log('❌ Firestore user document NOT found');
    console.log('   Creating new user document...');

    await userDocRef.set({
      id: authUser.uid,
      email: ADMIN_EMAIL,
      teamName: 'Admin',
      isAdmin: true,
      mustChangePin: false,
      badLoginAttempts: 0,
    });
    console.log('✅ Created Firestore user document');
  }

  // Step 3: Reset PIN in Firebase Auth
  console.log('');
  console.log('🔑 Resetting PIN...');

  await auth.updateUser(authUser.uid, {
    password: ADMIN_PIN,
    disabled: false,
  });
  console.log('✅ PIN has been reset');

  // Step 4: Create presence document if missing
  const presenceRef = db.collection('presence').doc(authUser.uid);
  const presenceDoc = await presenceRef.get();
  if (!presenceDoc.exists) {
    await presenceRef.set({ online: false, sessions: [] });
    console.log('✅ Created presence document');
  }

  console.log('');
  console.log('========================================');
  console.log('✅ Admin account verified and fixed!');
  console.log('');
  console.log('   Email:', ADMIN_EMAIL);
  console.log('   PIN: [set from ADMIN_PIN env var]');
  console.log('========================================');
}

verifyAndFixAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
