#!/usr/bin/env tsx
/**
 * Fix false positive "done" items in book_of_work - reopen broken tickets
 * GUID: SCRIPT_FIX_FALSE_DONE-000-v01
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

async function fixFalsePositiveDoneItems() {
  console.log('🛑 CRITICAL: Fixing false positive "done" items in book_of_work\n');
  console.log('═'.repeat(80));

  // 1. Reopen GEMINI-AUDIT-107 (Critical IDOR in Update User)
  const doc1Id = '138uy8mbrH8FA1SmLkq2';
  await db.collection('book_of_work').doc(doc1Id).update({
    status: 'tbd',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    notes: admin.firestore.FieldValue.arrayUnion(
      `2026-02-20: REOPENED - Audit confirms NOT FIXED. app/src/app/api/admin/update-user/route.ts still blindly trusts adminUid from request body. Critical IDOR vulnerability still present.`
    )
  });
  console.log(`✅ REOPENED: ${doc1Id}`);
  console.log(`   Issue: GEMINI-AUDIT-107 - Critical IDOR in Update User`);
  console.log(`   Status: done → tbd`);
  console.log(`   Reality: app/src/app/api/admin/update-user/route.ts NOT FIXED`);
  console.log('');

  // 2. Reopen GEMINI-AUDIT-120 (Race ID Inconsistency)
  const doc2Id = '9AF6Vmm67p4OX6fn1PBR';
  await db.collection('book_of_work').doc(doc2Id).update({
    status: 'tbd',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    notes: admin.firestore.FieldValue.arrayUnion(
      `2026-02-20: REOPENED - Audit confirms NOT FIXED. normalize-race-id.ts preserves -Sprint but results-utils.tsx strips it. Logic still fragmented and will break Sprint scoring.`
    )
  });
  console.log(`✅ REOPENED: ${doc2Id}`);
  console.log(`   Issue: GEMINI-AUDIT-120 - Race ID Inconsistency`);
  console.log(`   Status: done → tbd`);
  console.log(`   Reality: Fragmented logic between normalize-race-id.ts and results-utils.tsx NOT FIXED`);
  console.log('');

  console.log('═'.repeat(80));

  // 3. Create new ticket for OpenF1 credentials (Pub Closed issue)
  const openF1Issue = {
    title: 'PubChat Fails to Load - Missing OpenF1 Production Secrets',
    category: 'infrastructure' as const,
    severity: 'medium' as const,
    status: 'tbd' as const,
    package: 'feature' as const,
    description: 'PubChat feature fails to load due to missing OpenF1 API credentials in production environment.',
    technicalDetails: `**Root Cause:**
Missing OpenF1 API credentials in production environment causes PubChat feature to fail.

**Current State:**
- Generic ticket CONFIG-001 covers "Secrets exposed/missing" but lacks specific OpenF1 configuration
- PubChat feature broken due to missing credentials
- No specific task tracking OpenF1 credential setup

**Required Actions:**
1. ⬜ Obtain OpenF1 API credentials
2. ⬜ Store credentials in Azure Key Vault (per Phase 1A security plan)
3. ⬜ Configure environment variables in production
4. ⬜ Test PubChat feature with production credentials
5. ⬜ Document OpenF1 API setup in deployment docs

**Related:**
- CONFIG-001 (generic secrets management)
- Phase 1A security plan (Azure Key Vault setup)

**Impact:** Medium - PubChat feature unavailable to users
**Effort:** 1-2 hours (credential setup + testing)`,
    notes: `Created: 2026-02-20 by Bill (Claude Code)
Identified: User audit feedback
Specific fix for generic CONFIG-001 issue
Requires: OpenF1 API account and production secret management`,
    createdBy: 'Bill (Claude Code)',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const openF1DocRef = await db.collection('book_of_work').add(openF1Issue);
  console.log(`\n✅ CREATED: ${openF1DocRef.id}`);
  console.log(`   Issue: PubChat Fails to Load - Missing OpenF1 Production Secrets`);
  console.log(`   Status: tbd`);
  console.log(`   Severity: medium`);
  console.log(`   Category: infrastructure`);
  console.log('');

  console.log('═'.repeat(80));
  console.log('\n✅ CRITICAL FIXES COMPLETE:');
  console.log(`   - Reopened 2 false positive "done" items`);
  console.log(`   - Created 1 new ticket for OpenF1 credentials`);
  console.log('\n⚠️  Correctly logged items (already tbd):');
  console.log(`   - MtGM7uAcqFA4vg3RrVxe: GEMINI-AUDIT-114 (Critical IDOR in Delete User)`);
  console.log(`   - tMFajE54aJaAmQNCtL1w: GEMINI-AUDIT-128 (Sprint ID UI Breakage)`);
  console.log(`   - VIcrW13w1sYXNxHfXTfF: GEMINI-AUDIT-115 (Denial of Wallet - Scoring)`);
  console.log('\n✅ Book-of-work status now accurate - Check Admin Panel');

  process.exit(0);
}

fixFalsePositiveDoneItems().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
