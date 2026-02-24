#!/usr/bin/env tsx
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

async function checkBookOfWork() {
  console.log('Checking Book of Work for critical issues...\n');

  const bowDoc = await db.collection('admin_configuration').doc('book_of_work').get();

  if (!bowDoc.exists) {
    console.log('❌ Book of work not found in Firestore');
    process.exit(1);
  }

  const data = bowDoc.data();
  const issues = data?.issues || [];

  console.log(`Total issues: ${issues.length}\n`);

  // Look for GEMINI-AUDIT-120
  const issue120 = issues.find((i: any) => i.id === 'GEMINI-AUDIT-120');
  if (issue120) {
    console.log('🔍 Found GEMINI-AUDIT-120:');
    console.log('═'.repeat(60));
    console.log(JSON.stringify(issue120, null, 2));
    console.log('═'.repeat(60));
  } else {
    console.log('⚠️  GEMINI-AUDIT-120 not found');
  }

  // Show all critical issues
  console.log('\n📋 Critical/Active Issues:');
  console.log('═'.repeat(60));

  const critical = issues.filter((i: any) =>
    i.severity === 'critical' ||
    (i.status === 'active' && i.severity === 'high') ||
    i.title?.toLowerCase().includes('critical bug')
  );

  if (critical.length === 0) {
    console.log('✅ No critical issues found');
  } else {
    critical.forEach((issue: any, idx: number) => {
      console.log(`\n${idx + 1}. ${issue.id}`);
      console.log(`   Title: ${issue.title}`);
      console.log(`   Severity: ${issue.severity}`);
      console.log(`   Status: ${issue.status}`);
      if (issue.description) {
        console.log(`   Description: ${issue.description.substring(0, 100)}...`);
      }
    });
  }

  console.log('\n═'.repeat(60));
  process.exit(0);
}

checkBookOfWork().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
