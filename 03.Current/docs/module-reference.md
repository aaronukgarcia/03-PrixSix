# docs/module-reference.md

> Full documentation for all 14 Prix Six modules.
> This file is referenced from `CLAUDE.md` and contains detailed data flows, key functions, and cross-module connections.

---

## Module 1: Scoring System

**Files:** `lib/scoring-rules.ts`, `lib/scoring.ts`, `api/calculate-scores/route.ts`, `lib/results-utils.tsx`
**Collections:** `users/{uid}/predictions` (R), `scores` (W), `race_results` (R/W)
**Purpose:** Hybrid position-based scoring engine that awards points based on how close each predicted driver is to their actual finishing position.

### Scoring Table

| Grade | Condition | Points |
|-------|-----------|--------|
| Exact | Predicted position matches actual | +6 |
| 1-off | 1 position away | +4 |
| 2-off | 2 positions away | +3 |
| 3+-off | 3+ positions away but still in top 6 | +2 |
| Miss | Driver not in top 6 | 0 |
| Bonus | All 6 predicted drivers finish in top 6 | +10 |

**Constants:** `SCORING_POINTS` (single source of truth), `SCORING_DERIVED.maxPointsPerRace` = 46, `SCORING_DERIVED.driversToPredict` = 6

### Data Flow

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
## Module 2: Logon & Session

**Files:** `api/auth/login/route.ts`, `api/auth/record-logon/route.ts`, `api/auth/record-logout/route.ts`, `services/authService.ts`
**Collections:** `users` (R/W), `user_logons` (W), `login_attempts` (W), `audit_logs` (W), `attack_alerts` (W)
**Purpose:** Dual authentication system supporting PIN login (email + 6-digit PIN) and OAuth (Google, Apple), with brute-force protection and session tracking.

### PIN Login Flow

1. Client POST to `/api/auth/login` with `{email, pin}`
2. Extract client IP from proxy headers (Cloudflare, X-Forwarded-For, Vercel)
3. Check lockout: if `failedLoginAttempts >= 5` and within 30-min window — reject
4. Look up user by email in Firestore `users` collection
5. Verify PIN via Firebase Auth REST API (`verifyPassword` endpoint)
6. On success: generate Firebase custom token — return to client
7. Client calls `signInWithCustomToken()` — `onAuthStateChanged` fires in provider

### OAuth Login Flow

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

## Module 3: Firebase Provider

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
- `onAuthStateChanged` listener syncs `emailVerified`, `providers[]`, `photoUrl` from Auth — Firestore
- `currentLogonId` tracks active session for logout recording
- Presence system writes to `user_logons` on login/logout

**Connects to:** `authService.ts` (OAuth operations), `audit.ts` (navigation logging), `error-registry.ts` (error codes), `types/league.ts` (global league ID)

---

## Module 4: Predictions

**Files:** `(app)/predictions/page.tsx`, `predictions/_components/PredictionEditor.tsx`, `api/submit-prediction/route.ts`
**Collections:** `users/{uid}/predictions` (R/W)
**Purpose:** 6-driver prediction grid per race per team. Users select their top-6 predicted finishers before qualifying begins.

### Data Flow

1. Page loads — fetches current race from schedule + existing prediction from Firestore
2. If no prediction exists for current race — carry-over from most recent prior race
3. User drags/selects 6 drivers into ordered grid
4. Submit — POST to `api/submit-prediction/route.ts`
5. Server validates: exactly 6 unique drivers, pitlane is open
6. Writes prediction doc with ID `{teamId}_{raceId}` to `users/{uid}/predictions`

**Pitlane Lock:** Predictions locked when `pitlaneOpen === false` (race results exist OR qualifying has started based on schedule time).

**AI Analysis:** Optional feature with 11 analysis facets and configurable weights (max 77 points). Weights stored in user profile as `AnalysisWeights`.

**Connects to:** `data.ts` (driver list, race schedule), `scoring-rules.ts` (driversToPredict = 6), `firebase/provider.tsx` (auth context)

---
## Module 5: Results & Standings

**Files:** `(app)/results/page.tsx`, `(app)/my-results/page.tsx`, `(app)/standings/page.tsx`, `lib/results-utils.tsx`
**Collections:** `scores` (R), `race_results` (R), `users` (R), `users/{uid}/predictions` (R)
**Purpose:** Three views for displaying scoring outcomes: per-race results, personal history, and season standings.

**Results Page:** Per-race view showing all teams' predictions vs actual results. Displays grade breakdown (exact/1-off/2-off/3+-off/miss) and bonus status per team.

**My Results Page:** Personal cross-race view with performance charts and statistics. Shows scoring trends, best/worst races, and grade distribution over the season.

**Standings Page:** Aggregated season totals with rank and tiebreaking. Tiebreaker: most 1st/2nd/3rd place correct predictions across all sessions.

**Shared Utilities (`results-utils.tsx`):** Common display functions for formatting scores, computing grade letters, rendering driver prediction comparisons.

**Connects to:** `scoring-rules.ts` (point values for display), `data.ts` (driver names/images), `normalize-race-id.ts` (race matching)

---

## Module 6: Email System

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

**Key Functions:**
- `sendEmail(to, subject, html)` — generic send with rate check
- `sendWelcomeEmail(to, teamName)` — templated welcome email
- `canSendEmail(firestore, toEmail)` — rate limit check
- `queueEmail(firestore, emailData)` — deferred send

**Connects to:** `email-tracking.ts` (rate limiting, queue ops), `firebase-admin.ts` (Firestore access)

---

## Module 7: Teams & Leagues

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
## Module 8: Backup & Recovery

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

## Module 9: Security & Attack Detection

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

## Module 10: Consistency Checker

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
## Module 11: Audit Trail

**Files:** `lib/audit.ts`
**Collections:** `audit_logs` (W)
**Purpose:** Client-side audit logging with session correlation IDs, automatic navigation tracking, and fire-and-forget Firestore writes.

**Correlation IDs:** Session-scoped (one per browser tab), generated as RFC 4122 v4 GUIDs on first access.

**Key Functions:**
- `getCorrelationId()` — returns (or lazily generates) session correlation ID
- `logAuditEvent(firestore, userId, action, details)` — fire-and-forget write to `audit_logs`
- `useAuditNavigation()` — React hook that auto-logs page navigations via usePathname()

**Connects to:** `firebase/provider.tsx`, `firebase/non-blocking-updates.ts`, `firebase/errors.ts`

---

## Module 12: Schedule & Data

**Files:** `lib/data.ts`, `lib/normalize-race-id.ts`
**Collections:** None (static data)
**Purpose:** Single source of truth for F1 driver roster and race schedule.

**Helper Functions:**
- `getDriverImage(driverId)` — resolves driver ID to profile image URL
- `getDriverName(driverId)` — resolves lowercase ID to proper-case display name
- `getDriverCode(driverId)` — derives 3-letter uppercase code

**Race ID Normalization:**
- `normalizeRaceId(raceId)` — strips suffixes, replaces spaces with hyphens. Case-preserving.
- `normalizeRaceIdForComparison(raceId)` — same as above but lowercased for cross-collection matching.

**Connects to:** Every module that displays drivers or checks race schedules (scoring, predictions, consistency, results)

---
## Module 13: Error Handling

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

**`error-codes.ts`:** Master registry of all ERROR_CODES. Provides generateClientCorrelationId() and display formatting utilities.

**`error-registry.ts`:** Auto-generated by `scripts/generate-error-registry.ts` from `code.json`. Exports ERRORS record with full ErrorDefinition per key.

**`traced-error.ts`:** Factory functions:
- `generateCorrelationId(prefix)` — format: [prefix]_[timestamp-base36]_[random-6]
- `createTracedError(definition, options)` — creates TracedError from ERRORS.KEY with correlation ID + context + cause chain
- `logTracedError(error)` — writes to `error_logs` (server) or POST to /api/log-client-error (client)

**Golden Rule #7:** All errors must use ERRORS.KEY.code — no hardcoded error strings.

**Connects to:** Every module that handles errors (all API routes, Cloud Functions, client components)

---

## Module 14: WhatsApp Integration

**Files:** `api/whatsapp-proxy/route.ts`, `admin/_components/WhatsAppManager.tsx`
**Collections:** `users` (R — admin check)
**Purpose:** HTTPS proxy bridging the browser to an HTTP-only WhatsApp worker on Azure Container Instances, with admin authentication and HMAC request signing.

**Architecture:** Browser (HTTPS) → Next.js proxy → WhatsApp worker (HTTP on prixsix-whatsapp.uksouth.azurecontainer.io:3000)

**Security:**
- Admin-only: verifies Firebase Auth token + Firestore isAdmin flag
- HMAC SHA-256 request signing via WHATSAPP_APP_SECRET env var
- Endpoint whitelist: health, status, qr (GET only)

**Key Functions:**
- `signRequest(payload)` — generates sha256= HMAC signature
- `GET(request)` — proxies read-only requests (health/status/qr)
- `POST(request)` — proxies write requests (send message, etc.)

**Admin UI (WhatsAppManager):** Worker status display, QR code for WhatsApp Web pairing, alert configuration, custom messaging, and queue viewer.

**Connects to:** `firebase-admin.ts` (auth verification), Azure Container Instances (worker)

---

*See also: `CLAUDE.md` for the module quick-index table.*
