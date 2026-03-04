# COLLECTIONS.md — Firestore Collection Access Map

> Single reference for "what writes to X?" and "what reads X?" questions.
> When a data bug surfaces, start here.
> Last updated: 2026-03-03

---

## Collection Index

| Collection | Type | Purpose |
|-----------|------|---------|
| [`users`](#users) | Root | Player profiles, team names, admin flag |
| [`users/{uid}/predictions`](#usersuiddpredictions) | Subcollection | Per-race driver predictions |
| [`race_results`](#race_results) | Root | Official race finishing order — locks predictions |
| [`scores`](#scores) | Root | ⚠️ DEPRECATED — see note |
| [`leagues`](#leagues) | Root | League membership |
| [`audit_logs`](#audit_logs) | Root | Admin/system action trail |
| [`login_attempts`](#login_attempts) | Root | Brute-force detection |
| [`attack_alerts`](#attack_alerts) | Root | Automated attack detection flags |
| [`error_logs`](#error_logs) | Root | Runtime error audit trail |
| [`consistency_reports`](#consistency_reports) | Root | CC export reports |
| [`book_of_work`](#book_of_work) | Root | Feature/bug backlog (admin) |
| [`email_logs`](#email_logs) | Root | Email send history |
| [`email_queue`](#email_queue) | Root | Pending email jobs |
| [`app-settings`](#app-settings) | Root | Global config (hot news, pubchat, WhatsApp) |
| [`official_teams`](#official_teams) | Root | 2026 F1 team → driver number map |
| [`feedback`](#feedback) | Root | User bug/feature reports |
| [`backup_status`](#backup_status) | Root | Daily backup heartbeat |
| [`coordination`](#coordination) | Root | claude-sync session coordination |

---

## `users`

**Purpose:** Player profiles, auth state, team configuration.

**Key fields:** `teamName`, `secondaryTeamName`, `isAdmin`, `email`, `isEmailVerified`, `pinHash`, `lockedUntil`, `failedLoginAttempts`

**Writers:**
- `api/auth/login` — sets `failedLoginAttempts`, `lockedUntil` on lockout
- `api/auth/signup` — creates initial user doc
- `api/submit-prediction` — verifies team ownership (read only)
- Admin UI (TeamManager) — updates `teamName`, `isAdmin`
- `calculate-scores` — reads `teamName` for score attribution

**Readers:**
- `calculate-scores` — builds `userMap` (userId → teamName)
- `delete-scores` — admin auth check
- `submit-prediction` — team ownership validation
- All auth-gated pages — via `useAuth()` hook
- `consistency.ts` — full user scan for league/prediction consistency

**⚠️ Gotchas:**
- `aaron@garcia.ltd` and `aaron.garcia@hotmail.co.uk` are protected — DO NOT MODIFY without explicit instruction
- Secondary team: `{userId}-secondary` is a virtual teamId, not a separate user doc
- `pinHash` is a bcrypt hash — never log or expose

---

## `users/{uid}/predictions`

**Purpose:** Per-user, per-race driver predictions (6-position ordered array).

**Key fields:** `raceId`, `teamId`, `teamName`, `predictions[]`, `submittedAt`, `isCarryForward`

**raceId format (TWO formats exist — see GOTCHAS #5):**
- User-submitted: `"Australian-Grand-Prix-GP"` (with `-GP` suffix)
- Carry-forward (system-created): `"Australian-Grand-Prix"` (without `-GP` suffix)

**Writers:**
- `api/submit-prediction` — user submission → `{teamId}_{raceId}` doc ID
- `api/calculate-scores` — creates carry-forward docs for teams with no race-specific prediction

**Readers:**
- `api/calculate-scores` — `collectionGroup('predictions')` to score all teams
- `api/delete-scores` — `collectionGroup('predictions')` dual-query to cascade delete
- `predictions/page.tsx` — loads current user's prediction for display
- `results/page.tsx` — shows breakdown of user's prediction vs result

**⚠️ Gotchas:**
- ALWAYS query via `collectionGroup('predictions')` not `collection('predictions')` — predictions live in subcollections
- Two raceId formats require two collectionGroup queries when deleting — see `delete-scores/route.ts`
- Carry-forward docs have `isCarryForward: true` — useful for debugging "where did this prediction come from?"
- `calculate-scores` is intentionally unbounded on this query — see GOTCHAS #9

---

## `race_results`

**Purpose:** Official race finishing order. Existence of a doc LOCKS predictions for that race.

**Key fields:** `id`, `raceId`, `driver1`–`driver6`, `submittedAt`

**Doc ID format:** `"Australian-Grand-Prix-GP"` or `"Australian-Grand-Prix-Sprint"` (WITH suffix, Title-Case)

**Writers:**
- `api/calculate-scores` — creates doc when admin submits results (batch write)
- `api/delete-scores` — deletes doc when admin voids results (batch delete)

**Readers:**
- `predictions/page.tsx` — checks existence to determine pit lane lock
- `api/submit-prediction` — checks existence to enforce server-side lockout
- `results/page.tsx` — reads finishing order for breakdown display
- `consistency.ts` — validates result doc integrity

**⚠️ Gotchas:**
- A doc existing here IMMEDIATELY locks the predictions page — see GOTCHAS #3 and #4
- Dashboard does NOT check `race_results` — only checks qualifying time. Can show "Open" while predictions page shows "Closed"
- `_simulate_season.js` populates ALL 24 races — wipe after running, see GOTCHAS #3
- Deleting this doc without also deleting `scores` leaves standings wrong — see GOTCHAS #2

---

## `scores`

**⚠️ STATUS: DEPRECATED (ARCH CHANGE SSOT-001)**

Previously stored computed per-race scores. Now scores are calculated in real-time from `race_results` + `predictions` on every `standings` and `my-results` page load.

**If you see docs in this collection:** They are legacy data from before SSOT-001. Safe to ignore or delete.

**Nothing currently writes to this collection.**

---

## `leagues`

**Purpose:** League membership — maps league ID to member user IDs.

**Key fields:** `name`, `memberUserIds[]`, `ownerId`, `inviteCode`

**Main league doc ID:** `global` (NOT "Global League")

**Writers:**
- Admin UI (LeaguesManager) — create/delete leagues
- `api/leagues/join-by-code` — appends userId to `memberUserIds`
- `api/leagues/delete` — removes league doc

**Readers:**
- `teams/page.tsx` — loads user's leagues
- `standings/page.tsx` — filters standings by league
- `LeagueSelector` component — populates league switcher

**⚠️ Gotchas:**
- `memberUserIds` can contain `-secondary` suffixed IDs — these are malformed, see GOTCHAS #8
- Global League cleaned 2026-03-03: 138 → 37 real players (101 ghost IDs removed)
- Invite codes are 8 characters — do not reveal exact length in error messages (timing oracle)

---

## `audit_logs`

**Purpose:** Admin and system action trail.

**Key fields:** `userId`, `action`, `details{}`, `timestamp`

**Common actions:** `RACE_RESULTS_SUBMITTED`, `RACE_RESULTS_DELETED`, `PREDICTION_SUBMITTED`, `ADMIN_ACTION`

**Writers:** Almost all API routes write an audit entry on significant actions.

**Readers:**
- Admin UI (AuditLogViewer) — display trail
- `consistency.ts` — checks audit completeness

**⚠️ Gotchas:** Contains admin user IDs — treat as sensitive. Do not expose raw to users.

---

## `login_attempts`

**Purpose:** Brute-force and attack detection per IP and per email.

**Key fields:** `email`, `ipAddress`, `success`, `timestamp`, `failureReason`

**Writers:** `api/auth/login` — logs every attempt, success or failure

**Readers:** `lib/attack-detection.ts` — `checkForAttack()` scans last N attempts for patterns

**⚠️ Gotchas:**
- Contains real IP addresses and email addresses — PII, treat carefully
- TTL not enforced by code — old docs accumulate. Periodically prune.

---

## `attack_alerts`

**Purpose:** Automated alerts when attack patterns are detected.

**Key fields:** `type` (`bot_attack`/`credential_stuffing`/`brute_force`), `ipAddress`, `email`, `timestamp`

**Writers:** `lib/attack-detection.ts` when threshold exceeded

**Readers:** Admin UI (AttackMonitor component)

---

## `error_logs`

**Purpose:** Runtime error audit trail from traced errors.

**Key fields:** `errorCode`, `correlationId`, `module`, `severity`, `context{}`, `createdAt`

**Writers:** `logTracedError()` in `lib/traced-error.ts` — called from all API routes on error

**Readers:** Admin UI (ErrorLogViewer)

**⚠️ Gotchas:**
- NOTHING derives from `error_logs` — safe to wipe at any time, see GOTCHAS #10
- `skipErrorEmit: true` on `addDocumentNonBlocking` prevents error_logs writes from recursively logging their own errors
- Bot crawler errors filtered BEFORE reaching error_logs via `GlobalErrorLogger.tsx`

---

## `consistency_reports`

**Purpose:** Exported Consistency Checker scan results.

**Key fields:** `correlationId`, `issues[]`, `runAt`, `summary{}`

**Query by:** `correlationId` field (format: `cc_XXXXXXXXXX_XXXXXXXX`) — NOT by doc ID

**Writers:** `lib/consistency.ts` → `runConsistencyCheck()` export function

**Readers:** Admin UI (ConsistencyChecker) — via `/cc` skill

**⚠️ Gotchas:**
- Do NOT search `error_logs` for CC correlation IDs — they're in `consistency_reports`, see GOTCHAS #7

---

## `book_of_work`

**Purpose:** Feature/bug/chore backlog visible in the admin Book of Work panel.

**Key fields:** `referenceId`, `title`, `description`, `technicalDetails`, `category`, `severity`, `status`, `priority`, `module`, `versionReported`, `createdBy`, `createdAt`, `updatedAt`

**Writers:** Admin scripts (`scripts/add-*-to-bow.ts`), Admin UI (BookOfWorkManager)

**Readers:** Admin UI (BookOfWorkManager) — displays to admin users only

---

## `email_logs`

**Purpose:** Record of every email sent.

**Key fields:** `to`, `subject`, `type`, `status`, `sentAt`, `correlationId`

**Writers:** `lib/email.ts` → `sendEmail()` — writes log entry for every send attempt

**Readers:** Admin UI (EmailLogManager)

---

## `email_queue`

**Purpose:** Pending email jobs (queued for async delivery).

**Key fields:** `to`, `subject`, `body`, `type`, `createdAt`, `status`

**Writers:** `api/email-queue` — enqueues emails for background processing

**Readers:** `api/email-queue` — processes pending queue items

---

## `app-settings`

**Purpose:** Global application configuration documents.

**Sub-documents:**

| Doc ID | Purpose | Key fields |
|--------|---------|-----------|
| `hot-news` | AI Hot News Feed content | `newsFeed`, `lastUpdated`, `refreshCount` |
| `pubchat` | PubChat widget config | `timingData`, `lastUpdated` |
| `whatsapp-alerts` | WhatsApp notification config | `enabled`, `alertTypes[]` |

**Writers:**
- `hot-news`: `api/cron/refresh-hot-news` (via `hotNewsFeedFlow()`)
- `pubchat`: `api/admin/fetch-timing-data`
- `whatsapp-alerts`: Admin UI (WhatsApp settings panel)

**Readers:**
- `hot-news`: `ai/flows/hot-news-feed.ts` `getHotNewsFeed()`, dashboard `HotNewsFeed` component
- `pubchat`: `firebase/firestore/settings.ts` `getPubChatTimingData()`

---

## `official_teams`

**Purpose:** 2026 F1 team → driver number mapping for PubChat Team Lens.

**Doc IDs:** `mclaren`, `mercedes`, `red_bull`, `ferrari`, `williams`, `racing_bulls`, `aston_martin`, `alpine`, `audi`, `haas`, `cadillac`

**Schema:**
```json
{
  "teamName": "Williams",
  "teamColour": "00A0DE",
  "openf1TeamName": "Williams Racing",
  "season": 2026,
  "drivers": [
    { "surname": "Sainz", "fullName": "Carlos Sainz", "number": 55 },
    { "surname": "Albon", "fullName": "Alex Albon", "number": 23 }
  ]
}
```

**Writers:** `scripts/seed-official-teams.ts` (one-shot, already run)

**Readers:** `PubChatPanel` admin component on mount via `getOfficialTeams(firestore)`

**⚠️ Gotchas:**
- Williams 2026: Sainz #55, Albon #23 — verify if Team Lens shows no drivers, see GOTCHAS #12

---

## `feedback`

**Purpose:** User-submitted bug reports and feature requests.

**Key fields:** `userId`, `type` (`bug`/`feature`), `text`, `status`, `resolvedVersion`, `resolvedNotifiedAt`

**Writers:** Feedback submission form (user-facing)

**Readers:**
- Admin UI (FeedbackManager)
- `dashboard/_components/ResolvedFeedbackNotifier` — polls for `status='resolved'` + `resolvedNotifiedAt=null`

---

## `backup_status`

**Purpose:** Daily backup heartbeat — confirms backup ran and what it produced.

**Doc ID:** `latest`

**Writers:** `functions/index.js` `dailyBackup` Cloud Function

**Readers:** Admin UI (BackupHealthDashboard)

---

## `coordination`

**Purpose:** Claude multi-instance session coordination (claude-sync.js).

**Doc ID:** `claude-state`

**Writers/Readers:** `claude-sync.js` exclusively — do not modify manually
