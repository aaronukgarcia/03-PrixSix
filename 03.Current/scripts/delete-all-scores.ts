#!/usr/bin/env tsx
/**
 * Delete all scores from the scores collection.
 *
 * GUID: SCRIPT_DELETE_ALL_SCORES-000-v01
 * [Intent] Bulk delete all score documents from Firestore to clean up orphaned scores.
 *          Since we already deleted race_results, these scores have no source of truth.
 * [Inbound Trigger] Manual execution to clean up scores after race_results deletion.
 * [Downstream Impact] Removes all score documents - standings will be empty until new scores are calculated.
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Initialize Firebase Admin
const serviceAccountPath = join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function deleteCollection(collectionName: string, batchSize: number = 500): Promise<number> {
  const collectionRef = db.collection(collectionName);
  let totalDeleted = 0;

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    totalDeleted += snapshot.size;

    console.log(`   Deleted ${snapshot.size} documents (${totalDeleted} total)...`);

    // If we got fewer documents than the batch size, we're done
    if (snapshot.size < batchSize) {
      break;
    }
  }

  return totalDeleted;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Delete All Scores');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    console.log('🗑️  Deleting all documents from "scores" collection...\n');

    const totalDeleted = await deleteCollection('scores');

    if (totalDeleted === 0) {
      console.log('   ℹ️  Collection "scores" is already empty.\n');
    } else {
      console.log(`\n   ✅ Deleted ${totalDeleted} score documents\n`);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ COMPLETE');
    console.log(`   - Scores deleted: ${totalDeleted}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
