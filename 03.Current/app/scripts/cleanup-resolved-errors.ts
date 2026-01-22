import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

// IDs to delete - resolved or testing artifacts
const idsToDelete = [
  // CC logs (not errors, testing artifacts)
  '3VpUHfuIz79gf6a2XDt6',
  'Q9MuXVZpq7WizCVAINxc',
  'UX7iAvfxVIawX7dD9DdQ',
  'HxoOGh7DwX5wMVQbfiOL',
  'mkPj4s6THSpCWDWC3O4e',
  'Yy0ZE1Zp4kGK7PBZGUFp',
  '96TDAwKdo7AgP5mMtKJa',
  'BuUbypI6tE8CmTVXVIAa',
  'EwmoHB6kFdbVleRhvGPO',
  'ctfAWiOrtsAruDS2dQiw',
  'UbhcvR1dFOkZEmz674vm',
  '6dW8ijvGIm6TcgujsDxe',
  'R4Ia9q5aimsLNdgkMuJl',

  // Login attempt for non-existent user (expected behavior, not errors)
  '8vkdG8EfuDNx4zCTSzuB',
  'zmdyrvV2ZyqLrg0DAyw6',
  'dJRx3MRuN8Ik3mSfwwhB',
  'exNbGNs1GWBJy1c8b7ah',
  'b0wIlE9Pkn11ZXAZ9hLw',

  // Firestore undefined emailGuid (fixed in code)
  'OOyPV25ST4EUmpVN0f93',
  'oQ1A1cK11IvoVdpdwXIh',
  '5NoiXZeByg21pE9iILlY',

  // resetPin permissions (fixed with server-side API)
  'CPqegSZ5uRRDkwXMVTK9',
  'hx6Tjnvvb3SdHAj8OwkW',
];

async function cleanupErrors() {
  console.log(`Deleting ${idsToDelete.length} resolved/testing error logs...\n`);

  let deleted = 0;
  let failed = 0;

  for (const id of idsToDelete) {
    try {
      await db.collection('error_logs').doc(id).delete();
      console.log(`✓ Deleted: ${id}`);
      deleted++;
    } catch (error: any) {
      console.log(`✗ Failed to delete ${id}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`CLEANUP COMPLETE`);
  console.log(`========================================`);
  console.log(`Deleted: ${deleted}`);
  console.log(`Failed: ${failed}`);

  // Show remaining errors
  console.log(`\n--- REMAINING ERRORS ---`);
  const remaining = await db.collection('error_logs')
    .orderBy('timestamp', 'desc')
    .limit(20)
    .get();

  console.log(`Total remaining: ${remaining.size}\n`);

  remaining.docs.forEach((doc, i) => {
    const data = doc.data();
    console.log(`${i + 1}. [${doc.id}] ${data.error?.substring(0, 60) || 'No error message'}`);
    console.log(`   Route: ${data.context?.route}, Action: ${data.context?.action}`);
    console.log(`   Created: ${data.createdAt}\n`);
  });
}

cleanupErrors().catch(console.error);
