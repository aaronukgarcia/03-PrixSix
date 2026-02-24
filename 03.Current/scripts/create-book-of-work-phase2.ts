#!/usr/bin/env tsx
/**
 * Create book-of-work in Firestore with Phase 2 dependency updates
 * GUID: SCRIPT_CREATE_BOW_PHASE2-000-v01
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

async function createBookOfWork() {
  console.log('Creating book-of-work in Firestore...\n');

  const bookOfWork = {
    metadata: {
      created: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      version: '1.58.54',
      createdBy: 'Bill (Claude Code)',
      purpose: 'Track outstanding work items and dependency updates for Prix Six'
    },
    issues: [
      {
        id: 'DEPENDENCY-PHASE2-001',
        title: 'Phase 2 Breaking Dependency Updates',
        category: 'dependencies',
        severity: 'medium',
        status: 'open',
        created: '2026-02-20',
        createdBy: 'Bill (Claude Code)',
        description: 'Breaking changes requiring testing and migration before production deployment',
        details: {
          updates: [
            {
              package: 'next',
              current: '15.5.11',
              target: '16.1.6',
              type: 'major',
              impact: 'App Router changes, breaking API changes',
              migrationGuide: 'https://nextjs.org/docs/app/building-your-application/upgrading/version-16'
            },
            {
              package: 'firebase',
              current: '11.9.1',
              target: '12.9.0',
              type: 'major',
              impact: 'Auth and Firestore API changes',
              migrationGuide: 'https://firebase.google.com/support/release-notes/js'
            },
            {
              package: 'tailwindcss',
              current: '3.4.19',
              target: '4.2.0',
              type: 'major',
              impact: 'Complete rewrite with new engine - major migration effort',
              migrationGuide: 'https://tailwindcss.com/docs/upgrade-guide'
            },
            {
              package: 'zod',
              current: '3.24.2',
              target: '4.3.6',
              type: 'major',
              impact: 'Schema validation API changes',
              migrationGuide: 'https://github.com/colinhacks/zod/releases'
            },
            {
              package: 'date-fns',
              current: '3.6.0',
              target: '4.1.0',
              type: 'major',
              impact: 'Date manipulation API changes',
              migrationGuide: 'https://date-fns.org/docs/Upgrade-Guide'
            },
            {
              package: '@hookform/resolvers',
              current: '4.1.3',
              target: '5.2.2',
              type: 'major',
              impact: 'Form validation resolver changes',
              migrationGuide: 'https://github.com/react-hook-form/resolvers/releases'
            },
            {
              package: '@types/node',
              current: '20.19.33',
              target: '25.3.0',
              type: 'major',
              impact: 'TypeScript type definitions for Node.js 25',
              migrationGuide: 'Match Node.js runtime version'
            },
            {
              package: 'dotenv',
              current: '16.5.0',
              target: '17.3.1',
              type: 'major',
              impact: 'Environment variable loading changes',
              migrationGuide: 'https://github.com/motdotla/dotenv/releases'
            },
            {
              package: 'recharts',
              current: '2.15.1',
              target: '3.7.0',
              type: 'major',
              impact: 'Chart component API changes',
              migrationGuide: 'https://recharts.org/en-US/api'
            }
          ],
          estimatedEffort: '4-8 hours (testing required)',
          risk: 'HIGH - Breaking changes in core dependencies',
          prerequisites: [
            'Complete Phase 1 safe updates ✅',
            'Create feature branch for testing',
            'Review migration guides for each package',
            'Test in development environment',
            'Deploy to staging before production'
          ],
          recommended_sequence: [
            '1. Create feature branch: git checkout -b update-dependencies',
            '2. Update Next.js 15 → 16 (review migration guide)',
            '3. Update Firebase 11 → 12 (review breaking changes)',
            '4. Update form/validation packages (zod, @hookform/resolvers)',
            '5. Update date-fns and recharts',
            '6. Update @types/node and dotenv',
            '7. Test thoroughly (all user flows)',
            '8. Deploy to staging',
            '9. Update Tailwind CSS 3 → 4 (separate branch - major effort)'
          ]
        },
        relatedIssues: ['DEPENDENCY-PHASE1-001'],
        references: [
          'DEPENDENCY-AUDIT-REPORT.md',
          'E:\\GoogleDrive\\Papers\\03-PrixSix\\03.Current\\DEPENDENCY-AUDIT-REPORT.md'
        ],
        notes: [
          '2026-02-20: Phase 1 completed successfully (29 packages updated)',
          '2026-02-20: npm vulnerabilities present (11 total) - mostly genkit-cli dev dependencies',
          '2026-02-20: Node.js v25.3.0 not LTS - recommend v24.13.0 for production'
        ]
      },
      {
        id: 'DEPENDENCY-PHASE1-001',
        title: 'Phase 1 Safe Dependency Updates',
        category: 'dependencies',
        severity: 'low',
        status: 'completed',
        created: '2026-02-20',
        completedDate: '2026-02-20',
        createdBy: 'Bill (Claude Code)',
        description: 'Non-breaking minor and patch updates across npm, Python, and global tools',
        details: {
          packagesUpdated: 29,
          npmPackages: 10,
          pythonPackages: 6,
          globalTools: 2,
          dependencies: 11,
          executionTime: '5 minutes',
          risk: 'LOW - All minor/patch updates'
        },
        remediation: {
          version: '1.58.54',
          date: '2026-02-20',
          description: 'Successfully updated all safe dependencies without breaking changes'
        }
      },
      {
        id: 'GEMINI-AUDIT-120',
        title: 'Sprint Race Scoring Bug - GP Prediction Lookup Failure',
        category: 'scoring',
        severity: 'critical',
        status: 'completed',
        created: '2026-02-13',
        completedDate: '2026-02-20',
        createdBy: 'Gemini Security Audit',
        description: 'Sprint scoring failed to find GP predictions, causing false carry-forwards',
        details: {
          rootCause: 'Sprint scoring looked for Race-Sprint prediction but normalized to Race (without suffix)',
          impact: 'Users with GP predictions got carry-forward scores for Sprint races instead of using their GP prediction',
          fix: 'Added fallback in calculate-scores/route.ts to check base GP prediction before carry-forward'
        },
        remediation: {
          version: '1.58.53',
          date: '2026-02-20',
          commitHash: 'pending',
          description: 'Fixed Sprint scoring to check base GP prediction before carry-forward logic'
        }
      }
    ],
    summary: {
      byCategory: {
        dependencies: 2,
        scoring: 1
      },
      bySeverity: {
        critical: 1,
        medium: 1,
        low: 1
      },
      byStatus: {
        open: 1,
        completed: 2
      }
    }
  };

  await db.collection('admin_configuration').doc('book_of_work').set(bookOfWork);

  console.log('✅ Book-of-work created in Firestore');
  console.log(`   Collection: admin_configuration`);
  console.log(`   Document: book_of_work`);
  console.log(`   Total issues: ${bookOfWork.issues.length}`);
  console.log(`   Open issues: 1 (DEPENDENCY-PHASE2-001)`);
  console.log(`   Completed issues: 2`);
  console.log('');
  console.log('Phase 2 Dependency Updates added to book-of-work:');
  console.log('═'.repeat(60));
  console.log(JSON.stringify(bookOfWork.issues[0], null, 2));
  console.log('═'.repeat(60));

  process.exit(0);
}

createBookOfWork().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
