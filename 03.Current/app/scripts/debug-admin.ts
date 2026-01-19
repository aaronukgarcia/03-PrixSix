/**
 * Debug admin account - check all related documents
 * Run: npx ts-node --project tsconfig.scripts.json scripts/debug-admin.ts
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}

const serviceAccount = require(path.resolve(__dirname, '..', serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

const ADMIN_EMAIL = 'aaron@garcia.ltd';

async function debugAdmin() {
  console.log('🔍 Debugging admin account:', ADMIN_EMAIL);
  console.log('');

  // Get Auth user
  let authUser;
  try {
    authUser = await auth.getUserByEmail(ADMIN_EMAIL);
    console.log('=== Firebase Auth ===');
    console.log('UID:', authUser.uid);
    console.log('Email:', authUser.email);
    console.log('Disabled:', authUser.disabled);
    console.log('');
  } catch (e) {
    console.log('❌ Auth user not found');
    return;
  }

  // Check users collection - by UID
  console.log('=== Firestore: users/' + authUser.uid + ' ===');
  const userDoc = await db.collection('users').doc(authUser.uid).get();
  if (userDoc.exists) {
    console.log('Document exists: YES');
    console.log('Data:', JSON.stringify(userDoc.data(), null, 2));
  } else {
    console.log('Document exists: NO');
  }
  console.log('');

  // Check if there's a user doc with matching email but different ID
  console.log('=== Firestore: users where email == ' + ADMIN_EMAIL + ' ===');
  const emailQuery = await db.collection('users').where('email', '==', ADMIN_EMAIL).get();
  if (emailQuery.empty) {
    console.log('No documents found with this email');
  } else {
    emailQuery.forEach(doc => {
      console.log('Found doc ID:', doc.id);
      console.log('Data:', JSON.stringify(doc.data(), null, 2));
    });
  }
  console.log('');

  // Check presence document
  console.log('=== Firestore: presence/' + authUser.uid + ' ===');
  const presenceDoc = await db.collection('presence').doc(authUser.uid).get();
  if (presenceDoc.exists) {
    console.log('Document exists: YES');
    console.log('Data:', JSON.stringify(presenceDoc.data(), null, 2));
  } else {
    console.log('Document exists: NO');
  }
}

debugAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
