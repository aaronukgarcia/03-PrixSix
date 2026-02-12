# CLAUDE.md - Prix Six Project Brief

> **Last updated:** 2026-02-12  (MCP versions updated)
> **Current production version:** Check `package.json` and verify at https://prix6.win/about
> **Read this entire file at the start of every session.**

---

## ⚠️ GOLDEN RULES — INVIOLABLE, NON-NEGOTIABLE

These rules MUST be followed on every piece of code written and every response given. No exceptions. No shortcuts. Ever.

| Rule | Summary |
|------|---------|
| #1 | Aggressive Error Trapping — log, type, correlation ID, selectable display |
| #2 | Version Discipline — bump on every commit, verify after every push |
| #3 | Single Source of Truth — no duplication without CC validation |
| #4 | Identity Prefix — every response starts with `bob>` or `bill>` |
| #5 | Verbose Confirmations — explicit, timestamped, version-numbered confirmations |
| #6 | GUID Documentation — read comments before changing code, update GUID versions and code.json |
| #7 | Registry-Sourced Errors — every error MUST be created from the error registry, no exceptions |
| #8 | Prompt Identity Enforcement — "who" check, violation logging to Vestige memory, scorekeeping |
| #9 | Shell Preference — Microsoft PowerShell first, then CMD, then bash if needed |
| #10 | Dependency Update Discipline — check for updates on any dependency encountered during bug fixes or feature builds |
| #11 | Pre-Commit Security Review — mandatory security threat modeling before every commit |

### 🛑 GOLDEN RULE #1: Aggressive Error Trapping

**Every function, API call, database operation, or async action MUST have comprehensive error handling.** This is not optional. This is not "nice to have". This is mandatory.

#### The Four Pillars — ALL FOUR REQUIRED ON EVERY ERROR

| Pillar | Requirement | Implementation |
|--------|-------------|----------------|
| **1. Error Log** | Every error MUST be logged to `error_logs` collection | Call `logError()` — no silent failures |
| **2. Error Type** | Every error MUST map to a defined error code | Use `ERROR_CODES` from `error-codes.ts` |
| **3. Correlation ID** | Every error MUST have a unique correlation ID | Use `generateCorrelationId()` or `generateClientCorrelationId()` |
| **4. Selectable Display** | Every error shown to users MUST have copy-pasteable text | User must be able to select and copy the error code + correlation ID |

#### Before You Write ANY Code

Ask yourself:
- ❓ What can fail here?
- ❓ What error code will I use?
- ❓ How will the user copy the error details?
- ❓ Is the error being logged?

If you cannot answer ALL FOUR questions, **stop and add error handling first**.

#### Minimum Error Handling Template

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
    title: `Error ${ERROR_CODES.RELEVANT_CODE.code}`,
    description: (
      <span className="select-all cursor-text">
        {error.message} — Ref: {correlationId}
      </span>
    ),
  });
}
```

#### What "Selectable Display" Means

The error message shown to users MUST allow them to:
1. Click/tap on the error text
2. Select (highlight) the error code and correlation ID
3. Copy to clipboard (Ctrl+C / Cmd+C / long-press)
4. Paste into WhatsApp or email to report the issue

**Acceptable implementations:**
- `<span className="select-all cursor-text">` — makes entire span selectable on click
- `<code>` or `<pre>` elements — naturally selectable
- Copy button next to the error — explicit copy action
- Toast with selectable description text

**NOT acceptable:**
- Error codes only in console logs
- Correlation IDs not shown to user
- Non-selectable toast messages
- Screenshots as the only way to report errors

#### Compliance Check

When reviewing code (your own or PRs), verify:

- [ ] Every `try` block has a corresponding `catch` with full error handling
- [ ] Every `catch` generates or uses a correlation ID
- [ ] Every `catch` maps to an `ERROR_CODES` entry
- [ ] Every user-facing error displays selectable text with code + correlation ID
- [ ] Every error is logged via `logError()` or equivalent API call

**If ANY checkbox fails, the code is not ready for commit.**

---

### 🛑 GOLDEN RULE #2: Version Discipline

**Every commit MUST bump the version number. Every push to main MUST be verified for build success and version consistency.**

#### Version Bump Requirements

| When | Action Required |
|------|-----------------|
| **Every commit** | Bump PATCH version minimum (e.g., 1.17.0 → 1.17.1) |
| **New feature** | Bump MINOR version (e.g., 1.17.1 → 1.18.0) |
| **Breaking change** | Bump MAJOR version (e.g., 1.18.0 → 2.0.0) |

#### Files That MUST Be Updated Together

Both files MUST show the same version number — always update them as a pair:

1. `app/package.json` — the `"version"` field
2. `app/src/lib/version.ts` — the `APP_VERSION` constant

**Never update one without the other.**

#### Post-Push Verification — MANDATORY

After every push to `main`, you MUST:

1. **Wait for build completion** (~3-5 minutes)
2. **Check build logs for success:**
   ```powershell
   powershell -Command "& 'C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' logging read 'resource.type=\"build\"' --project=studio-6033436327-281b1 --limit=20 --freshness=15m --format='value(textPayload)'"
   ```
3. **Verify version consistency across all pages:**

| Page | URL | What to Check |
|------|-----|---------------|
| About | https://prix6.win/about | Version number displayed |
| Login | https://prix6.win/login | Version number in footer/corner |

4. **Confirm all pages show IDENTICAL version numbers**

#### If Versions Don't Match

This indicates a build failure or caching issue:
1. Hard refresh the pages (Ctrl+Shift+R)
2. Check build logs for errors
3. If still mismatched, investigate which file wasn't updated
4. Fix and push a correction commit

#### Version Verification Checklist

Before marking a push as "complete", verify:

- [ ] Build logs show `DONE` status
- [ ] About page shows correct version
- [ ] Login page shows correct version
- [ ] Both pages show IDENTICAL version
- [ ] Version matches what's in `package.json` and `version.ts`

**A push is NOT complete until all boxes are checked.**

---

### 🛑 GOLDEN RULE #3: Single Source of Truth

**Data MUST have exactly one authoritative source. If technical constraints require duplication, the Consistency Checker MUST validate synchronisation.**

#### The Principle

Every piece of data in the system must have ONE canonical location. All other usages must either:
- **Reference** the source (preferred), OR
- **Duplicate with mandatory sync validation** (when technically unavoidable)

#### Prohibited Patterns

| ❌ Don't Do This | ✅ Do This Instead |
|------------------|-------------------|
| Store user email in Firestore AND Firebase Auth independently | Firebase Auth is the source; Firestore references or caches with sync check |
| Store driver names in multiple collections | Single `drivers` collection; other collections reference by ID |
| Hardcode values that exist in the database | Read from database or use constants file as single source |
| Store calculated values that can be derived | Calculate on read, or cache with clear invalidation rules |

#### Firebase Auth vs Firestore — CRITICAL

Firebase Auth and Firestore are separate systems. When user data exists in both:

| Data Field | Authoritative Source | Duplication Rules |
|------------|---------------------|-------------------|
| Email | Firebase Auth | If cached in Firestore, CC MUST verify match |
| Display Name | Firebase Auth | If cached in Firestore, CC MUST verify match |
| UID | Firebase Auth | Firestore documents keyed by UID — this is a reference, not duplication |
| User preferences | Firestore | NOT in Firebase Auth |
| Team memberships | Firestore | NOT in Firebase Auth |

#### When Duplication Is Unavoidable

Sometimes technical constraints force duplication (e.g., Firestore queries need denormalised data). In these cases:

1. **Document the duplication** — Add a comment explaining why it's necessary
2. **Identify the source of truth** — Which system "wins" if they disagree?
3. **Add a Consistency Checker validation** — The CC MUST flag mismatches

#### Consistency Checker Requirements

The CC (`/app/src/components/admin/ConsistencyChecker.tsx`) MUST include validations for:

| Check | What It Validates |
|-------|-------------------|
| `auth-firestore-email-sync` | User email in Firebase Auth matches email in Firestore users collection |
| `auth-firestore-name-sync` | Display name in Firebase Auth matches name in Firestore (if stored) |
| `driver-reference-integrity` | All driver IDs referenced in teams/predictions exist in drivers collection |
| `track-reference-integrity` | All track IDs referenced in races exist in tracks collection |

#### Adding New Data — Decision Tree

Before adding any new data field, ask:

```
Does this data already exist somewhere?
├── YES → Reference it, don't duplicate
│         └── Can't reference due to technical constraint?
│             └── Add CC validation for sync
└── NO → Add to ONE location only
         └── Document where it lives in CLAUDE.md if it's a key entity
```

#### Compliance Checklist

When reviewing code that involves data:

- [ ] New data fields have exactly one source of truth
- [ ] Any duplication is documented with justification
- [ ] Any duplication has a corresponding CC validation
- [ ] References use IDs, not copied values
- [ ] Firebase Auth data is not independently stored in Firestore without sync checks

**If ANY checkbox fails, the code violates Single Source of Truth.**

---

## 🚨 MANDATORY: Session Coordination Protocol

### Session Start — ALWAYS do this first

**Step 1:** Check in to get your name assignment:
```bash
node claude-sync.js checkin
```

This will:
- Assign you **Bob** (if you're first) or **Bill** (if second)
- Register your session with a timestamp
- Show you how to prefix your responses

**Step 2:** Complete these checks:
1. Run `git status` and confirm your branch
2. Run `git pull` to get latest changes
3. Run `node claude-sync.js read` to review the coordination state

**Step 3:** Announce yourself with your assigned name:
```
bob> Good morning, I'm Bob on branch main. No conflicts detected.
```
or
```
bill> Good morning, I'm Bill on branch feature/xyz. No conflicts detected.
```

---

### 🛑 GOLDEN RULE #4: Identity Prefix — EVERY SINGLE RESPONSE

> **THIS IS NON-NEGOTIABLE. YOU MUST DO THIS. EVERY. SINGLE. TIME.**

**EVERY response you give MUST start with your assigned name prefix:**

| If you are | Your prefix | Example |
|------------|-------------|---------|
| First instance | `bob> ` | `bob> I've updated the file...` |
| Second instance | `bill> ` | `bill> The build completed...` |
| Third instance | `ben> ` | `ben> I've reviewed the backup system...` |

#### Why This Matters

Aaron often has two Claude Code instances running simultaneously. Without the prefix, he cannot tell which instance is responding. This causes confusion, wasted time, and potential conflicts.

#### Correct Examples

```
bob> I've reviewed the error handling and it follows Golden Rule #1.

bob> Version bumped to 1.30.1 in both package.json and version.ts.

bob> Build 1.30.1 deployed at 20:21 successfully. About page and Login page both show 1.30.1.
```

#### WRONG — Never Do This

```
I've reviewed the error handling...     ← WRONG: No prefix

Sure, I can help with that...           ← WRONG: No prefix

The build completed successfully.       ← WRONG: No prefix
```

#### Self-Check Before Every Response

Before sending ANY response, ask yourself:
- ❓ Does my response start with `bob> `, `bill> `, or `ben> `?
- ❓ If NO, add it NOW before sending

**If you forget your assignment, run `node claude-sync.js read` to check.**

#### Mid-Session Self-Check

**Every 5 responses, mentally verify: "Am I still using my prefix?"**

If you catch yourself without it:
1. Immediately correct by adding the prefix
2. Apologise: `bob> Apologies — I dropped my prefix. Correcting now. [continue with response]`

This drift is common in long sessions. Stay vigilant.

---

### 🛑 GOLDEN RULE #5: Verbose Confirmations

**When completing key actions, you MUST provide explicit, timestamped confirmations. No vague "done" or "completed" messages.**

#### Required Confirmation Formats

| Action | Required Confirmation Format |
|--------|------------------------------|
| Version bump | `bob> Version bumped to 1.30.1 in both package.json and version.ts.` |
| Commit | `bob> Committed: "feat: add deadline warnings" (1.30.1)` |
| Push to main | `bob> Pushed 1.30.1 to main. Monitoring build...` |
| Build success | `bob> Build 1.30.1 deployed at 20:21 successfully.` |
| Version verified | `bob> Version check: About page = 1.30.1, Login page = 1.30.1. ✓ Match confirmed.` |
| Build failure | `bob> ⚠️ Build 1.30.1 FAILED at 20:25. Error: [specific error]. Investigating...` |
| File claimed | `bob> Claimed /app/src/components/Scoring.tsx — now in my NO-TOUCH ZONE.` |
| File released | `bob> Released /app/src/components/Scoring.tsx — available for others.` |

#### Full Deployment Confirmation Sequence

After pushing to main, provide this full sequence:

```
bob> Pushed 1.30.1 to main at 20:15. Monitoring build...

[after checking build logs]

bob> Build 1.30.1 completed at 20:21 (6 min build time). Verifying deployment...

[after checking pages]

bob> ✓ Deployment verified:
     - Build status: SUCCESS
     - About page: 1.30.1
     - Login page: 1.30.1
     - All versions match. Deployment complete.
```

#### Why Verbose Confirmations Matter

- Aaron can quickly scan responses to confirm actions completed
- Timestamps help track when things happened
- Version numbers in every confirmation prevent confusion
- Explicit "match confirmed" removes ambiguity

#### WRONG — Never Do This

```
bob> Done.                              ← WRONG: What's done? What version?

bob> Build finished.                    ← WRONG: Success or failure? What version?

bob> I've updated the version.          ← WRONG: To what number? In which files?

bob> Pushed the changes.                ← WRONG: What version? To which branch?
```

---

### 🛑 GOLDEN RULE #6: GUID Documentation Discipline

**Every code change MUST respect and maintain the GUID commenting system. Read existing comments before modifying code. Update GUID versions and remarks when logic changes. Update `code.json` to reflect all GUID additions and changes.**

#### Before Modifying ANY Code

1. **Read the GUID comments** on the code block you're about to change
2. **Understand the three fields:**
   - `[Intent]` — why this code exists
   - `[Inbound Trigger]` — what causes it to execute
   - `[Downstream Impact]` — what breaks if this code changes
3. **Consider the downstream impact** — if the comment says "X depends on this", check X before changing

If a code block has a GUID comment, **you MUST read and understand it before making changes.**

#### When Changing Existing Code

| What Changed | Required Action |
|-------------|----------------|
| Logic changed (behaviour differs) | Increment GUID version (e.g., v03 → v04), update all three remark fields, update `code.json` |
| Refactored but same behaviour | Increment GUID version, update remarks to reflect new structure |
| Deleted code | Remove GUID from `code.json`, remove from other GUIDs' dependency lists |
| Moved code to different file | Update GUID remarks with new location, update `code.json` |

#### When Adding New Code

Every new logical block (function, branch, class, component, rule, config section) MUST have:

```
// GUID: [MODULE_NAME]-[SEQ]-v03
// [Intent] Why this code exists.
// [Inbound Trigger] What causes this code to execute.
// [Downstream Impact] What depends on this code or what breaks if it changes.
```

- Use the module naming convention from the file (e.g., `BACKUP_FUNCTIONS-XXX` for functions/index.js)
- Start at v03 (Fully Audited) for new code where you know the business logic
- Add a corresponding entry to `code.json`

#### Updating `code.json`

The manifest at `code.json` MUST stay in sync with code comments:

- **New GUID →** Add entry with guid, version, logic_category, description, dependencies
- **Changed GUID →** Increment version number, update description if behaviour changed
- **Removed GUID →** Delete entry, remove from all dependency arrays
- **logic_category** must be one of: `VALIDATION`, `TRANSFORMATION`, `ORCHESTRATION`, `RECOVERY`

#### What NOT To Do

| ❌ Don't | ✅ Do |
|----------|------|
| Change code without reading its GUID remarks | Read [Intent] and [Downstream Impact] first |
| Leave stale GUID comments after changing logic | Update the remarks to match the new behaviour |
| Add code without GUID comments | Add GUID + [Intent] + [Inbound Trigger] + [Downstream Impact] |
| Update code GUIDs but forget `code.json` | Always update both together |
| Delete GUID comments without removing from `code.json` | Remove from both places |

#### Compliance Checklist

When reviewing code changes, verify:

- [ ] All modified code blocks have updated GUID versions and remarks
- [ ] All new code blocks have GUID comments with all three fields
- [ ] `code.json` reflects all GUID additions, changes, and deletions
- [ ] Dependency arrays in `code.json` are accurate (no stale references)
- [ ] No GUID comments describe behaviour that no longer matches the code

**If ANY checkbox fails, the code is not ready for commit.**

#### Reference

The full GUID commenting specification is in `AddComments.md`. Follow that format for all remarks.

---

### 🛑 GOLDEN RULE #7: Registry-Sourced Errors

**Every error MUST be created from the error registry. No exceptions.**

#### The Four Diagnostic Questions

Every error log MUST answer automatically:

| # | Question | Answered By |
|---|----------|-------------|
| 1 | **Where did it fail?** | `file` + `functionName` + `correlationId` |
| 2 | **What was it trying to do?** | `message` + `context` |
| 3 | **Known failure modes?** | `recovery` + `failureModes` |
| 4 | **Who triggered it?** | `calledBy` + `calls` + `context` |

#### Required Pattern

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

#### Forbidden Patterns

```typescript
// NEVER hardcode error codes
throw new Error('PX-7004: Smoke test failed');

// NEVER manually construct metadata
logError('PX-7004', 'Smoke test failed', context);

// NEVER log without registry
console.error('[BACKUP_FUNCTIONS-026]', error);
```

#### Adding New Errors

1. Add to `errorProfile.emits` in `code.json`
2. Run `npx tsx scripts/generate-error-registry.ts` from the `app/` directory
3. Import `ERRORS.NEW_ERROR_KEY` from `@/lib/error-registry`
4. **Never skip the generation step**

#### Lookup Protocol — When Investigating Errors

When investigating errors, always follow this sequence:

| User Says | Lookup Type | Where to Look |
|-----------|-------------|---------------|
| "PX-7004" | Error code | `code-index.json` → `byErrorCode["PX-7004"]` |
| "smoke test error" | Topic | `code-index.json` → `byTopic["smoke"]` |
| "BACKUP_FUNCTIONS-026" | GUID | `code.json` → find GUID entry |
| "error in scoring.ts" | File | `code-index.json` → `byFile["app/src/lib/scoring.ts"]` |

1. Check `code-index.json` **FIRST** (instant lookup)
2. Answer the four diagnostic questions
3. Report: GUID → File → Function → Recovery
4. **Never grep blindly** — use the registry

#### Compliance Checklist

When reviewing error handling code:

- [ ] Error is created via `createTracedError(ERRORS.KEY)` — not hardcoded
- [ ] Error is logged via `logTracedError()` — not manual console.error
- [ ] Error code comes from `error-registry.ts` — not inline string
- [ ] Error includes correlation ID and context
- [ ] `error-registry.ts` was regenerated if `code.json` errorProfile changed

**If ANY checkbox fails, the code is not ready for commit.**

---

### 🛑 GOLDEN RULE #8: Prompt Identity Enforcement

**The "who" check. When the user says "who", you MUST verify your prompt prefix is correct. If it is not — or was not — log a violation to Vestige memory. No exceptions.**

#### The Rule

Every agent that has checked in via `claude-sync.js checkin` MUST prefix ALL responses with their assigned name (e.g. `bill>`, `bob>`, `ben>`). This is already covered by Golden Rule #4. Rule #8 adds **enforcement and accountability**.

#### The "who" Check

When the user says **"who"**:

1. **Check:** Am I currently using the correct prompt prefix?
2. **Check:** Have I been using it consistently since checkin — or did I have to be corrected?
3. **If either check fails:** Log a violation to Vestige memory immediately

#### Violation Logging — MANDATORY

Every violation MUST be logged to Vestige memory with:

| Field | Example |
|-------|---------|
| **Agent name** | Bill |
| **Date/time** | 2026-01-31 17:30 UTC |
| **Violation number** | #1 (incrementing counter per agent) |
| **What happened** | Didn't use `bill>` prefix after checkin |
| **Reason why** | Treated checkin output as informational instead of a directive |

Use `mcp__vestige__smart_ingest` with tags `["prompt-violation", "<agent-name>", "golden-rule-8", "counter", "prixsix"]`.

#### Scorekeeping

Maintain a running tally across sessions:
- `Bill = N violations`
- `Bob = N violations`
- `Ben = N violations`

When logging a new violation, recall the previous count first via `mcp__vestige__recall` with query `"prompt identity violation"`, increment, and store the updated tally.

#### Honesty During "who" Check

**Do NOT claim "no violation" if you had to be corrected during the session.** The "who" check must be honest — it covers the entire session, not just the current message. Falsely reporting "no violation" is itself a violation.

#### Self-Check — Every Response

Before sending ANY response, verify:
- ❓ Does my response start with my assigned prefix?
- ❓ If NO, add it NOW and log a violation

This rule exists because agents consistently fail to follow Golden Rule #4 despite it being clearly documented. Rule #8 adds consequences.

---

### 🛑 GOLDEN RULE #9: Shell Preference

**When executing commands, prioritize shell selection in this order: PowerShell → CMD → bash. Only use bash when PowerShell and CMD cannot accomplish the task.**

#### The Rule

Windows is the primary development platform for Prix Six. Shell commands should respect the native Windows environment:

1. **First choice: PowerShell** — Use for most operations (file operations, Azure CLI, gcloud CLI, git)
2. **Second choice: CMD** — Use when PowerShell syntax is problematic or legacy batch scripts required
3. **Last resort: bash** — Only when the task genuinely requires Unix shell features unavailable in PowerShell/CMD

#### When to Use Each Shell

| Shell | Use For | Examples |
|-------|---------|----------|
| **PowerShell** | Most operations, Azure CLI, gcloud CLI, git, npm | `Get-Content`, `az containerapp logs`, `gcloud logging read` |
| **CMD** | Legacy batch scripts, simple commands when PowerShell escaping is problematic | `dir`, `copy`, basic git commands |
| **bash** | Unix-specific tools, complex piping that requires Unix semantics | `grep` with complex regex (though prefer Grep tool), `find` (though prefer Glob tool) |

#### Tool Preference Over bash

Before reaching for bash, check if a specialized tool can accomplish the task:
- **File search** → Use `Glob` tool (not `find` or `ls`)
- **Content search** → Use `Grep` tool (not `grep` or `rg`)
- **Read files** → Use `Read` tool (not `cat`/`head`/`tail`)
- **Edit files** → Use `Edit` tool (not `sed`/`awk`)
- **Write files** → Use `Write` tool (not `echo >`/`cat <<EOF`)

#### PowerShell Path Conventions

When using PowerShell with full paths:
- Use quotes around paths with spaces: `& "C:\Program Files\..."`
- Prefer forward slashes in JSON/config (avoid escaping): `"E:/GoogleDrive/..."`
- Use `&` operator for executing commands with paths

#### Rationale

- Windows native tools (PowerShell/CMD) have better integration with Windows APIs
- PowerShell provides rich object-oriented output vs bash text streams
- Avoids WSL/Git Bash dependency and PATH complexity
- Clearer intent when Unix features are genuinely needed

---

### 🛑 GOLDEN RULE #10: Dependency Update Discipline

**Any dependency that is discovered or encountered during a bug fix or feature build MUST be checked for available updates.**

#### The Rule

When working on bugs or features, if you interact with, import, or reference any external dependency:

1. **Check for updates** — Use `npm outdated`, package manager queries, or version check commands
2. **Review changelog** — Check for breaking changes, security fixes, or relevant improvements
3. **Consider updating** — If safe to do so (no breaking changes or acceptable effort to adapt), update the dependency
4. **Document the decision** — If you choose NOT to update, note the reason (e.g., "Breaking changes require auth refactor - defer to separate ticket")

#### What Counts as "Encountered"

| Scenario | Action Required |
|----------|-----------------|
| Import statement in code you're modifying | Check that package for updates |
| Error message mentioning a package | Check that package for updates |
| Using a CLI tool (gcloud, az, npm, etc.) | Check tool version vs latest |
| Debugging an issue caused by a library | Check for bug fixes in newer versions |
| Adding a new dependency | Already checking latest — this is standard |

#### How to Check for Updates

**For npm packages:**
```powershell
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current\app
npm outdated
```

**For specific package:**
```powershell
npm show <package-name> version
npm show <package-name>@latest version
```

**For global tools (Azure CLI, gcloud, etc.):**
```powershell
az version  # Check current
# Visit https://aka.ms/installazurecliwindows for latest

gcloud version  # Check current
# Visit https://cloud.google.com/sdk/docs/install for latest
```

#### When NOT to Update

Acceptable reasons to defer:
- **Breaking changes** require significant refactoring (document in issue/comment)
- **Major version jump** needs dedicated testing effort (create follow-up task)
- **Security audit required** for new version (enterprise/compliance constraint)
- **Dependency conflict** with other packages (needs resolution plan)

**Never defer for:**
- "It works, why change it?" (technical debt accumulation)
- "Too busy" (compounds future maintenance burden)
- Security patches (MUST update unless breaking changes require emergency workaround)

#### Reporting Updates

When you update a dependency, include in commit message:
```
feat: improve error handling in auth flow

- Updated firebase-admin 11.5.0 → 12.0.0
- Updated express 4.18.2 → 4.19.2 (security patch CVE-2024-xxxx)
- Deferred @google-cloud/firestore 7.1.0 → 8.0.0 (breaking: query syntax changes)
```

#### Rationale

- **Security:** Outdated dependencies are attack vectors
- **Bug fixes:** Many "mysterious" bugs are already fixed upstream
- **Technical debt:** Small, incremental updates easier than large version jumps
- **Maintenance cost:** Staying current reduces future migration effort
- **Best practices:** Dependency hygiene is a sign of mature engineering

#### Compliance Checklist

Before marking a bug fix or feature complete:

- [ ] Identified all dependencies touched by this work
- [ ] Checked each dependency for available updates
- [ ] Updated dependencies OR documented reason to defer
- [ ] Tested that updates don't break existing functionality
- [ ] Included dependency changes in commit message if updated

**If ANY checkbox fails without documented justification, the work is not ready for commit.**

---

### 🛑 GOLDEN RULE #11: Pre-Commit Security Review

**Before EVERY commit, you MUST perform threat modeling on all code changes. Ask how the change could be exploited, circumvented, or compromised. This is mandatory — no exceptions.**

#### The Rule

Security cannot be bolted on after the fact. Every bug fix, feature addition, or code change introduces potential attack vectors. Before committing ANY code:

1. **Threat Model the Change** — Analyze how an attacker could exploit this code
2. **Ask the Critical Questions** — Force yourself to think like an adversary
3. **Document Security Consideration** — Log to Vestige memory with commit timestamp
4. **Update code.json** — Ensure GUID documentation reflects security implications

#### The Five Mandatory Questions

Before every commit, you MUST ask and answer:

| # | Question | What to Look For |
|---|----------|------------------|
| 1 | **How could this be exploited?** | Input validation bypass, injection attacks, authentication bypass, information disclosure |
| 2 | **How can this be circumvented?** | Client-side checks only, missing server validation, race conditions, timing attacks |
| 3 | **Is it secure?** | Credentials exposure, weak randomness, missing authorization, unencrypted sensitive data |
| 4 | **How would I get around this security?** | Privilege escalation paths, token/session hijacking, direct API calls bypassing UI logic |
| 5 | **What's the worst case if this fails?** | Data breach, account takeover, system compromise, financial loss, reputation damage |

#### Attack Vectors to Always Consider

Every commit must be evaluated against these threat categories:

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

#### When Security Review is CRITICAL

Pay extra attention when code touches:

- **Authentication/Authorization** — Login, signup, password reset, role checks
- **User Input** — Forms, API parameters, file uploads, search queries
- **Database Operations** — Firestore writes, admin SDK calls, bulk operations
- **Sensitive Data** — Passwords, PINs, emails, API keys, tokens, personal information
- **Admin Functions** — Anything with elevated privileges or system-wide effects
- **External Integrations** — APIs, webhooks, third-party services
- **Client-Side Logic** — Anything that could be bypassed by direct API calls

#### Documentation Requirements

After completing security review, you MUST:

1. **Log to Vestige Memory** with:
   - Commit timestamp
   - Files changed
   - Security considerations evaluated
   - Threats identified and mitigated (or accepted risk with justification)
   - Confirmation: "Security review complete for commit [hash/description]"

2. **Update code.json** with:
   - Security-relevant remarks in GUID comments
   - Threat mitigation notes in `[Downstream Impact]`
   - Dependencies on security controls (auth checks, rate limits, validation)

#### Memory Template

Use this format when logging to Vestige:

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

Result: ✅ Security review complete. Code ready for commit.
```

#### Examples of Good Security Thinking

**Example 1: Adding a "Delete Account" Feature**

❌ **Bad:** Client-side button → Firestore delete → done
✅ **Good:** Ask the questions:
- Q1: How could this be exploited? → Any user could call the API to delete any account
- Q2: How circumvented? → Client-side auth check bypassed by direct API call
- Q3: Is it secure? → NO - missing server-side authorization
- Q4: How to get around? → Craft direct Firestore request with another user's UID
- Q5: Worst case? → Mass account deletion, data loss, service disruption

**Mitigation:** Server-side API route with Firebase Auth verification + Firestore rule requiring `request.auth.uid == resource.id`

**Example 2: Adding Email Notification for Score Changes**

❌ **Bad:** Fetch all users, send email with score
✅ **Good:** Ask the questions:
- Q1: Exploited how? → Email enumeration, PII disclosure via email content
- Q2: Circumvented? → Rate limits bypassed by triggering score recalculations
- Q3: Secure? → Partially - need rate limiting and PII sanitization
- Q4: Get around? → Spam endpoint to trigger DoS via email quota exhaustion
- Q5: Worst case? → Email service ban, cost explosion, user data leaked in emails

**Mitigation:** Rate limit per user, sanitize email content, queue with backoff, monitor costs

#### Compliance Checklist

Before marking code ready for commit:

- [ ] All 5 security questions asked and answered
- [ ] Attack vectors specific to this change identified
- [ ] Client-side security checks verified to have server-side enforcement
- [ ] No credentials, secrets, or PII exposed in code or logs
- [ ] Authorization checks present for privileged operations
- [ ] Input validation on all user-controlled data
- [ ] Security review logged to Vestige memory with timestamp
- [ ] code.json updated with security-relevant remarks

**If ANY checkbox fails, the code is not ready for commit.**

#### Rationale

The plaintext PIN storage vulnerability (missed in initial review, caught by Gemini) demonstrates why this rule is mandatory:

- **Reactive security fails** — Finding issues after commit wastes time and creates risk
- **Proactive threat modeling prevents** — Asking "could PINs leak?" before commit would have caught it
- **Attacker mindset essential** — Thinking "how would I steal credentials?" reveals flaws
- **Memory accountability** — Timestamped security reviews create audit trail and enforce discipline

This rule exists because **security is not a checkbox — it's a mindset that must be applied to every line of code before it enters the codebase.**

---

### Polling — Check shared memory regularly

**Every ~30 seconds (or every few messages), run:**
```bash
node claude-sync.js read
```

This keeps you aware of:
- What the other instance is doing
- Any new NO-TOUCH ZONES (claimed files)
- Activity log updates

### Keepalive Ping — Prove you're alive

**Every 5 minutes, run:**
```bash
node claude-sync.js ping
```

This is **mandatory for all agents**. Each ping:
- Updates your session's `lastActivity` timestamp
- Writes a record to the `session_pings` Firestore collection (audit trail)
- Logs to the activity feed

Failure to ping means you are not following protocol. Aaron can inspect pings in the Firebase Console under the `session_pings` collection.

### Session End — When I say goodnight/end session/sleep

When I indicate the session is ending (e.g., "goodnight", "that's all", "put this to sleep"), run:
```bash
node claude-sync.js checkout
```

Then respond with a graceful sign-off:
```
bob> Goodnight! Bob checked out. Session ended.
```

### During the Session

| Command | When to use |
|---------|-------------|
| `node claude-sync.js checkin` | Start of session (get Bob/Bill assignment) |
| `node claude-sync.js checkout` | End of session |
| `node claude-sync.js read` | Check current state (poll every ~30 sec) |
| `node claude-sync.js ping` | Keepalive heartbeat (**every 5 minutes** — mandatory) |
| `node claude-sync.js claim /path/` | Before modifying files |
| `node claude-sync.js release /path/` | When done with files |
| `node claude-sync.js write "message"` | Log significant milestones |
| `node claude-sync.js register "desc"` | Register current branch |
| `node claude-sync.js init` | Initialise fresh state (first time only) |

**If you need to modify a file in a NO-TOUCH ZONE, STOP and ask me first.**

---

## What is Prix Six?

A fantasy Formula 1 league application built on Firebase. Approximately 20 players compete via a WhatsApp group. The app handles team selection, race scoring, standings, and league administration.

**Two human developers:** Will and Aaron. Always confirm which one you're working for.

---

## Environment

- **Platform:** Windows
- **Node:** `C:\Program Files\nodejs\node.exe`
- **NPM:** `C:\Program Files\nodejs\npm.cmd`
- **gcloud CLI:** `"C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"`
- **Azure CLI:** `"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"`
- **Project root:** `E:\GoogleDrive\Papers\03-PrixSix\03.Current`
- **Firebase service account:** `E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json`
- **Firebase Project ID:** `studio-6033436327-281b1`

**Note:** gcloud and Azure CLI are NOT in PATH. Use the full paths above when running these commands.

**Terminal clarification:** "Console" means PowerShell or CMD. "Firebase" refers to the GUI unless explicitly using Firebase CLI or SDK.

### Available MCP Tools (System-Wide)

The following MCP servers are configured globally in `C:\Users\aarongarcia\.claude\.mcp.json` and available in all Claude Code sessions:

| MCP Server | Version | Purpose | Relevance to PrixSix |
|:---|:---|:---|:---|
| **Vestige** (Memory) | v1.1.2 | Persistent memory across sessions | Core - session context retention |
| **Sequential Thinking** | 2025.12.18 | Structured reasoning for complex tasks | Useful for architecture decisions |
| **GitHub MCP** | Go binary | GitHub operations (PRs, issues, code search) | Git workflow automation |
| **Firebase MCP** | 15.5.1 | Firebase project management, Firestore ops | Direct PrixSix Firebase integration |
| **Context7** | 2.1.1 | Up-to-date library documentation | Docs for Next.js, Firebase, React |
| **Azure MCP** | 0.0.4 | Azure resource management | Available for infrastructure tasks |
| **MS 365 MCP** | 0.40.0 | Microsoft 365 operations | Available if needed |
| **Semgrep** (standalone) | 1.151.0 | Static code analysis | CLI tool - Semgrep MCP removed due to version conflicts |

**Tokens Required:** GitHub MCP needs API token set in `~/.claude.json` env vars. Firebase MCP uses existing `GOOGLE_APPLICATION_CREDENTIALS`. Azure and MS 365 MCPs have configured credentials.

**MCP Install Location:** `E:\GoogleDrive\Tools\MCP\` (with local npm installs for offline fallback)

**MCP Config:** User-level MCP configuration is in `C:\Users\aarongarcia\.claude.json` (NOT `.claude\.mcp.json` which is for Claude Desktop only). All servers are configured using `claude mcp add` or `claude mcp add-json` for user-level availability across all Claude Code sessions.

---

## Architecture Overview

- **Frontend:** React
- **Backend:** Firebase (Firestore + Cloud Functions)
- **Hosting:** Firebase Hosting
- **External integrations:** WhatsApp (in development)
- **Coordination:** Firestore document at `coordination/claude-state`

---

## Module Reference

Quick-reference documentation for every major functional module. Each section covers purpose, data flow, key functions, Firestore collections, constants, and cross-module connections.

### 1. Scoring System

**Files:** `lib/scoring-rules.ts`, `lib/scoring.ts`, `api/calculate-scores/route.ts`, `lib/results-utils.tsx`
**Collections:** `users/{uid}/predictions` (R), `scores` (W), `race_results` (R/W)
**Purpose:** Hybrid position-based scoring engine that awards points based on how close each predicted driver is to their actual finishing position.

**Scoring Table:**

| Grade | Condition | Points |
|-------|-----------|--------|
| Exact | Predicted position matches actual | +6 |
| 1-off | 1 position away | +4 |
| 2-off | 2 positions away | +3 |
| 3+-off | 3+ positions away but still in top 6 | +2 |
| Miss | Driver not in top 6 | 0 |
| Bonus | All 6 predicted drivers finish in top 6 | +10 |

**Constants:** `SCORING_POINTS` (single source of truth), `SCORING_DERIVED.maxPointsPerRace` = 46, `SCORING_DERIVED.driversToPredict` = 6

**Data Flow:**
1. Admin submits race results via `api/calculate-scores/route.ts`
2. `calculateRaceScores()` fetches all predictions for the race via `collectionGroup` query on `predictions`
3. Per user: iterates 6 predicted drivers, calls `calculateDriverPoints()` for each
4. Checks bonus condition (`correctCount === 6`)
5. `updateRaceScores()` writes score documents to `scores` collection
6. Returns scores + standings to admin UI

**Key Functions:**
- `calculateDriverPoints(predicted, actual)` — single-driver point calc (in `scoring-rules.ts`)
- `calculateRaceScores(firestore, raceResult)` — all-user scoring for one race
- `updateRaceScores(firestore, raceResult)` — orchestrates calc + persistence + standings

**Carry-Forward:** If no prediction exists for a race, the user's most recent prior prediction is used automatically. Grid is only empty for a team's very first race.

**Connects to:** `scoring-rules.ts` (point values), `data.ts` (driver lookup), `normalize-race-id.ts` (ID matching), `error-registry.ts` (traced errors), `consistency.ts` (score validation)

---

### 2. Logon & Session

**Files:** `api/auth/login/route.ts`, `api/auth/record-logon/route.ts`, `api/auth/record-logout/route.ts`, `services/authService.ts`
**Collections:** `users` (R/W), `user_logons` (W), `login_attempts` (W), `audit_logs` (W), `attack_alerts` (W)
**Purpose:** Dual authentication system supporting PIN login (email + 6-digit PIN) and OAuth (Google, Apple), with brute-force protection and session tracking.

**PIN Login Flow:**
1. Client POST to `/api/auth/login` with `{email, pin}`
2. Extract client IP from proxy headers (Cloudflare, X-Forwarded-For, Vercel)
3. Check lockout: if `failedLoginAttempts >= 5` and within 30-min window → reject
4. Look up user by email in Firestore `users` collection
5. Verify PIN via Firebase Auth REST API (`verifyPassword` endpoint)
6. On success: generate Firebase custom token → return to client
7. Client calls `signInWithCustomToken()` → `onAuthStateChanged` fires in provider

**OAuth Login Flow:**
1. `signInWithGoogle/Apple()` from `authService.ts` triggers popup/redirect
2. Firebase Auth handles OAuth provider flow
3. `onAuthStateChanged` in provider syncs auth state to Firestore user profile
4. Profile fields synced: `emailVerified`, `providers[]`, `photoUrl`

**Constants:** `MAX_LOGIN_ATTEMPTS` = 5, `LOCKOUT_DURATION_MS` = 30 min (1,800,000 ms)

**Key Functions:**
- `getClientIP(request)` — extracts real IP from proxy headers
- `logLoginAttempt()` — records attempt to `login_attempts` collection
- `checkForAttack()` — runs all 3 attack detection checks after failure

**Connects to:** `attack-detection.ts` (attack checks), `firebase-admin.ts` (token generation), `traced-error.ts` (error handling), `audit.ts` (logging)

---

### 3. Firebase Provider

**Files:** `firebase/provider.tsx`
**Collections:** `users` (R/W), `user_logons` (W), `audit_logs` (W)
**Purpose:** Central auth/Firebase context wrapping the entire app. Single source of truth for current user session and profile.

**Exported Interfaces:**
- `EmailPreferences` — notification settings (rankingChanges, raceReminders, newsFeed, resultsNotifications)
- `AnalysisWeights` — 11 AI analysis factor weights (0-100 each)
- `User` — extended profile combining Auth UID + Firestore profile fields

**Hooks Provided:**
- `useFirebase()` — full context (auth, firestore, storage, functions, user)
- `useAuth()` — Firebase Auth instance
- `useFirestore()` — Firestore instance
- `useStorage()` — Firebase Storage instance
- `useFunctions()` — Cloud Functions instance

**Auth State Sync:**
- `onAuthStateChanged` listener syncs `emailVerified`, `providers[]`, `photoUrl` from Auth → Firestore
- `currentLogonId` tracks active session for logout recording
- Presence system writes to `user_logons` on login/logout

**Connects to:** `authService.ts` (OAuth operations), `audit.ts` (navigation logging), `error-registry.ts` (error codes), `types/league.ts` (global league ID)

---

### 4. Predictions

**Files:** `(app)/predictions/page.tsx`, `predictions/_components/PredictionEditor.tsx`, `api/submit-prediction/route.ts`
**Collections:** `users/{uid}/predictions` (R/W)
**Purpose:** 6-driver prediction grid per race per team. Users select their top-6 predicted finishers before qualifying begins.

**Data Flow:**
1. Page loads → fetches current race from schedule + existing prediction from Firestore
2. If no prediction exists for current race → carry-over from most recent prior race
3. User drags/selects 6 drivers into ordered grid
4. Submit → POST to `api/submit-prediction/route.ts`
5. Server validates: exactly 6 unique drivers, pitlane is open
6. Writes prediction doc with ID `{teamId}_{raceId}` to `users/{uid}/predictions`

**Pitlane Lock:** Predictions locked when `pitlaneOpen === false` (race results exist OR qualifying has started based on schedule time).

**AI Analysis:** Optional feature with 11 analysis facets and configurable weights (max 77 points). Weights stored in user profile as `AnalysisWeights`.

**Connects to:** `data.ts` (driver list, race schedule), `scoring-rules.ts` (driversToPredict = 6), `firebase/provider.tsx` (auth context)

---

### 5. Results & Standings

**Files:** `(app)/results/page.tsx`, `(app)/my-results/page.tsx`, `(app)/standings/page.tsx`, `lib/results-utils.tsx`
**Collections:** `scores` (R), `race_results` (R), `users` (R), `users/{uid}/predictions` (R)
**Purpose:** Three views for displaying scoring outcomes: per-race results, personal history, and season standings.

**Results Page:** Per-race view showing all teams' predictions vs actual results. Displays grade breakdown (exact/1-off/2-off/3+-off/miss) and bonus status per team.

**My Results Page:** Personal cross-race view with performance charts and statistics. Shows scoring trends, best/worst races, and grade distribution over the season.

**Standings Page:** Aggregated season totals with rank and tiebreaking. Tiebreaker: most 1st/2nd/3rd place correct predictions across all sessions.

**Shared Utilities (`results-utils.tsx`):** Common display functions for formatting scores, computing grade letters, rendering driver prediction comparisons.

**Connects to:** `scoring-rules.ts` (point values for display), `data.ts` (driver names/images), `normalize-race-id.ts` (race matching)

---

### 6. Email System

**Files:** `lib/email.ts`, `lib/email-tracking.ts`, `api/email-queue/route.ts`
**Collections:** `email_logs` (W), `email_daily_stats` (R/W), `email_queue` (R/W)
**Purpose:** Transactional email via Microsoft Graph API (Azure AD client credentials) with rate limiting, queuing, and daily summary reporting.

**Rate Limits:**
- Global: 30 emails/day (`DAILY_GLOBAL_LIMIT`)
- Per-address: 5 emails/day (`DAILY_PER_ADDRESS_LIMIT`)
- Admin email (`aaron@garcia.ltd`) is exempt from per-address limit

**Queue System:**
- When rate limit is reached, emails go to `email_queue` with status `pending`
- Queue processor retries with configurable intervals
- Status progression: `pending` → `sent` | `failed`

**Data Flow:**
1. Caller invokes `sendEmail()` or `sendWelcomeEmail()`
2. `canSendEmail()` checks global + per-address daily limits
3. If under limit → send via Microsoft Graph API → `recordSentEmail()`
4. If over limit → `queueEmail()` writes to `email_queue`
5. Each email gets a tracking GUID embedded in footer for support reference
6. Daily summary HTML generated by `generateDailySummaryHtml()`

**Key Functions:**
- `sendEmail(to, subject, html)` — generic send with rate check
- `sendWelcomeEmail(to, teamName)` — templated welcome email
- `canSendEmail(firestore, toEmail)` — rate limit check
- `queueEmail(firestore, emailData)` — deferred send

**Connects to:** `email-tracking.ts` (rate limiting, queue ops), `firebase-admin.ts` (Firestore access)

---

### 7. Teams & Leagues

**Files:** `(app)/teams/page.tsx`, `(app)/leagues/page.tsx`, `lib/leagues.ts`, `lib/types/league.ts`
**Collections:** `users` (R), `users/{uid}/predictions` (R), `leagues` (R/W)
**Purpose:** Team browsing with expandable prediction history, and custom league management with invite codes.

**Teams Page:** Paginated user list. Lazy-loads prediction history on expand to avoid loading all prediction subcollections upfront.

**League System:**
- Invite codes: 6 characters from 32-char alphabet (A-Z excluding I/O, digits 2-9)
- Max leagues per user: 5 (including global league)
- Global league: system-wide (`id: 'global'`, `owner: 'system'`), cannot delete or leave
- Operations: create, join by code, leave, remove member, rename, regenerate code, delete

**Constants:** `INVITE_CODE_LENGTH` = 6, `MAX_LEAGUES_PER_USER` = 5, `GLOBAL_LEAGUE_ID` = `'global'`, `SYSTEM_OWNER_ID` = `'system'`

**Key Functions:**
- `generateInviteCode()` — crypto-random code generation
- `createLeague(firestore, data)` — create with limit check
- `joinLeagueByCode(firestore, code, userId)` — lookup + add member
- `getUserLeagues(firestore, userId)` — fetch user's leagues

**Connects to:** `audit.ts` (correlation IDs for error tracing), `types/league.ts` (type definitions + constants)

---

### 8. Backup & Recovery

**Files:** `functions/index.js`, `admin/_components/BackupHealthDashboard.tsx`
**Collections:** All collections (exported), `backup_health` (W)
**Purpose:** Automated daily Firestore + Auth backup to Google Cloud Storage with integrity verification and dead man's switch monitoring.

**Schedule:**
- Daily 02:00 UTC: Firestore export + Auth user JSON to GCS bucket
- 7-day Object Retention Lock (irreversible — objects cannot be deleted during retention)
- Sunday smoke test: import backup to recovery project, verify document counts, delete

**Dead Man's Switch:** MQL (Monitoring Query Language) alert fires if no `BACKUP_HEARTBEAT` log entry appears within 25 hours.

**Backup Health Dashboard:** Admin UI showing backup status, last success/failure timestamps, retention policy, and smoke test results.

**Connects to:** GCS bucket (storage), Firebase Admin SDK (auth export), Cloud Monitoring (alerting)

---

### 9. Security & Attack Detection

**Files:** `lib/attack-detection.ts`, `admin/_components/AttackMonitor.tsx`
**Collections:** `login_attempts` (R/W), `attack_alerts` (W)
**Purpose:** Real-time detection of bot attacks, credential stuffing, and distributed login attacks against the authentication layer.

**Detection Thresholds:**

| Attack Type | Condition | Severity |
|-------------|-----------|----------|
| Bot Attack | 5+ fails from same IP in 5 min | Critical |
| Credential Stuffing | Same IP tries 3+ accounts in 5 min | Critical |
| Distributed Attack | 3+ IPs target same account with 5+ fails in 10 min | Warning |

**Constants:** `ATTACK_THRESHOLDS.BOT_ATTACK` = {attempts: 5, windowMinutes: 5}, `CREDENTIAL_STUFFING` = {uniqueAccounts: 3, windowMinutes: 5}, `DISTRIBUTED_ATTACK` = {uniqueIPs: 3, failedAttempts: 5, windowMinutes: 10}

**Key Functions:**
- `logLoginAttempt(db, attempt)` — records each attempt to `login_attempts`
- `checkForAttack(db, ip, email)` — orchestrates all 3 detection checks
- `checkBotAttack(db, ip)` — same-IP rapid failure detection
- `checkCredentialStuffing(db, ip)` — multi-account from single IP
- `checkDistributedAttack(db, email)` — multi-IP targeting single account
- `createAttackAlert(db, alert)` — writes alert to `attack_alerts`

**Admin UI (AttackMonitor):** Real-time display of unacknowledged alerts with acknowledge controls and alert history.

**Connects to:** `api/auth/login/route.ts` (triggered after each failed login), `error-registry.ts` (error codes)

---

### 10. Consistency Checker

**Files:** `lib/consistency.ts`, `admin/_components/ConsistencyChecker.tsx`
**Collections:** All collections (R — read-only validation)
**Purpose:** Pure validation functions across 9 domain categories. No side-effects (no Firestore writes).

**Categories:** `users`, `drivers`, `races`, `predictions`, `team-coverage`, `results`, `scores`, `standings`, `leagues`

**Severity Levels:** `error` (data integrity issue), `warning` (suspicious but not broken), `info` (expected/benign condition)

**Score Distribution Analysis:** Counts scoring types A-G across all validated scores for statistical breakdown.

**Types Exported:** `CheckCategory`, `IssueSeverity`, `CheckStatus`, `Issue`, `CheckResult`, `ScoreTypeDistribution`

**Admin UI (ConsistencyChecker):** Lazy-loaded to avoid ~4MB Firestore load on page mount. Runs checks on demand, displays categorised issues with colour-coded severity badges and summary counts.

**Connects to:** `scoring-rules.ts` (point values for score validation), `data.ts` (driver list + race schedule), `normalize-race-id.ts` (cross-collection race matching)

---

### 11. Audit Trail

**Files:** `lib/audit.ts`
**Collections:** `audit_logs` (W)
**Purpose:** Client-side audit logging with session correlation IDs, automatic navigation tracking, and fire-and-forget Firestore writes.

**Correlation IDs:** Session-scoped (one per browser tab), generated as RFC 4122 v4 GUIDs on first access. All audit events within a session share the same ID.

**Key Functions:**
- `getCorrelationId()` — returns (or lazily generates) session correlation ID
- `logAuditEvent(firestore, userId, action, details)` — fire-and-forget write to `audit_logs`
- `useAuditNavigation()` — React hook that auto-logs page navigations via `usePathname()`

**Error Handling:** Uses `addDocumentNonBlocking` so audit failures never block the UI. Silent console-only fallback on Firestore permission errors (`FirestorePermissionError`).

**Connects to:** `firebase/provider.tsx` (auth context for userId), `firebase/non-blocking-updates.ts` (non-blocking writes), `firebase/errors.ts` (permission error type)

---

### 12. Schedule & Data

**Files:** `lib/data.ts`, `lib/normalize-race-id.ts`
**Collections:** None (static data)
**Purpose:** Single source of truth for F1 driver roster and race schedule. Provides driver lookup, image resolution, and race ID normalization.

**Driver Data (`F1Drivers[]`):** 22 drivers across 11 teams (2026 season). Each entry: `{id, name, number, team, imageId}`.

**Helper Functions:**
- `getDriverImage(driverId)` — resolves driver ID to profile image URL via placeholder images
- `getDriverName(driverId)` — resolves lowercase ID to proper-case display name
- `getDriverCode(driverId)` — derives 3-letter uppercase code (e.g., `"hamilton"` → `"HAM"`)

**Race Schedule (`RaceSchedule`):** Calendar with qualifying times used for pitlane lock calculation.

**Race ID Normalization (`normalize-race-id.ts`):**
- `normalizeRaceId(raceId)` — strips ` - GP` / ` - Sprint` suffixes, replaces spaces with hyphens. Case-preserving.
- `normalizeRaceIdForComparison(raceId)` — same as above but lowercased for cross-collection matching.

**Connects to:** Every module that displays drivers or checks race schedules (scoring, predictions, consistency, results)

---

### 13. Error Handling

**Files:** `lib/error-codes.ts`, `lib/error-registry.ts`, `lib/traced-error.ts`
**Collections:** `error_logs` (W)
**Purpose:** Structured error system with unique PX-xxxx codes, auto-generated registry, and traced errors with correlation IDs.

**Error Code Format:** `PX-[CATEGORY][NUMBER]`
- `1xxx` — Authentication & Authorization
- `2xxx` — Data Validation
- `3xxx` — External Services (Email, AI)
- `4xxx` — Firestore Operations
- `5xxx` — Race/Scoring Logic
- `6xxx` — Session Management
- `7xxx` — Backup & Recovery
- `8xxx` — Attack Detection
- `9xxx` — Unknown/Unexpected

**`error-codes.ts`:** Master registry of all `ERROR_CODES` with `{code, message}` per error key. Also provides `generateClientCorrelationId()` and display formatting utilities.

**`error-registry.ts`:** Auto-generated by `scripts/generate-error-registry.ts` from `code.json`. Exports `ERRORS` record with full `ErrorDefinition` per key (code, GUID, module, file, message, severity, recovery, failureModes).

**`traced-error.ts`:** Factory functions for creating and logging errors:
- `generateCorrelationId(prefix)` — format: `[prefix]_[timestamp-base36]_[random-6]`
- `createTracedError(definition, options)` — creates `TracedError` from `ERRORS.KEY` with correlation ID + context + cause chain
- `logTracedError(error)` — writes to `error_logs` (server) or POST to `/api/log-client-error` (client)

**Golden Rule #7:** All errors must use `ERRORS.KEY.code` — no hardcoded error strings.

**Connects to:** Every module that handles errors (all API routes, Cloud Functions, client components)

---

### 14. WhatsApp Integration

**Files:** `api/whatsapp-proxy/route.ts`, `admin/_components/WhatsAppManager.tsx`
**Collections:** `users` (R — admin check)
**Purpose:** HTTPS proxy bridging the browser to an HTTP-only WhatsApp worker on Azure Container Instances, with admin authentication and HMAC request signing.

**Architecture:** Browser (HTTPS) → Next.js proxy → WhatsApp worker (HTTP on `prixsix-whatsapp.uksouth.azurecontainer.io:3000`)

**Security:**
- Admin-only: verifies Firebase Auth token + Firestore `isAdmin` flag
- HMAC SHA-256 request signing via `WHATSAPP_APP_SECRET` env var
- Endpoint whitelist: `health`, `status`, `qr` (GET only)

**Key Functions:**
- `signRequest(payload)` — generates `sha256=` HMAC signature
- `GET(request)` — proxies read-only requests (health/status/qr)
- `POST(request)` — proxies write requests (send message, etc.)

**Admin UI (WhatsAppManager):** Worker status display, QR code for WhatsApp Web pairing, alert configuration, custom messaging, and queue viewer.

**Connects to:** `firebase-admin.ts` (auth verification), Azure Container Instances (worker)

---

## Git Discipline

### Branch Strategy

| Branch | Purpose | Triggers Deploy? |
|--------|---------|------------------|
| `main` | Production-ready code only | **YES** — never commit directly |
| `develop` | Integration branch for features | No |
| `feature/*` | Individual feature work | No |

**Rules:**
1. **Never commit directly to `main`** — each push triggers a 3-5 minute build + deployment costs
2. Always branch from `develop` for new work
3. Before starting work, always run `git status` to check another Claude Code instance isn't active
4. Only merge to `main` when explicitly instructed ("merge to main", "deploy this", "push to production")

### Creating a Feature Branch
```bash
git checkout develop
git pull
git checkout -b feature/<short-description>
```

### Merging to Main (only when instructed)
```bash
git checkout main
git merge --squash feature/<branch-name>
git commit -m "v1.x.x - <summary of changes>"
git push origin main
git branch -d feature/<branch-name>
```

### Commit Messages

Format: `[type]: brief description`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

Examples:
- `feat: add WhatsApp session persistence`
- `fix: correct sprint race scoring calculation`
- `docs: update CLAUDE.md with new branch`

---

## Versioning

**Scheme:** MAJOR.MINOR.PATCH (e.g., 2.4.6)

- **MAJOR:** Breaking changes or significant new functionality
- **MINOR:** New features, backward compatible
- **PATCH:** Bug fixes, minor tweaks

**When bumping the version, update BOTH files:**
1. `app/package.json` - the npm package version
2. `app/src/lib/version.ts` - the `APP_VERSION` constant displayed on the About page

**Always verify** the About page reflects the updated version after deployment:  
https://prix6.win/about

---

## Data Standards

### Types of Data

| Type | Description | Examples |
|------|-------------|----------|
| Standing data | Static reference data | Tracks, drivers |
| Temp data | Transactional data | Teams, submissions (predictions) |

### Protected Records — DO NOT MODIFY unless explicitly asked

1. `aaron@garcia.ltd` — admin account
2. `aaron.garcia@hotmail.co.uk` — user account

### Case Sensitivity — CHECK THIS

A common fault is mismatched casing in IDs:
- Lookups often use lowercase: `australian-grand-prix`
- Storage may use mixed case: `Australian-Grand-Prix`

**Always verify how IDs are stored before matching.**

---

## Consistency Checker (CC)

Before starting work, check the Consistency Checker and note how it validates IDs and lookups.

**When building new features:**
- Plan for your work to be checked by the CC
- Add any new tables with IDs and lookups to the CC

---

## Global Error Handling Standard

**MANDATORY for all user-facing errors.** See `app/src/lib/error-codes.ts` for the error code registry.

> ⚠️ **This section provides implementation details. The Golden Rule above is the authority.**

### Requirements

Every error displayed to users MUST include:

1. **Unique Error Type Number**: Use codes from `ERROR_CODES` in `error-codes.ts`
   - Format: `PX-[CATEGORY][NUMBER]` (e.g., `PX-3001` for email failures)
   - Categories: 1xxx=Auth, 2xxx=Validation, 3xxx=External, 4xxx=Firestore, 5xxx=Race, 6xxx=Session, 9xxx=Unknown

2. **Correlation ID**: Generate using `generateCorrelationId()` or `generateClientCorrelationId()`
   - Format: `err_[timestamp-base36]_[random]`
   - Must be unique per error instance

3. **Selectable Text**: Error popups MUST allow users to copy the error code and correlation ID
   - Use the `ErrorToast` component or include copyable text

4. **Server-Side Logging**: Call `logError()` to write to `error_logs` collection
   - Include: correlationId, error message, stack trace, context (route, userId, timestamp)

### Implementation Pattern

```typescript
import { ERROR_CODES, createAppError, generateClientCorrelationId } from '@/lib/error-codes';
import { logError } from '@/lib/firebase-admin';

// In API routes:
const correlationId = generateCorrelationId();
try {
  // ... operation
} catch (error) {
  await logError({ correlationId, error, context: { route, userId } });
  return NextResponse.json({
    success: false,
    error: ERROR_CODES.EMAIL_SEND_FAILED.message,
    errorCode: ERROR_CODES.EMAIL_SEND_FAILED.code,
    correlationId,
  });
}

// In React components:
catch (error) {
  const correlationId = generateClientCorrelationId();
  toast({
    variant: "destructive",
    title: `Error ${ERROR_CODES.EMAIL_SEND_FAILED.code}`,
    description: `${error.message} (ID: ${correlationId})`,
  });
}
```

### Adding New Error Codes

1. Add to `ERROR_CODES` in `app/src/lib/error-codes.ts`
2. Use appropriate category number
3. Document the error condition

---

## Code Standards

- UK English for all user-facing strings
- Prefer JSON for data interchange
- camelCase for variables, PascalCase for components

---

## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | This file — project context for Claude Code |
| `CHANGELOG.md` | Version history and release notes |
| `package.json` | Dependencies and version number |
| `firebase.json` | Firebase configuration |
| `firestore.rules` | Database security rules |
| `/functions/index.js` | Cloud Functions entry point |
| `claude-sync.js` | Session coordination script |

---

## External Dependencies

| Dependency | Purpose | Notes |
|------------|---------|-------|
| `whatsapp-web.js` | WhatsApp Web automation | Unofficial — ToS risk acknowledged |
| `firebase-admin` | Firestore access for coordination | Used by claude-sync.js |

---

## Environment Variables / Secrets

**Never commit secrets to the repo.**

Required for local development:
- `GOOGLE_APPLICATION_CREDENTIALS` — path to `service-account.json`

Required for production (Firebase App Hosting):
- NEXT_PUBLIC_FIREBASE_* vars are in `apphosting.yaml` (public, OK to commit)
- GRAPH_* secrets are configured via `firebase apphosting:secrets:set`:
  - `GRAPH_TENANT_ID` - Azure AD tenant ID
  - `GRAPH_CLIENT_ID` - Azure app registration client ID
  - `GRAPH_CLIENT_SECRET` - Azure app client secret
  - `GRAPH_SENDER_EMAIL` - Email address to send from (aaron@garcia.ltd)

**Important:** After creating secrets, grant App Hosting backend access:
```bash
firebase apphosting:secrets:grantaccess SECRET_NAME --backend prixsix
```

---

## IAM Permissions

The App Hosting service account needs these roles:

| Service Account | Role | Purpose |
|-----------------|------|---------|
| `firebase-app-hosting-compute@studio-6033436327-281b1.iam.gserviceaccount.com` | Service Account Token Creator | Create custom auth tokens for login |

To grant (using full gcloud path):
```bash
"C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" iam service-accounts add-iam-policy-binding firebase-adminsdk-fbsvc@studio-6033436327-281b1.iam.gserviceaccount.com --member="serviceAccount:firebase-app-hosting-compute@studio-6033436327-281b1.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --project=studio-6033436327-281b1
```

---

## API Key Security

The Firebase API key (`AIzaSyA23isMS-Jt60amqI-0XZHoMZeQOawtsSk`) should be restricted in Google Cloud Console.

### To Configure Restrictions

1. Go to https://console.cloud.google.com/apis/credentials?project=studio-6033436327-281b1
2. Click on the API key
3. Under **Application restrictions**, select "HTTP referrers (websites)"
4. Add allowed domains:
   - `prix6.win/*`
   - `prix6.win/*` (custom domain)
   - `https://prix6.win/*`
   - `localhost:*` (for development)
5. Under **API restrictions**, select "Restrict key" and enable only:
   - Firebase Installations API
   - Firebase Management API
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API

### Why This Matters

- Prevents API key abuse if exposed in client-side code
- Limits the key to only the APIs needed for the app
- Restricts usage to your domains only

---

## CI/CD Build Throttling

**Problem:** Firebase App Hosting triggers a build on every push to main, causing resource waste when multiple commits happen quickly.

**Solution:** Follow these practices:

1. **Never commit directly to main** - Use feature branches
2. **Squash merges** - Combine multiple commits into one before merging to main
3. **Manual build triggers** - For development, consider using `develop` branch

**Future Enhancement:** Consider adding GitHub Actions with build debouncing:
- Only trigger builds when no commits for 10 minutes
- Or use manual workflow dispatch for production builds

---

## Firebase Auth Configuration

### Email Verification Domain Setup

If you see error `auth/unauthorized-continue-uri`, add your domains to Firebase:

1. Go to Firebase Console → Authentication → Settings → Authorized domains
2. Add these domains:
   - `localhost` (for development)
   - `prix6.win` (production)
   - Any custom domains in use

The continue URL in email verification is configured in `firebase/provider.tsx`.

---

## Current Sprint / Focus Areas

### In Progress
- [ ] WhatsApp integration for automated group messages

### Backlog
- [ ] (add planned work)

### Recently Completed
- [x] Migrated all ~47 remaining hardcoded PX codes to `ERRORS.KEY.code` from `@/lib/error-registry` across 15 files (commit `c4129e8`). Inline correlation ID generation replaced with `generateClientCorrelationId()`. Zero remaining hardcoded `'PX-xxxx'` strings outside source-of-truth files (`error-codes.ts`, `error-registry.ts`) and intentional exclusions (`ErrorLogViewer.tsx` category prefixes, regex parsers in auth pages). Golden Rule #7 is now fully enforced.
- [x] Phase 9 - migrate all error handling to traced-error system
- [x] Tier 1 security audit + module indexer error traceability system
- [x] v1.17.0 - Smart Pit Lane Status (shows Submit/Edit Prediction based on user state)
- [x] v1.17.0 - Waiting State & Deep Linking (loading spinner, clickable link to /predictions)
- [x] v1.17.0 - Deadline Visibility Warning (colour-coded banners at 24h/6h/1h)
- [x] v1.17.0 - Apply to All Teams checkbox (submit same prediction to all teams)
- [x] v1.17.0 - Email Verification Backend (Firebase email verification, schema update)
- [x] v1.17.0 - Email Verification Frontend (banner on all pages, profile page controls)
- [x] Fixed login - added correlation IDs to all errors, granted Service Account Token Creator role
- [x] Performance fix - lazy load ConsistencyChecker (reduced 4MB Firestore load)
- [x] Added version display to login and dashboard pages
- [x] Security audit - removed hardcoded secrets, updated .gitignore
- [x] Configured apphosting.yaml with Firebase env vars

---

## Before Committing Checklist

1. ✅ Run tests (if applicable)
2. ✅ Check no console errors
3. ✅ Run `npm run build` locally to verify build succeeds
4. ✅ **GOLDEN RULE #2:** Bump version in BOTH `package.json` AND `src/lib/version.ts`
5. ✅ Update `CHANGELOG.md` if user-facing change
6. ✅ Update `CLAUDE.md` if architectural change or new branch
7. ✅ Run `node claude-sync.js write "summary"` to log your work
8. ✅ **GOLDEN RULE #1:** Verify all error handling — no unhandled exceptions
9. ✅ **GOLDEN RULE #3:** Verify no data duplication without CC sync validation
10. ✅ **GOLDEN RULE #4:** Prefix your commit confirmation with bob> or bill>
11. ✅ **GOLDEN RULE #5:** Use verbose confirmation: `bob> Committed: "type: message" (1.x.x)`
12. ✅ **GOLDEN RULE #6:** GUID comments updated on all changed/new code, `code.json` in sync
13. ✅ **GOLDEN RULE #7:** Errors use `ERRORS.KEY` from error-registry.ts, `error-registry.ts` regenerated if code.json changed
14. ✅ **GOLDEN RULE #8:** Prompt prefix used on every response; violations logged to Vestige memory
15. ✅ **GOLDEN RULE #11:** Pre-commit security review completed, 5 questions answered, security consideration logged to Vestige with timestamp

---

## After Pushing to Main - MANDATORY Build Verification

> ⚠️ **See Golden Rule #2 above for the authoritative version discipline requirements.**

**Every push to `main` triggers a Firebase App Hosting build.** You MUST verify the build succeeds AND version consistency.

### Check Build Status

Run this command after pushing to main:
```powershell
powershell -Command "& 'C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' logging read 'resource.type=\"build\"' --project=studio-6033436327-281b1 --limit=20 --freshness=15m --format='value(textPayload)'"
```

### Verify Version Consistency

After build completes, check BOTH pages show identical versions:
- **About:** https://prix6.win/about
- **Login:** https://prix6.win/login

### What to Look For

**Success indicators:**
- `DONE` at the end of the build
- New revision created (e.g., `build-2026-01-21-043`)

**Failure indicators:**
- `ERROR` or `failed` in the output
- `fah/misconfigured-secret` - Secret permission issue
- `step exited with non-zero status` - Build step failed

### Common Build Failures & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `useSearchParams() should be wrapped in a suspense boundary` | Next.js 15 requirement | Wrap component using `useSearchParams()` in `<Suspense>` |
| `fah/misconfigured-secret` | Secret access denied | Run `firebase apphosting:secrets:grantaccess SECRET_NAME --backend prixsix` |
| `Permission denied` on secrets | IAM not configured | Grant access for all 4 GRAPH_* secrets |

### If Build Fails

1. Check the error in build logs
2. Fix the issue locally
3. Run `npm run build` to verify fix works
4. Commit and push the fix
5. Re-verify the build succeeds

---

## Compacting / Context Recovery

When you compact the conversation, you **must**:
1. Re-read this entire `CLAUDE.md` file
2. Run `node claude-sync.js read` to check coordination state
3. Inform the user you're caught up with the instructions

---

## Contact / Decisions

All architectural decisions go through Aaron. If unsure about approach, ask before implementing.

---

*This file is the single source of truth for project context. Keep it updated.*
