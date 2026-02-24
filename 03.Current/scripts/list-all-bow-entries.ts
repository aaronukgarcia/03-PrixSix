#!/usr/bin/env tsx
/**
 * List all book-of-work entries from Firestore
 * GUID: SCRIPT_LIST_BOW-000-v01
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

async function listAllBookOfWorkEntries() {
  console.log('Reading all book-of-work entries from Firestore...\n');
  console.log('═'.repeat(100));

  const snapshot = await db.collection('book_of_work').orderBy('updatedAt', 'desc').get();

  console.log(`Total entries: ${snapshot.docs.length}\n`);

  snapshot.docs.forEach((doc, idx) => {
    const data = doc.data();
    console.log(`${idx + 1}. [${doc.id}]`);
    console.log(`   Title: ${data.title}`);
    console.log(`   Status: ${data.status}`);
    console.log(`   Severity: ${data.severity}`);
    console.log(`   Category: ${data.category}`);
    if (data.package) console.log(`   Package: ${data.package}`);
    console.log(`   Created: ${data.createdBy} (${data.createdAt?.toDate?.().toISOString() || 'unknown'})`);
    if (data.notes && typeof data.notes === 'string') {
      const preview = data.notes.substring(0, 150);
      console.log(`   Notes: ${preview}${data.notes.length > 150 ? '...' : ''}`);
    } else if (Array.isArray(data.notes) && data.notes.length > 0) {
      console.log(`   Notes: ${data.notes[data.notes.length - 1].substring(0, 150)}...`);
    }
    console.log('');
  });

  console.log('═'.repeat(100));

  // Summary by status
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    byStatus[data.status] = (byStatus[data.status] || 0) + 1;
    bySeverity[data.severity] = (bySeverity[data.severity] || 0) + 1;
  });

  console.log('\nSummary by Status:');
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });

  console.log('\nSummary by Severity:');
  Object.entries(bySeverity).forEach(([severity, count]) => {
    console.log(`  ${severity}: ${count}`);
  });

  process.exit(0);
}

listAllBookOfWorkEntries().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
