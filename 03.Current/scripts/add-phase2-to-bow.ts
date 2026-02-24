#!/usr/bin/env tsx
/**
 * Add Phase 2 Dependency Updates to book_of_work collection
 * GUID: SCRIPT_ADD_PHASE2_BOW-000-v01
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

async function addPhase2ToBookOfWork() {
  console.log('Adding Phase 2 Dependency Updates to book_of_work collection...\n');

  const phase2Entry = {
    title: 'Phase 2: Breaking Dependency Updates (Major Versions)',
    category: 'infrastructure' as const,
    severity: 'medium' as const,
    status: 'tbd' as const,
    package: 'dependencies' as const,
    description: 'Breaking changes in core dependencies requiring testing and migration before production deployment.',
    technicalDetails: `**Phase 2 Breaking Updates (9 packages):**

1. **Next.js** 15.5.11 → 16.1.6 (MAJOR)
   - Impact: App Router changes, breaking API changes
   - Migration: https://nextjs.org/docs/app/building-your-application/upgrading/version-16

2. **Firebase** 11.9.1 → 12.9.0 (MAJOR)
   - Impact: Auth and Firestore API changes
   - Migration: https://firebase.google.com/support/release-notes/js

3. **Tailwind CSS** 3.4.19 → 4.2.0 (MAJOR)
   - Impact: Complete rewrite with new engine - MAJOR MIGRATION EFFORT
   - Migration: https://tailwindcss.com/docs/upgrade-guide

4. **Zod** 3.24.2 → 4.3.6 (MAJOR)
   - Impact: Schema validation API changes
   - Migration: https://github.com/colinhacks/zod/releases

5. **date-fns** 3.6.0 → 4.1.0 (MAJOR)
   - Impact: Date manipulation API changes
   - Migration: https://date-fns.org/docs/Upgrade-Guide

6. **@hookform/resolvers** 4.1.3 → 5.2.2 (MAJOR)
   - Impact: Form validation resolver changes
   - Migration: https://github.com/react-hook-form/resolvers/releases

7. **@types/node** 20.19.33 → 25.3.0 (MAJOR)
   - Impact: TypeScript type definitions for Node.js 25
   - Note: Match Node.js runtime version

8. **dotenv** 16.5.0 → 17.3.1 (MAJOR)
   - Impact: Environment variable loading changes
   - Migration: https://github.com/motdotla/dotenv/releases

9. **recharts** 2.15.1 → 3.7.0 (MAJOR)
   - Impact: Chart component API changes
   - Migration: https://recharts.org/en-US/api

**Prerequisites:**
✅ Phase 1 safe updates completed (2026-02-20)
⬜ Create feature branch for testing
⬜ Review migration guides for each package
⬜ Test in development environment
⬜ Deploy to staging before production

**Recommended Sequence:**
1. Create feature branch: \`git checkout -b update-dependencies\`
2. Update Next.js 15 → 16 (review migration guide)
3. Update Firebase 11 → 12 (review breaking changes)
4. Update form/validation packages (zod, @hookform/resolvers)
5. Update date-fns and recharts
6. Update @types/node and dotenv
7. Test thoroughly (all user flows)
8. Deploy to staging
9. Update Tailwind CSS 3 → 4 (separate branch - major effort)

**Estimated Effort:** 4-8 hours (testing required)
**Risk Level:** HIGH - Breaking changes in core dependencies`,
    notes: `Created: 2026-02-20 by Bill (Claude Code)
Based on: DEPENDENCY-AUDIT-REPORT.md
Phase 1 completed: 2026-02-20 (29 packages updated successfully)
npm vulnerabilities: 11 total (1 low, 1 moderate, 9 high) - mostly genkit-cli dev dependencies
Node.js recommendation: Switch to v24.13.0 LTS (currently on v25.3.0 latest)`,
    createdBy: 'Bill (Claude Code)',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('book_of_work').add(phase2Entry);

  console.log('✅ Phase 2 Dependency Updates added to book_of_work collection');
  console.log(`   Document ID: ${docRef.id}`);
  console.log(`   Collection: book_of_work`);
  console.log(`   Status: tbd (To Do)`);
  console.log(`   Severity: medium`);
  console.log(`   Category: infrastructure`);
  console.log('');
  console.log('Entry Details:');
  console.log('═'.repeat(80));
  console.log(`Title: ${phase2Entry.title}`);
  console.log(`Packages: 9 major version updates`);
  console.log(`Risk: HIGH - Breaking changes in Next.js, Firebase, Tailwind CSS, and others`);
  console.log('═'.repeat(80));
  console.log('\n✅ Task complete - Check Admin Panel > Book of Work tab to view the entry');

  process.exit(0);
}

addPhase2ToBookOfWork().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
