# Newbie Experience — Cold Walkthrough Audit

> **Date:** 2026-07-26 · **Auditor:** Bill (cold walkthrough subagent, read-only code trace)
> **Method:** role-played a brand-new F1 fan arriving via an invite link: invitation → signup →
> first login → dashboard → prediction → every page under `(app)`. All findings are logged in the
> Book of Work under `NEWBIE-NN`.
> **App version at audit:** 3.11.0

## Executive summary

The core loop is solid, but a newcomer's first hour is harmed by three things:
1. **The late-joiner first-contact is actively confusing** — their first Predictions view shows
   *cloned strangers' picks* presented as "your submission", locked (NEWBIE-09), and the
   onboarding checklist auto-ticks "Make a Prediction" from those clones (NEWBIE-10).
2. **A dead click on the very first screen** — an invited person whose email already has a PIN
   account gets zero feedback from the Google/Apple buttons on the invite form (NEWBIE-15).
3. **Terminology drift** — PubChat/Live Timing, About/Help, Audit, Pit Lane: four navigation
   labels that don't say what they are to someone who just arrived (NEWBIE-01/-03/-06, -02).

## Top 5 priorities

| # | Finding | Severity | One-liner |
|---|---------|----------|-----------|
| 1 | NEWBIE-09 | HIGH | Late joiner's first Predictions view shows cloned picks as a locked "your submission" — explain the clone + point at their real first race |
| 2 | NEWBIE-15 | MED | Invite-form OAuth silently no-ops when the email already has a PIN account (`needsLinking` unhandled) |
| 3 | NEWBIE-08 | MED | Two-to-three stacked welcome cards; consolidate and suppress after `/welcome` acknowledgement |
| 4 | NEWBIE-01/-03/-06 | MED | Rename nav: PubChat→Live Timing, Audit→My Activity, unify About/Help |
| 5 | NEWBIE-13/-14 | MED | Soften raw `[PX-####]` error surfaces; client-side weak-PIN check before submit |

## All findings

### Terminology / copy
- **NEWBIE-01 (med)** `AppSidebar.tsx:70` — Nav says "PubChat", route is `/live`, component is "Live Timing". Four names for one thing. → Rename nav to "Live Timing" and align.
- **NEWBIE-02 (med)** — "Pit Wall"/"Pit Lane Closed" used to mean the prediction deadline; jargon for newcomers. → Pair every Pit Lane state with plain language ("Predictions Open / Deadline Passed").
- **NEWBIE-03 (med)** `AppSidebar.tsx:84` — Main-nav "Audit" reads like a compliance tool. → Rename to "My Activity".
- **NEWBIE-04 (low)** — "GP" vs "Grand Prix" vs "R9 Spr" vs " - Sprint" inconsistent across standings/results/submissions. → One label scheme.
- **NEWBIE-05 (low)** — "Paddock", "grid", "Team Principal" flavour terms unexplained on first use. → Gloss on first use (predictions page already does this for "grid").

### Onboarding / navigation
- **NEWBIE-06 (med)** `onboarding/page.tsx:87` — Checklist says "Visit the About page"; nav labels `/about` as "Help". → One name everywhere.
- **NEWBIE-07 (low)** — "Getting Started" buried in the bottom nav group. → Pin to top for users with incomplete onboarding.
- **NEWBIE-08 (med)** — WelcomeCTA + DashboardClient welcome card stack (2 cards; 3 welcomes for late joiners after `/welcome`). → Consolidate; suppress post-acknowledgement.

### Late-joiner specifics (active-floor rule)
- **NEWBIE-09 (HIGH)** `predictions/page.tsx:356-376` — First visit after qualifying: locked editor filled with cloned picks labelled as "your submission". → Detect cloned state; show "placeholder picks were cloned for you; your first editable race is {nextRaceName}".
- **NEWBIE-10 (med)** `onboarding/page.tsx:194-204` — `predictionMade` auto-ticks from cloned docs. → Exclude `_clonedFromLateJoinerHandicap` docs.
- **NEWBIE-11 (low)** `api/auth/signup/route.ts:511` — Comment still documents the old "−5" rule. → Update to active-floor −1.
- **NEWBIE-12 (low)** `welcome/page.tsx:40` — Missing `lateJoinerInfo` renders vague defaulted specifics on an acknowledgement screen. → Softer "being set up" state.

### Error paths
- **NEWBIE-13 (med)** — Raw `[PX-####]` + correlation IDs inline on login/complete-profile/submissions/standings. → Friendly sentence first, code behind a "details for support" affordance.
- **NEWBIE-14 (med)** `InviteSignupForm.tsx:56` — Weak-PIN list is server-only; `123456` bounces after full form submit. → Mirror check client-side.
- **NEWBIE-15 (med)** `InviteSignupForm.tsx:122-140` — OAuth `needsLinking` unhandled on invite form: button spins, nothing happens. → Show the same "account exists" dialog as login.
- **NEWBIE-16 (med)** `complete-profile/page.tsx:192-200` — Success relies solely on the auth listener to navigate. → Fallback `router.push('/dashboard')`.

### Dead ends / empty states
- **NEWBIE-17 (med)** `submissions/page.tsx:490` — "Auto"/"Manual" badges and carry-forward count with no legend. → One-line legend.
- **NEWBIE-18 (med)** `standings/page.tsx:356` — Legend collapsed by default on a dense, jargon-heavy page; late-joiner penalty annotation unexplained. → Open legend for low-history users; tooltip on the annotation.
- **NEWBIE-19 (low)** — Help page says Teams predictions are hidden until deadline; Teams page shows them regardless. → Reconcile (gate or correct copy).
- **NEWBIE-20 (low)** — `/live` and `/pit-wall` between races show empty shells with no "come back on race weekend" framing. → Explicit between-sessions empty state.
- **NEWBIE-21 (low)** `leagues/page.tsx:430` — Non-owner league members can't see or re-share the invite code and get no hint. → "Ask the league owner" line.

### Mobile
- **NEWBIE-22 (med)** — dnd-kit drag-reorder prediction grid is error-prone on touch; primary onboarding CTA lands here. → Ensure tap-to-place works and say so.
- **NEWBIE-23 (low)** — Full bump chart is hard to parse on a phone as the first "how am I doing?" view. → Default mobile to table or My Position mode.

### Copy nits
- **NEWBIE-24 (low)** `teams/page.tsx:453` — "teams predictions" missing apostrophe; empty states lack a next step.
- **NEWBIE-25 (low)** `InviteSignupForm.tsx:200` — Invited email is editable but signup ties to the token; a changed email creates a mismatch. → Lock the field or validate it matches.

## Next-season backlog (Aaron, 2026-07-26)

- **INVITE-TREE-001** — Invitation genealogy tracking: when Aaron invites Garth and Garth invites
  Pablo, the invite records should chain (invitedBy on each token/user) so the admin can see the
  full referral tree of how teams registered. Target: next season's signup flow.
