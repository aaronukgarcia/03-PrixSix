# Azure cost reduction, garcia.ltd DNS move and quality review — plan of 2026-10-12

Owner: Aaron. Written by Bill (Claude) after the September Microsoft invoice G189680716 (GBP 108.44).
Everything in section 1 is DONE and verified tonight. Sections 2 to 4 are plans awaiting Aaron.

## 1. What was done tonight (verified)

| Step | Evidence |
|---|---|
| Worker 2.2.7 built in ACR (run dbm, 55 s) and deployed | `/health` on the container app reports `version: 2.2.7`, `connected: true` |
| Blob write storm stopped | PutBlob per minute: 658 every 5 min before 22:21Z; 0 from 22:24Z on (two start-up bursts of 1621 and 1011 are the session restore) |
| Race-window schedule applied | revision `prixsix-whatsapp--v227-sched`, minReplicas 0, maxReplicas 1, 7 cron rules (singapore, united-states, mexican, brazilian, las-vegas, qatar, abu-dhabi) |
| Budget created | `monthly-cap-gbp20` on subscription 8e1afaa3…, GBP 20/month, emails to aaron@garcia.ltd and aaron.garcia@hotmail.co.uk at 50/80/100 % actual and 100 % forecast |
| Cost incurred | ACR Tasks build, about GBP 0.02 (cost-gate token 20261012-231947-176c4a) |

**Not a hard cap.** Azure Pay-As-You-Go cannot stop spending at a number; a budget only alerts. A true cap needs an action group that disables resources, which is more plumbing than the spend it protects. The alerts are the control.

### Race windows (UTC) now configured

| Race | Worker on | Worker off |
|---|---|---|
| Singapore (already live) | 2026-10-08 00:00 | 2026-10-13 00:00 |
| United States | 2026-10-22 00:00 | 2026-10-27 00:00 |
| Mexico | 2026-10-29 00:00 | 2026-11-03 00:00 |
| Brazil | 2026-11-05 00:00 | 2026-11-10 00:00 |
| Las Vegas | 2026-11-19 00:00 | 2026-11-24 00:00 |
| Qatar | 2026-11-26 00:00 | 2026-12-01 00:00 |
| Abu Dhabi | 2026-12-03 00:00 | 2026-12-08 00:00 |

Rules come from `app/src/lib/data.ts` via `whatsapp-worker/scale-schedule.js`. Cron has no year, so re-run `deploy-container-app.ps1 -SkipBuild` when the 2027 calendar lands or a race moves.

## 2. Race weekend cost forecast

Derived from September actuals (GBP, before VAT).

| Item | Basis | Per race window (5 days) |
|---|---|---|
| Container App prixsix-whatsapp, 1 vCPU / 2 GiB | 27.81 for 30 days always-on = 0.93/day | 4.64 |
| Blob writes (two start-up bursts + incremental sync) | ~2.6k writes at 0.0043 per 1k | 0.01 |
| Blob storage, egress, Key Vault | September actuals | 0.05 |
| **Per race weekend** | | **about 4.70** |

Fixed items that bill whether or not a race runs:

| Item | Per month |
|---|---|
| Container registry prixsixacr (Basic) | 3.68 |
| DNS zone garcia.ltd | 0.21 |
| Front Door garcia-cdn (until section 3 is done) | 24.94 |
| Metropolis: metropolisacr 3.20 + container app 0.14 (not Prix Six, same subscription) | 3.34 |

Monthly outlook before VAT:

| Month | Race windows | Prix Six variable | Fixed (with Front Door) | Fixed (Front Door gone) | Total with FD | Total without FD |
|---|---|---|---|---|---|---|
| October (12th onward only) | 2 (Austin, Mexico start) + half month of old always-on | ~16 | ~32 | | ~48 | |
| November | 3 (Brazil, Las Vegas, Qatar) | 14.1 | 32.2 | 7.2 | 46 | 21 |
| December | 1 (Abu Dhabi) | 4.7 | 32.2 | 7.2 | 37 | 12 |
| Off season (Jan to Feb) | 0 | 0 | 32.2 | 7.2 | 32 | 7 |

November lands at the GBP 20 budget even with Front Door gone. The GBP 3.34 of Metropolis and the GBP 3.68 registry fee are the levers if that matters: a Basic registry is a flat fee, and both registries could share one.

## 3. garcia.ltd (and jonnyclifton.uk) move to Cloudflare free — careful plan

Goal: delete Front Door Standard (GBP 24.94/month). Both custom domains it serves must move, or the fee stays.

### What Front Door does today

| Custom domain | Origin | Purpose |
|---|---|---|
| www.garcia.ltd | garcialtdstorage static website | papers site |
| jonnyclifton.uk, www.jonnyclifton.uk | jonnycliftonuk static website | Jonny Clifton site |

September traffic was 6,957 requests and 27 MB. Cloudflare free covers that many times over.

### Risk to manage

garcia.ltd DNS also carries Microsoft 365 mail for aaron@garcia.ltd (MX, SPF, DKIM, autodiscover) and whatever TXT verifications exist. A botched zone copy breaks email. Everything below is ordered so email never depends on an unverified record.

### Steps

1. **Freeze and export (read-only, 10 min).** Export both zones from Azure DNS (`az network dns zone export`) into `temp/` and keep a copy in the password manager. The cost-gate hook flags `az network dns` commands, so this runs under a token or Aaron runs it. Record every record set in a checklist table in this document.
2. **Decide the static-site origin.** Cloudflare free cannot rewrite the Host header, and Azure static websites need the storage hostname as Host. Two sane options, choose one:
   - **Cloudflare Pages** (recommended): upload the papers site and the Jonny Clifton site as Pages projects. Free, HTTPS, custom domains included, no Azure storage dependency, no Worker code.
   - Cloudflare Worker (free tier) proxying to the storage hostname. Works, but it is code to maintain.
3. **Create the Cloudflare zones** for garcia.ltd and jonnyclifton.uk (free plan). Import the exported records. Do not change nameservers yet.
4. **Verify the imported zones record by record** against the checklist from step 1, especially MX, SPF TXT, the two DKIM CNAMEs, autodiscover CNAME, any `_dmarc` and verification TXTs. Set the proxied flag OFF (grey cloud) on all mail-related records. Query the Cloudflare nameservers directly (`nslookup -type=MX garcia.ltd <cf-ns>`) and compare with Azure answers.
5. **Lower TTLs** in Azure DNS to 300 s one day before cutover so a rollback is quick.
6. **Cutover, one zone at a time.** Change the nameservers at the registrar for jonnyclifton.uk first (no email on it). Watch 24 h: site loads over HTTPS, no certificate warnings. Then garcia.ltd.
7. **Email proof after garcia.ltd cutover.** Send from aaron@garcia.ltd to an external address and back, check headers show SPF pass and DKIM pass. Check Outlook autodiscover on a fresh profile. Only after this passes is the move considered done.
8. **Soak for 7 days.** Keep Azure DNS zones and Front Door alive but idle. Rollback is reverting the nameservers at the registrar.
9. **Decommission.** Delete Front Door profile garcia-cdn (saves 24.94/month). After 30 days delete the Azure DNS zones (0.21/month) and, if Pages hosts the sites, the `$web` containers. Update the Azure resources memory note.

### Costs of this plan

Cloudflare free: GBP 0. Registrar nameserver change: GBP 0. Azure: nothing new. Deleting Front Door is the only billing change, and it is a reduction.

### Who does what

Aaron: Cloudflare account login, registrar login, the two nameserver changes, the email proof in step 7. Bill: exports, imports, record verification, Pages uploads, the decommission steps under cost-gate.

## 4. Quality review plan — proving the actions landed

Each check has a date, a method and a pass condition. Record results in this table as they happen.

| # | When | Check | Method | Pass | Result |
|---|---|---|---|---|---|
| Q1 | 2026-10-12 22:25Z | Worker version live | GET `/health` | `version` 2.2.7, `connected` true | PASS |
| Q2 | 2026-10-12 22:30Z | Blob write storm gone | Storage metric Transactions, ApiName PutBlob, 1-min grain | 0 per minute in steady state | PASS (0 from 22:24Z) |
| Q3 | 2026-10-13 00:05Z | Scale to zero after Singapore window | Revision `v227-sched` replicas; `/health` | replicas 0; health unreachable | pending |
| Q4 | 2026-10-13 and 14 | No blob writes while off | Same metric, daily | PutBlob 0 for the day | pending |
| Q5 | 2026-10-22 00:05Z | Wake for Austin | replicas 1; `/health` connected; log shows "Restored N auth files" | connected within 2 min, no QR needed | pending |
| Q6 | 2026-10-22 | End-to-end send after wake | Admin WhatsAppManager manual send to prix6-test (testMode on) | message arrives with Bill#n suffix | pending |
| Q7 | 2026-10-22 | Stale backlog expired, not sent | whatsapp_queue docs created before 2026-10-21 00:00Z | status FAILED, error starts "EXPIRED" | pending |
| Q8 | 2026-10-27 00:05Z | Scale down after Austin | replicas 0 | yes | pending |
| Q9 | within 48 h of any threshold | Budget alerts work | inbox for "Budget monthly-cap-gbp20" | email received at 50 % (expected mid-October because the first 12 days were old-rate) | pending |
| Q10 | 2026-11-09 (October invoice) | October bill | Cost Management by service | Container Apps under GBP 20; Storage write ops under GBP 15 (both carry 12 old-rate days) | pending |
| Q11 | 2026-12-09 (November invoice) | November bill | invoice total before VAT | under GBP 46 with Front Door, under GBP 21 without | pending |
| Q12 | after section 3 step 7 | Email still works after DNS move | SPF and DKIM pass headers | pass | pending |
| Q13 | after section 3 step 9 | Front Door gone | Cost Management, service Azure Front Door Service | 0 for the month after deletion | pending |
| Q14 | each check above | error_logs noise from worker health probes while off | error_logs where route `/api/admin/whatsapp/health` | only when an admin opened the panel; no cron-driven noise | pending |

Review cadence: Bill updates the Result column at Q3, Q5, Q8 and after each invoice. Anything that fails goes to the Book of Work as a P1 the same day.
