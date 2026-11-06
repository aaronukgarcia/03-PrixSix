# Refactor to save: Cloudflare Workers/Pages, Neon, Clerk, Resend, R2 — plan of 2026-11-05

Owner: Aaron (decision). Written by Prix6-Bill. BOW item REFACTOR-SAVE-001 (plus COST-GCP-EXPORT-001 as its first step).
Question asked: what would Prix Six save by moving off Firebase/GCP + Azure onto Cloudflare Workers (Pages), Neon Postgres, Clerk, Resend and Cloudflare R2?

Short answer: on the bills as they stand, about GBP 4 to 8 a month (GBP 50 to 100 a year), and only if every target service stays inside its free tier. The migration is a rewrite of the data layer, auth, scheduled jobs and backups of a 90k-line app, which costs far more than that in tokens and risk. The cost wins that do pay back are inside the current stack (section 5).

## 1. What Prix Six pays today

### Google Cloud, billing account 013201-1DF202-96B537 (the Prix Six project)

Payment-received emails to aaron.garcia.uk@gmail.com; each payment on the 1st covers the previous month. GBP, VAT included as charged.

| Paid on | Amount | Covers |
|---|---|---|
| 2026-05-01 | 2.29 | April |
| 2026-06-01 | 1.28 | May |
| 2026-07-01 | 1.27 | June |
| 2026-08-01 | 7.68 | July |
| 2026-09-01 | 6.98 | August |
| 2026-10-01 | 10.10 | September |
| 2026-11-01 | 10.37 | October |

Trend: about GBP 10 a month now, up from GBP 1 to 2 in the spring. The GBP 100 / 101.01 / 17.00 payments in the same inbox are billing account 01C5C3 ("Default Gemini Project", the GBP 80 Gemini API spike of 18 Aug and the GBP 15 spend cap lifted 1 Nov). That account is not Prix Six and is out of scope here.

Per-SKU split is NOT available: the project has no billing export to BigQuery, and gcloud cannot read costs. What runs, and the likely cost order:

| Service | Shape today | Likely share |
|---|---|---|
| Cloud Run (App Hosting backend `prixsix`, europe-west4) | 1 vCPU / 512 MiB, minScale 0, maxInstances 1, gen1, CPU throttled | small: scale-to-zero, ~35 users |
| Cloud Functions 2nd gen (codebase prix6-backup) + Cloud Scheduler | 19 Node exports, 15 schedules in europe-west2; three run every 15 min, one every 30 min, billceleration 4x per hour, hourly hot news and token cleanup; one Python function (pub chat, hourly) | medium: ~450 invocations a day, each a cold Node runtime |
| Firestore | 44 collections, 51,064 top-level docs + 818 predictions; 30,214 of them are `whatsapp_status_log`, 13,538 `audit_logs`; 66 `onSnapshot` listeners in the client, 318 collection references, 18 transactions | medium: reads from the listeners and the backup export of every collection nightly |
| Cloud Storage | `prix6-backups` 29.39 GiB; default bucket 2.61 MiB | ~GBP 0.60 |
| Cloud Build | one build per push to main (3 to 5 min); 0 builds in the last 30 days | ~0 (free 120 min/day) |
| Secret Manager | 9 secrets mounted on Cloud Run | ~GBP 0.15 |
| Vertex AI (Gemini 2.5 Flash) | Billceleration picker, roasts, hot news | GBP 1 to 2 |
| Logging / Monitoring | default | ~0 |

### Azure, subscription 8e1afaa3 (resource group garcia)

From docs/plan-2026-10-12-azure-cost-and-dns.md and the 2026-10-18 Cost Management check, GBP before VAT:

| Item | Per month |
|---|---|
| prixsixacr (Basic registry) | 3.68 fixed |
| garcialtdstorage (WhatsApp session blobs; writes fixed by worker 2.2.7) | ~0.40 |
| prixsix-whatsapp container app (race windows only, 5 days per race) | 4.70 per race weekend: ~14 in a 3-race month, 0 off season |
| Key Vault prixsix-secrets-vault | pennies |
| Metropolis bits (not Prix Six) | 3.34, excluded |

Prix Six Azure: GBP 4 off season, GBP 9 to 18 in season.

### Not on any Prix Six bill

Email goes through Microsoft Graph on Aaron's existing M365 tenant (no marginal cost). DNS and the prix6.win zone sit on Cloudflare free. OpenF1 is a credentialed API with no recorded charge.

### Today's total

| | Off season | In season (3 races) |
|---|---|---|
| Google Cloud | ~10 | ~10 |
| Azure (Prix Six share) | ~4 | ~9 to 18 |
| **Total, GBP/month** | **~14** | **~19 to 28** |

Call it GBP 200 to 250 a year.

## 2. What the proposed stack would cost

Prices checked 2026-11-05 from vendor pages and recent third-party summaries (USD list prices; ~GBP 0.78 per USD). Verify on each vendor's pricing page before signing up.

| Service | Tier that fits | Monthly | Why that tier |
|---|---|---|---|
| Cloudflare Workers (Pages is folded into Workers static assets) | Workers Paid, $5 | ~GBP 4 | Next.js SSR via OpenNext exceeds the free plan's 10 ms CPU per request; Cron Triggers replace Cloud Scheduler (15 min CPU limit on paid); static assets free |
| Neon Postgres | Free (0.5 GB storage, 100 CU-hours/project/month, autosuspend) | GBP 0, risk of ~GBP 15 | 51k rows is a few tens of MB once the two log collections are pruned. Compute is the risk: crons every 15 min keep the branch awake ~8 h/day = ~60 CU-hours at 0.25 CU; a chattier schedule or the WhatsApp status writes push it past 100, then Launch at $0.106/CU-hour (~$19 for 180 CU-hours) |
| Clerk | Free (50,000 monthly retained users since Feb 2026) | GBP 0 | 35 users. Google and Apple sign-in both supported; Pro ($25) only for branding removal/allowlists |
| Resend | Free (3,000/month, 100/day, 1 domain) | GBP 0 | email_logs show 1,489 sends all season (~170/month). The 100/day cap bites on an incident day (23 emails) stacked on a race-reminder run (35); Pro is $20 |
| Cloudflare R2 | Free 10 GB, then $0.015/GB; egress free | GBP 0 to 0.25 | 29 GB of backups is 19 GB over: $0.29. Cut retention under 10 GB and it is free |
| Gemini for Billceleration/roasts | unchanged (Vertex, or Gemini API key) | GBP 1 to 2 | the AI cost does not move; keeping Vertex means keeping a GCP project and billing account anyway |
| WhatsApp worker | **not moveable to Workers** | GBP 4 to 18 (Azure, as today) | Baileys holds a persistent WebSocket; Workers cannot. Cloudflare Containers is an option but was not priced here |

| | Off season | In season |
|---|---|---|
| Proposed stack, GBP/month | ~9 to 10 | ~14 to 24 |
| Today | ~14 | ~19 to 28 |
| **Saving** | **~4** | **~5 to 8** |

Annual saving: roughly GBP 50 to 100, assuming every free tier holds. If Neon tips into Launch the saving is gone.

## 3. What the migration actually involves

Sized from the tree on 2026-11-05 (v3.26.3):

| Area | Today | After | Work |
|---|---|---|---|
| Hosting | Firebase App Hosting (Cloud Run) + Cloud Build | Workers via @opennextjs/cloudflare | adapter, edge-incompatible Node APIs in 75 API routes, env/secrets move, build pipeline, custom domain, the hosted.app verification route is lost |
| Data | Firestore, 44 collections, 318 collection refs, 18 transactions | Neon Postgres + an ORM (Drizzle/Prisma) | schema design for 44 collections, every read/write rewritten, migration scripts, dual-run and reconcile |
| Realtime | 66 `onSnapshot` listeners (Pit Wall, presence, predictions, admin panels) | Postgres has no push; polling, SSE or Durable Objects | the Pit Wall and presence code is the hard part; Durable Objects are extra Workers cost |
| Authorization | firestore.rules (protectedFields, isBot, audit_logs gap SEC-AUDITLOGS-001) | server-side checks in every route | rewrite, and a security review of each route (GGR17) |
| Auth | Firebase Auth: Google, Apple, email/password, custom tokens (admin challenge, probes), Apple relay emails | Clerk | user export/import (35 users; Firebase scrypt hashes importable), Apple Sign-In re-registration, session model in the app, the 4 createCustomToken paths |
| Scheduled work | 19 Cloud Functions + 1 Python function, 15 schedules | Workers Cron Triggers (or Queues) | each function ported; the Python pub-chat updater rewritten in TS; the 15-min CPU cap is fine for the nightly export |
| Email | Graph (M365) via lib/email.ts, queue, daily stats | Resend | transport swap is small; DKIM/SPF for prix6.win; the OPS-EMAIL-HEALTH-001 Graph probe goes away |
| Backups | nightly Firestore export to GCS + Azure mirror + weekly restore drill (I6) | pg_dump to R2 + restore drill | new drill scripts; the Azure mirror stays or becomes a second R2 bucket |
| Admin tooling | 14 inline firebase-admin scripts, bow-update.js, consistency checker, cheat check | SQL equivalents | every script |
| Observability | error_logs, audit_logs, health-check probes (3-place coupling) | same tables in Postgres | retargeting the probes |

Effort estimate: 150 to 300 agent-hours plus a two-week parallel run with reconciliation, and the whole season's history to migrate without losing a score. At any realistic token spend the payback on GBP 50 to 100 a year is beyond five years, before counting the regression risk to a live league.

What you gain that is not money: no Cloud Build minutes per push, no App Hosting rollout stalls, a relational schema for standings queries, free egress, and one vendor for DNS, hosting, storage and crons. What you lose: Firestore's realtime model (Pit Wall), the rules-as-policy layer, the proven backup/restore chain, and the Google/Apple sign-in setup that already works.

## 4. Recommendation

Do not migrate the stack for cost. Record the finding on REFACTOR-SAVE-001 and leave it open as a strategic option (reasons other than cost: vendor consolidation, Firestore realtime no longer needed, or GCP pricing changes). Revisit if the Google bill passes GBP 25 a month or when the next season's feature work would anyway touch the data layer.

## 5. Cheaper wins inside the current stack (ordered by payback)

1. **COST-GCP-EXPORT-001: enable the Cloud Billing export to BigQuery** (free; a few MB a month). Until it exists nobody knows which SKU drives the GBP 10. Everything below is a guess without it. One-off, 15 minutes, needs Aaron's console login.
2. **Prune and cap `whatsapp_status_log` (30,214 docs) and `audit_logs` (13,538).** They are 86 percent of all documents, get exported every night, and the status log is written by a 30-second poll. Add a TTL policy (Firestore TTL is free) and stop exporting them. Expected: smaller backups, fewer reads, the backup bucket stops growing.
3. **Coalesce the 15-minute schedules.** processEmailQueue, whatsAppQueueWatchdog and expireStaleLogons each wake a Node runtime 96 times a day; one 15-minute tick that does all three, and a 30-minute cadence off season, cuts function invocations by about half.
4. **Backup retention under 10 GB.** 29 GiB in prix6-backups at ~GBP 0.60 a month is small, but the retention policy (applyBackupRetention) should match the drill window, not grow forever. R2 is not needed for this.
5. **Azure registry.** prixsixacr Basic (GBP 3.68 fixed) is the largest fixed Prix Six line on Azure. Hosting the worker image in GitHub Container Registry (free for public, or within the account's allowance) and pulling from there removes it. Needs a cost-gated redeploy.
6. **Email via Resend only if Graph becomes a problem.** It saves nothing today; the Graph 403 on the health probe (OPS-EMAIL-HEALTH-001) is a permissions fix, not a reason to move.

Items 2, 3 and 5 together are worth about the same GBP 4 to 8 a month as the whole migration, for a few hours of work and no data-layer risk.

## 6. Sources checked

- Google payments: Gmail threads 1a19a6d8c91deebd, 1a0f972c1702f3f4, 1a05e60128ffbca2, 19fbe387a00faaab, 19f1eea1529bb57d, 19e8431c43477aad, 19de51049165c782 (customer ID in each body identifies the account).
- GCP: `gcloud billing projects describe`, `gcloud run services describe prixsix`, `gcloud scheduler jobs list --location europe-west2`, `gcloud storage du`, Firestore aggregation counts (temp scratch script fs-counts.js).
- Azure: docs/plan-2026-10-12-azure-cost-and-dns.md, memory notes azure-bill-sept-2026 and azure-resources.
- Vendor pricing: developers.cloudflare.com/workers/platform/pricing, developers.cloudflare.com/r2/pricing, neon.com/pricing (via activepieces and simplyblock summaries, Nov 2026), clerk.com/articles/clerk-pricing-explained, resend.com/pricing (via usecarly and costbench summaries, Oct 2026).

---

# Part B: the whole-year bill, the token build cost and Aaron's hours (added 2026-11-05)

Scope: every Prix Six module (Firebase/Google hosting + Firestore + Functions + Vertex AI, Azure WhatsApp worker, OpenF1 live feed, Cloudflare DNS + domain registration, Apple sign-in, Microsoft Graph email), December 2025 to November 2026. GBP as charged (Google payments are card charges; Azure Cost Management figures are pre-VAT and shown with 20 percent added). November is an estimate.

## B1. Hosting and services by month

| Month | Google Cloud | Azure (Prix Six resources) | OpenF1 live | Cloudflare | Gemini API (acct 01C5C3) | Apple Developer | Total |
|---|---|---|---|---|---|---|---|
| 2025-12 | 0 | 0 | 0 | 0 | 0 | 0 | **0.00** |
| 2026-01 | 0 | 15.00 | 0 | 16.50 (domain, invoice IN-55874866, $20.90) | 0 | 79.00 (annual, month assumed) | **110.50** |
| 2026-02 | 0 | 14.59 | 8.50 (from 18 Feb) | 0 | 0 | 0 | **23.09** |
| 2026-03 | 1.90 | 5.00 | 8.50 | 0 | 0 | 0 | **15.40** |
| 2026-04 | 2.29 | 4.94 | 8.50 | 0 | 0 | 0 | **15.73** |
| 2026-05 | 1.28 | 5.04 | 8.50 | 0 | 0 | 0 | **14.82** |
| 2026-06 | 1.27 | 19.70 | 8.50 | 0 | 0 | 0 | **29.47** |
| 2026-07 | 7.68 | 53.04 | 8.50 | 0 | 17.00 | 0 | **86.22** |
| 2026-08 | 6.98 | 61.08 | 8.50 | 0 | 201.01 (100.00 on 18 Aug + 101.01 on 1 Sep) | 0 | **277.57** |
| 2026-09 | 10.10 | 74.36 | 8.50 | 0 | 0 | 0 | **92.96** |
| 2026-10 | 10.37 | 43.55 | 8.50 | 0 | 0 | 0 | **62.42** |
| 2026-11 (est) | 10.00 | 10.10 | 8.50 | 0 | 0 | 0 | **28.60** |
| **Year** | **51.87** | **306.40** | **85.00** | **16.50** | **218.01** | **79.00** | **756.78** |

Notes on each column:

- **Google Cloud** (billing account 013201): App Hosting/Cloud Run, Firestore, 19 Cloud Functions + Python function, Cloud Scheduler, Secret Manager, 29 GB backup bucket, Vertex AI Gemini 2.5 Flash for Billceleration, roasts and hot news. Shown against the month consumed (the card is charged on the 1st of the following month). Nothing was charged for December to February: the project sat inside the free tier.
- **Azure** (subscription 8e1afaa3, resource group garcia, only the Prix Six resources): prixsix-whatsapp-worker (Jan to Feb) then prixsix-whatsapp container app (June on), prixsixacr registry, garcialtdstorage from June (the blob-write storm of worker 2.2.4, fixed 2026-10-12). The June to October climb is that storm plus the always-on worker, both fixed; the November figure is the new run-rate (registry + one race window).
- **OpenF1** live data: EUR 9.90 a month on Stripe since 2026-02-18, about GBP 8.50. Historical data would be free; the live tier feeds the Pit Wall and session-time sync.
- **Cloudflare**: the only invoice in the year, January, $20.90, is the prix6.win registration. DNS, Workers static sites and the zone are on the free plan.
- **Microsoft Graph email**: no marginal cost, it rides Aaron's M365 tenant. Not counted.
- **Apple Developer Program** (needed for Sign in with Apple): GBP 79 a year, confirmed by Aaron 2026-11-05 as part of Prix Six; no receipt in the Gmail account (paid on the Apple ID), so the month is assumed.
- **Gemini API** (billing account 01C5C3, project gen-lang-client-0258130516 "Default Gemini Project", key "Default Gemini API Key" created 2025-12-07): confirmed by Aaron as Prix Six spend. GBP 17.00 for July, then the 16 to 19 August burst (2,254 requests, GBP 80 flagged by the anomaly alert) that hit the GBP 15 spend cap on 20 Aug and paused the service; GBP 100.00 charged on 18 Aug and GBP 101.01 on 1 Sep. Monitoring shows 4 requests on 3 Oct and nothing else since 19 Aug, so it has stopped. The cap was lifted on 1 Nov, so on Aaron's word the key was deleted on 2026-11-05 23:19Z (deletion token 20261105-231921-880c51, BOW COST-GEMINI-KEY-001 done); no keys remain on the project, undelete possible for 30 days.

Excluded, on the same bills but not Prix Six: Azure Front Door garcia-cdn and the garcia.ltd DNS zone (about GBP 240 with VAT over the year, deleted 2026-10-13), and Microsoft 365.

Run-rate going forward, with the storm, the Gemini burst and Front Door gone: Google ~10, Azure 5 off season / 15 in season, OpenF1 8.50, domain 1.40, Apple 6.60, so GBP 30 to 40 a month, about GBP 430 a year.

## B2. Token build cost (Claude Code)

Source: ~/.claude/stats-cache.json (all-project daily tokens by model from 2026-06-27, daily message counts from 2026-01-18) joined to ~/.claude/history.jsonl (every prompt with its project folder) to take the Prix Six share of each day. Priced at API list (Opus 4.5+ $5/$25 per MTok, cache read 10 percent, cache write 125 percent; Sonnet $3/$15; Haiku $1/$5). Days before 27 June have no token record and are estimated from message counts at the later average of 254k tokens per message, so January is the softest number. If the account is on a Claude subscription the cash cost is the subscription, not these figures; they are what the same work would cost on the API.

| Month | Prix Six, USD | All projects, USD | Prix Six days | Basis |
|---|---|---|---|---|
| 2026-01 | 6,632 | 11,997 | 8 | estimated |
| 2026-02 | 0 | 5,373 | 0 | see note |
| 2026-03 | 1,533 | 2,517 | 9 | estimated |
| 2026-04 | 1,484 | 1,578 | 6 | estimated |
| 2026-05 | 352 | 9,914 | 5 | estimated |
| 2026-06 | 346 | 7,277 | 6 | mostly estimated |
| 2026-07 | 1,496 | 2,604 | 13 | measured |
| 2026-08 | 242 | 20,640 | 4 | measured |
| 2026-09 | 231 | 29,907 | 3 | measured |
| 2026-10 | 677 | 12,158 | 9 | measured |
| **Total** | **12,992 (about GBP 10,100)** | **103,965** | | |

February: 288 commits and 16 commit days, but only 182 Claude prompts on 4 days and no token record, so that month's build ran mostly outside Claude Code (the tree holds Gemini RCA notes from the period). Its token cost is unknown and not in the total.

The all-time figure across every project on this machine is 132.5 billion tokens, USD 79.7k at today's list prices (USD 104k when the daily records are priced by model). Prix Six is about 12.5 percent of it.

## B3. Aaron's hours

Three measures, all from logs, none from memory:

| Measure | Figure |
|---|---|
| Commits | 902 since 2025-12-28; 405 fix/security/diag type, 226 feat/perf/refactor, the rest chore, docs, version bumps |
| Releases | 86 versions in CHANGELOG.md, 64 version-bump commits, now v3.26.3 |
| Book of Work | 642 items raised and worked |
| Active commit days | 80; first-to-last commit span sums to 518 h |
| Prompts typed to Claude on Prix Six | 2,363 over 93 days (history.jsonl) |
| Keyboard hours, per day the larger of prompt-island time and commit span | **607 h over 108 days** |

By month (hours, days): Jan 157/10, Feb 129/16, Mar 140/23, Apr 25/8, May 11/5, Jun 36/11, Jul 71/13, Aug 6/5, Sep 8/4, Oct 26/13. Three quarters of the effort landed in the January to March build; the season since April has been maintenance at 10 to 70 hours a month.

Those are hours with the tools open. Testing on the phone, WhatsApp group admin, score checks on race Sundays and the player emails are not logged; adding a third for those gives a working estimate of **650 to 750 hours** for the year, roughly 15 working weeks. Commit timestamps cluster from 15:00 to midnight on weekdays, with Thursday the busiest day.

## B4. Putting it together

| | Year to date |
|---|---|
| Hosting and services actually paid | GBP 757 |
| Avoidable part of that, now fixed (blob storm, always-on worker, Gemini burst) | about GBP 350 |
| Token build cost at API list | about GBP 10,100 (USD 13.0k), February unknown |
| Aaron's time | 650 to 750 hours |

Hosting is under 5 percent of the build cost in tokens and a rounding error against the hours. The refactor in Part A attacks the smallest of the three numbers.
