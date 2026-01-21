# CLAUDE.md - Prix Six Project Brief

> **Last updated:** 2026-01-21  19:30
> **Current production version:** Check `package.json` and verify at https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/about  
> **Read this entire file at the start of every session.**

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

### Response Prefix — ALWAYS use this

**Prefix ALL your responses with your assigned name:**
- If you are Bob: `bob> `
- If you are Bill: `bill> `

This helps the user know which instance they're talking to.

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
- **Project root:** `E:\GoogleDrive\Papers\03-PrixSix\03.Current`
- **Firebase service account:** `E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json`
- **Firebase Project ID:** `studio-6033436327-281b1`

**Note:** gcloud is NOT in PATH. Use the full path above when running gcloud commands.

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
- GRAPH_* secrets must be set via `firebase apphosting:secrets:set` (currently disabled)

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
3. ✅ Bump version in `package.json` AND `src/lib/version.ts`
4. ✅ Update `CHANGELOG.md` if user-facing change
5. ✅ Update `CLAUDE.md` if architectural change or new branch
6. ✅ Run `node claude-sync.js write "summary"` to log your work

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