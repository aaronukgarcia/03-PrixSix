#!/usr/bin/env tsx
/**
 * Read book-of-work from Firestore (Single Source of Truth)
 * GUID: SCRIPT_READ_BOOK_OF_WORK-000-v01
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(process.cwd(), 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function readBookOfWork() {
  console.log('Reading book-of-work from Firestore...\n');

  const bowDoc = await db.collection('admin_configuration').doc('book_of_work').get();

  if (!bowDoc.exists) {
    console.log('❌ Book of work not found in Firestore');
    console.log('Creating new book-of-work structure...\n');
    return null;
  }

  const data = bowDoc.data();
  console.log('✅ Book of work found');
  console.log(`Total issues: ${data?.issues?.length || 0}`);
  console.log(`Last updated: ${data?.metadata?.lastUpdated || 'unknown'}\n`);

  return data;
}

readBookOfWork()
  .then((data) => {
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
