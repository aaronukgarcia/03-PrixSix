#!/usr/bin/env tsx
import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccountPath = join(process.cwd(), 'service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  await db.collection('book_of_work').doc('PERF-001').update({
    status: 'done',
    assignedTo: 'Bill (Claude Code)',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolution: 'Fixed in v1.58.70. Two-part fix: (1) layout.tsx now uses initializePerformance(app, { instrumentationEnabled: false }) so the SDK never starts auto-instrumentation, (2) GlobalErrorLogger.tsx filters performance/invalid attribute value errors as belt-and-suspenders. Files changed: app/src/app/layout.tsx, app/src/components/GlobalErrorLogger.tsx.',
  });
  console.log('✅ PERF-001 marked done');
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
