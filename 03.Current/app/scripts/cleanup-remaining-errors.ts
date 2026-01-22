import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp({ credential: cert(path.join(__dirname, '..', '..', 'service-account.json')) });
}
const db = getFirestore();

// IDs to delete - old errors from before fixes were deployed
const idsToDelete = [
  // Old feedback permission errors (Firestore rules now allow feedback create)
  'pUC7sLeToi7tj2vq5YOc',
  'bXRTcNtEsJch6D0koBRO',
  'RU6rVP5EaZKwtjY4c25q',

  // Old signup permission errors (signup now uses server-side API)
  'RQ1nChMUw1gXViOyUH19',
  'i2b2orCmOAUMcCbKfJ18',

  // prix6.win blocked errors (documented - needs Firebase Console fix)
  'ILSFhIiL1ZNhmY8uztsi',
  'JOBmTrJ6h0QYEutP6hoZ',
];

async function cleanupErrors() {
  console.log(`Deleting ${idsToDelete.length} remaining old error logs...\n`);

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

  // Verify no errors remain
  console.log(`\n--- VERIFICATION ---`);
  const remaining = await db.collection('error_logs').limit(5).get();
  console.log(`Remaining errors: ${remaining.size}`);
  if (remaining.size > 0) {
    remaining.docs.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: ${data.error?.substring(0, 50) || 'No error'}`);
    });
  }
}

cleanupErrors().catch(console.error);
