// GUID: SCRIPTS_VERIFY_ADMIN-000-v03
// âš ï¸  LOCAL DEVELOPMENT TOOL ONLY â€” DO NOT DEPLOY OR RUN IN CI/CD âš ï¸
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
 * âš ï¸  LOCAL DEVELOPMENT ONLY â€” This script MUST NOT run in production or CI/CD.
 *     It force-resets the admin account password, creating a backdoor if misused.
 *     Pass --local-only explicitly to confirm local intent.
 */

import * as admin from './_admin-compat';
import * as dotenv from 'dotenv';
import * as path from 'path';

// GUID: SCRIPTS_VERIFY_ADMIN-001-v03
// [Intent] Hard guard: abort immediately if not in a local development context.
//          Prevents accidental or malicious execution in staging/production/CI/CD environments.
// [Inbound Trigger] Script startup â€” evaluated before any Firebase initialisation or env var reads.
// [Downstream Impact] process.exit(1) if NODE_ENV is not explicitly 'development' OR the --local-only
//                     flag is absent. Both conditions must be satisfied simultaneously. The NODE_ENV
//                     check deliberately excludes undefined/unset â€” CI/CD environments that do not set
//                     NODE_ENV would otherwise pass the guard.
const hasLocalOnlyFlag = process.argv.includes('--local-only');
const isDevEnv = process.env.NODE_ENV === 'development';

if (!hasLocalOnlyFlag || !isDevEnv) {
  console.error('');
  console.error('âŒ BLOCKED: verify-admin.ts is a local development tool only.');
  console.error('   It MUST NOT run in production, staging, or CI/CD environments.');
  console.error('');
  if (!hasLocalOnlyFlag) {
    console.error('   Missing required flag: --local-only');
    console.error('   Pass this flag explicitly to confirm you are running locally.');
  }
  if (!isDevEnv) {
    console.error(`   NODE_ENV is "${process.env.NODE_ENV ?? 'unset'}" â€” must be explicitly "development".`);
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
  console.error('âŒ GOOGLE_APPLICATION_CREDENTIALS not set in .env.local');
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
  console.log('ðŸ” Checking admin account:', ADMIN_EMAIL);
  console.log('');

  // Step 1: Check if user exists in Firebase Auth
  let authUser: admin.auth.UserRecord | null = null;
  try {
    authUser = await auth.getUserByEmail(ADMIN_EMAIL);
    console.log('âœ… Firebase Auth user found');
    console.log('   UID:', authUser.uid);
    console.log('   Email:', authUser.email);
    console.log('   Email verified:', authUser.emailVerified);
    console.log('   Disabled:', authUser.disabled);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log('âŒ User NOT found in Firebase Auth');
      console.log('   Creating new auth user...');

      authUser = await auth.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PIN,
        emailVerified: true,
      });
      console.log('âœ… Created auth user with UID:', authUser.uid);
    } else {
      console.error('âŒ Error checking auth user:', error);
      process.exit(1);
    }
  }

  // Step 2: Check Firestore user document
  console.log('');
  console.log('ðŸ” Checking Firestore user document...');

  const userDocRef = db.collection('users').doc(authUser.uid);
  const userDoc = await userDocRef.get();

  if (userDoc.exists) {
    const userData = userDoc.data();
    console.log('âœ… Firestore user document found');
    console.log('   Team Name:', userData?.teamName);
    console.log('   isAdmin:', userData?.isAdmin);
    console.log('   Email:', userData?.email);
    console.log('   Bad Login Attempts:', userData?.badLoginAttempts || 0);
    console.log('   Must Change PIN:', userData?.mustChangePin || false);

    // Fix issues
    const updates: any = {};

    if (!userData?.isAdmin) {
      console.log('');
      console.log('âš ï¸  isAdmin is not true, fixing...');
      updates.isAdmin = true;
    }

    if ((userData?.badLoginAttempts || 0) > 0) {
      console.log('âš ï¸  Bad login attempts detected, resetting...');
      updates.badLoginAttempts = 0;
    }

    if (userData?.mustChangePin) {
      console.log('âš ï¸  mustChangePin is true, clearing...');
      updates.mustChangePin = false;
    }

    if (Object.keys(updates).length > 0) {
      await userDocRef.update(updates);
      console.log('âœ… Applied fixes:', updates);
    }
  } else {
    console.log('âŒ Firestore user document NOT found');
    console.log('   Creating new user document...');

    await userDocRef.set({
      id: authUser.uid,
      email: ADMIN_EMAIL,
      teamName: 'Admin',
      isAdmin: true,
      mustChangePin: false,
      badLoginAttempts: 0,
    });
    console.log('âœ… Created Firestore user document');
  }

  // Step 3: Reset PIN in Firebase Auth
  console.log('');
  console.log('ðŸ”‘ Resetting PIN...');

  await auth.updateUser(authUser.uid, {
    password: ADMIN_PIN,
    disabled: false,
  });
  console.log('âœ… PIN has been reset');

  // Step 4: Create presence document if missing
  const presenceRef = db.collection('presence').doc(authUser.uid);
  const presenceDoc = await presenceRef.get();
  if (!presenceDoc.exists) {
    await presenceRef.set({ online: false, sessions: [] });
    console.log('âœ… Created presence document');
  }

  console.log('');
  console.log('========================================');
  console.log('âœ… Admin account verified and fixed!');
  console.log('');
  console.log('   Email:', ADMIN_EMAIL);
  console.log('   PIN: [set from ADMIN_PIN env var]');
  console.log('========================================');
}

verifyAndFixAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('âŒ Script failed:', error);
    process.exit(1);
  });
