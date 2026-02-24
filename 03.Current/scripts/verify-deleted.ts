#!/usr/bin/env tsx
/**
 * Verify if collections are actually empty
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(__dirname, '..', 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function countDocuments(collectionName: string): Promise<number> {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.size;
}

async function main() {
  console.log('Project ID:', serviceAccount.project_id);
  console.log('\nDocument counts:');
  console.log('  feedback:', await countDocuments('feedback'));
  console.log('  error_logs:', await countDocuments('error_logs'));
  console.log('  race_results:', await countDocuments('race_results'));

  // Also check what the admin panel might be reading
  console.log('\nFirst 3 race_results (if any):');
  const results = await db.collection('race_results').limit(3).get();
  results.forEach(doc => {
    console.log('  -', doc.id, ':', doc.data());
  });

  process.exit(0);
}

main();
