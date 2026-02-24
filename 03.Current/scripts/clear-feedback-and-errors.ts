#!/usr/bin/env tsx
/**
 * Script to delete all feedback and error_logs documents from Firestore.
 *
 * Usage:
 *   npx tsx scripts/clear-feedback-and-errors.ts
 *
 * GUID: SCRIPT_CLEAR_FEEDBACK_ERRORS-000-v01
 * [Intent] Bulk delete all documents from feedback and error_logs collections.
 * [Inbound Trigger] Manual execution by admin to clear old feedback/errors.
 * [Downstream Impact] Permanently deletes all feedback items and error logs.
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

async function deleteCollection(collectionName: string): Promise<number> {
  console.log(`\n🗑️  Deleting all documents from "${collectionName}"...`);

  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.get();

  if (snapshot.empty) {
    console.log(`   ℹ️  Collection "${collectionName}" is already empty.`);
    return 0;
  }

  console.log(`   📄 Found ${snapshot.size} document(s) to delete...`);

  const batch = db.batch();
  let count = 0;

  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
    count++;
  });

  await batch.commit();

  console.log(`   ✅ Deleted ${count} document(s) from "${collectionName}"`);
  return count;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Clear Feedback, Error Logs & Race Results');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    const feedbackCount = await deleteCollection('feedback');
    const errorLogsCount = await deleteCollection('error_logs');
    const raceResultsCount = await deleteCollection('race_results');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ COMPLETE');
    console.log(`   - Feedback deleted: ${feedbackCount}`);
    console.log(`   - Error logs deleted: ${errorLogsCount}`);
    console.log(`   - Race results deleted: ${raceResultsCount}`);
    console.log(`   - Total deleted: ${feedbackCount + errorLogsCount + raceResultsCount}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
