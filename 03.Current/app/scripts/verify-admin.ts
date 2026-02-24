// GUID: SCRIPTS_VERIFY_ADMIN-000-v03
// ⚠️  LOCAL DEVELOPMENT TOOL ONLY — DO NOT DEPLOY OR RUN IN CI/CD ⚠️
// This script resets the hardcoded admin account PIN using ADMIN_PIN from .env.local.
// Running this in staging or production would constitute a backdoor: anyone with access
// to the ADMIN_PIN environment variable could take over the admin account silently.
// NEVER add this to any CI/CD pipeline, Dockerfile, or cloud build step.
// NEVER run against a production Firebase project.
// [Intent] One-time local recovery tool to verify and repair the admin account state.
// [Inbound Trigger] Developer runs manually: npx ts-node --project tsconfig.scripts.json scripts/verify-admin.ts --local-only
// [Downstream Impact] Resets admin password in Firebase Auth. Must only target the local dev Firebase project.

/**
 * Verify and fix admin account
 * Run: npx ts-node --project tsconfig.scripts.json scripts/verify-admin.ts --local-only
 *
 * ⚠️  LOCAL DEVELOPMENT ONLY — This script MUST NOT run in production or CI/CD.
 *     It force-resets the admin account password, creating a backdoor if misused.
 *     Pass --local-only explicitly to confirm local intent.
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

// GUID: SCRIPTS_VERIFY_ADMIN-001-v03
// [Intent] Hard guard: abort immediately if not in a local development context.
//          Prevents accidental or malicious execution in staging/production/CI/CD environments.
// [Inbound Trigger] Script startup — evaluated before any Firebase initialisation or env var reads.
// [Downstream Impact] process.exit(1) if NODE_ENV is not explicitly 'development' OR the --local-only
//                     flag is absent. Both conditions must be satisfied simultaneously. The NODE_ENV
//                     check deliberately excludes undefined/unset — CI/CD environments that do not set
//                     NODE_ENV would otherwise pass the guard.
const hasLocalOnlyFlag = process.argv.includes('--local-only');
const isDevEnv = process.env.NODE_ENV === 'development';

if (!hasLocalOnlyFlag || !isDevEnv) {
  console.error('');
  console.error('❌ BLOCKED: verify-admin.ts is a local development tool only.');
  console.error('   It MUST NOT run in production, staging, or CI/CD environments.');
  console.error('');
  if (!hasLocalOnlyFlag) {
    console.error('   Missing required flag: --local-only');
    console.error('   Pass this flag explicitly to confirm you are running locally.');
  }
  if (!isDevEnv) {
    console.error(`   NODE_ENV is "${process.env.NODE_ENV ?? 'unset'}" — must be explicitly "development".`);
  }
  console.error('');
  console.error('   Correct usage (local only):');
  console.error('   NODE_ENV=development npx ts-node --project tsconfig.scripts.json scripts/verify-admin.ts --local-only');
  console.error('');
  process.exit(1);
}

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
