#!/usr/bin/env tsx
/**
 * Add Leagues Red Team Review findings to book_of_work collection
 * Source: Red team review conducted 2026-02-23 by Bill (Claude Code)
 * Covers: Bertie's FIRESTORE-003/004 work (v1.58.57-58) + pre-existing leagues.ts issues
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

const now = admin.firestore.FieldValue.serverTimestamp();

const entries = [
  {
    id: 'LEAGUES-001',
    data: {
      title: 'getUserLeagues Silent Failure Bypasses League Limit Check',
      description: 'getUserLeagues() in lib/leagues.ts returns an empty array [] on Firestore error instead of propagating the failure. This function is called by createLeague() and joinLeagueByCode() to enforce the MAX_LEAGUES_PER_USER limit. If Firestore is unavailable or the query fails, the limit check silently passes (0 < 5) and the user can join or create unlimited leagues.',
      technicalDetails: `**File:** app/src/lib/leagues.ts
**Lines:** 233-236

**Vulnerable pattern:**
\`\`\`ts
} catch (error: any) {
  console.error('Error fetching user leagues:', error);
  return []; // ← silent failure — callers see [] instead of an error
}
\`\`\`

**Attack scenario:**
1. Attacker induces Firestore latency or quota exhaustion
2. getUserLeagues() returns []
3. createLeague() sees 0 < 5 (limit check passes)
4. Attacker can create unlimited leagues

**Fix:** Throw the error or return a typed failure result so callers can detect the failure and halt rather than proceeding with a stale [] value.`,
      notes: `Found by: Bill (Claude Code) — Red team review 2026-02-23
Pre-existing issue — predates Bertie's work. Not introduced in v1.58.57-58.
Bertie reviewed and didn't fix it. Should be addressed by Bertie as follow-up.`,
      category: 'security',
      severity: 'high',
      status: 'tbd',
      priority: 1,
      source: 'redteam-review-2026-02-23',
      package: 'security-high',
      sourceData: {
        reviewer: 'Bill (Claude Code)',
        reviewDate: '2026-02-23',
        reviewedCommits: ['54e8f00', '53a8f08'],
        reviewedVersions: '1.58.57-1.58.58',
      },
      versionReported: '1.58.58',
      module: 'Leagues',
      file: 'app/src/lib/leagues.ts',
      guid: 'LIB_LEAGUES-005-v03',
      referenceId: 'LEAGUES-001',
      createdBy: 'Bill (Claude Code)',
      createdAt: now,
      updatedAt: now,
    }
  },
  {
    id: 'LEAGUES-002',
    data: {
      title: 'leagues.ts Catch Blocks Missing 4-Pillar Error Handling (Rule #1)',
      description: 'All 7 catch blocks in lib/leagues.ts are missing Pillars 1 and 2 of the mandatory error handling standard. None of them write to the error_logs Firestore collection (Pillar 1) and none use ERRORS.KEY from the error registry (Pillar 2). They only log to console.error and return a string with a correlation ID. This means league errors are invisible in the admin error log and cannot be triaged.',
      technicalDetails: `**File:** app/src/lib/leagues.ts
**Affected functions (all catch blocks):**
- createLeague() — line ~91
- joinLeagueByCode() — line ~155
- leaveLeague() — line ~206
- getUserLeagues() — line ~233
- regenerateInviteCode() — line ~300
- updateLeagueName() — line ~341
- removeMember() — line ~388
- deleteLeague() — line ~430

**Current pattern (Rule #1 violation):**
\`\`\`ts
} catch (error: any) {
  const correlationId = getCorrelationId();
  console.error(\`Error ... [\${correlationId}]:\`, error);
  return { success: false, error: \`...Please try again. (ID: \${correlationId})\` };
}
\`\`\`

**Missing:**
- ✗ Pillar 1: No logTracedError() / Firestore error_logs write
- ✗ Pillar 2: No ERRORS.KEY usage

**Fix:** Import createTracedError/logTracedError, use ERRORS.UNKNOWN_ERROR (or add league-specific error codes to code.json), write to error_logs in each catch block.

**Note:** leagues.ts is client-side — use the client-side logError() equivalent, not the server-side logTracedError(). Check how other client-side modules (e.g. audit.ts) handle this.`,
      notes: `Found by: Bill (Claude Code) — Red team review 2026-02-23
Pre-existing issue — not introduced by Bertie. Present since leagues module was created.
Affects all league operations. Assigned to Bertie as follow-up to v1.58.57-58 security work.`,
      category: 'standards',
      severity: 'medium',
      status: 'tbd',
      priority: 2,
      source: 'redteam-review-2026-02-23',
      package: 'standards-medium',
      sourceData: {
        reviewer: 'Bill (Claude Code)',
        reviewDate: '2026-02-23',
        reviewedCommits: ['54e8f00', '53a8f08'],
        reviewedVersions: '1.58.57-1.58.58',
      },
      versionReported: '1.58.58',
      module: 'Leagues',
      file: 'app/src/lib/leagues.ts',
      guid: 'LIB_LEAGUES-000-v04',
      referenceId: 'LEAGUES-002',
      createdBy: 'Bill (Claude Code)',
      createdAt: now,
      updatedAt: now,
    }
  },
  {
    id: 'LEAGUES-003',
    data: {
      title: 'No Rate Limiting on /api/leagues/join-by-code Invite Code Lookup',
      description: 'The POST /api/leagues/join-by-code endpoint performs an unconstrained Firestore query for invite codes. While FIRESTORE-003 correctly moved the inviteCode lookup from the client SDK to this server-side API, the API itself has no rate limiting. An authenticated attacker could script requests to enumerate all valid invite codes. A 6-character code from a 32-character alphabet has ~1 billion combinations, but without rate limiting there is no throttle on attempts.',
      technicalDetails: `**File:** app/src/app/api/leagues/join-by-code/route.ts
**Lines:** 74-77

**Vulnerable pattern:**
\`\`\`ts
const leaguesSnapshot = await db.collection('leagues')
  .where('inviteCode', '==', normalizedCode)
  .limit(1)
  .get();
\`\`\`

No rate limiting middleware, no per-user attempt counter, no Firebase App Check.

**Attack scenario:**
1. Attacker authenticates as a valid user (low bar — just needs an account)
2. Scripts POST requests to /api/leagues/join-by-code with random codes
3. 404 = invalid code, 409/403/200 = valid code found
4. Attacker joins any private league without the owner's invite

**Mitigations already in place:**
- Requires valid Firebase Auth token (reduces surface to authenticated users only)
- Codes are cryptographically random 6-char from 32-char alphabet (~1B combinations)
- Risk accepted at current ~20 user scale

**Recommended fix:**
- Add Firebase App Check to the API route
- OR add per-user rate limiting (e.g. max 10 attempts per minute via Redis/Firestore counter)
- OR add an attempt counter per user to Firestore with exponential backoff`,
      notes: `Found by: Bill (Claude Code) — Red team review 2026-02-23
Introduced by Bertie in v1.58.58 (FIRESTORE-003 fix). The fix is correct and an improvement — this is a follow-up hardening item, not a regression.
Risk is LOW at current app scale. Defer until user base grows or App Check is added for other reasons.`,
      category: 'security',
      severity: 'medium',
      status: 'tbd',
      priority: 2,
      source: 'redteam-review-2026-02-23',
      package: 'security-medium',
      sourceData: {
        reviewer: 'Bill (Claude Code)',
        reviewDate: '2026-02-23',
        reviewedCommits: ['54e8f00'],
        reviewedVersions: '1.58.58',
      },
      versionReported: '1.58.58',
      module: 'Leagues',
      file: 'app/src/app/api/leagues/join-by-code/route.ts',
      guid: 'API_LEAGUE_JOIN-001-v04',
      referenceId: 'LEAGUES-003',
      createdBy: 'Bill (Claude Code)',
      createdAt: now,
      updatedAt: now,
    }
  },
  {
    id: 'LEAGUES-004',
    data: {
      title: 'Inline Error Strings in join-by-code Route Instead of ERRORS.KEY (Rule #7)',
      description: 'The early-return validation guards in /api/leagues/join-by-code/route.ts (lines 40-119) return hardcoded inline error strings instead of using ERRORS.KEY from the error registry. This violates Rule #7 and means these errors have no PX- error codes, cannot be cross-referenced in the error registry, and are not logged to error_logs. Affected paths include: auth check (401), format validation (400), league-not-found (404), already-a-member (409), global league guard (403), and max leagues limit (403).',
      technicalDetails: `**File:** app/src/app/api/leagues/join-by-code/route.ts

**Inline strings found:**
- Line 40: "Unauthorized: Invalid or missing authentication token" — should use ERRORS.AUTH_INVALID_TOKEN
- Line 56: "Invalid invite code format" — needs new ERRORS.LEAGUE_INVITE_CODE_INVALID
- Line 66: "Invite code must be 6 characters" — same
- Line 81: "Invalid invite code. League not found." — needs ERRORS.LEAGUE_NOT_FOUND
- Line 94: "You are already a member of this league" — needs ERRORS.LEAGUE_ALREADY_MEMBER
- Line 102: "Cannot join the global league with an invite code" — needs ERRORS.LEAGUE_CANNOT_JOIN_GLOBAL
- Line 116: "You have reached the maximum..." — needs ERRORS.LEAGUE_MAX_REACHED

**Missing error codes in code.json (need to be added and registry regenerated):**
- LEAGUE_INVITE_CODE_INVALID
- LEAGUE_NOT_FOUND
- LEAGUE_ALREADY_MEMBER
- LEAGUE_CANNOT_JOIN_GLOBAL
- LEAGUE_MAX_REACHED

**Note:** The main catch block (line 164) correctly uses ERRORS.UNKNOWN_ERROR. Only the early-return validation paths are affected.`,
      notes: `Found by: Bill (Claude Code) — Red team review 2026-02-23
Introduced by Bertie in v1.58.58. Low severity — these are user-facing validation messages, not server errors. Fix when convenient.`,
      category: 'standards',
      severity: 'low',
      status: 'tbd',
      priority: 3,
      source: 'redteam-review-2026-02-23',
      package: 'standards-low',
      sourceData: {
        reviewer: 'Bill (Claude Code)',
        reviewDate: '2026-02-23',
        reviewedCommits: ['54e8f00'],
        reviewedVersions: '1.58.58',
      },
      versionReported: '1.58.58',
      module: 'Leagues',
      file: 'app/src/app/api/leagues/join-by-code/route.ts',
      guid: 'API_LEAGUE_JOIN-001-v04',
      referenceId: 'LEAGUES-004',
      createdBy: 'Bill (Claude Code)',
      createdAt: now,
      updatedAt: now,
    }
  },
  {
    id: 'LEAGUES-005',
    data: {
      title: 'handleJoin Catch Block Missing Correlation ID in User-Facing Error (Rule #1)',
      description: 'The catch block in handleJoin() in leagues/page.tsx (line 160) displays a generic toast message with no correlation ID when a network-level error occurs (e.g. fetch() throws). The user cannot report the error meaningfully because there is no ID to reference. This violates Rule #1 Pillar 3 (correlation ID in selectable display).',
      technicalDetails: `**File:** app/src/app/(app)/leagues/page.tsx
**Lines:** 160-166

**Current pattern:**
\`\`\`ts
} catch {
  toast({
    variant: 'destructive',
    title: 'Error',
    description: 'Failed to join league. Please try again.',
  });
}
\`\`\`

**Missing:** No correlation ID generated, no error code, user cannot report the error.

**Fix:**
\`\`\`ts
} catch (err: any) {
  const correlationId = generateClientCorrelationId();
  console.error(\`[handleJoin \${correlationId}]\`, err);
  toast({
    variant: 'destructive',
    title: 'Error',
    description: \`Failed to join league. Please try again. (ID: \${correlationId})\`,
  });
}
\`\`\``,
      notes: `Found by: Bill (Claude Code) — Red team review 2026-02-23
Introduced by Bertie in v1.58.58. Low severity — only affects network-level failures, not API validation errors (those return correlationId from the server). Quick fix.`,
      category: 'standards',
      severity: 'low',
      status: 'tbd',
      priority: 3,
      source: 'redteam-review-2026-02-23',
      package: 'standards-low',
      sourceData: {
        reviewer: 'Bill (Claude Code)',
        reviewDate: '2026-02-23',
        reviewedCommits: ['54e8f00'],
        reviewedVersions: '1.58.58',
      },
      versionReported: '1.58.58',
      module: 'Leagues',
      file: 'app/src/app/(app)/leagues/page.tsx',
      guid: 'PAGE_LEAGUES-003-v04',
      referenceId: 'LEAGUES-005',
      createdBy: 'Bill (Claude Code)',
      createdAt: now,
      updatedAt: now,
    }
  },
];

async function addLeaguesRedTeamToBookOfWork() {
  console.log('Adding Leagues Red Team Review findings to book_of_work...\n');

  for (const entry of entries) {
    await db.collection('book_of_work').doc(entry.id).set(entry.data);
    console.log(`✅ ${entry.id}: ${entry.data.title}`);
    console.log(`   Severity: ${entry.data.severity} | Priority: ${entry.data.priority} | Category: ${entry.data.category}`);
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log(`✅ All 5 entries added to book_of_work`);
  console.log('   LEAGUES-001: getUserLeagues silent failure (HIGH security)');
  console.log('   LEAGUES-002: leagues.ts catch blocks missing 4 pillars (MEDIUM standards)');
  console.log('   LEAGUES-003: No rate limiting on join-by-code API (MEDIUM security)');
  console.log('   LEAGUES-004: Inline error strings in route.ts (LOW standards)');
  console.log('   LEAGUES-005: handleJoin catch missing correlation ID (LOW standards)');
  console.log('═'.repeat(80));

  process.exit(0);
}

addLeaguesRedTeamToBookOfWork().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
