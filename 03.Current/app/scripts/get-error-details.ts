import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

async function getErrorDetails() {
  // Get all errors
  const snapshot = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  console.log('=== DETAILED ERROR ANALYSIS ===\n');

  // Unknown errors (no error field)
  console.log('--- UNKNOWN ERRORS (no error field) ---');
  const unknownDocs: string[] = [];
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (!data.error) {
      unknownDocs.push(doc.id);
      console.log(`\nDoc ID: ${doc.id}`);
      console.log('Full data:', JSON.stringify(data, null, 2).substring(0, 500));
    }
  });

  // Permission errors
  console.log('\n\n--- PERMISSION ERRORS ---');
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.error?.includes('permissions')) {
      console.log(`\nDoc ID: ${doc.id}`);
      console.log('Error:', data.error);
      console.log('Route:', data.context?.route);
      console.log('Action:', data.context?.action);
      console.log('UserId:', data.context?.userId);
      console.log('Created:', data.createdAt);
    }
  });

  // Firebase Auth blocked errors
  console.log('\n\n--- FIREBASE AUTH BLOCKED ERRORS ---');
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.error?.includes('blocked')) {
      console.log(`\nDoc ID: ${doc.id}`);
      console.log('Error:', data.error);
      console.log('Route:', data.context?.route);
      console.log('Action:', data.context?.action);
      console.log('Created:', data.createdAt);
    }
  });

  // Firestore document errors
  console.log('\n\n--- FIRESTORE DOCUMENT ERRORS ---');
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.error?.includes('Firestore document')) {
      console.log(`\nDoc ID: ${doc.id}`);
      console.log('Error:', data.error);
      console.log('Route:', data.context?.route);
      console.log('Action:', data.context?.action);
      console.log('Created:', data.createdAt);
    }
  });

  // Summary of IDs to delete
  console.log('\n\n=== SUMMARY ===');
  console.log('Unknown error doc IDs:', unknownDocs.join(', '));
}

getErrorDetails().catch(console.error);
