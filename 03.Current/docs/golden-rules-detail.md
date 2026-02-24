# docs/golden-rules-detail.md

> Full implementation patterns, code templates, and compliance checklists for all 11 Golden Rules.
> This file is referenced from `CLAUDE.md` and should be read when you need detailed guidance.

---

##  GOLDEN RULE #1: Aggressive Error Trapping

**Every function, API call, database operation, or async action MUST have comprehensive error handling.** This is not optional. This is not "nice to have". This is mandatory.

### The Four Pillars — ALL FOUR REQUIRED ON EVERY ERROR

| Pillar | Requirement | Implementation |
|--------|-------------|----------------|
| **1. Error Log** | Every error MUST be logged to `error_logs` collection | Call `logError()` — no silent failures |
| **2. Error Type** | Every error MUST map to a defined error code | Use `ERROR_CODES` from `error-codes.ts` |
| **3. Correlation ID** | Every error MUST have a unique correlation ID | Use `generateCorrelationId()` or `generateClientCorrelationId()` |
| **4. Selectable Display** | Every error shown to users MUST have copy-pasteable text | User must be able to select and copy the error code + correlation ID |

### Before You Write ANY Code

Ask yourself:
- What can fail here?
- What error code will I use?
- How will the user copy the error details?
- Is the error being logged?

If you cannot answer ALL FOUR questions, **stop and add error handling first**.

### Minimum Error Handling Template

**For API Routes / Server Actions:**
```typescript
import { ERROR_CODES, generateCorrelationId } from '@/lib/error-codes';
import { logError } from '@/lib/firebase-admin';

const correlationId = generateCorrelationId();
try {
  // Your code here
} catch (error) {
  await logError({
    correlationId,
    error,
    errorCode: ERROR_CODES.RELEVANT_CODE.code,
    context: { route: '/api/your-route', userId, action: 'what-you-were-doing' }
  });

  return NextResponse.json({
    success: false,
    error: ERROR_CODES.RELEVANT_CODE.message,
    errorCode: ERROR_CODES.RELEVANT_CODE.code,
    correlationId,  // MUST be included for user to copy
  }, { status: 500 });
}
```

**For React Components / Client-Side:**
```typescript
import { ERROR_CODES, generateClientCorrelationId } from '@/lib/error-codes';

try {
  // Your code here
} catch (error) {
  const correlationId = generateClientCorrelationId();

  // Log to server (fire-and-forget is acceptable)
  fetch('/api/log-error', {
    method: 'POST',
    body: JSON.stringify({ correlationId, error: error.message, errorCode: ERROR_CODES.RELEVANT_CODE.code })
  });

  // Display with SELECTABLE text — user MUST be able to copy this
  toast({
    variant: "destructive",
    title: ,
    description: (
      <span className="select-all cursor-text">
        {error.message} — Ref: {correlationId}
      </span>
    ),
  });
}
```
### What Selectable Display Means

The error message shown to users MUST allow them to:
1. Click/tap on the error text
2. Select (highlight) the error code and correlation ID
3. Copy to clipboard (Ctrl+C / Cmd+C / long-press)
4. Paste into WhatsApp or email to report the issue

**Acceptable implementations:**
- `<span className="select-all cursor-text">` — makes entire span selectable on click
- `<code>` or `<pre>` elements — naturally selectable
- Copy button next to the error — explicit copy action

**NOT acceptable:**
- Error codes only in console logs
- Correlation IDs not shown to user
- Non-selectable toast messages

### Compliance Check

- [ ] Every `try` block has a corresponding `catch` with full error handling
- [ ] Every `catch` generates or uses a correlation ID
- [ ] Every `catch` maps to an `ERROR_CODES` entry
- [ ] Every user-facing error displays selectable text with code + correlation ID
- [ ] Every error is logged via `logError()` or equivalent API call

**If ANY checkbox fails, the code is not ready for commit.**

---

##  GOLDEN RULE #2: Version Discipline

**Every commit MUST bump the version number. Every push to main MUST be verified for build success and version consistency.**

### Version Bump Requirements

| When | Action Required |
|------|-----------------|
| **Every commit** | Bump PATCH version minimum (e.g., 1.17.0 — 1.17.1) |
| **New feature** | Bump MINOR version (e.g., 1.17.1 — 1.18.0) |
| **Breaking change** | Bump MAJOR version (e.g., 1.18.0 — 2.0.0) |

### Files That MUST Be Updated Together

Both files MUST show the same version number — always update them as a pair:

1. `app/package.json` — the `"version"` field
2. `app/src/lib/version.ts` — the `APP_VERSION` constant

**Never update one without the other.**

### Post-Push Verification — MANDATORY

After every push to `main`, you MUST:

1. **Wait for build completion** (~3-5 minutes)
2. **Check build logs for success:**
```powershell
powershell -Command "& 'C:Program Files (x86)GoogleCloud SDKgoogle-cloud-sdkingcloud.cmd' logging read 'resource.type="build"' --project=studio-6033436327-281b1 --limit=20 --freshness=15m --format='value(textPayload)'"
```
3. **Verify version consistency across all pages:**

| Page | URL | What to Check |
|------|-----|---------------|
| About | https://prix6.win/about | Version number displayed |
| Login | https://prix6.win/login | Version number in footer/corner |

4. **Confirm all pages show IDENTICAL version numbers**

### Version Verification Checklist

- [ ] Build logs show `DONE` status
- [ ] About page shows correct version
- [ ] Login page shows correct version
- [ ] Both pages show IDENTICAL version
- [ ] Version matches what's in `package.json` and `version.ts`

**A push is NOT complete until all boxes are checked.**

---
##  GOLDEN RULE #3: Single Source of Truth

**Data MUST have exactly one authoritative source. If technical constraints require duplication, the Consistency Checker MUST validate synchronisation.**

### The Principle

Every piece of data in the system must have ONE canonical location. All other usages must either:
- **Reference** the source (preferred), OR
- **Duplicate with mandatory sync validation** (when technically unavoidable)

### Prohibited Patterns

| Don't Do This | Do This Instead |
|------------------|-------------------|
| Store user email in Firestore AND Firebase Auth independently | Firebase Auth is the source; Firestore references or caches with sync check |
| Store driver names in multiple collections | Single `drivers` collection; other collections reference by ID |
| Hardcode values that exist in the database | Read from database or use constants file as single source |
| Store calculated values that can be derived | Calculate on read, or cache with clear invalidation rules |

### Firebase Auth vs Firestore — CRITICAL

| Data Field | Authoritative Source | Duplication Rules |
|------------|---------------------|-------------------|
| Email | Firebase Auth | If cached in Firestore, CC MUST verify match |
| Display Name | Firebase Auth | If cached in Firestore, CC MUST verify match |
| UID | Firebase Auth | Firestore documents keyed by UID — this is a reference, not duplication |
| User preferences | Firestore | NOT in Firebase Auth |
| Team memberships | Firestore | NOT in Firebase Auth |

### Consistency Checker Requirements

The CC (`/app/src/components/admin/ConsistencyChecker.tsx`) MUST include validations for:

| Check | What It Validates |
|-------|-------------------|
| `auth-firestore-email-sync` | User email in Firebase Auth matches email in Firestore users collection |
| `auth-firestore-name-sync` | Display name in Firebase Auth matches name in Firestore (if stored) |
| `driver-reference-integrity` | All driver IDs referenced in teams/predictions exist in drivers collection |
| `track-reference-integrity` | All track IDs referenced in races exist in tracks collection |

### Compliance Checklist

- [ ] New data fields have exactly one source of truth
- [ ] Any duplication is documented with justification
- [ ] Any duplication has a corresponding CC validation
- [ ] References use IDs, not copied values
- [ ] Firebase Auth data is not independently stored in Firestore without sync checks

---

##  GOLDEN RULE #4: Identity Prefix

**EVERY response you give MUST start with your assigned name prefix. No exceptions.**

| If you are | Your prefix | Example |
|------------|-------------|---------|
| First instance (Bill) | `bill> ` | `bill> I've updated the file...` |
| Second instance (Bob) | `bob> ` | `bob> The build completed...` |
| Third instance (Ben) | `ben> ` | `ben> I've reviewed the backup system...` |

### Correct Examples

```
bob> I've reviewed the error handling and it follows Golden Rule #1.

bob> Version bumped to 1.30.1 in both package.json and version.ts.

bob> Build 1.30.1 deployed at 20:21 successfully. About page and Login page both show 1.30.1.
```

### WRONG — Never Do This

```
I've reviewed the error handling...     — WRONG: No prefix

Sure, I can help with that...           — WRONG: No prefix

The build completed successfully.       — WRONG: No prefix
```

### Mid-Session Self-Check

**Every 5 responses, mentally verify: "Am I still using my prefix?"**

If you catch yourself without it:
1. Immediately correct by adding the prefix
2. Apologise: `bob> Apologies — I dropped my prefix. Correcting now.`

---
##  GOLDEN RULE #5: Verbose Confirmations

**When completing key actions, you MUST provide explicit, timestamped confirmations. No vague "done" or "completed" messages.**

### Required Confirmation Formats

| Action | Required Confirmation Format |
|--------|------------------------------|
| Version bump | `bob> Version bumped to 1.30.1 in both package.json and version.ts.` |
| Commit | `bob> Committed: "feat: add deadline warnings" (1.30.1)` |
| Push to main | `bob> Pushed 1.30.1 to main. Monitoring build...` |
| Build success | `bob> Build 1.30.1 deployed at 20:21 successfully.` |
| Version verified | `bob> Version check: About page = 1.30.1, Login page = 1.30.1. Match confirmed.` |
| Build failure | `bob> Build 1.30.1 FAILED at 20:25. Error: [specific error]. Investigating...` |
| File claimed | `bob> Claimed /app/src/components/Scoring.tsx — now in my NO-TOUCH ZONE.` |
| File released | `bob> Released /app/src/components/Scoring.tsx — available for others.` |

### Full Deployment Confirmation Sequence

```
bob> Pushed 1.30.1 to main at 20:15. Monitoring build...

[after checking build logs]

bob> Build 1.30.1 completed at 20:21 (6 min build time). Verifying deployment...

[after checking pages]

bob> Deployment verified:
     - Build status: SUCCESS
     - About page: 1.30.1
     - Login page: 1.30.1
     - All versions match. Deployment complete.
```

### WRONG — Never Do This

```
bob> Done.                              — WRONG: What's done? What version?

bob> Build finished.                    — WRONG: Success or failure? What version?

bob> I've updated the version.          — WRONG: To what number? In which files?

bob> Pushed the changes.                — WRONG: What version? To which branch?
```

---

##  GOLDEN RULE #6: GUID Documentation Discipline

**Every code change MUST respect and maintain the GUID commenting system. Read existing comments before modifying code. Update GUID versions and remarks when logic changes. Update `code.json` to reflect all GUID additions and changes.**

### Before Modifying ANY Code

1. **Read the GUID comments** on the code block you're about to change
2. **Understand the three fields:**
   - `[Intent]` — why this code exists
   - `[Inbound Trigger]` — what causes it to execute
   - `[Downstream Impact]` — what breaks if this code changes
3. **Consider the downstream impact** — if the comment says "X depends on this", check X before changing

### When Changing Existing Code

| What Changed | Required Action |
|-------------|----------------|
| Logic changed (behaviour differs) | Increment GUID version (e.g., v03 — v04), update all three remark fields, update `code.json` |
| Refactored but same behaviour | Increment GUID version, update remarks to reflect new structure |
| Deleted code | Remove GUID from `code.json`, remove from other GUIDs' dependency lists |
| Moved code to different file | Update GUID remarks with new location, update `code.json` |

### When Adding New Code

Every new logical block MUST have:

```
// GUID: [MODULE_NAME]-[SEQ]-v03
// [Intent] Why this code exists.
// [Inbound Trigger] What causes this code to execute.
// [Downstream Impact] What depends on this code or what breaks if it changes.
```

- Use the module naming convention from the file
- Start at v03 (Fully Audited) for new code where you know the business logic
- Add a corresponding entry to `code.json`

### Updating code.json

The manifest at `code.json` MUST stay in sync with code comments:

- **New GUID** — Add entry with guid, version, logic_category, description, dependencies
- **Changed GUID** — Increment version number, update description if behaviour changed
- **Removed GUID** — Delete entry, remove from all dependency arrays
- **logic_category** must be one of: `VALIDATION`, `TRANSFORMATION`, `ORCHESTRATION`, `RECOVERY`

### Compliance Checklist

- [ ] All modified code blocks have updated GUID versions and remarks
- [ ] All new code blocks have GUID comments with all three fields
- [ ] `code.json` reflects all GUID additions, changes, and deletions
- [ ] Dependency arrays in `code.json` are accurate (no stale references)
- [ ] No GUID comments describe behaviour that no longer matches the code

---
##  GOLDEN RULE #7: Registry-Sourced Errors

**Every error MUST be created from the error registry. No exceptions.**

### The Four Diagnostic Questions

Every error log MUST answer automatically:

| # | Question | Answered By |
|---|----------|-------------|
| 1 | **Where did it fail?** | `file` + `functionName` + `correlationId` |
| 2 | **What was it trying to do?** | `message` + `context` |
| 3 | **Known failure modes?** | `recovery` + `failureModes` |
| 4 | **Who triggered it?** | `calledBy` + `calls` + `context` |

### Required Pattern

```typescript
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

const traced = createTracedError(ERRORS.SMOKE_TEST_FAILED, {
  correlationId,
  context: { importPath, backupDate }
});
await logTracedError(traced, db);
throw traced;
```

### Forbidden Patterns

```typescript
// NEVER hardcode error codes
throw new Error('PX-7004: Smoke test failed');

// NEVER manually construct metadata
logError('PX-7004', 'Smoke test failed', context);

// NEVER log without registry
console.error('[BACKUP_FUNCTIONS-026]', error);
```

### Adding New Errors

1. Add to `errorProfile.emits` in `code.json`
2. Run `npx tsx scripts/generate-error-registry.ts` from the `app/` directory
3. Import `ERRORS.NEW_ERROR_KEY` from `@/lib/error-registry`
4. **Never skip the generation step**

### Lookup Protocol

| User Says | Lookup Type | Where to Look |
|-----------|-------------|---------------|
| "PX-7004" | Error code | `code-index.json` — `byErrorCode["PX-7004"]` |
| "smoke test error" | Topic | `code-index.json` — `byTopic["smoke"]` |
| "BACKUP_FUNCTIONS-026" | GUID | `code.json` — find GUID entry |
| "error in scoring.ts" | File | `code-index.json` — `byFile["app/src/lib/scoring.ts"]` |

1. Check `code-index.json` **FIRST** (instant lookup)
2. Answer the four diagnostic questions
3. Report: GUID — File — Function — Recovery
4. **Never grep blindly** — use the registry

### Compliance Checklist

- [ ] Error is created via `createTracedError(ERRORS.KEY)` — not hardcoded
- [ ] Error is logged via `logTracedError()` — not manual console.error
- [ ] Error code comes from `error-registry.ts` — not inline string
- [ ] Error includes correlation ID and context
- [ ] `error-registry.ts` was regenerated if `code.json` errorProfile changed

---
##  GOLDEN RULE #8: Prompt Identity Enforcement

**The "who" check. When the user says "who", you MUST verify your prompt prefix is correct. If it is not — or was not — log a violation to Vestige memory. No exceptions.**

### The Rule

Every agent that has checked in via `claude-sync.js checkin` MUST prefix ALL responses with their assigned name (e.g. `bill>`, `bob>`, `ben>`). Rule #8 adds **enforcement and accountability**.

### The "who" Check

When the user says **"who"**:

1. **Check:** Am I currently using the correct prompt prefix?
2. **Check:** Have I been using it consistently since checkin — or did I have to be corrected?
3. **If either check fails:** Log a violation to Vestige memory immediately

### Violation Logging — MANDATORY

Every violation MUST be logged to Vestige memory with:

| Field | Example |
|-------|---------|
| **Agent name** | Bill |
| **Date/time** | 2026-01-31 17:30 UTC |
| **Violation number** | #1 (incrementing counter per agent) |
| **What happened** | Didn't use `bill>` prefix after checkin |
| **Reason why** | Treated checkin output as informational instead of a directive |

Use `mcp__vestige__smart_ingest` with tags `["prompt-violation", "<agent-name>", "golden-rule-8", "counter", "prixsix"]`.

### Scorekeeping

Maintain a running tally across sessions:
- `Bill = N violations`
- `Bob = N violations`
- `Ben = N violations`

When logging a new violation, recall the previous count first via `mcp__vestige__recall` with query `"prompt identity violation"`, increment, and store the updated tally.

### Honesty During "who" Check

**Do NOT claim "no violation" if you had to be corrected during the session.** The "who" check must be honest — it covers the entire session, not just the current message. Falsely reporting "no violation" is itself a violation.

---

##  GOLDEN RULE #9: Shell Preference

**When executing commands, prioritize shell selection in this order: PowerShell — CMD — bash. Only use bash when PowerShell and CMD cannot accomplish the task.**

### Shell Priority

| Shell | Use For | Examples |
|-------|---------|----------|
| **PowerShell** | Most operations, Azure CLI, gcloud CLI, git, npm | `Get-Content`, `az containerapp logs`, `gcloud logging read` |
| **CMD** | Legacy batch scripts, simple commands when PowerShell escaping is problematic | `dir`, `copy`, basic git commands |
| **bash** | Unix-specific tools, complex piping that requires Unix semantics | `grep` with complex regex, `find` (though prefer Glob tool) |

### Tool Preference Over bash

Before reaching for bash, check if a specialized tool can accomplish the task:
- **File search** — Use `Glob` tool (not `find` or `ls`)
- **Content search** — Use `Grep` tool (not `grep` or `rg`)
- **Read files** — Use `Read` tool (not `cat`/`head`/`tail`)
- **Edit files** — Use `Edit` tool (not `sed`/`awk`)
- **Write files** — Use `Write` tool (not `echo >`/`cat <<EOF`)

---
##  GOLDEN RULE #10: Dependency Update Discipline

**Any dependency that is discovered or encountered during a bug fix or feature build MUST be checked for available updates.**

### What Counts as Encountered

| Scenario | Action Required |
|----------|-----------------|
| Import statement in code you're modifying | Check that package for updates |
| Error message mentioning a package | Check that package for updates |
| Using a CLI tool (gcloud, az, npm, etc.) | Check tool version vs latest |
| Debugging an issue caused by a library | Check for bug fixes in newer versions |
| Adding a new dependency | Already checking latest — this is standard |

### How to Check for Updates

```powershell
cd E:GoogleDrivePapers-PrixSix.Currentapp
npm outdated
```

**For a specific package:**
```powershell
npm show <package-name> version
npm show <package-name>@latest version
```

### When NOT to Update

Acceptable reasons to defer:
- **Breaking changes** require significant refactoring (document in issue/comment)
- **Major version jump** needs dedicated testing effort (create follow-up task)
- **Security audit required** for new version (enterprise/compliance constraint)
- **Dependency conflict** with other packages (needs resolution plan)

**Never defer for:**
- "It works, why change it?" (technical debt accumulation)
- "Too busy" (compounds future maintenance burden)
- Security patches (MUST update unless breaking changes require emergency workaround)

### Reporting Updates in Commit Messages

```
feat: improve error handling in auth flow

- Updated firebase-admin 11.5.0 — 12.0.0
- Updated express 4.18.2 — 4.19.2 (security patch CVE-2024-xxxx)
- Deferred @google-cloud/firestore 7.1.0 — 8.0.0 (breaking: query syntax changes)
```

### Compliance Checklist

- [ ] Identified all dependencies touched by this work
- [ ] Checked each dependency for available updates
- [ ] Updated dependencies OR documented reason to defer
- [ ] Tested that updates don't break existing functionality
- [ ] Included dependency changes in commit message if updated

---
##  GOLDEN RULE #11: Pre-Commit Security Review

**Before EVERY commit, you MUST perform threat modeling on all code changes. Ask how the change could be exploited, circumvented, or compromised. This is mandatory — no exceptions.**

### The Five Mandatory Questions

Before every commit, you MUST ask and answer:

| # | Question | What to Look For |
|---|----------|------------------|
| 1 | **How could this be exploited?** | Input validation bypass, injection attacks, authentication bypass, information disclosure |
| 2 | **How can this be circumvented?** | Client-side checks only, missing server validation, race conditions, timing attacks |
| 3 | **Is it secure?** | Credentials exposure, weak randomness, missing authorization, unencrypted sensitive data |
| 4 | **How would I get around this security?** | Privilege escalation paths, token/session hijacking, direct API calls bypassing UI logic |
| 5 | **What's the worst case if this fails?** | Data breach, account takeover, system compromise, financial loss, reputation damage |

### Attack Vectors to Always Consider

| Threat Category | What to Check |
|----------------|---------------|
| **Authentication Bypass** | Can auth be skipped? Are credentials properly validated server-side? |
| **Authorization Bypass** | Can users access data/functions they shouldn't? Are permissions checked server-side? |
| **Privilege Escalation** | Can a regular user gain admin rights? Are role checks in Firestore rules? |
| **Client-Side Manipulation** | Are critical checks only on client? Can API be called directly? |
| **Injection Attacks** | SQL/NoSQL injection, XSS, HTML injection, command injection in user inputs |
| **Credential Exposure** | Are secrets in code? Logged in plaintext? Stored unencrypted? |
| **Weak Randomness** | Using Math.random() for security? Modulo bias in token generation? |
| **Rate Limiting** | Can endpoint be spammed? DoS/DoW attack vectors? |
| **Data Leakage** | PII in logs? Sensitive data in error messages? Debug info in production? |
| **Session Security** | Token expiry? Session fixation? CSRF protection? |

### Documentation Requirements

After completing security review, you MUST:

1. **Log to Vestige Memory** using this format:

```
Pre-Commit Security Review - [Timestamp]

Files Changed: [list]
Commit: [description]

Security Analysis:
1. Exploitation vectors considered: [list]
2. Circumvention attempts analyzed: [list]
3. Security controls validated: [list]
4. Attack scenarios tested: [list]

Threats Identified:
- [Threat 1]: Mitigated by [control]
- [Threat 2]: Mitigated by [control]
- [Accepted Risk]: [justification]

Result: Security review complete. Code ready for commit.
```

2. **Update code.json** with security-relevant remarks in GUID comments

### Compliance Checklist

- [ ] All 5 security questions asked and answered
- [ ] Attack vectors specific to this change identified
- [ ] Client-side security checks verified to have server-side enforcement
- [ ] No credentials, secrets, or PII exposed in code or logs
- [ ] Authorization checks present for privileged operations
- [ ] Input validation on all user-controlled data
- [ ] Security review logged to Vestige memory with timestamp
- [ ] code.json updated with security-relevant remarks

**If ANY checkbox fails, the code is not ready for commit.**

### Rationale

The plaintext PIN storage vulnerability (missed in initial review, caught by Gemini) demonstrates why this rule is mandatory. Reactive security fails — proactive threat modeling prevents. Thinking "how would I steal credentials?" before commit would have caught it.

---

*See also: `CLAUDE.md` for the one-line summaries of all 11 rules.*
