#!/usr/bin/env tsx
import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('service-account.json', 'utf8'));
admin.initializeApp({credential: admin.credential.cert(sa)});
const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('scores').limit(5).get();
  console.log('scores collection document count (first 5):', snapshot.size);
  snapshot.forEach(doc => console.log('  -', doc.id));
}

check().then(() => process.exit(0));
