# CLAUDE.md - Prix Six Project Brief

> **Last updated:** 2026-01-22  12:00
> **Current production version:** Check `package.json` and verify at https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/about  
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
| About | https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/about | Version number displayed |
| Login | https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/login | Version number in footer/corner |

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
- ❓ Does my response start with `bob> ` or `bill> `?
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

### Polling — Check shared memory regularly

**Every ~30 seconds (or every few messages), run:**
```bash
node claude-sync.js read
```

This keeps you aware of:
- What the other instance is doing
- Any new NO-TOUCH ZONES (claimed files)
- Activity log updates

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

---

## Architecture Overview

- **Frontend:** React
- **Backend:** Firebase (Firestore + Cloud Functions)
- **Hosting:** Firebase Hosting
- **External integrations:** WhatsApp (in development)
- **Coordination:** Firestore document at `coordination/claude-state`

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
https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/about

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
   - `prixsix--studio-6033436327-281b1.europe-west4.hosted.app/*`
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
   - `prixsix--studio-6033436327-281b1.europe-west4.hosted.app` (production)
   - Any custom domains in use

The continue URL in email verification is configured in `firebase/provider.tsx`.

---

## Current Sprint / Focus Areas

### In Progress
- [ ] WhatsApp integration for automated group messages

### Backlog
- [ ] (add planned work)

### Recently Completed
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
- **About:** https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/about
- **Login:** https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/login

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
