# CLAUDE.md - Prix Six Project Brief

> **Last updated:** 2026-10-03 (paths moved to E:\git\prix6; branch strategy matches practice — no `develop`; build check via Cloud Build europe-west4; BT/EE block note)
> **Current production version:** Check `package.json` and verify at https://prix6.win/about
> **Read this entire file at the start of every session.**

## Global Golden Rules

<!-- forge:tier1 -->
## Invariants (tier 1, gated; the full text is docs/forge/KIT-INVARIANTS.md)
I1  No money is spent without a token Aaron minted for that pattern (gate.py cost set, fail-closed).
I2  No secret is committed, pushed or left loose (pre-push gitleaks; .gitleaksignore change needs a token; roots swept nightly).
I3  No file is created outside a project boundary; scratch goes to %TEMP% (boundary.js).
I4  Nothing outside the project temp or E:\SAFE\drill is deleted without a token, the SAFE quarantine included (gate.py destructive set, fail-closed).
I5  No AI attribution reaches git: no Co-Authored-By Claude, no "Generated with Claude Code", no Claude-Session trailer (commit-msg).
I6  Every backup stream has a passed restore drill inside its window (safe-drill.js).
I7  The nightly ran and every archive is proven, or ALERT.md exists (safe-backup.js, safe-status).
I8  A hook never blocks a call because it crashed, except the money, secret and deletion gates, which fail closed with a logged disable variable.
I9  This window is <identity> and writes only to its own database (launcher, claude-db.js).
I10 This project runs the current required kit and the kit's files do not change without a trace (forge drift, kit hash).
I11 Nothing executes from a cloud-synced folder (safe-status path check).
I12 Every change to the kit, the rules or the registry carries its project, session and identity (forge event, CHECK constraints).
Practices (tier 2, per profile) and lessons (tier 3): `GGR.md` (generated, never hand-edited; labels `GGR<no>v<version>`); lessons by topic: `node vestige-pointer.js find <topic>`.
GGR58 (practice, every project that dispatches agents): Every agent dispatch names its model by role (Haiku/Sonnet clerical, Sonnet developer, Opus hostile review/second bounce) and a BUDGET line; the dispatch guard refuses an inherited model.
<!-- /forge:tier1 -->


---

## 🚀 HOW TO START A SESSION (do this before anything else)

**Every Claude Code window must be launched from the project directory:**

```powershell
cd E:\git\prix6\03.Current
claude --add-dir E:\AI\Memory\source
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

> **No env var needed at all inside Claude Code (claude-sync v2.2).** Every window's checkin is
> automatically mapped to its own `CLAUDE_CODE_SESSION_ID` in `.claude-session-map.json`, so the
> renewal hook always renews the right permit — even with Bill, Bob and Ben running simultaneously.
> `$env:CLAUDE_SESSION_ID` is only needed in plain terminals outside Claude Code (it still wins if set).

**If wrong instance grabbed your name — HUMAN MUST RUN THIS, not Claude:**
```powershell
node claude-sync.js checkin --name Bill --force --human-ok   # evict impostor, claim Bill
```
> ⚠️ **`--human-ok` is a human-only flag.** Claude instances are NEVER permitted to supply `--human-ok` autonomously. Without it, `--force` is blocked at the script level.

> 🔁 **Crash/reboot auto-recovery (claude-sync v2.1).** If your previous session **crashed or the machine rebooted** without checking out, you no longer need `--force`. A plain `checkin --name Bill` now **auto-reclaims** your own name from the dead holder — proven dead via boot-id mismatch (reboot) or a stale local heartbeat (crash). A *genuinely live* holder keeps a fresh heartbeat and is never reclaimed, so eviction of a live peer still requires the human-only `--force --human-ok`. "If you were Bill and you crashed, you come back as Bill."

> 🛡️ **Idle protection & wake recovery (claude-sync v2.2, 2026-07-13).** The renewal hook only fires on tool use, so an **idle** window's permit expires at TTL. Two safeguards now cover this:
> 1. **Reserved slots** — a permit that expired < 30 min ago (same OS boot) stays *reserved* for its holder. Another window asking for that name is rejected ("SLOT IS RESERVED") and should run `checkin --any` for the next free slot. A reboot voids reservations; a human can override with `--force --human-ok`.
> 2. **Wake recovery** — when the idle window becomes active again, its next hook fire automatically re-acquires its old name (or, if the name was genuinely taken, takes the next free slot and prints a loud **IDENTITY CHANGED** notice — obey it and switch your prefix).
>
> Don't trust the `← YOU` marker or an "I am Bill" assumption after any anomaly — `node claude-sync.js status` shows what your *window* actually holds.

---

## ⚠️ GLOBAL GOLDEN RULES (GGR) — INVIOLABLE, NON-NEGOTIABLE

**Since 2026-09-19 the rules are one set, identical in every project (Aaron's ruling), held in the `forge` registry and rendered here as `GGR.md`.** Read `GGR.md` in full at the start of every session; it replaces the 19-rule table that used to live here. Each rule is labelled `GGR<no>v<version>` and keeps developing: refine one from inside this project with `node E:\GoogleDrive\Tools\new\forge.js rule set <no> --summary "..." --note "why" --from prix6`, then re-render with `node E:\GoogleDrive\Tools\new\forge.js ggr --out GGR.md`. Never hand-edit `GGR.md`. Rules with an *applies when* clause (deploy bundling, determinism gate, codename) are dormant until the condition holds but are still the rule.

**Alias table — the old Prix Six GR numbers still appear in hook messages, skills, memory and commit history. Read them as:**

| Old | GGR | Old | GGR | Old | GGR |
|-----|-----|-----|-----|-----|-----|
| GR#1 error trapping | GGR1 | GR#8 identity enforcement | GGR7 | GR#15 validators from data | GGR30 |
| GR#2 version discipline | GGR43 | GR#9 shell preference | GGR25 | GR#16 type-safe storage | GGR29 |
| GR#3 SSOT | GGR6 | GR#10 dependency updates | GGR18 | GR#17 silent failures | GGR3 |
| GR#4 identity prefix | GGR7 | GR#11 security review | GGR17 | GR#18 dead-code audit | GGR32 |
| GR#5 verbose confirmations | GGR8 | GR#12 completeness | GGR11 + GGR35 | GR#19 deploy bundling | GGR45 |
| GR#6 GUID documentation | GGR22 | GR#13 complete all N | GGR10 | | |
| GR#7 registry errors | GGR5 | GR#14 memory recall | GGR9 | | |

Binding here since the port and new to this project: **GGR15 nothing committed un-attacked**, **GGR12 no code left behind** (tree-reverting git commands banned), **GGR13 converge early**, **GGR14 verify against CI**, **GGR16 cost gate** (user-scope `cost_gate.py` hook + `/cost-gate` skill; never mint a token without Aaron's Authorise), **GGR44 local merge + push only, never a host-side merge** (the committer-email leak), **GGR62 launcher dry-run before handover**, **GGR63 nothing executes from a synced folder**, plus the AI-Rules ERR/REL/DATA/SEC families and the BIAS_GUARD assessment rules.

> **Full implementation patterns, code templates, and compliance checklists:** `docs/golden-rules-detail.md` (still numbered by the old GR#; use the alias table).

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

**Step 2:** Nothing — per-window identity is automatic (v2.2). Your checkin is keyed to this
window's `CLAUDE_CODE_SESSION_ID`; the renewal hook renews the correct permit in any
multi-agent setup. (`$env:CLAUDE_SESSION_ID` is only for plain terminals outside Claude Code.)

**Step 3:** Complete these checks:
1. Run `git status` and confirm your branch
2. Run `git pull` to get latest changes
3. Run `node claude-sync.js read` to review the coordination state

**Step 4:** Announce yourself with your assigned name:
```
Prix6-Bill> Good morning, I'm Prix6-Bill on branch main. No conflicts detected.
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
| Second instance (Bob) | `Prix6-Bob> ` | `Prix6-Bob> The build completed...``` |
| Third instance (Ben) | `ben> ` | `ben> I've reviewed the backup system...``` |

Every 5 responses, mentally verify you are still using your prefix. If you drop it: add it immediately and apologise.

If you need to check your assignment: `node claude-sync.js read`

---

### Permit Auto-Renewal — Handled by hook

Permits have a **5-minute TTL**. The `PostToolUse` hook (`claude-ping-check.js`) automatically calls `renew --auto` every 2 minutes, renewing only when < 3.5 minutes remain. **You do not need to manually ping** — the hook identifies your window automatically via `CLAUDE_CODE_SESSION_ID` (v2.2). If your permit expires while you were idle, the same hook re-acquires your name on your next action (wake recovery) — watch for a `[claude-sync]` notice and obey any IDENTITY CHANGED instruction in it.

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
Prix6-Bill> Goodnight! Prix6-Bill checked out. Session ended.
```

### During the Session

| Command | When to use |
|---------|-------------|
| `node claude-sync.js checkin` | Start of session — auto-assigns Bill/Bob/Ben |
| `node claude-sync.js checkin --any` | Next free slot, ignoring `CLAUDE_IDENTITY` — use after a REJECTED/RESERVED response |
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
- **Project root:** `E:\git\prix6\03.Current` (the git repo root is one level up, `E:\git\prix6`)
- **Firebase service account:** `E:\git\prix6\03.Current\service-account.json`
- **Temp / scratch:** `E:\git\prix6\03.Current\temp` (git-ignored) — nothing is written outside the project (GGR66)
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

**MCP Install Location:** per-server paths are recorded in `C:\Users\aarongarcia\.claude.json` (e.g. `E:\AI\utils\ms-365`). The old `E:\GoogleDrive\Tools\MCP` folder no longer exists.

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
| 16 | Pre-Race Showreel | `(app)/pit-wall/_hooks/usePreRaceMode.ts`, `_hooks/useHistoricalReplay.ts`, `api/pit-wall/historical-sessions/route.ts`, `api/pit-wall/historical-replay/route.ts` | None (OpenF1 2025 historical telemetry, no Firestore) |
| 17 | Billceleration (AI team) | `lib/billceleration.ts`, `ai/flows/billceleration-picker.ts`, `api/cron/billceleration/route.ts`, `functions/index.js` (billcelerationTick) | `admin_configuration` (billceleration/State/Status), `billceleration_log`, `users/{bot}/predictions` |

---
## Git Discipline

### Branch Strategy

| Branch | Purpose | Triggers Deploy? |
|--------|---------|------------------|
| `main` | Production-ready code only | **YES** — never commit code directly |
| `feature/*` | Individual feature work, branched from `main` | No |

There is no `develop` branch (it was planned but never created). Docs-only and hook-only changes that ship no app code may go straight to `main` (precedent `5d5b92d`, `c28ee15`); they still trigger a build.

**Rules:**
1. **Never commit directly to `main`** — each push triggers a 3-5 minute build + deployment costs
2. Always branch from an up-to-date `main` for new work
3. Before starting work, always run `git status` to check another Claude Code instance isn't active
4. Only merge to `main` when explicitly instructed ("merge to main", "deploy this", "push to production")

### Creating a Feature Branch
```bash
git checkout main
git pull
git checkout -b feature/<short-description>
```

### Merging to Main (only when instructed)
```bash
git checkout main
git merge --squash feature/<branch-name>
git commit -m "<type>: <summary of changes> (vX.Y.Z)"
git push origin main
git branch -D feature/<branch-name>   # -d refuses after a squash; first confirm `git diff main feature/<branch-name>` is empty
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
3. **Keep work off main until it is ready** - feature branches do not trigger builds

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
10. ✅ **GOLDEN RULE #4:** Prefix your commit confirmation with the launcher identity (e.g. Prix6-Bill>)
11. ✅ **GOLDEN RULE #5:** Use verbose confirmation
12. ✅ **GOLDEN RULE #6:** GUID comments updated on all changed/new code, `code.json` in sync
13. ✅ **GOLDEN RULE #7:** Errors use `ERRORS.KEY` from error-registry.ts
14. ✅ **GOLDEN RULE #8:** Prompt prefix used on every response; violations logged to Vestige memory
15. ✅ **GOLDEN RULE #11:** Pre-commit security review completed, 5 questions answered, logged to Vestige
16. ✅ **GOLDEN RULE #12:** All dependent systems implemented (no orphaned imports, no feature without backup/restore test, no endpoint without error logging)
17. ✅ **GOLDEN RULE #13:** Every issue the user identified is resolved — none deferred as "TODO" or "lower priority"
18. ✅ **GOLDEN RULE #14:** Vestige queried for project-specific commit-style and topic rules before composing the message
19. ✅ **GOLDEN RULE #15:** Any new validator derives expected counts/values from data, not hardcoded constants
20. ✅ **GOLDEN RULE #16:** Date/string coercion of Firestore data uses `safeX()` helpers (never `new Date(rawField)` directly)
21. ✅ **GOLDEN RULE #17:** New scheduled functions write a status field that `/health-check` CHECK 11 can monitor for freshness
22. ✅ **GOLDEN RULE #18:** If this commit eliminates a collection/field, dead-code audit ran (orphaned readers checked in the same commit)
23. ✅ **GOLDEN RULE #19:** If `functions/` changed, commit message ends with `firebase deploy --only functions:...` bundling ALL pending function changes

---

## After Pushing to Main - MANDATORY Build Verification

**Every push to `main` triggers a Firebase App Hosting build.** You MUST verify the build succeeds AND version consistency.

```powershell
# App Hosting builds run in Cloud Build region europe-west4. Run from PowerShell (Git Bash mangles the filters).
$g = 'C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
& $g builds list --project=studio-6033436327-281b1 --region=europe-west4 --limit=2 --format='value(id,status,createTime,finishTime)'
```

`SUCCESS` on the newest build is not the end: confirm the new revision (`prixsix-build-YYYY-MM-DD-NNN`) is the one serving, then check the pages.

After build completes, verify BOTH pages show identical versions:
- **About:** https://prix6.win/about
- **Login:** https://prix6.win/login

> **prix6.win can be unreachable from the dev machine's network (found 2026-10-03).** The BT broadband connection (Hub Threat Protect; the block page is shared with EE and hosted on an EE address) intercepts the hostname and redirects to `block.ee.co.uk/ee/warn.html`, so curl fails the TLS handshake (exit 35, "wrong version number") and the browser shows an error page. That is the network, not the site: the same Cloudflare IP answers normally for any other hostname. Verify through the App Hosting default domain instead — `https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/login` — and remember that players on BT or EE broadband may be seeing the same block (BOW OPS-EE-BLOCK-001).

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

> **Hook support (2026-09-18):** `claude-startup.js` is source-aware — on a `compact` SessionStart it
> skips the fresh checkin, renews the existing permit, and re-injects a **POST-COMPACTION RESUME** block
> (identity, branch, the steps above). Obey it. The PreCompact echo in `.claude/settings.json` is NOT
> injected into the summary; only this SessionStart path is.
>
> **Compact timing:** `claude-ping-check.js` prints a `[claude-sync] CONTEXT …` nudge once the window
> passes 75% (then every 25k tokens). When you see it, finish the current step, write any in-flight plan
> to a file or Vestige, then ask the user to run `/compact` at that boundary. Never mid-edit.

---

## Contact / Decisions

All architectural decisions go through Aaron. If unsure about approach, ask before implementing.

---

*This file is the single source of truth for project context. Keep it updated.*
