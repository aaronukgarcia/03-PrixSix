# Changelog

## v3.18.1 — 2026-07-27

### SEC-AUDIT3-01: notify-pin-changed recipient locked to the caller

The audit's one medium finding fixed: the "PIN changed" notification email accepted a body-supplied recipient — any authenticated member could aim the branded security warning at an arbitrary address. The recipient must now be one of the caller's own addresses (token email, primary, or verified secondary); mismatches 403 and log a registry error.

## v3.18.0 — 2026-07-27

### Backlog clearance wave: invite genealogy, Pit Wall features, security audit closed

**Invite genealogy (INVITE-TREE-001):** every invite consumption now stamps `invitedBy` (inviter uid/team, token, time) on the new user via both signup paths — lineage even records when the gate is open (never blocking); field is server-side-only (firestore.rules `protectedFields` — **this release requires `firebase deploy --only firestore:rules`**); new admin "Referral Tree" tab renders the full referral forest. Ready before next-season signups.

**Pit Wall:** replay year derived from the schedule (no 2025 hardcode, GR#15); replays auto-advance on completion; throttle/brake sparklines in the timing table (FEAT-PW-011); pulsing RADIO pills on cars during replays (FEAT-PW-012); WebAudio radio squelch on team-radio playback (FEAT-PW-013); render-containment documented (FEAT-PW-014). Circuit outline confirmed already shipped (BOW was stale). FEAT-PW-010/015/016/017 deferred with reasons.

**Security:** CHORE-SEC-003 steps 2–4 executed — all 77 API routes + functions + worker audited, ZERO high-severity findings (one medium logged: SEC-AUDIT3-01 notify-pin-changed arbitrary recipient; one low: record-logon/logout missing registry errors); top-10 security test cases recorded. Sentinel leak fixed: OAuth gate-refusals now release the claimed team name (BUG-SENTINEL-LEAK-001). live-data's 502 error-log write was fire-and-forget post-response and died on Cloud Run CPU throttle (today's err_ms39dvf0 investigation) — now awaited.

**Chores:** admin email stamped on results-submitted/deleted audit entries (CHORE-ADM-001); AI error-log pipeline verified end-to-end (BUG-AI-ERRORLOG-001 closed); rate-limiter coverage confirmed on all DOS routes (CHORE-ARCH-001 closed); dependency-alignment chore closed; fresh code.json audit counts recorded (43 undocumented GUIDs + one duplicate pair → follow-up batch).

## v3.17.0 — 2026-07-27

### firebase-admin 14 across all three packages (DEP-MAJ-001/002 — the final majors)

firebase-admin 13 → 14.2.0 in app, functions, and whatsapp-worker in one coherent change, plus @google-cloud/firestore 7 → 8.7.0 in functions (firebase-functions 7.3.0 already accepts admin 14). Breaking surface handled: admin 14 removes the legacy namespace (`admin.credential`, `admin.firestore()`, `admin.apps`…) and requires Node ≥22 — production code needed exactly one type fix (send-hot-news-email); the ~48 ops scripts keep working via a new `scripts/_admin-compat.ts` shim; worker `firebase-config.ts` rewritten modular. Verified: app build + tsc clean, functions `require()` loads all 18 exports, worker tsc clean, and a live read-only Firestore smoke on 14.2.0 (Timestamp semantics intact). Known follow-up: the repo-root helper `node_modules` (claude-sync tooling) still pins admin 13 — isolated, untouched by design.

## v3.16.0 — 2026-07-27

### Zero TypeScript errors + admin delete confirmation + lucide 1.x

**CHORE-TSC-001: `tsc --noEmit` now exits clean** — all 10 suppressed errors properly fixed, none suppressed. Highlights: react-resizable-panels v4 prop rename (`direction`→`orientation`); React 19 JSX-namespace import; @types/node-fetch added; and one **real runtime bug** — `generateRaceId` called without its type argument in the AI analysis route ID'd every race as a Sprint, so the "recent form" grounding block (actual top-6 finishers) has been silently empty since it shipped and form commentary ran ungrounded. Fixed with `'gp'`.

**FEAT-ADM-001:** the admin results trash icon no longer deletes on a single click — a destructive-styled AlertDialog names the race and spells out the cascade (result + all scores + all player predictions, irreversible) before `handleDelete` can run.

**DEP-MAJ-005:** lucide-react 0.577 → 1.27.0 — all 148 icons across 94 files verified against the new typings and runtime; 1.x keeps compat aliases, zero renames needed, zero audit delta.

## v3.15.1 — 2026-07-27

### Urgent triage fixes: OAuth/secondary late-joiner gap + signup throttling

**BUG-LATE-JOINER-HANDICAPS-001.** OAuth profile completion and add-secondary-team still used the dead pre-SSOT-001 handicap mechanism (writing `scores/late-joiner-handicap_*` docs that nothing reads) — a mid-season joiner via either path received NO effective handicap. Both now delegate to the SSOT active-floor lib; `applyLateJoinerHandicap` gains secondary-team support (clones into the owner's predictions subcollection under the `-secondary` teamId, no phantom user doc, no welcome-screen flags). Failures log to error_logs per the GR#17 amendment. This also removes the last writers of the dead mechanism (closes BUG-SSOT-001-DEADCODE-AUDIT).

**SEC-DOS-002.** `/api/auth/signup` was invite-enabled but completely unthrottled — now rate-limited per-IP (5/15min, the reset-pin pattern) with 429 + Retry-After.

## v3.15.0 — 2026-07-27

### Wave 3/4 completion (multi-agent, round 2)

**Newbie experience — all 21 remaining items (NEWBIE-02…25).** Plain-language pit-lane copy; sprint badges unified on submissions; F1 jargon glossed on first use; Help-page naming unified; Getting Started actually pinned to the nav while onboarding is incomplete (the earlier declaration was never rendered); ONE welcome card (dashboard's duplicate removed, suppressed right after /welcome acknowledgement); cloned late-joiner docs no longer auto-tick "Make a Prediction"; soft "being set up" state when handicap info is pending; friendly-first error surfaces on login/complete-profile/submissions/standings; client-side weak-PIN validation; complete-profile redirect fallback; submissions Auto/Manual legend; standings guide auto-opens on first visit + penalty tooltip; /about Teams copy corrected; between-sessions framing on Live Timing + Pit Wall; league non-owner invite hint; touch-visible grid controls (tap-first UX); mobile standings defaults to My Position; teams copy/empty-states; invited email locked read-only.

**GR#17 error-logs completion (HEALTH-ERRORS-001 closed).** Function-by-function sweep finished across all 18 exports — including two deep finds: `deleteAllCollections` was swallowing recovery-cleanup failures entirely (cleanup could fail with zero trace while reporting SUCCESS — now PX-7006), and the WhatsApp watchdog's "attention" state (stuck/failed deliveries) never reached error_logs (now PX-3407, edge-triggered). Sub-catch gaps wired (Auth PX-7003, Storage PX-7010), hardcoded PX literals replaced with registry references (GR#7). All four admin health probes now log server-side on unhealthy, awaited pre-response. New codes: PX-7003 mirror, PX-7010, PX-3407.

**Gitignore sweep (BUG-GITIGNORE-001 closed):** unanchored `logs`/`pids`/`coverage`/`send-bulk-temp.ts` were shadowing real source paths (proven: `src/app/api/admin/logs/**`) — all anchored with comments in both app and project gitignores.

**Dependencies:** worker express 4→5, pino 9→10, dotenv 16→17 (zero source changes needed — DEP-MAJ-006; ships as worker 2.2.3). zod 4 formally BLOCKED: genkit 1.40 pins zod ^3 (recorded in DEP-MAJ-003).

**Backlog triage (25 pre-audit items):** 12 closed with evidence (incl. 4 Pit Wall fixes shipped long ago, reset-pin rate limiting, version-guard, hooks). Live discoveries now precisely documented: OAuth-completion + add-secondary-team still use the dead pre-SSOT handicap path (late joiners via those routes get NO adjustment); signup is invite-enabled but completely unthrottled (promoted); tsc suppressed-error debt grew 3→9 incl. an arity bug in ai/analysis; admin results delete cascades without confirmation.

## v3.14.0 — 2026-07-26

### Wave 2/3/4 mega-integration (multi-agent)

**Pit Wall (PITWALL-03…08, 12):** RaceSelector picks now actually play (on-demand priority + auto-advance resume); circuit-name map fixed for Budapest/Barcelona/São Paulo/Monaco/Yas Marina (validated against live OpenF1 — Singapore never needed mapping); tyre age/compound/DRS/in-pit indicators computed properly through the detail tier and merged; next-race target re-derives every minute (no more frozen long-lived tabs); duplicate polling loop on visibility flapping fixed; total OpenF1 outage now returns a real 502 + correlationId instead of masquerading as a quiet day; replay ingest hardened — stale 'ingesting' claims (heartbeat >5min) can be taken over, completed sessions can never be clobbered to 'failed', and ingest short-circuits to complete when all chunks already exist.

**PubChat (PUBCHAT-04…14):** single bulletin ID everywhere; finished races no longer targeted after +4h grace; one FP1-offset source; read failures show "temporarily unavailable" with a traced error instead of the warming-up mask; anti-repetition dedup actually strips the envelope and includes hourly content; transactional messageId; empty pit-chatter → registry error + no persona repeats; refresh-timing gate is transactional (no double-fetch) with O(n) stint mapping (fixing a wrong-compound bug); missing timing doc renders the between-races panel. Functions side: hot-news heartbeat doc on every run + off-season/race-week gate on the hourly cron.

**Cross-cutting:** GR#17-amendment error_logs wiring swept across most Cloud Functions (writeErrorLog; remainder tracked in HEALTH-ERRORS-001); UX-LOGIN-FLASH-001 fixed (transient auth re-hydration no longer flashes the login page — 800ms persistence gate, no security change); prompt-injection hole in the team-name generator sanitized (OWASP LLM01, pre-audit critical); sidebar renames PubChat→Live Timing, Audit→My Activity (NEWBIE-01/-03).

**Dependency majors (Wave 4 partial):** TypeScript 5.9→6.0.3 (7.x blocked: Next.js doesn't support its compiler API yet) + @types/node 20→26; react-day-picker 9→10 with calendar migration. zod 4, lucide 1.x, worker express-5 set, and firebase-admin 14 remain queued.

## v3.13.1 — 2026-07-26

### Replay smoothing + Wave 1 backend closeout

**Replay interpolation (Aaron's report: very jerky at zoom 3).** Raw replay frames are only ~2–4Hz and the player snapped cars to each new frame — at high zoom those hops are many pixels. `useReplayPlayer` now lerps every car's x/y between the current and next frame on every 16ms tick (gaps >5s snap instead of gliding across red-flag holes); radio messages still trigger on frame advance only.

**Wave 1 backend (DEP-SEC-002/003 artefacts in this commit):** functions deps updated (firebase-functions 7.3.0, 0 critical/0 high) with the new `cleanupRecoveryProject` Sunday function (7.3.0 hard-caps scheduled timeouts at 540s; the combined smoke run measured 544s, so cleanup is split out — verification now fits with margin) + `BACKUP_CLEANUP_FAILED` added to the functions error-codes mirror; whatsapp-worker 2.2.2 (baileys 6.7.23 critical advisory + sharp/libvips CVEs cleared, 25→8 vulns, 0 critical/high).

Same-night ops (data-side, PITWALL-12 evidence): Hungarian GP replay first-ingest died on a Firestore deadline leaving the claim wedged on 'ingesting'; manual reset + re-ingest completed (158 chunks), then a stale `firestoreError` field blocked playback despite complete status — cleared manually. All three defects (staleness takeover, error-field lifecycle, connection-tied ingest) are specified in PITWALL-12.

## v3.13.0 — 2026-07-26

### DEP-SEC-001 (Wave 1): app dependency + vulnerability pass

Safe-range `npm update` across the app: next 16.2.12, react/react-dom 19.2.8, firebase 12.16, the full radix family, recharts 3.10.1, framer-motion, tailwind 4.3.3, postcss, date-fns 4.4 and friends — plus the genkit family moved TOGETHER (genkit + @genkit-ai/google-genai + @genkit-ai/next + genkit-cli → 1.40.1, per the PX-3101 coupling rule) and `npm audit fix`. Vulnerabilities 83 → 74 with **0 critical and 0 low remaining** (was 1 critical); the remaining moderates/highs are next's bundled sharp (next is at latest — upstream fix pending) and the genkit-cli dev-tooling chain that never ships to the prod runtime. AI regression on genkit 1.40 passed (`ai.generate` round-trip). Local build green.

## v3.12.4 — 2026-07-26

### Email chart: tied-rank labels no longer overprint

Aaron's screenshot from the Hungarian GP results email showed rail labels crashing into each other wherever two teams are TIED on rank/points (P29 ×2, P36 ×2) — tied ranks share a y-coordinate and the email renderer had no collision handling. Ported the web ChartLabelRail's two-pass dodging (sort by line y, push apart to a minimum gap, pull back inside the plot, leader line when displaced) into `lib/standings-chart-image.ts`; ties now stack cleanly. Verified with a regenerated LREG chart spanning both tie clusters.

## v3.12.3 — 2026-07-26

### GR#17 amendment: health failures always write to error_logs

Aaron's rule: `error_logs` is the single pane of glass — a failed health check that only writes its own status doc is invisible (exactly how BUG-SMOKE-001 hid for four months). New `writeErrorLog` helper in `functions/index.js` writes registry-shaped `error_logs` entries (`[PX-70xx]` + correlationId, same field shape as the app's `logError`), wired into the catch paths of `performBackup` (daily + manual), `runRecoveryTest`, and `manualSmokeTest`. Golden Rule #17 amended in CLAUDE.md + `docs/golden-rules-detail.md`; `/health-check` CHECK 11 now cross-checks every FAILED/stale status against `error_logs` and flags non-compliant functions (plus a weekly cadence note). HEALTH-ERRORS-001 (BOW, wave 2, high) tracks sweeping the remaining functions and probe endpoints.

## v3.12.2 — 2026-07-26

### BUG-SMOKE-001: backup restore smoke test silently OOM-killed + Graph probe false alarm

**Smoke test (Aaron's report: last night's restore test never completed — major concern).** The weekly restore test had been dying since March with zero trace. Root cause chain: (1) recovery-project cleanup paged deletes with `limit(500).get()`, which downloads FULL document contents — the imported `replay_chunks` docs (~1MB each) meant ~500MB per batch and a fatal heap OOM (2026-07-26 04:08 log: signal 6 at ~800MB inside the 1GiB limit); (2) the OOM killed the process before the status write, so `backup_status` froze at 2026-03-22 with no FAILED record — the silent-OOM signature; (3) `manualSmokeTest` never received the v3.1.5 memory bump and died even earlier at its 512MiB limit (04:47 log) — why Aaron's manual trigger vanished without trace. Fixes: cleanup now uses refs-only `recursiveDelete` (BulkWriter, no field data, also clears subcollections); SUCCESS status/history is written BEFORE cleanup so verification results survive any cleanup crash; both functions bumped to 2GiB / 900s; dead `deleteCollection` removed (GR#18). Both functions redeployed. Note: verification itself passed at 04:06 (heartbeat + users + Auth 57 users + Storage all verified) — backups themselves are restorable.

**Graph "Degraded" badge**: probe-only false alarm. The health probe used the untrimmed `GRAPH_SENDER_EMAIL` env value — trailing whitespace/newline in the stored secret becomes `%0A` in the `/users/{email}` URL and Graph answers HTTP 400. Actual sending trims (49/49 emails sent in the last 7 days). Probe now trims all four Graph env values.

## v3.12.1 — 2026-07-26

### Phase-aware Pit Lane Status card

The dashboard's amber locked card previously froze at the quali-lock message all weekend. It now tracks the phase: before the race it keeps the "Locked / closed at / locked for Quali · GP" copy; during the race (~3h window from lights out) it shows "Race under way — predictions stay locked until the results are in"; after the race it shows "Awaiting official results — the pit lane re-opens for the {next race} once the FIA results are published and scored, usually within 24 hours of the chequered flag". Copy only — lock enforcement unchanged.

## v3.12.0 — 2026-07-26

### BOW blitz round 1 — top 7 findings from the 2026-07-26 cold audits

- **PITWALL-01** — Showreel replay drew its GPS from OpenF1 `/position`, which carries race ORDER only (no x/y) — every car dropped by the track map's null filter, i.e. the "replay showed no cars" incident's failure mode, still live in the showreel path. GPS now comes from `/location` fetched in 15-minute windows with a streaming per-driver downsample; race order is merged from `/position` via a binary-search lookup.
- **PITWALL-02** — A session only counted as "not live" after 48h, so Saturday's finished qualifying suppressed the pre-race showreel on every race day and rendered dead standings as LIVE. Liveness is now `date_end + 30min` (plus a not-yet-started guard); the 48h check remains only as a fallback when `date_end` is missing.
- **PUBCHAT-01** — The admin Hot News OFF toggle did nothing: the dashboard never read `hotNewsFeedEnabled` and the hourly flow force-wrote it back to `true`. The flow now early-returns when disabled (no Gemini call, flag untouched) and the dashboard hides the card.
- **PUBCHAT-02** — `isWaitingForNewSession` compared the stored session against an FP1 *estimate* (quali−24h) that is later than real FP1, hiding the live leaderboard during Friday running. Stored data now counts as current within a 6h buffer before the estimate.
- **PUBCHAT-03** — Hot-news generation had no failure/empty guard; an empty Gemini response produced a header-only bulletin that the 7am publisher broadcast to WhatsApp. Failures and empty text now throw before any write, preserving the previous good bulletin.
- **NEWBIE-09** — A late joiner's first Predictions view showed cloned strangers' picks as a locked "your submission". The closed-pit-lane alert now detects `_clonedFromLateJoinerHandicap` and explains the clone + names their first real race.
- **NEWBIE-15** — The invite form's Google/Apple buttons silently did nothing for an email that already has a PIN account (`needsLinking` unhandled). Now shows clear guidance, plus a fail-visible fallback for any unrecognised result shape.

## v3.11.0 — 2026-07-26

### Per-team position chart in results emails + standings-table adjustment fix

**Position chart (Aaron-approved mockup).** Every post-race results email now embeds a personalised "Your position — last 3 rounds" chart: the recipient's team ±5 by rank as a dark F1-style bump chart (highlighted line, colour-chip label rail, same visual language and team colours as the /standings chart). New `lib/standings-chart-image.ts` builds league snapshots once per batch and renders one PNG per recipient (~60ms each) via new dependency `@resvg/resvg-js`; text uses bundled `public/fonts/Roboto-Regular.ttf` (OFL) because Cloud Run containers ship no fonts. Attached inline via Graph fileAttachment (cid) — `sendEmail` gains optional attachments. Chart failures degrade gracefully: the email ships without the image and the failure is logged once per batch.

**BUGFIX:** the results email's Season Standings table was computed WITHOUT `standings_adjustments`, so late-joiner baselines were missing — after the active-floor re-baseline it would have shown Fangio-F1 on 17 points instead of 168. Now includes adjustments, matching the /standings page.

## v3.10.1 — 2026-07-26

### Standings chart: circuit locations under x-axis ticks

Each race tick on the season-progression chart now shows the circuit location beneath the round label in a fainter version of the same style — "R9 Spr" over "Spa", "R8" over "Silverstone". Location comes from `RaceSchedule.location` ("Spa-Francorchamps" shortened to "Spa"); axis height raised to fit the second line.

## v3.10.0 — 2026-07-26

### Late-joiner active-floor rule (replaces "−5 below last place")

Aaron's rule change: late joiners were entering 5 points below dormant husk accounts (and, worse, the old flow computed "last place" without standings adjustments — Fangio-F1 anchored to Billceleration's raw 17 scored points instead of its adjusted 164). New rule in `lib/late-joiner.ts`: a newcomer clones the lowest-placed **active** team (manual submission in the last 3 completed race weekends; dormant teams ignored; fully-adjusted totals) and enters exactly **1 point behind them**. Rules page and welcome screen copy updated; `lateJoinerInfo` gains `startingTotal`/`adjustmentPoints`.

**Retro re-baseline applied (data, chronological, audited):** all five prior late joiners recalculated under the rule via `scripts/rebaseline-late-joiners.ts` — Geepers AI −5→+8 (their self-played Spanish GP points are preserved on top of the floor anchor), Hamilton's heros and Must Be The Water −5→−1, Billceleration 147→151, Fangio-F1 −5→151 (now 168, one behind Checo yourself, tied with the bot). Five `ADMIN_REBASELINE_LATE_JOINER` audit entries with originals for reversibility. Billceleration is henceforth a normal competitor — no more cellar pinning.

## v3.9.0 — 2026-07-25

### Standings chart readability overhaul (F1-TV style)

Aaron's report: Top-10 team names on the season-progression chart piled into an unreadable smudge. Root cause was threefold: a fixed 192px chart height; Top 10 mode silently injecting the viewer's own out-of-top-10 teams into the auto-fit Y domain (stretching P1..P11 out to P1..P27 and squashing the battle into a sliver); and per-line coloured endpoint labels with no collision handling. Redesign follows the F1 broadcast pattern:

- **Dynamic height** — 24px per rank row shown, clamped 320–640px, so the drawn battle always has label-height room.
- **Honest Top 10** — the domain fits the top 10 only; your own teams outside the window become a chip row under the chart ("Your teams outside the Top 10: … → view My Position") linking to My Position mode.
- **Label rail** — a right-hand rail with one collision-free slot per team (two-pass dodging, leader lines when displaced): colour chip + "P<rank> Name" in foreground ink, full names (20 chars, 13 on phones), user's teams bold. Works in All-teams mode too (labels were previously hidden entirely above 12 lines). Built on recharts v3 public hooks (useYAxisScale/usePlotArea); mounting verified with a jsdom render test.
- **Narrow viewports** get a slimmer rail (118px, 10px font).

## v3.8.3 — 2026-07-25

### Submissions page hid explicit submissions from late-created accounts

The submissions page skipped every team whose account was created after the selected race's qualifying time — including teams with a real, explicit prediction doc (surfaced by Fangio-F1's admin-entered proxy submission, whose account was created after the Hungarian GP cutoff). The skip now applies only to the carry-forward path, where it belongs (a team that didn't exist can't have a phantom carry-forward row); explicit submissions always display.

## v3.8.2 — 2026-07-25

### Splash replay fix + team selector persistence

**Splash fired mid-session after admin hot-link entry (Aaron's report).** The once-per-session flag was only written when the splash animation *finished* — but admin pages suppress the splash without finishing it, so a session that started on `/admin` (hot link) kept the splash armed and replayed it on the first click into a normal page. Two-part fix in `SplashScreen.tsx` + the app layout: the session token is now consumed the moment the splash is armed (mid-splash navigation can no longer re-arm it either), and the layout explicitly disarms an armed-but-suppressed splash on admin pages.

**Team selector snapped back to primary on reload (Aaron's report from LREG/Time Team).** The predictions-page team selector was in-memory React state only. It now persists to sessionStorage (`prixsix_selected_team`) and restores on reload, validated against the user's actual teams with fallback to primary (covers team renames and user switches in the same tab).

### Cheeky Bill device tracking

Sandbox testing of v3.8.0 showed the comedy-device roulette landing the same structure (picks-voice) twice in four roasts — the anti-repetition block covers wording, not delivery structure. Now each history entry also records which device the roulette assigned (`device` key, null for free choice), `generateCheekyComment` returns `{ comment, device }`, and the roulette excludes the last 3 recently used devices before rolling. All four call sites updated (`roast-submission` route + three sandbox scripts).

## v3.8.0 — 2026-07-24

### Cheeky Bill anti-sameness overhaul

Aaron's report: Bill's takes on the WhatsApp submission messages had become samey — same gags (dartboard, Mystic Meg), same one-sentence cadence, every time. Root cause was architectural, in `ai/flows/cheeky-bill.ts`: the same 12 static style examples were sent on every call (LLMs anchor on examples, so they became templates), Bill had no memory of what he'd already said, the one-sentence + sign-off structure never varied, and generation ran at default temperature (highest-probability = most-repeated phrasings). Four coordinated fixes:

- **Anti-repetition memory** (new `lib/cheeky-bill-history.ts`): a rolling window of Bill's last 20 posted roast lines in `admin_configuration/cheekyBillHistory` (transactional append; the `whatsapp_queue` copy is transport, not history — queue docs get purged). The roast route feeds the latest 10 into the prompt as a "stale material — do not reuse any opening, image, or punchline shape" block, and records each new line before responding (BUG-ROAST-001 rule: no post-response writes).
- **Example pools, sampled per call**: standard grows 12 → 22, Jack Dee 5 → 10, splitbrain 5 → 8, news 2 → 4; each call shows a random 3–4 (Fisher-Yates) so the anchor examples differ every time.
- **Comedy-device roulette**: ~70% of roasts are steered into one random delivery device — understatement, absurd comparison, mock TV-commentary, steward's verdict, collapsing compliment, mid-thought open, picks-turn-on-their-owner, deadpan fact read-out — so the *structure* varies, not just the vocabulary.
- **Rhythm + temperature**: 1-in-3 non-news roasts may use a two-part setup + deadpan tag instead of the hard one-sentence rule; both Bill generate calls (submission roast + Monday weekly snark) now run at temperature 1.0.

All safety guardrails unchanged: protected-traits ban, no profanity, facts-only quoting, sanitised interpolation, decorative degrade (history failures never block the WhatsApp message).

## v3.7.2 — 2026-07-20

### BUG-ROAST-001: lost submission notifications + BUG-EMAIL-002: dead email cron

**BUG-ROAST-001 (Aaron's report: LREG's submission produced no WhatsApp message).** Root cause: the roast/notification pipeline ran as a fire-and-forget block *after* the HTTP response, and Cloud Run throttles CPU to near-zero once a response completes — on a quiet instance the half-finished pipeline froze mid-await and was silently abandoned (no queue doc, no error; request logs proved both submissions returned 200 on the same instance and only the second, which had live CPU from its own request window, delivered). Fix: `/api/submit-prediction` now awaits one fast, durable `roast_tasks` doc write before responding; the new `roastTaskTrigger` Cloud Function fires on create and POSTs the new `/api/internal/roast-submission` route, which runs the entire pipeline (mode roll, splitbrain detection, banter context, Gemini, `whatsapp_queue`, worker wake) inside a real request with full CPU. Task docs carry `PENDING → PROCESSING → DONE/ERROR` status so failures are visible, and duplicate triggers no-op transactionally. The clone-rule engine (same latent orphan risk, but fast pure-Firestore work) is now simply awaited before the response. Bonus: the roast route's driver list derives from `F1Drivers` (replaces a hardcoded name map).

**BUG-EMAIL-002.** `processEmailQueue` had no `secrets: ["CRON_SECRET"]` binding (every other cron function has one; this function's own header comment documented the requirement) — so it fail-safed with `PROCESS_EMAIL_QUEUE_MISSING_SECRET` every 15 minutes and never drained the email queue. Binding added. Queue backlog at fix time: 2 stale docs from March.

## v3.7.1 — 2026-07-20

### Billceleration go-live fix + rollout artefacts

- **Fix:** `mintBotIdToken` now sends `Referer: https://prix6.win/` on the Identity Toolkit exchange — the web API key is HTTP-referrer-restricted, so server-side token minting got 403 without it (browser sign-ins never hit this). Found and fixed during the supervised first submission.
- Rollout artefacts committed: `check-bot-standings.ts`, `supervised-first-submission.ts`, `docs/COLLECTIONS.md` entry for `billceleration_log`.
- Go-live record: bot provisioned (P37, 12 pts, −5 penalty applied), disclosure announced to the group, first real submission (Hungarian GP) delivered with the splitbrain roast, schedule enabled.

## v3.7.0 — 2026-07-20

### Billceleration — the autonomous AI team

A new team joins the league: **Billceleration**, run entirely by AI with zero ongoing human input.

- **Full competitor, late-joiner rules**: provisioned via `applyLateJoinerHandicap` (last place's completed-race points, −5 penalty) — same treatment as any human late joiner.
- **Cadence**: one submission at **06:55 Europe/London on hot-news days** (Sun/Thu/Fri/Sat, in-season race weeks) plus a **fresh final decision in the last hour before qualifying closes**. New `billcelerationTick` Cloud Function (15-min grid, `:55` lands the daily slot exactly) → `/api/cron/billceleration`, which owns all slot/dedup logic with a transactional claim.
- **The picker**: Gemini (structured output, thinking disabled) as the ambitious team-principal half of Bill's brain. Inputs: **every rival's current submissions** (full access — disclosed to the group in the join announcement), real WDC form (Jolpica), latest headlines (Autosport), live trackside race-control facts (OpenF1), venue weather. Picks validated against the F1Drivers roster with a feedback retry and deterministic fallbacks (form-book top-6 → previous own picks → skip).
- **Split-brain self-roast**: the bot submits through the real `/api/submit-prediction` route with a minted ID token, so every deadline gate and the WhatsApp pipeline fire as normal — except Bill's take is forced to the new `splitbrain` mode, quoting the picker's own rationale back at itself ("what was I thinking, too much juice", "following the pack because we're all sheep").
- **Ops**: kill switch at `admin_configuration/billceleration.enabled`; GR#17 status heartbeat every tick (`billcelerationStatus`, health-check CHECK 11, 2h bound); full pick/rationale history in `billceleration_log` (client access denied in rules); provisioning + sandbox test scripts (`provision-billceleration.ts`, `test-billceleration.ts --dry|--roast|--token`).

## v3.6.0 — 2026-07-20

### Cheeky Bill three-mode roasts: Jack Dee mode + news-correlated mode

Every prediction submission now rolls one of three roast modes (~1/3 each):

- **Standard** — the existing pub-banter roast, unchanged.
- **Jack Dee mode** — deadpan, withering, and personal (Aaron-approved): Bill mocks the *submitter* — their effort, judgement, track record and team name — not just the picks. Protected-characteristics and no-profanity guardrails remain absolute in every mode.
- **News-correlated** — Bill checks the very latest trackside/news context and mocks the correlation with the submission (the panic pick straight after a quali crash, the doomed driver just promoted). Sources, chosen for latency: **OpenF1 `race_control`** messages from a live/just-ended session (minutes-fresh incident feed, reusing the shared Pit Wall token cache) + **Autosport RSS** headlines (reusing the hot-news fetcher, GR#3). A deterministic eligibility gate (fresh race-control messages OR a headline naming a picked driver) decides whether news mode runs; otherwise it silently degrades to standard. The roll happens before the context fetch, so 2/3 of submissions never touch the news endpoints.

New sandbox harness `app/scripts/send-test-cheeky-modes.ts` (`--mode jackdee|news|standard|all [--fake-news]`) sends labelled test roasts to the prix6-test group only. All external text (race-control messages, headlines) passes through `sanitizeForPrompt` (GR#11).

## v3.5.2 — 2026-07-13

### "Bill's take" joins the weekly standings post (+ standings SSOT fix)

The Monday 18:00 weekly standings WhatsApp message now carries **two lines of Cheeky Bill roast** under the table (`💬 Bill's take:`), driven by the same verified-facts contract as the submission roasts — the LLM may only quote deterministic server-computed facts, never invent stats:

- **`buildWeeklyStandingsFacts`** (`cheeky-bill-context.ts`): last completed round + its round winner, **biggest riser/faller vs the pre-round table** (re-aggregated with that round's scores excluded — no stored history needed), leader's gap to P2, **point ties inside the top 10** (described by table position), and who's propping up the table.
- **`generateWeeklyStandingsSnark`** (`cheeky-bill.ts`): exactly two short lines, priority tie → mover → leader gap → backmarker, second line signed `..bill`. Fire-safe: any failure and the plain standings post goes out unchanged (verified — the dry-run's first attempt degraded exactly this way).
- **SSOT fix (GR#3):** `buildStandingsText` in the cron route now includes `standings_adjustments` (late-joiner penalties) — previously omitted, so the WhatsApp table could disagree with the site standings.
- Dry-run script `app/scripts/dry-run-weekly-snark.ts` composes the exact message against live data (read-only). Sample output verified against the real 2026-W29 table, including the three-way 247 tie.

## v3.5.1 — 2026-07-13

### BUG-CSP-001: Apple/Google popup sign-in broken by v3.4.12 CSP + SEC-SIGNUP-003: team-name uniqueness overhaul

**BUG-CSP-001 (Aaron's report: "clicking the Apple button does not work").** Reproduced via headless Edge against prod `/login`: the click fires but `signInWithPopup` throws `auth/internal-error` (PX-1017) before any popup opens. Root cause: the v3.4.12 security-hardening CSP blocked `https://apis.google.com/js/api.js` (which Firebase Auth loads to run the OAuth popup) and — with `default-src 'self'` and no `frame-src` — the hidden result-relay iframe to the Firebase authDomain. Desktop *Google* popup sign-in was equally broken (mobile redirect flows unaffected, which is why Google logins kept appearing in the logs). Also collaterally blocked: Google Fonts CSS, gtag.js, Cloudflare Insights. Fix: explicit CSP allowlist entries (`script-src` + apis.google.com/googletagmanager/cloudflareinsights, `style-src` + fonts.googleapis.com, `font-src` + fonts.gstatic.com, new `frame-src` with the authDomain) in `next.config.ts`.

**SEC-SIGNUP-003 (follow-through on the Geepers AI incident).** Team-name uniqueness was enforced by four flows with four different, drifting mechanisms. New `lib/team-names.ts` is the SSOT (transactional `claimTeamName`/`releaseTeamName` + `isTeamNameTaken`), wired into:
- `complete-oauth-profile` — now claims a sentinel (was: queries only, no sentinel, TOCTOU window — the actual hole behind the duplicate-name incident); released on all failure paths, kept once the account is minted
- `add-secondary-team` — now claims a sentinel AND writes `secondaryTeamNameLower`, which **no code had ever written**, so the signup routes' secondary-name uniqueness queries have always silently matched nothing
- `admin/update-user` renames — now sync `teamNameLower` (was left stale, breaking the indexed uniqueness queries), claim the new name's sentinel, and release the old one after commit
- email `signup` — inline transaction replaced by the shared helper

**Data migration (`scripts/backfill-team-name-sentinels.js`, run 2026-07-13):** 34 missing sentinels created (all OAuth-era joiners + secondaries), 30 user docs had stale/missing `teamNameLower`/`secondaryTeamNameLower` repaired, 1 stale-owner collision repaired ("marv at maggots" — sentinel belonged to a deleted uid). `team_names` also carries ~111 orphan reservations from seed scripts and deleted users (they only block those names; left for a future cleanup decision).

**Probe-residue cleanup (Aaron's "Unknown Team" report):** the 2026-07-13 verification probe's late-joiner artefacts survived account deletion — 13 cloned prediction docs in the orphaned `users/{uid}/predictions` subcollection plus a `standings_adjustments` doc — putting a 151-point "Unknown Team" at rank 34. Purged; standings verified clean (34 entries).

## v3.5.0 — 2026-07-13

### SEC-SIGNUP-001: fail-closed signup gate + Invite a Friend

**Security fix.** `POST /api/auth/signup` and `/api/auth/complete-oauth-profile` read the signup toggle from `admin_configuration/site_settings` — a document that **never existed** — and proceeded on missing doc or read error (fail-open). Worse, the admin Site Functions panel writes the toggle to `admin_configuration/global` (doc-ID mismatch), so flipping the switch off never reached enforcement. While the /signup UI said "Registration Closed", a direct POST (or any Google/Apple sign-in) could still mint a full account. Verified live: prod returned 200-paths pre-fix, 403 PX-1007 post-fix. Both gates now read `admin_configuration/global` (SSOT with the admin panel) and **fail closed** — signup proceeds only when `newUserSignupEnabled === true` or a valid friend invite accompanies the request. Both `admin_configuration` docs were stamped `newUserSignupEnabled: false` at fix time, closing prod immediately without a deploy (`site_settings` becomes dead after this release — safe to delete once v3.5.0 is verified).

**Invite a Friend (new feature).** Registration stays closed to the public, but members can now invite friends:

- **`app/src/lib/invites.ts`** (new): invite SSOT — 256-bit hex token (doc ID in the server-only `invites` collection), read-only `validateInvite`, transactional single-use `consumeInvite` (mirrors the team_names sentinel pattern) + `revertInvite` rollback on failed account creation. 14-day expiry enforced at validation time.
- **`POST /api/invites/create`** (new): Bearer-authed + CSRF + rate-limited (5/day per member, 20/day per IP), refuses existing members (PX-2104), reuses a pending invite for the same inviter+friend (idempotent resend), sends a welcoming branded email (gradient header, CTA hot link, Google/Apple note, expiry) via the Graph `sendEmail` pipeline, audit-logs `INVITE_SENT`.
- **`/invite` page + sidebar item**: "Invite a Friend" (UserPlus) — email form, success panel with copyable link.
- **`/signup` rework**: tokenless visits get the same static Registration Closed card (BUG-ERR-003 no-Firebase path preserved); a server-validated `?invite=` token renders the new `InviteSignupForm` — join with email + team name + 6-digit PIN, or **Google/Apple one-tap** (token carried through the OAuth redirect via sessionStorage → `/complete-profile` → gate bypass). Invalid/expired tokens get a friendly explanation card.
- **New error codes** PX-2101…PX-2104 (`INVITE_SEND_FAILED`, `INVITE_INVALID`, `INVITE_EXPIRED`, `INVITE_ALREADY_MEMBER`).
- **`firestore.rules`**: `invites` collection is Admin-SDK-only (doc ID IS the secret — even admin client reads would leak live links). **Requires a separate rules deploy.**
- **Registry drift repair**: regenerating `error-registry.ts` from `code.json` would have silently dropped 27 error keys (RATE_LIMIT_EXCEEDED, AUDIT_LOG_FAILED, all PIT_WALL_*, …) that had been added to the generated file without ever being registered in `code.json`. All 27 are now backfilled into `code.json` — the generator is idempotent again.

## v3.4.14 — 2026-07-13

### Cheeky Bill gets situational awareness (submission history + real-world form)

Two new fact sources make the roast *specific to the situation* rather than generic:

- **Submission history** (`buildPreviousSubmissionFacts`): the new picks are diffed **deterministically in TypeScript** against the team's most recent submission for a different race (cloned docs skipped, in-memory filter — no composite index). Identical order → "copy, paste, submit"; same six with N shuffled → "minimal effort, you're not planning on winning are you"; 4+ new drivers → "wholesale panic". First-ever submission → no fact, standard roast.
- **Real-world form** (`buildFormFacts`): the full actual F1 drivers' championship is fetched from Jolpica (`api.jolpi.ca` — same free keyless feed the hot-news bulletin uses), cached 6h, matched to Prix Six driver IDs by diacritic-stripped surname (all 22 unique, verified live against the 2026 season). Produces: every pick's real WDC position, an **OUTSIDER ALERT** for any podium pick ranked P10+ in reality ("brave, going with the pundits for an outside chance"), and a **ZERO IMAGINATION** flag when the six copy the real WDC top six in exact order.
- **Prompt** (`cheeky-bill.ts`): two new optional fact fields, situational-priority instruction (roast the laziness/panic/blind-hope/form-book-copy over generic digs), and the two player-supplied style lines as few-shots. The "never invent stats" contract unchanged — the LLM only quotes flags computed server-side.
- **Route**: passes `userId` + normalised raceId + picks into the context builder; all still inside the non-fatal fire-and-forget block.

## v3.4.13 — 2026-07-13

### Cheeky Bill goes full roast mode (player-requested)

Player feedback on the WhatsApp submission comments: fun, but not *close* enough — they asked for properly derogatory, tongue-in-cheek insults about their guesswork. Bill has been retrained accordingly, and now gets **real ammunition**.

- **`app/src/ai/flows/cheeky-bill.ts`**: persona rewritten from "witty and slightly cheeky" to full pub-roast — praise banned, ten style examples baked in ("was the dartboard busy or did the dog pick this one..bill"). Mockery targets the picks and F1 judgement only (no profanity, nothing personal beyond their laughable predictions). Team name is now sanitised via `sanitizeForPrompt` before prompt interpolation (prompt-injection hardening). Fallback lines updated to match the new tone.
- **`app/src/lib/cheeky-bill-context.ts`** (new): builds VERIFIED banter facts — the last completed race's official top 6 (from `race_results` × `RaceSchedule`) and the submitting team's championship rank/points (via the `cumulative-standings` SSOT helpers, so digs always match the standings page). 10-minute in-memory cache keeps pre-qualifying submission bursts cheap. Never throws — degrades to a statless roast.
- **`app/src/app/api/submit-prediction/route.ts`**: fetches the banter context inside the existing fire-and-forget WhatsApp block and passes it (plus the race name) to `generateCheekyComment`. The prompt forbids inventing statistics — only supplied facts may be quoted, and drivers absent from the last-race top 6 may only be called "not in the top 6", never given a made-up position.

## v3.4.9 — 2026-07-06

### Richer WhatsApp results message (podium + round winner + standings)

The `resultsPublished` WhatsApp alert previously just said "Results are in — check the standings", with none of the actual result. It now posts a **concise, glanceable summary** (deliberately *not* the full email): the race **podium**, the **round-winning team** with a congrats, and the **Championship top 5** — computed from the same cumulative-standings SSOT as the site.

- **`app/src/lib/whatsapp-results-message.ts`** (new): pure, dependency-free builder for the message (reused by the scoring route and the one-off British GP backfill post).
- **`app/src/app/api/calculate-scores/route.ts`**: builds and sends the enriched message; degrades gracefully to podium+winner if the standings compute fails, and to the old bare line as an absolute fallback (never blocks scoring).

## v3.4.8 — 2026-07-06

### Results emails: raise daily cap + surface silent cap suppression

**Root cause (British GP, sprint weekend).** `DAILY_GLOBAL_LIMIT` in `/api/send-results-email` was **30** — exactly the league size — so a single race batch consumed the whole day's budget. On 2026-07-05 the Sprint results (12:45) sent 30 emails and hit the cap; when the main GP was posted at 21:09 **every** recipient was blocked and the entire GP results email batch was silently suppressed (0 sent). No player received the GP results email, and no error was logged.

- **`app/src/app/api/send-results-email/route.ts`**: `DAILY_GLOBAL_LIMIT` raised **30 → 100** (comfortably covers a sprint weekend's two same-day postings incl. verified secondary emails). `canSendEmailAdmin` now returns a `limitType` so a global-cap block is distinguishable from a benign per-address block. When the global cap suppresses any results email, a **registry error (`EMAIL_DAILY_LIMIT` / PX-3003)** is logged once per batch with a correlation ID, and the API returns `globalLimitReached` / `suppressedCount` / `correlationId`.
- **`app/src/app/(app)/admin/_components/ResultsManager.tsx`**: the admin now sees a prominent, selectable **alert toast** if any results emails were blocked by the cap (or if the email request failed), with the error code + correlation ID — no more silent non-delivery.
- **Backfill**: `app/scripts/backfill-british-gp-emails.ts` reconstructs the British GP results email (real scoring primitives + faithful `computeRaceScores` port; dry-run by default) and re-sends to opted-in players who missed it.

## v3.2.2 — 2026-06-15

### Daily hot-news banner + Teams + email join CTA

- **7am hot-news** (`publishHotNewsToWhatsApp`): now gated to **in-season only** (14 days before first qualifying → 1 day after the final race), and prepends a **next-session countdown banner** built from `race_schedule` (e.g. "🏁 Next: Spielberg Qualifying — 12 days, 1 hour, 53 minutes") computed as of the 07:00 push.
- **Microsoft Teams**: the same daily hot-news now also posts to Teams via `TEAMS_WEBHOOK_URL` (graceful no-op until the webhook is configured).
- **All emails**: footer now carries a join CTA — "Want to be part of the banter? Email Aaron and ask to join the WhatsApp Prix6.win group" — added to both `sendEmail` and `sendWelcomeEmail` footers (every outgoing email funnels through these).

## v3.2.1 — 2026-06-15

### Consistency Checker — Score Type Breakdown re-pointed to live SSOT

- The CC's **Score Type Breakdown** (A–F tiers + Total Driver Predictions) was parsing `breakdown` strings on the dead `scores` collection (post-SSOT-001 it holds only stale pre-refactor docs with no breakdown), so every count read **0**. `checkScores` now computes the breakdown by replaying each team's prediction against each scored race exactly as `cumulative-standings` does (race-specific → sprint fallback → date-gated carry-forward). **Type G** (late joiner) now comes from the `standings_adjustments` count.
- Verified against live data: A=278, B=458, C=317, D=431, E=736, F=30, G=1 — 2220 driver predictions across 370 team-race scores.
- **Admin:** deleted two abandoned pre-season teams (Experience Motorsport, Smooth Operator) — full removal (Auth + Firestore + league membership + logons), audited.

## v3.2.0 — 2026-06-14

### Late-joiner overhaul + standings carry-forward fix + 7am hot-news cold-start fix

**Standings bug (Geepers AI wrongly #1).** The cumulative-standings carry-forward rule was back-filling races a team never played: a late joiner with a single prediction had it retro-applied to every completed race and rocketed to the top (Geepers AI = 212 pts from 1 pick).
- `lib/cumulative-standings.ts`: carry-forward is now **gated by race date** — a carried-forward pick is never scored for a race that ran before the team's first submission. Race-specific and sprint-fallback matches are unaffected. Blast radius verified: only the affected team changes.
- New `standings_adjustments` collection + `readStandingsAdjustments()` — one-time point deltas (e.g. the late-joiner −5) folded into standings as synthetic rows. Read by `/api/standings`.
- Standings page shows a red **"−5 late-joining penalty"** under the team name.

**Late-joiner mechanic, done right.** Previously the signup handicap wrote to the dead `scores` collection (miscalculated, never read post-SSOT-001).
- New `lib/late-joiner.ts`: on mid-season signup, clones the **current last-place team's** prior-race predictions into the new team, applies a one-time **−5** penalty, and writes an audit entry for the team creation **and every cloned submission** (full transparency).
- New **/welcome** acknowledgement screen for late joiners (next race, cloned-from-last-place explanation, −5 penalty, signpost to Rules) with a required "I have read and understood" checkbox → audited via `/api/auth/acknowledge-late-joiner`.
- **Rules page** now lists the −5 Late Joiner Penalty (red badge); `SCORING_POINTS.lateJoinerPenalty = -5`.
- Data correction applied for **Geepers AI**: cloned Need for Speed Trap's 9 pre-Spanish races, kept his own Spanish GP pick, −5 penalty → 65 (was 48 / 5 behind last going into his first race).

**7am hot-news not delivered.** Log Analytics showed the scale-to-zero WhatsApp worker fired the queued message ~1s after Baileys "ready", before the socket stabilised (init-queries 408 ~60s later) — Baileys returned a local "sent" but WhatsApp never received it.
- `functions/index.js` `publishHotNewsToWhatsApp`: now warms the worker and polls `/health` until genuinely connected (plus a short stabilisation pause) **before** enqueuing; timeout 120→180s. Durable fix still belongs in the worker (gate queue processing on a stable connection).

## v3.1.27 — 2026-06-12

### WhatsApp alerts — wire the schedule-driven toggles

- New cron route **`/api/cron/whatsapp-scheduled`** (CRON_SECRET) driven by a new **`whatsAppScheduledTick`** Cloud Function (every 30 min). It reuses the TS libs (`race-schedule-server`, `cumulative-standings`) and de-duplicates via `admin_configuration/whatsappScheduledState`. Wires:
  - **qualifyingReminder** → prediction-deadline reminders at **24h** and **2h** before qualifying lock.
  - **latePredictionWarning** → ~3h before lock, posts the list of teams who still haven't predicted.
  - **raceReminder** → ~1h before lights-out.
  - **weeklyStandingsUpdate** → Mondays 18:00 Europe/London, posts the top-10 standings.
- **endOfSeasonSummary** → manual **"🏆 Post EOS Summary"** button in the WhatsApp admin panel → `/api/admin/whatsapp-eos` posts the champion + full final standings.
- All gated by `masterEnabled && the specific toggle && targetGroup`, respect `testMode`, and wake the worker. This completes wiring the previously-decorative alert toggles (`FEAT-WHATSAPP-ALERT-TOGGLES-001`).

## v3.1.26 — 2026-06-12

### WhatsApp alerts — wire the event-driven toggles

- New central helper `lib/whatsapp-alert.ts` `sendWhatsAppAlert(type, message)` — gates on `masterEnabled && alerts[type] && targetGroup`, respects `testMode`, enqueues to `whatsapp_queue`, and wakes the worker. One gateway for every categorised alert.
- Wired the two clean event triggers (previously decorative toggles):
  - **`resultsPublished`** → fires from `calculate-scores` when a race is scored ("📊 Results are in for {race}!").
  - **`newPlayerJoined`** → fires from both signup paths (`signup` + `complete-oauth-profile`) ("👋 {team} just joined!").
- Remaining decorative toggles are **schedule-driven** (qualifying/race reminders, late-prediction warning, weekly standings, end-of-season) and need scheduled Cloud Functions with the F1 calendar + dedup + chosen lead times — tracked separately.

## v3.1.25 — 2026-06-12

### Fix — WhatsApp messages stranded PENDING (scale-to-zero worker never woken)

- **Symptom:** a player's prediction-submit notification (e.g. "Kwik Fitties submitted picks") sometimes never arrived — the `whatsapp_queue` doc was created but stuck `PENDING`.
- **Root cause:** the worker is a scale-to-zero Azure Container App (`minReplicas:0`, 5-min cooldown). Its `/process-queue` endpoint exists to trigger scale-up on enqueue, but **nothing called it** — every enqueue path just wrote the doc. So when the worker was asleep, the message sat PENDING until it happened to wake for another reason (intermittent delivery).
- **Fix:** new `lib/whatsapp-wake.ts` `wakeWhatsAppWorker()` POSTs the HMAC-signed `/process-queue` after each enqueue (best-effort, non-blocking). Wired into **submit-prediction**, the **hot-news email** path, and the **7am `publishHotNewsToWhatsApp`** function (which now binds the `WHATSAPP_APP_SECRET` secret). The 2 stranded Kwik Fitties messages were flushed manually.

## v3.1.24 — 2026-06-12

### Docs — captured WhatsApp + genkit-skew lessons in code.json (lessons block + GUID notes).

## v3.1.23 — 2026-06-12

### Hot News → WhatsApp

- **Manual:** the Hot News email flow now has an **"Also send to WhatsApp group"** checkbox (enabled once "Send email" is ticked). When set, `/api/send-hot-news-email` also enqueues the hot-news content to the configured WhatsApp `targetGroup` (server-side Admin SDK, since `whatsapp_queue` is client-write-denied) — fires even if there are 0 email subscribers.
- **Automatic:** new scheduled Cloud Function **`publishHotNewsToWhatsApp`** runs **daily at 07:00 Europe/London** and forks the current hot news out to the WhatsApp group (gated by `masterEnabled`; respects `testMode`; writes `admin_configuration/hotNewsWhatsAppStatus` for freshness monitoring per GR#17). The website's hot-news content refresh is unchanged — this only publishes the current content to WhatsApp once a day.
- Context: the `hotNewsPublished` alert toggle existed but was never wired to a sender; this closes that gap for hot news specifically. (Other alert toggles remain decorative — tracked for a follow-up.)

## v3.1.22 — 2026-06-12

### WhatsApp — queue clear controls + QR delivery tuning

- **Clear the queue:** new admin-only `DELETE /api/admin/whatsapp-queue` (server-side Admin SDK, since `whatsapp_queue` is client-write-denied) supporting a single message by `id` or a bulk `scope` (`all` or a status like `FAILED`). The Message Queue card now has a **per-message trash button**, **Clear Failed**, and **Clear All** (with confirm) — so a stale/failed backlog can't blast out when the worker reconnects.
- **QR delivery:** the worker QR is valid for a few minutes and generation is rate-limited, so the panel now **auto-fetches the QR promptly** the moment `awaitingQR` flips true (no manual click) and **re-reads it every 60s** (was an aggressive cadence) with few-minute amber/stale thresholds.

## v3.1.21 — 2026-06-12

### Fix — PX-3101 regression (Genkit version skew from the v3.1.17 audit fix)

- AI analysis broke again with `AI content generation failed (PX-3101)`. Root cause: the v3.1.17 `npm audit fix` bumped `genkit`, `@genkit-ai/core`, `/ai`, `/next`, `/firebase` to **1.37.0** but left **`@genkit-ai/google-genai` at 1.33.0**. A 1.33 plugin against a 1.37 core throws `GenkitError: INVALID_ARGUMENT: Unknown action type returned from plugin vertexai`.
- **Fix:** aligned `@genkit-ai/google-genai` (and pinned `genkit`/`@genkit-ai/next`) to `^1.37.0`. Verified locally (full analysis returns) and live.
- **Lesson:** `npm audit fix`, even "non-breaking/lock-only," can partially bump a tightly-coupled plugin family and break it. Keep the whole `@genkit-ai/*` + `genkit` set on one version.

## v3.1.20 — 2026-06-12

### Fix — WhatsApp worker 401 "Invalid signature" (secret re-sync)

- The admin WhatsApp panel showed `Connection Failed — HTTP 401`. Diagnosis: the worker is **healthy** and its `WHATSAPP_APP_SECRET` is correct (a self-computed `HMAC(secret,"status")` returns 200 directly). The running app was signing `/status` with a **stale** secret binding, so the worker correctly rejected it. (`/health` "worked" only because the worker leaves it public/unsigned.)
- **Fix:** added a fresh `WHATSAPP_APP_SECRET` version (v2) in Secret Manager equal to the worker's known-good value and redeployed the app so fresh instances re-resolve it. Verified `/api/whatsapp-proxy?endpoint=status` returns 200 post-deploy.
- Also corrected the panel's restart command — it named a non-existent resource (`prixsix-whatsapp-worker`) and used the ACI verb; now shows the correct `az containerapp revision restart --name prixsix-whatsapp …`, with a note that a 401 is a secret issue, not a worker fault.
- Remaining: WhatsApp session still `awaitingQR` — scan the QR to make messaging live.

## v3.1.19 — 2026-06-12

### WhatsApp health — distinguish "asleep" from "down"

- A true cold start of the scale-to-zero worker exceeds even a 10s probe, so v3.1.18's bump alone still showed a red failure on the first hit after idle. The worker being asleep is **normal**, not an outage.
- `/api/admin/whatsapp/health` now returns a distinct **`healthy: null, state: "sleeping"`** on a probe timeout (vs `healthy: false` for a genuine unreachable/HTTP error). The admin Interface Health panel renders this **amber** ("Worker asleep (scale-to-zero) — wakes on first message") instead of red.
- The panel's own client-side fetch timeout was raised 10s→15s so it reliably receives the route's sleeping response (returned at ~10s) rather than aborting first.

## v3.1.18 — 2026-06-12

### Fix — WhatsApp health check false timeouts

- `/api/admin/whatsapp/health` used a 5s fetch timeout against the worker, but the worker is a scale-to-zero Azure Container App whose cold start (~3–5s) could exceed it, producing a false "operation aborted due to timeout" on the first hit after idle. Raised to **10s**.

## v3.1.17 — 2026-06-12

### WhatsApp — wire the app to the (already-running) worker

- The worker (Azure Container App `prixsix-whatsapp`) is up and healthy, but `/api/admin/whatsapp/health` reported `not configured` because it reads `WHATSAPP_WORKER_URL`, which `apphosting.yaml` never set. The functional `whatsapp-proxy` route *hardcoded* the URL, so messaging worked but the two paths disagreed.
- **Fix (SSOT):** added `WHATSAPP_WORKER_URL` to `apphosting.yaml` (plain value — the URL is already in source and access is HMAC-gated) and changed `whatsapp-proxy` to read it (`process.env.WHATSAPP_WORKER_URL || <fallback>`). Health probe and proxy now share one source; the health check reports accurately.

### Security — safe (non-breaking) dependency audit pass

- `npm audit fix` (no `--force`) in `app/` and `functions/` — **lock-file-only** changes, no direct-dependency version bumps.
- **app/:** 51 → 29 vulnerabilities (critical `protobufjs` cleared; now 0 critical, 9 high, 20 moderate).
- **functions/:** down to 9 moderate (critical/high cleared).
- The remainder require breaking major upgrades (the `genkit`/`@genkit-ai/*` and `@google-cloud` chains, `next`, `firebase-admin` 13→14) and are deferred to a careful per-major pass.

## v3.1.16 — 2026-06-12

### Chore — code.json fully synced with source

- Registered 258 GUIDs that were present in source comments but missing from `code.json` (0 stale pointers found). Registry is now fully in sync: 0 undocumented, 0 stale. Each entry carries its `[Intent]` description, file, version, and category (flagged `autoRegistered` for later enrichment).

## v3.1.15 — 2026-06-12

### Type safety — non-existent `ERRORS.*` keys now fail at compile time

- `ERRORS` and `CLIENT_ERRORS` were typed `Record<string, …>`, so a misspelled key compiled fine and resolved to `undefined` at runtime (the class of bug behind the five dead refs fixed in v3.1.12/v3.1.14). Both are now typed via **`satisfies`** instead of an annotation, so the inferred type keeps the exact key set — `ERRORS.NONEXISTENT` is a **TS2339 compile error**. Verified with a probe.
- The full registry mixes two entry shapes (full diagnostic vs. the lighter Pit Wall `{code, message, description, suggestedAction, modulePath}`), so `ERRORS` uses `satisfies Record<string, ErrorDefinition | LightErrorDefinition>` (new `LightErrorDefinition` type). `satisfies` doesn't widen, so every consumer keeps its precise per-entry type.
- The generator (`scripts/generate-error-registry.ts`) was updated to emit the `satisfies` form too.
- **Dead code removed:** the tightening surfaced an orphaned duplicate `app/api/` tree (2 stale route files — `verify-access`, `admin-challenge` — last touched v2.0.33, outside the Next app dir so never served) referencing error keys that no longer exist. Deleted (GR#3 SSOT / GR#18).
- **Note:** the production build skips type validation, so this guards `tsc`/IDE, not CI. Three unrelated pre-existing `tsc` errors remain (a `JSX` namespace ref + two in `PitWallClient`) and would need fixing before `tsc` could gate CI.

## v3.1.14 — 2026-06-11

### Chore — migrate Genkit off the deprecated `@genkit-ai/vertexai` plugin

- `app/src/ai/genkit.ts` now uses the unified **`@genkit-ai/google-genai`** plugin (its Vertex AI backend), and the deprecated `@genkit-ai/vertexai` package has been removed from `package.json`/lockfile. Auth (ADC via the App Hosting compute SA), region (`europe-west4`), the `vertexai/gemini-2.5-flash` model id, and `thinkingConfig` all carry over unchanged — no new secret or API key required. Verified end-to-end (full ~5k-char analysis returned) before deploy.
- This build also carries the **v3.1.13 PX-3101 fix** (whose App Hosting rollout stalled): retired `gemini-2.0-flash` → `gemini-2.5-flash` with `thinkingConfig: { thinkingBudget: 0 }` on the bounded analysis/pit-chatter calls.

### Bug fix — four dead `ERRORS.*` references (undefined at runtime)

- `ERRORS` is typed `Record<string, ErrorDefinition>`, so a misspelled key compiles fine but resolves to `undefined` at runtime, only misfiring when the catch block runs. An audit of every `ERRORS.<KEY>` against the registry found four:
  - `api/team-name-suggestions` — `DATABASE_READ_FAILED` → `FIRESTORE_READ_FAILED` (fixed in v3.1.12).
  - `api/email-health` (health-check catch) — `DATABASE_READ_FAILED` → `FIRESTORE_READ_FAILED`.
  - `api/email-health` (admin-check catch) — `AUTH_ADMIN_VERIFICATION_FAILED` → `FIRESTORE_READ_FAILED`.
  - `api/email-queue` — `DATABASE_READ_FAILED` → `FIRESTORE_READ_FAILED`.
  - `api/auth/signup` (user-doc create catch) — `DATABASE_ERROR` → `FIRESTORE_WRITE_FAILED`.
- **Note:** this build also carries the v3.1.13 PX-3101 AI-model fix, whose App Hosting rollout stalled (build succeeded, revision healthy, but no rollout promoted it). Re-shipping in-band promotes both.
- **Recommended follow-up:** tighten the `ERRORS` export type from `Record<string, ErrorDefinition>` to a keyed type so these resolve at compile time, not runtime.

## v3.1.13 — 2026-06-11

### Bug fix — AI features broken (PX-3101), reported by Al on race analysis

- **Root cause:** `app/src/ai/genkit.ts` used `vertexai/gemini-2.0-flash`, which Google has retired for this project — a direct Vertex `generateContent` call returns **HTTP 404 NOT_FOUND** in `europe-west4`. Because this Genkit instance is shared, *every* AI feature (race analysis, pit chatter, hot-news, AI team-name generator) failed with `AI_GENERATION_FAILED`. Switched to **`gemini-2.5-flash`** (verified 200 OK in `europe-west4`).
- **Second issue uncovered by the switch:** 2.5-flash is a *thinking* model. With thinking on, a test analysis spent ~1410 of 1500 output tokens on hidden reasoning and returned a truncated 2-sentence answer (`finishReason: MAX_TOKENS`). Set `thinkingConfig: { thinkingBudget: 0 }` on the bounded-token calls — race analysis (also raised to 2048 tokens) and pit chatter (300 tokens) — since punditry/banter needs no reasoning budget. Verified a full ~1100-word analysis is produced.
- **Observation (not yet fixed):** the AI failure was never persisted to `error_logs` (0 rows since 2026-06-08) despite the route calling `logTracedError` — server-side traced-error logging from the AI routes may not be persisting. Flagged for a silent-failure follow-up.

## v3.1.12 — 2026-06-11

### Security — close SEC-DOS-001 (denial-of-wallet on team-name suggestions)

- **`/api/team-name-suggestions`** — this public, unauthenticated endpoint previously ran a full `users` collection scan on **every** request with no rate limiting, so a flood scaled Firestore reads by both request rate and user count. Two mitigations:
  - **Per-IP rate limit** (30 req/min) via the new reusable `app/src/lib/rate-limit.ts` (in-memory fixed-window, deliberately not Firestore-backed so it can't amplify the very DoS it guards). Breach returns HTTP 429 with `Retry-After`.
  - **TTL cache** (60s) of the existing-name set — caps collection scans at one per window per instance instead of one per request. Uniqueness is still authoritatively re-checked on profile submit.
- **Bug fix (found in passing):** the endpoint's error path referenced `ERRORS.DATABASE_READ_FAILED`, which does not exist (`ERRORS` is `Record<string,…>`, so it resolved to `undefined` at runtime). Corrected to `ERRORS.FIRESTORE_READ_FAILED` (PX-4001). The same dead reference remains in `api/email-health` and `api/email-queue` — flagged, not yet fixed.

### New error registry entry

- `RATE_LIMIT_EXCEEDED` (PX-8005) — generic per-IP request throttle for public endpoints.

## v3.1.11 — 2026-06-11

### Bug fix — new Google/Apple users could not complete signup

- **Fixed:** the `/complete-profile` page submitted to `/api/auth/complete-oauth-profile` **without** an `Authorization` header, so every team-name submission (typed or suggested) returned 401 "Unauthorized". It was the only authenticated caller in the app missing the Firebase ID token. Now attaches `Bearer <idToken>` like every other call.

## v3.1.0 — 2026-05-06

### Architectural change — cumulative standings consolidated server-side (SSOT)

- **Single source of truth for cumulative standings.** Three implementations have been collapsed into one shared lib `app/src/lib/cumulative-standings.ts`. The standings page, the results email handler, and a new admin health probe all import from it. Algorithm parity with the pre-3.1.0 client-side compute was verified by `app/scripts/verify-standings-parity.ts` before deploy.
- **`/api/standings`** — new authenticated GET endpoint. Returns granular `ScoreData[]` and ranked `CumulativeStanding[]`. Optional `?leagueId=` for server-side filter (the standings page itself keeps client-side league filtering for chart UX).
- **`/api/admin/health/standings`** — new admin RAG probe. Runs the shared lib, applies invariants (the all-zeros pattern, empty-with-data, count mismatches), returns healthy / degraded / down with a top-5 sample. Wired into the admin Health tab as a 4th panel alongside PubChat / WhatsApp / Email, plus a diagnostic sub-panel showing warnings and the sample.
- **Standings page** now fetches from `/api/standings`. The existing `onSnapshot(race_results)` listener is retained as a refetch trigger so live updates after admin scoring still feel near-real-time.

### Bug fix — broken Season Standings table in results emails

- **Fixed:** the cumulative standings table in race results emails has been showing every team at 0 points (all tied at rank #1) since the function was added on 2026-03-14. The inline implementation was reading `pred.driver1..driver6` from prediction documents — fields that do not exist. Driver picks are stored in `pred.predictions` (an array). The new shared lib reads the correct field and produces the same numbers as the on-screen standings page. Reported by reviewing the Miami GP results email sent at 23:14 on 2026-05-03.
- **Graceful degradation:** if the cumulative compute fails (Firestore outage, malformed data), the email still ships with the per-race scores. The Season Standings table is replaced with a placeholder that links to `/standings` and includes the error code + correlation ID for support.
- **Secondary teams now appear** in the email standings (previously dropped because the inline `teamNameByUid` map only included primary teams).

### New error registry entries

- `STANDINGS_HEALTH_DEGRADED` (PX-5010) — admin-side warning when the standings probe trips an invariant.
- `STANDINGS_FETCH_FAILED` (PX-5011) — client-side error when `/api/standings` cannot be reached.

### Files

- New: `app/src/lib/cumulative-standings.ts`, `app/src/app/api/standings/route.ts`, `app/src/app/api/admin/health/standings/route.ts`, `app/scripts/verify-standings-parity.ts` (one-shot, delete after 3.1.0 ships).
- Modified: `app/src/app/api/send-results-email/route.ts`, `app/src/app/(app)/standings/page.tsx`, `app/src/app/(app)/admin/_components/InterfaceHealthMonitor.tsx`, `app/src/lib/error-registry.ts`, `app/src/lib/error-registry-client.ts`.

---

## v2.2.0 — 2026-03-18

### Features
- **Prediction clone rule engine** — fire-and-forget server-side engine in `submit-prediction/route.ts`. When a primary team submits picks, all active `prediction_clone_rules` for that user fire automatically. Clone predictions are inverted (reverse order) and written to destination teams with `isCloned: true`.
- **`prediction_clone_rules` collection** — new permanent Firestore collection seeded with 3 whole-season invert rules: Kwik Fitties → Shoe Piastry, gronyteen → nosey parker, Montfleur Motor Racing → Magnussen Force.
- **Retroactive backfill** — inverted predictions written for Australian GP, Chinese GP (and Japanese GP for gronyteen) for all 3 clone pairs.
- **Test User deleted** — removed `tF07x5SOPXTsMxzuihbEgGvtnxr1` from Firestore, global league, and Firebase Auth.
- **Magnussen Force email corrected** — `aaon.garcia.uk+mf@gmail.com` → `Aaron.Garcia.uk+MF@gmail.com`.

---

## v2.1.9 — 2026-03-18

### Features
- GPS Replay player on Pit Wall — Chinese GP full race download from Firebase Storage with media controls (⏮⏪⏸/▶⏩⏭), speed selector (0.5× – 8×), scrub bar.

### Fixes
- My Results chart labels season leader as "Leader (Name)" not bare team name.

---

## v2.1.8 — 2026-03-18

### Fixes
- Pit Wall track map — use `/location` endpoint for GPS x/y/z instead of `/position`.
- Pit Wall incremental: circuit outline, session-adaptive polling, `positionDataAvailable` flag.
- Secondary team creation: pit lane lockout (BUG-ST-002) — returns 403 with locked race name and next open date after qualifying starts.
- Secondary team creation: `secondaryTeamCreatedAt` timestamp now written to user doc (BUG-ST-001).

---

## v2.1.7 — 2026-03-16

### Fixes
- Results email Season Standings now shows cumulative totals across all races (not just current race points).

---

## v2.1.6 — 2026-03-15

### Features
- FIA classification PDF URL field in admin results entry with direct link on public results page.

---

## v2.1.5 — 2026-03-15

### Features
- Admin must type exact race name to confirm result submission — prevents wrong-race entry (BUG-ADM-002).

---

## v2.1.4 — 2026-03-13

### Features
- Pit Wall loading screen with animated progress.
- Server-side shared live data cache (2s TTL thundering-herd guard).
- Standings fix for sprint-only weekends.

---

## v2.1.3 — 2026-03-12

### Fixes
- GlobalErrorLogger IDB filter for Safari iOS.
- Pit Wall multi-threaded rewrite.

---

## v2.1.2 — 2026-03-12

### Fixes
- `findNextRace()` uses `raceTime` not `qualifyingTime` — PubChat was showing Japan instead of China.

---

## v2.1.1 — 2026-03-11

### Features
- Pit Wall refresh interval auto-resets to 60s after 20 minutes.

---

## v2.1.0 — 2026-03-10

### Features
- Pre-Race Showreel — 2025 historical telemetry replay on Pit Wall before live sessions.

---

## v2.0.49 — 2026-03-09

### Fixes
- Pit Wall auth — `verifyAuthToken` returns null not `{valid}`.
