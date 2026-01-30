# claude-comment.md - Codebase Documentation Census

> **Generated:** 2026-01-30
> **Version:** 1.25.12
> **Purpose:** Track GUID comment coverage and codebase documentation health

---

## Codebase Census

### Overall Metrics

| Metric | Value |
|--------|-------|
| Total source files (.ts, .tsx, .js) | 158 |
| Total lines of code | 33,915 |
| Total blank lines | 3,170 (9.35%) |
| Total comment lines | 2,081 (6.1%) |
| Files with comments | 105 |
| Files with NO comments (any size) | 53 |
| Files below 10% comment ratio (50+ lines) | 37 |

### File Size Distribution

| Size Category | File Count |
|---------------|-----------|
| 0-50 lines | 36 |
| 51-100 lines | 20 |
| 101-200 lines | 51 |
| 201-500 lines | 32 |
| 500+ lines | 19 |

### Top 10 Largest Files

| Lines | File |
|-------|------|
| 1,453 | app/src/lib/consistency.ts |
| 1,333 | app/src/app/(app)/admin/_components/WhatsAppManager.tsx |
| 1,096 | app/src/app/(app)/profile/page.tsx |
| 955 | app/src/app/(app)/standings/page.tsx |
| 834 | app/src/app/(app)/results/page.tsx |
| 816 | app/src/firebase/provider.tsx |
| 786 | app/src/app/(app)/about/page.tsx |
| 763 | app/src/components/ui/sidebar.tsx |
| 648 | app/src/app/(app)/predictions/_components/PredictionEditor.tsx |
| 634 | app/src/app/(app)/admin/_components/ResultsManager.tsx |

---

## GUID Coverage

### Summary

| Location | GUIDs in code | GUIDs in code.json | Coverage |
|----------|---------------|-------------------|----------|
| functions/index.js | 24 | 21 (BACKUP_FUNCTIONS) | Full |
| app/src/app/(app)/admin/_components/BackupHealthDashboard.tsx | ~14 | 14 (BACKUP_DASHBOARD) | Full |
| app/src/app/(app)/admin/page.tsx | 3 | 3 (BACKUP_ADMIN_TAB) | Partial (backup tab only) |
| app/src/lib/error-codes.ts | 1 | 1 (BACKUP_ERRORS) | Partial (PX-7xxx only) |
| firestore.rules | 1 | 1 (BACKUP_RULES) | Partial (backup rules only) |
| Provisioning scripts (may not be in repo) | — | 18 (PROVISION_RECOVERY) | Infrastructure |
| All other app/src/ files (150+) | 0 | 0 | **None** |
| **Total** | **~43** | **58** | **~6% of files** |

### code.json Module Distribution

| Module Prefix | GUID Count | Location |
|---------------|-----------|----------|
| BACKUP_FUNCTIONS | 21 | functions/index.js |
| PROVISION_RECOVERY | 18 | Infrastructure/provisioning |
| BACKUP_DASHBOARD | 14 | BackupHealthDashboard.tsx |
| BACKUP_ADMIN_TAB | 3 | admin/page.tsx |
| BACKUP_ERRORS | 1 | error-codes.ts |
| BACKUP_RULES | 1 | firestore.rules |
| **Total** | **58** | |

### GUID Version Distribution (code.json)

| Version | Count | Meaning |
|---------|-------|---------|
| v03 (Fully Audited) | 55 | Business logic documented |
| v04 (Post-Audit Fix) | 3 | Updated after bug fixes |
| v01, v02 | 0 | N/A |

### Key Observation

All 58 GUIDs relate to the **backup & recovery system** only. Zero GUIDs exist for:
- Scoring logic (scoring.ts, scoring-rules.ts)
- Authentication (login, signup, PIN reset routes)
- Attack detection (attack-detection.ts)
- Consistency checking (consistency.ts - 1,453 lines)
- Email system (email.ts, email-tracking.ts)
- Prediction management (submit-prediction route)
- League management (leagues.ts)
- Any page components or admin components (except backup dashboard)

---

## Diagnostic Tags

| Tag | Count | Purpose |
|-----|-------|---------|
| @ERROR_PRONE | 0 | Mark fragile code |
| @TECH_DEBT | 0 | Mark technical debt |
| @AUDIT_NOTE | 0 | Auditor observations |
| @PERF_SENSITIVE | 0 | Performance-critical sections |

No diagnostic tags have been deployed yet.

---

## Entry Points Inventory

### API Routes (22)

| Route | Purpose |
|-------|---------|
| /api/add-secondary-team | Add secondary team for user |
| /api/admin/delete-user | Admin: delete user account |
| /api/admin/update-user | Admin: update user details |
| /api/ai/analysis | AI-powered analysis endpoint |
| /api/auth/login | User login with PIN |
| /api/auth/reset-pin | Reset user PIN |
| /api/auth/signup | New user registration |
| /api/calculate-scores | Score calculation for race results |
| /api/delete-scores | Delete scores for a race |
| /api/email-health | Email system health check |
| /api/email-queue | Email queue processing |
| /api/log-client-error | Client-side error logging |
| /api/send-hot-news-email | Send hot news emails |
| /api/send-results-email | Send race results emails |
| /api/send-secondary-email-verification | Secondary email verification |
| /api/send-verification-email | Primary email verification |
| /api/send-welcome-email | Welcome email for new users |
| /api/submit-prediction | Submit race prediction |
| /api/update-secondary-email | Update secondary email address |
| /api/verify-email | Verify primary email |
| /api/verify-secondary-email | Verify secondary email |
| /api/whatsapp-proxy | WhatsApp message proxy |

### Page Routes (21)

| Route | Purpose |
|-------|---------|
| / | Root/landing page |
| /about | About page with version info |
| /about/dev | Developer tools and version history |
| /admin | Admin panel |
| /audit | Audit log viewer |
| /dashboard | User dashboard |
| /leagues | League management |
| /leagues/[leagueId] | Individual league view |
| /predictions | Prediction submission |
| /profile | User profile management |
| /results | Race results display |
| /rules | League rules |
| /schedule | Race schedule |
| /standings | League standings |
| /submissions | Submission tracking |
| /teams | Team management |
| /login | Authentication |
| /signup | Registration |
| /forgot-pin | PIN recovery |
| /verify-email | Email verification landing |
| /verify-secondary-email | Secondary email verification landing |

### Cloud Functions (3)

| Function | Trigger | Schedule |
|----------|---------|----------|
| dailyBackup | Scheduled | 02:00 UTC daily |
| manualBackup | Callable | On-demand (admin) |
| runRecoveryTest | Scheduled | 04:00 UTC Sundays |

---

## Files Below 10% Comment Ratio (50+ lines)

Priority candidates for GUID documentation:

| Comment % | Lines | File |
|-----------|-------|------|
| 0% | 786 | app/src/app/(app)/about/page.tsx |
| 0% | 540 | app/src/app/(app)/admin/_components/EmailLogManager.tsx |
| 0% | 328 | app/src/app/(app)/admin/_components/FeedbackManager.tsx |
| 0% | 241 | app/src/app/(app)/admin/_components/TeamManager.tsx |
| 0% | 200 | app/src/components/ui/dropdown-menu.tsx |
| 0% | 178 | app/src/components/ui/form.tsx |
| 0% | 165 | app/src/app/(app)/schedule/page.tsx |
| 0% | 165 | app/src/app/(auth)/login/page.tsx |
| 0% | 160 | app/src/components/ui/select.tsx |
| 0% | 157 | app/src/app/(app)/about/dev/_components/VersionHistory.tsx |
| 0% | 153 | app/src/app/(app)/admin/_components/LeaguesManager.tsx |
| 0% | 151 | app/src/app/(app)/admin/_components/AuditLogViewer.tsx |
| 0% | 143 | app/src/app/(auth)/verify-email/page.tsx |
| 0% | 142 | app/src/app/(auth)/verify-secondary-email/page.tsx |
| 0% | 141 | app/src/components/ui/alert-dialog.tsx |
| 0% | 140 | app/src/components/ui/sheet.tsx |
| 0% | 137 | app/src/app/(app)/admin/_components/SiteFunctionsManager.tsx |
| 0% | 134 | app/src/app/(auth)/forgot-pin/page.tsx |
| 0% | 129 | app/src/components/ui/toast.tsx |
| 0% | 126 | app/src/app/(app)/admin/_components/AuditManager.tsx |
| 0% | 125 | app/src/components/layout/AppSidebar.tsx |
| 0% | 122 | app/src/components/ui/dialog.tsx |
| 0% | 117 | app/src/components/ui/table.tsx |
| 0% | 111 | app/src/components/EmailVerificationBanner.tsx |
| 1% | 1,096 | app/src/app/(app)/profile/page.tsx |
| 1% | 190 | app/src/app/(app)/dashboard/_components/DashboardClient.tsx |
| 1% | 174 | app/src/app/(app)/admin/_components/StandingDataManager.tsx |
| 1% | 318 | app/src/app/(app)/admin/_components/HotNewsManager.tsx |
| 2% | 617 | app/src/app/(app)/about/_components/CinematicIntro.tsx |
| 2% | 611 | app/src/app/(app)/admin/_components/ConsistencyChecker.tsx |
| 3% | 557 | app/src/app/(app)/admin/_components/ErrorLogViewer.tsx |
| 5% | 187 | app/src/app/(app)/admin/page.tsx |

**Note:** Files in `components/ui/` are shadcn/ui generated components. These are typically vendor code and may not require GUID documentation. Priority should be given to business-logic files (admin components, pages, lib modules).

---

## Critical Undocumented Functions

These exported functions contain significant business logic and have zero GUID documentation:

### Scoring System (highest risk)
- `calculateRaceScores(firestore, raceResult)` — scoring.ts
- `updateRaceScores(firestore, raceId, raceResult)` — scoring.ts
- `deleteRaceScores(firestore, raceId)` — scoring.ts
- `calculateDriverPoints(predictedPosition, actualPosition)` — scoring-rules.ts

### Authentication & Security (security-critical)
- `POST /api/auth/login` — login route.ts
- `POST /api/auth/signup` — signup route.ts
- `POST /api/auth/reset-pin` — reset-pin route.ts
- `verifyAuthToken(authHeader)` — firebase-admin.ts
- `checkForAttack(db, FieldValue, currentIP, currentEmail)` — attack-detection.ts
- `checkBotAttack()`, `checkCredentialStuffing()`, `checkDistributedAttack()` — attack-detection.ts

### Email System
- `sendWelcomeEmail({ toEmail, teamName, pin, firestore })` — email.ts
- `sendEmail({ toEmail, subject, htmlContent })` — email.ts
- `canSendEmail(firestore, toEmail)` — email-tracking.ts
- `queueEmail(firestore, email)` — email-tracking.ts

### Data Validation (consistency.ts — 15+ functions)
- `checkUsers()`, `checkDrivers()`, `checkRaces()`, `checkPredictions()`
- `checkScores()`, `checkStandings()`, `checkLeagues()`, `checkTeamCoverage()`

### Prediction & League Management
- `POST /api/submit-prediction` — submit-prediction route.ts
- `POST /api/calculate-scores` — calculate-scores route.ts
- `createLeague()`, `joinLeagueByCode()`, `leaveLeague()` — leagues.ts

### Core Infrastructure
- `getFirebaseAdmin()` — firebase-admin.ts
- `logError(options)` — firebase-admin.ts
- `generateCorrelationId()` — firebase-admin.ts (also duplicated in audit.ts and functions/index.js)
- `logAuditEvent()` — audit.ts

---

## Recommended GUID Documentation Order

Based on file size, business logic complexity, and current comment coverage:

### Tier 1 - Critical (largest business logic files, 0% comments)
1. `app/src/lib/consistency.ts` (1,453 lines) - Core validation engine
2. `app/src/firebase/provider.tsx` (816 lines) - Auth + Firestore provider
3. `app/src/app/(app)/profile/page.tsx` (1,096 lines) - User profile
4. `app/src/app/(app)/standings/page.tsx` (955 lines) - League standings
5. `app/src/app/(app)/results/page.tsx` (834 lines) - Race results

### Tier 2 - High Priority (admin components)
6. `app/src/app/(app)/admin/_components/WhatsAppManager.tsx` (1,333 lines)
7. `app/src/app/(app)/admin/_components/ResultsManager.tsx` (634 lines)
8. `app/src/app/(app)/admin/_components/ConsistencyChecker.tsx` (611 lines)
9. `app/src/app/(app)/admin/_components/ErrorLogViewer.tsx` (557 lines)
10. `app/src/app/(app)/admin/_components/EmailLogManager.tsx` (540 lines)

### Tier 3 - Medium Priority (feature pages and shared logic)
11. `app/src/app/(app)/predictions/_components/PredictionEditor.tsx` (648 lines)
12. `app/src/app/(app)/about/page.tsx` (786 lines)
13. `app/src/app/(app)/about/_components/CinematicIntro.tsx` (617 lines)
14. `app/src/lib/error-codes.ts` - Error code registry
15. `app/src/lib/placeholder-images.json` - Driver image URLs

### Tier 4 - Lower Priority (auth pages, generated UI)
- Auth pages (login, signup, forgot-pin, verify-email)
- shadcn/ui components (vendor generated, document only if customised)

---

## Module Naming Convention

When adding GUIDs to app/src files, use these module prefixes:

| File/Area | Module Prefix |
|-----------|---------------|
| functions/index.js | BACKUP_FUNCTIONS |
| app/src/lib/consistency.ts | CONSISTENCY |
| app/src/firebase/provider.tsx | AUTH_PROVIDER |
| app/src/app/api/*/route.ts | API_[ROUTE_NAME] |
| app/src/app/(app)/admin/_components/*.tsx | ADMIN_[COMPONENT] |
| app/src/app/(app)/*/page.tsx | PAGE_[NAME] |
| app/src/components/*.tsx | COMPONENT_[NAME] |
| app/src/lib/*.ts | LIB_[NAME] |

---

*This file should be regenerated periodically to track documentation progress.*
