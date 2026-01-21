import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as path from 'path';

const email = process.argv[2] || 'aaron@garcia.ltd';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();
const auth = getAuth();

async function check() {
  console.log(`Checking user: ${email}\n`);

  // Check Firestore user
  console.log('=== Firestore ===');
  const snap = await db.collection('users').where('email', '==', email).get();
  console.log('Documents found:', snap.size);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log('User ID:', d.id);
    console.log('Team Name:', data.teamName);
    console.log('Is Admin:', data.isAdmin);
    console.log('Bad Login Attempts:', data.badLoginAttempts || 0);
  });

  // Check Firebase Auth user
  console.log('\n=== Firebase Auth ===');
  try {
    const authUser = await auth.getUserByEmail(email);
    console.log('UID:', authUser.uid);
    console.log('Email:', authUser.email);
    console.log('Email verified:', authUser.emailVerified);
    console.log('Disabled:', authUser.disabled);
    console.log('Created:', authUser.metadata.creationTime);
    console.log('Last sign-in:', authUser.metadata.lastSignInTime);
  } catch (e: any) {
    console.log('Error:', e.code, '-', e.message);
  }
}

check().catch(console.error);
