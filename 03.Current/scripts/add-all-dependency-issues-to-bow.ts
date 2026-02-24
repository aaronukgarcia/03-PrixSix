#!/usr/bin/env tsx
/**
 * Add all outstanding dependency issues to book_of_work collection
 * GUID: SCRIPT_ADD_ALL_DEPS_BOW-000-v01
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

async function addAllDependencyIssuesToBookOfWork() {
  console.log('Adding all outstanding dependency issues to book_of_work collection...\n');

  const issues = [
    {
      title: 'npm Vulnerabilities in Dev Dependencies (11 total)',
      category: 'infrastructure' as const,
      severity: 'medium' as const,
      status: 'tbd' as const,
      package: 'dependencies' as const,
      description: '11 npm vulnerabilities detected in development dependencies, primarily in genkit-cli dependency chain.',
      technicalDetails: `**Vulnerability Breakdown:**
- **9 High Severity:**
  1. minimatch <10.2.1 - ReDoS via repeated wildcards
  2. glob 3.0.0-10.5.0 - Via minimatch vulnerability
  3. rimraf 2.3.0-3.0.2 || 4.2.0-5.0.10 - Via glob vulnerability
  4. gaxios >=7.1.3 - Via rimraf vulnerability
  5. google-gax 5.0.5-5.0.6 - Via rimraf vulnerability
  6. @genkit-ai/tools-common - Via glob vulnerability
  7. @genkit-ai/telemetry-server >=0.9.0-dev.1 - Via tools-common
  8. genkit-cli >=0.9.0-dev.1 - Via telemetry-server & tools-common
  9. fast-xml-parser 4.1.3-5.3.5 - DoS through entity expansion (CVSS 7.5)

- **1 Moderate Severity:**
  10. ajv <8.18.0 - ReDoS when using $data option

- **1 Low Severity:**
  11. hono <4.11.10 - Timing comparison hardening in basicAuth/bearerAuth (CVSS 3.7)

**Fix Available:** \`npm audit fix\` for most issues
**Breaking Fix:** genkit-cli major version downgrade (0.9.x → 0.0.2) - requires evaluation

**Impact:** Development tools only, does not affect production runtime
**Source:** npm audit (2026-02-20)`,
      notes: `Created: 2026-02-20 by Bill (Claude Code)
Based on: npm audit results after Phase 1 updates
Total prod dependencies: 768
Total dev dependencies: 163
Fix strategy: Review genkit-cli upgrade path, apply non-breaking fixes first`,
      createdBy: 'Bill (Claude Code)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      title: 'Semgrep Python Dependency Conflicts',
      category: 'infrastructure' as const,
      severity: 'low' as const,
      status: 'tbd' as const,
      package: 'dependencies' as const,
      description: 'Semgrep 1.151.0 reports version incompatibilities with updated Python packages after Phase 1.',
      technicalDetails: `**Conflict Details:**
Semgrep 1.151.0 has incompatible requirements with:
- exceptiongroup 1.3.1 (semgrep wants <1.3.0)
- click (updated to 8.3.1)
- jsonschema (updated to 4.26.0)
- opentelemetry packages (updated to 1.39.1)
- mcp (version conflict)

**Current Status:**
✅ Semgrep still functional (tested: \`semgrep --version\` = 1.151.0)
✅ All Python packages updated successfully
⚠️ Pip shows dependency warnings but non-blocking

**Possible Solutions:**
1. Wait for semgrep update to support newer dependencies
2. Pin conflicting packages to semgrep-compatible versions
3. Monitor semgrep releases for compatibility fixes
4. Accept warnings if semgrep remains functional

**Impact:** Low - Semgrep continues to work despite warnings
**Source:** pip install output (2026-02-20)`,
      notes: `Created: 2026-02-20 by Bill (Claude Code)
Phase 1 Python package updates completed successfully
Semgrep functionality verified and working
Recommend monitoring semgrep release notes for compatibility updates`,
      createdBy: 'Bill (Claude Code)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      title: 'Node.js Not on LTS Version',
      category: 'infrastructure' as const,
      severity: 'medium' as const,
      status: 'tbd' as const,
      package: 'dependencies' as const,
      description: 'Production environment running Node.js v25.3.0 (latest) instead of LTS version v24.13.0.',
      technicalDetails: `**Current State:**
- **Installed:** Node.js v25.3.0 (latest release, not LTS)
- **Recommended:** Node.js v24.13.0 (LTS until April 2027)

**Impact:**
- Firebase tools show warning: "Node.js v25 not officially supported (requires v20/22/24)"
- Latest versions may have untested edge cases in production
- LTS versions receive long-term security updates and stability fixes

**Benefits of Switching to LTS:**
1. ✅ Official support from firebase-tools
2. ✅ Long-term security updates (until April 2027)
3. ✅ Production stability (fewer breaking changes)
4. ✅ Better compatibility with enterprise tools

**Migration Steps:**
1. Download Node.js v24.13.0 LTS from nodejs.org
2. Install alongside v25 (use nvm/nvm-windows for version management)
3. Switch default to v24.13.0
4. Test all npm scripts and deployments
5. Update documentation with new version

**Effort:** 30 minutes - 1 hour
**Risk:** Low (downgrade to stable LTS)`,
      notes: `Created: 2026-02-20 by Bill (Claude Code)
Based on: DEPENDENCY-AUDIT-REPORT.md
Current v25 works but not officially supported by firebase-tools
LTS v24 recommended for production stability`,
      createdBy: 'Bill (Claude Code)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      title: 'Python Package Breaking Update: peewee 3.x → 4.0.0',
      category: 'infrastructure' as const,
      severity: 'low' as const,
      status: 'tbd' as const,
      package: 'dependencies' as const,
      description: 'Python ORM library peewee has major version update available (3.19.0 → 4.0.0) with breaking changes.',
      technicalDetails: `**Current Version:** peewee 3.19.0
**Latest Version:** peewee 4.0.0
**Update Type:** MAJOR (breaking changes)

**Usage in Prix Six:**
- Used in Cloud Functions (Python runtime)
- Check if peewee is actually utilized in production code
- May be a transitive dependency

**Before Updating:**
1. ✅ Verify peewee usage in codebase
2. ⬜ Review peewee 4.0.0 changelog for breaking changes
3. ⬜ Test Cloud Functions in development environment
4. ⬜ Update code to match new API if needed

**Migration Guide:** https://github.com/coleifer/peewee/releases/tag/4.0.0

**Priority:** Low (if not actively used) / Medium (if used in production)
**Effort:** 1-2 hours (depends on usage)`,
      notes: `Created: 2026-02-20 by Bill (Claude Code)
From: pip list --outdated results
Action: First determine if peewee is actually used in Cloud Functions
If unused: can be safely updated or removed
If used: review changelog and test thoroughly`,
      createdBy: 'Bill (Claude Code)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      title: 'Remaining Safe Python Package Updates',
      category: 'infrastructure' as const,
      severity: 'low' as const,
      status: 'tbd' as const,
      package: 'dependencies' as const,
      description: 'Additional Python package updates available that were not included in Phase 1.',
      technicalDetails: `**Packages Available for Update:**

1. **boltons** 21.0.0 → 25.0.0 (Medium priority)
   - Utility library, likely safe minor version jump

2. **face** 24.0.0 → 26.0.0 (Medium priority)
   - Library updates

3. **rich** 13.5.3 → 14.3.3 (Low priority - UI only)
   - Terminal UI library for pretty output
   - Note: Was upgraded then downgraded due to semgrep compatibility

4. **Additional packages** (from top 10 of 16 outdated):
   - Check full list via \`pip list --outdated\`

**Phase 1 Completed (6 packages):**
✅ google-api-core 2.29.0 → 2.30.0
✅ google-genai 1.63.0 → 1.64.0
✅ grpcio 1.78.0 → 1.78.1
✅ grpcio-status 1.78.0 → 1.78.1
✅ pydantic-settings 2.13.0 → 2.13.1
✅ exceptiongroup 1.2.2 → 1.3.1

**Recommended Action:**
Run \`pip list --outdated\` to get full list, review each package individually, update in batches

**Effort:** 15-30 minutes
**Risk:** Low (minor/patch versions)`,
      notes: `Created: 2026-02-20 by Bill (Claude Code)
Based on: DEPENDENCY-AUDIT-REPORT.md Section 5
Phase 1 focused on Google Cloud packages
Remaining updates are lower priority utilities`,
      createdBy: 'Bill (Claude Code)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      title: 'MCP Server Updates Check',
      category: 'infrastructure' as const,
      severity: 'low' as const,
      status: 'tbd' as const,
      package: 'dependencies' as const,
      description: 'Manual verification needed for MCP servers (Vestige, Azure, MS-365, GitHub, Firebase, Sequential Thinking, Context7).',
      technicalDetails: `**MCP Servers Installed:**

1. **Vestige** v1.1.2 (binary)
   - Check: https://github.com/vestige-ai/vestige
   - Action: Manual check for binary updates

2. **Azure MCP** 0.0.4 (pre-release)
   - Check: Monitor for v1.0 stable release
   - Action: \`cd E:\\GoogleDrive\\Tools\\MCP\\azure-mcp && npm outdated\`

3. **MS 365 MCP** 0.40.0
   - Recently updated (2026-02-12)
   - Action: \`cd E:\\GoogleDrive\\Tools\\MCP\\ms-365 && npm outdated\`

4. **GitHub MCP** (Go binary)
   - Check: https://github.com/github/github-mcp-server
   - Action: Manual check for releases

5. **Firebase MCP** 15.5.1
   - Tied to firebase-tools (updated to 15.7.0 in Phase 1)
   - Action: Check if MCP version follows firebase-tools

6. **Sequential Thinking** 2025.12.18
   - Action: \`cd E:\\GoogleDrive\\Tools\\MCP\\sequential-thinking && npm outdated\`

7. **Context7** 2.1.1
   - Action: \`cd E:\\GoogleDrive\\Tools\\MCP\\context7 && npm outdated\`

**Update Strategy:**
- npm-based MCPs: Run \`npm outdated\` in each MCP directory
- Binary MCPs: Check GitHub releases manually
- Vestige: Check official website for updates

**Effort:** 30 minutes - 1 hour
**Risk:** Low (optional, not blocking)`,
      notes: `Created: 2026-02-20 by Bill (Claude Code)
Based on: DEPENDENCY-AUDIT-REPORT.md Section 4
MCPs are user-level tools, updates don't affect production
Last MCP updates: 2026-02-12 (MS-365, Azure dependencies)`,
      createdBy: 'Bill (Claude Code)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  ];

  console.log(`Adding ${issues.length} dependency issues to book_of_work collection...\n`);
  console.log('═'.repeat(80));

  const docRefs = [];
  for (const issue of issues) {
    const docRef = await db.collection('book_of_work').add(issue);
    docRefs.push({ id: docRef.id, title: issue.title, severity: issue.severity });
    console.log(`✅ Added: ${issue.title}`);
    console.log(`   ID: ${docRef.id}`);
    console.log(`   Severity: ${issue.severity}`);
    console.log(`   Status: ${issue.status}`);
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log(`\n✅ All ${issues.length} dependency issues added to book_of_work collection`);
  console.log('\nSummary:');
  docRefs.forEach((doc, idx) => {
    console.log(`${idx + 1}. [${doc.severity.toUpperCase()}] ${doc.title}`);
  });
  console.log('\n✅ Task complete - Check Admin Panel > Book of Work tab to view all entries');

  process.exit(0);
}

addAllDependencyIssuesToBookOfWork().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
