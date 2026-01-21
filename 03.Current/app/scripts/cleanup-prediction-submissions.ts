/**
 * Delete entire prediction_submissions collection (orphaned after refactor)
 * Run with: npx ts-node scripts/cleanup-prediction-submissions.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceAccountPath = join(__dirname, '..', '..', 'service-account.json');
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccountPath) });
}
const db = getFirestore();

async function deleteCollection() {
  console.log('='.repeat(70));
  console.log('DELETE PREDICTION_SUBMISSIONS COLLECTION');
  console.log('This collection is now orphaned after the refactor to use');
  console.log('collectionGroup queries on users/{id}/predictions.');
  console.log('='.repeat(70));

  const collectionRef = db.collection('prediction_submissions');
  const snapshot = await collectionRef.get();

  if (snapshot.empty) {
    console.log('\nCollection is already empty. Nothing to delete.');
    return;
  }

  console.log(`\nFound ${snapshot.size} documents to delete.`);

  // Delete in batches of 500 (Firestore limit)
  const BATCH_SIZE = 500;
  let deleted = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    batchCount++;
    deleted++;

    if (batchCount === BATCH_SIZE) {
      await batch.commit();
      console.log(`Deleted ${deleted} of ${snapshot.size} documents...`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Commit any remaining deletes
  if (batchCount > 0) {
    await batch.commit();
  }

  console.log('\n' + '='.repeat(70));
  console.log(`DONE - Deleted ${deleted} documents from prediction_submissions.`);
  console.log('='.repeat(70));
}

deleteCollection().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
