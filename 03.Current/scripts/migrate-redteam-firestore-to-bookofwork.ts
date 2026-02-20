/**
 * GUID: SCRIPT_MIGRATE_REDTEAM_FIRESTORE-000
 * Intent: Populate Firestore book_of_work collection with 18 new unique issues from RedTeam.json de-duplication
 * Trigger: User asked if Firestore table was populated (it wasn't - only Vestige was updated)
 * Impact: Admin panel BookOfWorkManager will display all 18 new Firestore security issues
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

/**
 * GUID: SCRIPT_MIGRATE_REDTEAM_FIRESTORE-001
 * Intent: Define the 18 new unique Firestore security issues from RedTeam.json
 * Trigger: These were added to Vestige but not to Firestore book_of_work collection
 * Impact: Source of truth for migration - all issues documented here
 */
const newIssues = [
  // CRITICAL PRIORITY (10 issues)
  {
    guid: 'GEMINI-AUDIT-015',
    title: 'Authorization Bypass - Direct Firestore Writes to admin_configuration',
    description: `The updateAuditSettings function in AuditManager.tsx directly modifies admin_configuration/global from client to enable Single User Mode. No server-side auth. Attacker can craft direct setDoc call to initiate DoS attack.

**Attack Vector:** Bypass client UI, craft direct Firestore setDoc call to admin_configuration/global with singleUserModeEnabled: true
**Impact:** Complete application DoS - all users disconnected
**Fix:** Replace with authenticated API endpoint that verifies admin privileges server-side`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/AuditManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'authorization-bypass', 'dos', 'admin_configuration'],
    priority: 10,
  },
  {
    guid: 'GEMINI-AUDIT-017',
    title: 'Denial of Wallet - Unbounded ConsistencyChecker Reads',
    description: `The runChecks function fetches entire Firestore collections (predictions via collectionGroup, race_results, scores, leagues) without pagination. Repeated triggers cause excessive billing (DoW attack).

**Attack Vector:** Malicious admin repeatedly triggers CC full scan
**Impact:** Excessive Firebase billing, potential budget exhaustion
**Fix:** Implement pagination with server-side aggregation, add rate limiting`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/ConsistencyChecker.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'denial-of-wallet', 'unbounded-reads', 'pagination'],
    priority: 9,
  },
  {
    guid: 'GEMINI-AUDIT-018',
    title: 'Plaintext PIN Storage in email_logs Collection',
    description: `EmailLog interface and email_logs Firestore collection store user 6-digit PINs in plaintext. Attacker with read access can retrieve credentials for account takeover.

**Attack Vector:** Read email_logs collection to steal user PINs
**Impact:** Account takeover via credential theft
**Fix:** Hash PINs before storage, remove plaintext from email_logs
**Note:** EMAIL-006 added maskPin() utility but root cause remains`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/EmailLogManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'credentials', 'plaintext', 'email_logs', 'account-takeover'],
    priority: 10,
  },
  {
    guid: 'GEMINI-AUDIT-021',
    title: 'Insecure Direct Object Modification - Feedback Collection',
    description: `updateStatus and deleteFeedback perform direct Firestore operations from client. No server-side authorization. Attacker can modify/delete any feedback item.

**Attack Vector:** Craft direct Firestore API calls to update/delete any feedback
**Impact:** Data integrity compromise, unauthorized deletion
**Fix:** Replace with authenticated API endpoints for feedback management`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/FeedbackManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'idor', 'feedback', 'authorization-bypass'],
    priority: 8,
  },
  {
    guid: 'GEMINI-AUDIT-022',
    title: 'Content Injection - Direct Writes to hot_news/global',
    description: `handleSave directly modifies hot_news/global via updateHotNewsContent without server-side auth. Attacker can inject arbitrary content into public news feed.

**Attack Vector:** Bypass client UI, inject malicious HTML/JavaScript into global news
**Impact:** Content injection, XSS, phishing attacks, brand damage
**Fix:** Replace with authenticated API endpoint, sanitize all content server-side`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/HotNewsManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'content-injection', 'xss', 'hot_news'],
    priority: 9,
  },
  {
    guid: 'GEMINI-AUDIT-025',
    title: 'Single User Mode DoS - Direct admin_configuration Write',
    description: `activateSingleUserMode directly modifies admin_configuration/global from client. Attacker can enable Single User Mode and disconnect all users.

**Attack Vector:** Direct setDoc call to enable Single User Mode
**Impact:** Complete application DoS, all users forcibly disconnected
**Fix:** Move Single User Mode activation to authenticated API endpoint`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/OnlineUsersManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'dos', 'admin_configuration', 'single-user-mode'],
    priority: 10,
  },
  {
    guid: 'GEMINI-AUDIT-028',
    title: 'Site Functions DoS - Direct admin_configuration Write',
    description: `handleSave directly modifies admin_configuration/global to update userLoginEnabled and newUserSignupEnabled without server-side checks. DoS for login/registration.

**Attack Vector:** Disable login/signup flags via direct Firestore write
**Impact:** Application DoS - login and registration disabled
**Fix:** Replace with authenticated API endpoint for site function management`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/SiteFunctionsManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'dos', 'admin_configuration', 'site-functions'],
    priority: 9,
  },
  {
    guid: 'GEMINI-AUDIT-029',
    title: 'Privilege Escalation - Client-Side isAdmin Toggle',
    description: `handleToggleAdmin calls client-side updateUser to change isAdmin status without server-side auth. Attacker can set isAdmin: true on own account.

**Attack Vector:** Direct Firestore API call to set own isAdmin flag to true
**Impact:** Privilege escalation, unauthorized admin access
**Fix:** Move admin toggle to authenticated API endpoint with server-side admin verification`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/(app)/admin/_components/TeamManager.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'privilege-escalation', 'users', 'isAdmin'],
    priority: 10,
  },
  {
    guid: 'GEMINI-AUDIT-049',
    title: 'Hardcoded "system" OwnerId - Privilege Escalation Risk',
    description: `checkLeagues recognizes 'system' as valid ownerId, bypassing user validation. If Firestore rules don't strictly enforce, attacker can create league with ownerId: 'system' for elevated privileges.

**Attack Vector:** Create league with ownerId set to 'system' string
**Impact:** Privilege escalation, bypassing league ownership restrictions
**Fix:** Enforce server-side-only creation of system leagues, remove 'system' as valid client-side owner`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/lib/consistency.ts',
    module: 'Library Utilities',
    tags: ['firestore', 'privilege-escalation', 'leagues', 'system-owner'],
    priority: 7,
  },
  {
    guid: 'GEMINI-AUDIT-107',
    title: 'IDOR Privilege Escalation - Untrusted adminUid Parameter',
    description: `Endpoint trusts adminUid from request body to verify admin privileges. Doesn't verify adminUid matches authenticated user's UID. Regular user can send admin's UID to bypass check.

**Attack Vector:** Send legitimate admin's UID in request body to bypass authorization
**Impact:** Privilege escalation, unauthorized user account modification
**Fix:** Verify request.auth.uid matches adminUid, don't trust client-supplied admin credentials`,
    category: 'security' as const,
    severity: 'critical' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-critical' as const,
    file: 'app/src/app/api/admin/update-user/route.ts',
    module: 'API Routes',
    tags: ['firestore', 'idor', 'privilege-escalation', 'users', 'api'],
    priority: 10,
  },

  // HIGH PRIORITY (3 issues)
  {
    guid: 'GEMINI-AUDIT-047',
    title: 'Information Disclosure - Client-Side Audit Log Logging',
    description: `logPermissionError logs structured error to console.error including userId, path, method. Exposes sensitive details to browser console.

**Attack Vector:** View browser console to understand data model and security rules
**Impact:** Information disclosure, security model reconnaissance
**Fix:** Remove detailed console logging, or sanitize to remove sensitive fields`,
    category: 'security' as const,
    severity: 'high' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-high' as const,
    file: 'app/src/lib/audit.ts',
    module: 'Library Utilities',
    tags: ['firestore', 'information-disclosure', 'audit_logs', 'console-logging'],
    priority: 6,
  },
  {
    guid: 'GEMINI-AUDIT-062',
    title: 'Information Disclosure - Raw Firestore Errors in Leagues',
    description: `createLeague, joinLeagueByCode, leaveLeague, deleteLeague return raw error.message to user. Leaks internal database structure and security rule details.

**Attack Vector:** Trigger errors to learn about security rules and database structure
**Impact:** Information disclosure, aids in crafting bypass attacks
**Fix:** Return generic error messages to client, log detailed errors server-side only`,
    category: 'security' as const,
    severity: 'high' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-high' as const,
    file: 'app/src/lib/leagues.ts',
    module: 'Library Utilities',
    tags: ['firestore', 'information-disclosure', 'leagues', 'error-messages'],
    priority: 6,
  },
  {
    guid: 'GEMINI-AUDIT-063',
    title: 'Missing Server-Side Authorization - League Management',
    description: `All functions in leagues.ts designed for client-side calls. Code includes comments like "Only owner can delete" but enforced client-side only. Attacker can bypass via direct Firestore API calls.

**Attack Vector:** Craft direct Firestore API calls to bypass client-side checks
**Impact:** Unauthorized league operations, data integrity compromise
**Fix:** Move all league management to authenticated API endpoints with server-side validation`,
    category: 'security' as const,
    severity: 'high' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-high' as const,
    file: 'app/src/lib/leagues.ts',
    module: 'Library Utilities',
    tags: ['firestore', 'authorization-bypass', 'leagues', 'client-side-checks'],
    priority: 7,
  },

  // MEDIUM PRIORITY (1 issue)
  {
    guid: 'GEMINI-AUDIT-111',
    title: 'Denial of Wallet - Unbounded Signup Handicap Calculation',
    description: `Late-joiner handicap executes db.collection('scores').get() to fetch ALL scores. As dataset grows, becomes slow/expensive. Repeated signups consume significant read quota.

**Attack Vector:** Repeated signup attempts to exhaust Firestore read quota
**Impact:** Performance degradation, excessive billing, budget exhaustion
**Fix:** Implement aggregated scoring with pagination or pre-calculated minimums`,
    category: 'security' as const,
    severity: 'medium' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-medium' as const,
    file: 'app/src/app/api/auth/signup/route.ts',
    module: 'API Routes',
    tags: ['firestore', 'denial-of-wallet', 'scores', 'unbounded-reads'],
    priority: 5,
  },

  // LOW PRIORITY (3 issues)
  {
    guid: 'GEMINI-AUDIT-014',
    title: 'Information Disclosure - AttackMonitor Console Logging',
    description: `console.error('[AttackMonitor] Firestore error:', error) logs raw Firestore error to browser console. Can expose internal app details.

**Attack Vector:** View browser console for database structure details
**Impact:** Minor information disclosure via browser console
**Fix:** Remove console.error or sanitize error object before logging`,
    category: 'security' as const,
    severity: 'low' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-low' as const,
    file: 'app/src/app/(app)/admin/_components/AttackMonitor.tsx',
    module: 'Admin Components',
    tags: ['firestore', 'information-disclosure', 'attack_alerts', 'console-logging'],
    priority: 3,
  },
  {
    guid: 'GEMINI-AUDIT-123',
    title: 'Hardcoded Client-Side Calendar - Data Sync Risk',
    description: `2026 race calendar hardcoded in client data.ts. Server-side Firestore race_schedule exists but not used. Risk of desync if schedule changes mid-season.

**Attack Vector:** N/A (data consistency issue, not exploitable)
**Impact:** Client-server data mismatch, potential incorrect predictions
**Fix:** Use Firestore race_schedule as single source, remove hardcoded calendar
**Related:** FIRESTORE-001 (add explicit security rule for race_schedule)`,
    category: 'security' as const,
    severity: 'low' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-low' as const,
    file: 'app/src/lib/data.ts',
    module: 'Library Utilities',
    tags: ['firestore', 'data-sync', 'race_schedule', 'hardcoded-data'],
    priority: 2,
  },
  {
    guid: 'GEMINI-AUDIT-125',
    title: 'Information Disclosure - Raw Health Endpoint Errors',
    description: `Health endpoint returns raw error.message when connectivity fails. Public unauthenticated endpoint leaks internal database details.

**Attack Vector:** Probe public health endpoint to learn database configuration
**Impact:** Minor information disclosure via public endpoint
**Fix:** Return generic "unavailable" message instead of raw error.message`,
    category: 'security' as const,
    severity: 'low' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'security-low' as const,
    file: 'app/src/app/api/health/route.ts',
    module: 'API Routes',
    tags: ['firestore', 'information-disclosure', 'health-endpoint', 'error-messages'],
    priority: 2,
  },

  // INFORMATIONAL (1 issue)
  {
    guid: 'GEMINI-AUDIT-083',
    title: 'Undocumented FeedbackForm Component',
    description: `FeedbackForm.tsx performs write operations to feedback collection via runTransaction but not documented in code.json.

**Attack Vector:** N/A (documentation gap, not exploitable)
**Impact:** Documentation completeness, no direct security risk
**Fix:** Add FeedbackForm.tsx to code.json with GUID documentation`,
    category: 'infrastructure' as const,
    severity: 'informational' as const,
    status: 'tbd' as const,
    source: 'vestige-redteam' as const,
    package: 'vestige-audit' as const,
    file: 'app/src/app/(app)/dashboard/_components/FeedbackForm.tsx',
    module: 'Dashboard Components',
    tags: ['documentation', 'code.json', 'feedback', 'guid-missing'],
    priority: 1,
  },
];

/**
 * GUID: SCRIPT_MIGRATE_REDTEAM_FIRESTORE-002
 * Intent: Main migration function - add all 18 issues to Firestore book_of_work collection
 * Trigger: User confirmed Firestore table needs to be populated
 * Impact: Admin panel BookOfWorkManager will display all new Firestore security issues
 */
async function migrateRedTeamIssues() {
  console.log('Starting RedTeam.json Firestore security issues migration...\n');

  const batch = db.batch();
  const now = Timestamp.now();
  let addedCount = 0;

  for (const issue of newIssues) {
    const docRef = db.collection('book_of_work').doc();

    const entry = {
      id: docRef.id,
      ...issue,
      createdAt: now,
      updatedAt: now,
      sourceData: {
        deduplicationReport: 'firestore-security-deduplication-report.md',
        vestigeNodeCritical: '52a80a91-bb5b-4888-b595-1628c5c41774',
        vestigeNodeOther: '9e263b80-83d2-45b7-b1ae-56073dbcb011',
        vestigeSummary: '41c4dfdc-c49d-43e6-8656-00c88d301573',
        migrationDate: '2026-02-20',
      },
    };

    batch.set(docRef, entry);
    addedCount++;

    console.log(`✓ Adding ${issue.guid} (${issue.severity}) - ${issue.title}`);
  }

  console.log(`\nCommitting batch write of ${addedCount} issues...`);
  await batch.commit();

  console.log(`\n✅ SUCCESS: Added ${addedCount} Firestore security issues to book_of_work collection`);
  console.log('\nBreakdown:');
  console.log('  Critical: 10 issues');
  console.log('  High: 3 issues');
  console.log('  Medium: 1 issue');
  console.log('  Low: 3 issues');
  console.log('  Informational: 1 issue');
  console.log('  TOTAL: 18 issues\n');

  // Query final count
  const snapshot = await db.collection('book_of_work').count().get();
  console.log(`Current book_of_work collection total: ${snapshot.data().count} entries`);
}

// Run migration
migrateRedTeamIssues()
  .then(() => {
    console.log('\n✅ Migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
