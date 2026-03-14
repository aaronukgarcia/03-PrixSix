# CLAUDE.md - Prix Six Project Brief

> **Last updated:** 2026-02-24 (claude-sync v2.0 — DHCP permit model)
> **Current production version:** Check `package.json` and verify at https://prix6.win/about
> **Read this entire file at the start of every session.**

---

## 🚀 HOW TO START A SESSION (do this before anything else)

**Every Claude Code window must be launched from the project directory:**

```powershell
cd E:\GoogleDrive\Papers-PrixSix.Current
claude --add-dir E:\GoogleDrive\Tools\Memory\source
```

> The `--add-dir` flag loads the Memory `CLAUDE.md` (MCPs, environment info).
> Starting here (not in the Memory directory) ensures hooks fire correctly.
> MCPs load automatically from user-level config regardless of directory.

**Then immediately inside Claude Code:**

```powershell
# Step 1: Acquire your named permit (5-min TTL)
node claude-sync.js checkin --name Bill      # primary window — that's it, you're done

# Step 2: Read the golden rules
# (checkin output shows the path — golden-rules-reminder.md)
```

> **No env var needed for single-agent use.** The hook reads `.claude-session-key` automatically.
> The `$env:CLAUDE_SESSION_ID` step is only required when Bob or Ben are running simultaneously
> in separate terminals — set it then to prevent the hooks from cross-renewing each other's permits.

**If wrong instance grabbed your name — HUMAN MUST RUN THIS, not Claude:**
```powershell
node claude-sync.js checkin --name Bill --force --human-ok   # evict impostor, claim Bill
```
> ⚠️ **`--human-ok` is a human-only flag.** Claude instances are NEVER permitted to supply `--human-ok` autonomously. Without it, `--force` is blocked at the script level.

**Multi-agent only (Bob/Ben also running):**
```powershell
# After checkin, paste the session ID line shown in the checkin output:
$env:CLAUDE_SESSION_ID = "session-XXXXXXXXXX"
```

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

> **Full implementation patterns, code templates, and compliance checklists:** `docs/golden-rules-detail.md`

## 🚨 MANDATORY: Session Coordination Protocol

### Session Start — ALWAYS do this first

**Step 1:** Check in to acquire your named permit (5-minute TTL, DHCP-style):
```bash
node claude-sync.js checkin
```

This will assign you **Bill** (1st), **Bob** (2nd), or **Ben** (3rd) — whichever slot is free.
Permits expire after 5 minutes unless auto-renewed. The `PostToolUse` hook handles renewal automatically.

> **If your slot is taken by a stale/wrong instance**, claim it explicitly:
> ```bash
> node claude-sync.js checkin --name Bill          # claim Bill if slot is free
> node claude-sync.js checkin --name Bill --force  # evict whoever holds Bill and take it
> ```

**Step 2 (CRITICAL — run once in your terminal):**

Copy the `$env:CLAUDE_SESSION_ID` line from the checkin output and run it:
```powershell
$env:CLAUDE_SESSION_ID = "session-XXXXXXXXXX"   # exact value shown in your checkin output
```
Without this, the auto-renewal hook cannot identify your instance and your permit will expire every 5 minutes in multi-agent setups.

**Step 3:** Complete these checks:
1. Run `git status` and confirm your branch
2. Run `git pull` to get latest changes
3. Run `node claude-sync.js read` to review the coordination state

**Step 4:** Announce yourself with your assigned name:
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
| First instance (Bill) | `bill> ` | `bill> I've updated the file...``` |
| Second instance (Bob) | `bob> ` | `bob> The build completed...``` |
| Third instance (Ben) | `ben> ` | `ben> I've reviewed the backup system...``` |

Every 5 responses, mentally verify you are still using your prefix. If you drop it: add it immediately and apologise.

If you need to check your assignment: `node claude-sync.js read`

---

### Permit Auto-Renewal — Handled by hook

Permits have a **5-minute TTL**. The `PostToolUse` hook (`claude-ping-check.js`) automatically calls `renew --auto` every 2 minutes, renewing only when < 2.5 minutes remain. **You do not need to manually ping** — but you must have set `$env:CLAUDE_SESSION_ID` (Step 2 above) for the hook to renew the correct instance.

To manually check your permit status at any time:
```bash
node claude-sync.js status --session $env:CLAUDE_SESSION_ID
```

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

When I indicate the session is ending, run:
```bash
node claude-sync.js checkout --session $env:CLAUDE_SESSION_ID
```

Then respond with a graceful sign-off:
```
bob> Goodnight! Bob checked out. Session ended.
```

### During the Session

| Command | When to use |
|---------|-------------|
| `node claude-sync.js checkin` | Start of session — auto-assigns Bill/Bob/Ben |
| `node claude-sync.js checkin --name Bill` | Claim a specific slot by name |
| `node claude-sync.js checkin --name Bill --force` | Evict impostor and claim slot |
| `node claude-sync.js checkout --session ID` | End of session |
| `node claude-sync.js status --session ID` | Check permit TTL remaining |
| `node claude-sync.js read` | Check full coordination state (poll every ~30 sec) |
| `node claude-sync.js renew --session ID` | Manually extend permit by 5 min |
| `node claude-sync.js ping --session ID` | Renew + heartbeat + watchdog report |
| `node claude-sync.js claim /path/ --session ID` | Before modifying files |
| `node claude-sync.js release /path/ --session ID` | When done with files |
| `node claude-sync.js write "message" --session ID` | Log significant milestones |
| `node claude-sync.js checkout --force [Name]` | Admin: evict a specific permit holder |
| `node claude-sync.js gc` | Clean up expired permits manually |
| `node claude-sync.js init` | Initialise fresh state (first time only) |

> **`--session ID`** = the session ID shown in your `checkin` output, or `$env:CLAUDE_SESSION_ID` if you set it.

**If you need to modify a file in a NO-TOUCH ZONE, STOP and ask me first.**

---

## What is Prix Six?

A fantasy Formula 1 league application built on Firebase. Approximately 20 players compete via a WhatsApp group. The app handles team selection, race scoring, standings, and league administration.

**Two human developers:** Will and Aaron. Always confirm which one you are working for.

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
| **Vestige** (Memory) | v1.1.2 | Persistent memory across sessions | Core — session context retention |
| **Sequential Thinking** | 2025.12.18 | Structured reasoning for complex tasks | Useful for architecture decisions |
| **GitHub MCP** | Go binary | GitHub operations (PRs, issues, code search) | Git workflow automation |
| **Firebase MCP** | 15.5.1 | Firebase project management, Firestore ops | Direct PrixSix Firebase integration |
| **Context7** | 2.1.1 | Up-to-date library documentation | Docs for Next.js, Firebase, React |
| **Azure MCP** | 0.0.4 | Azure resource management | Available for infrastructure tasks |
| **MS 365 MCP** | 0.40.0 | Microsoft 365 operations | Available if needed |
| **Semgrep** (standalone) | 1.151.0 | Static code analysis | CLI tool — Semgrep MCP removed due to version conflicts |

**Tokens Required:** GitHub MCP needs API token set in `~/.claude.json` env vars. Firebase MCP uses existing `GOOGLE_APPLICATION_CREDENTIALS`. Azure and MS 365 MCPs have configured credentials.

**MCP Install Location:** `E:\GoogleDrive\Tools\MCP\\` (with local npm installs for offline fallback)

**MCP Config:** User-level MCP configuration is in `C:\Users\aarongarcia\.claude.json` (NOT `.claude\.mcp.json` which is for Claude Desktop only). All servers are configured using `claude mcp add` or `claude mcp add-json` for user-level availability across all Claude Code sessions.

---

## Architecture Overview

- **Frontend:** React
- **Backend:** Firebase (Firestore + Cloud Functions)
- **Hosting:** Firebase Hosting
- **External integrations:** WhatsApp (in development)
- **Coordination:** Firestore document at `coordination/claude-state`

---

## Module Quick-Index

Full documentation for each module is in `docs/module-reference.md`.

| # | Module | Key Files | Collections |
|---|--------|-----------|-------------|
| 1 | Scoring System | `lib/scoring-rules.ts`, `lib/scoring.ts`, `api/calculate-scores/route.ts` | `scores`, `race_results`, `predictions` |
| 2 | Logon & Session | `api/auth/login/route.ts`, `services/authService.ts` | `users`, `user_logons`, `login_attempts` |
| 3 | Firebase Provider | `firebase/provider.tsx` | `users`, `user_logons` |
| 4 | Predictions | `(app)/predictions/page.tsx`, `api/submit-prediction/route.ts` | `users/{uid}/predictions` |
| 5 | Results & Standings | `(app)/results/page.tsx`, `lib/results-utils.tsx` | `scores`, `race_results` |
| 6 | Email System | `lib/email.ts`, `api/email-queue/route.ts` | `email_logs`, `email_queue` |
| 7 | Teams & Leagues | `(app)/teams/page.tsx`, `lib/leagues.ts` | `users`, `leagues` |
| 8 | Backup & Recovery | `functions/index.js` | All collections (exported) |
| 9 | Security & Attack Detection | `lib/attack-detection.ts` | `login_attempts`, `attack_alerts` |
| 10 | Consistency Checker | `lib/consistency.ts` | All collections (R only) |
| 11 | Audit Trail | `lib/audit.ts` | `audit_logs` |
| 12 | Schedule & Data | `lib/data.ts`, `lib/normalize-race-id.ts` | None (static data) |
| 13 | Error Handling | `lib/error-codes.ts`, `lib/error-registry.ts`, `lib/traced-error.ts` | `error_logs` |
| 14 | WhatsApp Integration | `api/whatsapp-proxy/route.ts` | `users` (R) |
| 15 | Pit Wall | `(app)/pit-wall/PitWallClient.tsx`, `api/pit-wall/live-data/route.ts` | None (OpenF1 + RainViewer, no Firestore) |

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

## Global Error Handling Standard

**MANDATORY for all user-facing errors.** See `app/src/lib/error-codes.ts` for the error code registry.

> ⚠️ **This section provides implementation details. The Golden Rule above is the authority.**

Every error displayed to users MUST include:

1. **Unique Error Type Number**: Use codes from `ERROR_CODES` in `error-codes.ts`
2. **Correlation ID**: Generate using `generateCorrelationId()` or `generateClientCorrelationId()`
3. **Selectable Text**: Error popups MUST allow users to copy the error code and correlation ID
4. **Server-Side Logging**: Call `logError()` to write to `error_logs` collection

> **Full patterns and templates:** `docs/golden-rules-detail.md`

---
## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | This file — project context for Claude Code |
| `docs/golden-rules-detail.md` | Full implementation detail for all 11 Golden Rules |
| `docs/module-reference.md` | Full documentation for all 14 modules |
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

| Service Account | Role | Purpose |
|-----------------|------|---------|
| `firebase-app-hosting-compute@studio-6033436327-281b1.iam.gserviceaccount.com` | Service Account Token Creator | Create custom auth tokens for login |

---

## CI/CD Build Throttling

**Problem:** Firebase App Hosting triggers a build on every push to main.

1. **Never commit directly to main** - Use feature branches
2. **Squash merges** - Combine multiple commits into one before merging to main
3. **Manual build triggers** - For development, consider using `develop` branch

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
11. ✅ **GOLDEN RULE #5:** Use verbose confirmation
12. ✅ **GOLDEN RULE #6:** GUID comments updated on all changed/new code, `code.json` in sync
13. ✅ **GOLDEN RULE #7:** Errors use `ERRORS.KEY` from error-registry.ts
14. ✅ **GOLDEN RULE #8:** Prompt prefix used on every response; violations logged to Vestige memory
15. ✅ **GOLDEN RULE #11:** Pre-commit security review completed, 5 questions answered, logged to Vestige

---

## After Pushing to Main - MANDATORY Build Verification

**Every push to `main` triggers a Firebase App Hosting build.** You MUST verify the build succeeds AND version consistency.

```powershell
powershell -Command "& 'C:Program Files (x86)GoogleCloud SDKgoogle-cloud-sdkingcloud.cmd' logging read 'resource.type="build"' --project=studio-6033436327-281b1 --limit=20 --freshness=15m --format='value(textPayload)'"
```

After build completes, verify BOTH pages show identical versions:
- **About:** https://prix6.win/about
- **Login:** https://prix6.win/login

---

## Current Sprint / Focus Areas

### In Progress
- [ ] WhatsApp integration for automated group messages

### Backlog
- [ ] (add planned work)

### Recently Completed
- [x] Migrated all ~47 remaining hardcoded PX codes to ERRORS.KEY.code across 15 files. Golden Rule #7 fully enforced.
- [x] Phase 9 - migrate all error handling to traced-error system
- [x] Tier 1 security audit + module indexer error traceability system
- [x] v1.17.0 - Smart Pit Lane Status, Waiting State, Deadline Visibility Warning, Apply to All Teams, Email Verification
- [x] Fixed login - correlation IDs to all errors, granted Service Account Token Creator role
- [x] Performance fix - lazy load ConsistencyChecker (reduced 4MB Firestore load)
- [x] Security audit - removed hardcoded secrets, updated .gitignore

---

## Compacting / Context Recovery

When you compact the conversation, you **must**:
1. Re-read this entire `CLAUDE.md` file
2. Run `node claude-sync.js read` to check coordination state
3. Inform the user you are caught up with the instructions

---

## Contact / Decisions

All architectural decisions go through Aaron. If unsure about approach, ask before implementing.

---

*This file is the single source of truth for project context. Keep it updated.*
