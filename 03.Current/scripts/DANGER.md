# SCRIPTS — OPERATIONAL DANGER ZONE

> **BOW SCRIPTS-001** — Security audit flag (2026-02-24). These scripts are intentionally
> unprotected for operational speed. Protection is at the filesystem level.

These scripts operate directly on the **production Firebase database** using the service account key.
Many are destructive and **irreversible**. Read this file before running any script.

---

## Critical Safety Rules

1. **NEVER run without a recent backup.** Run `backup-race-results.js` first.
2. **NEVER run on production without explicit instruction from Aaron.**
3. **ALL scripts use the service account (`GOOGLE_APPLICATION_CREDENTIALS` or `service-account.json`)** — they bypass all Firestore security rules.
4. **There is NO dry-run mode** for most scripts. Once run, changes are permanent.
5. **Verify the Firebase project ID before running** — see confirmation command below.

---

## Most Destructive Scripts (High Risk)

| Script | Risk | What it does |
|--------|------|--------------|
| `reset-db.ts` | 🔴 HIGH | TOTAL DATA LOSS — wipes users and races collections entirely |
| `purge-race-results.js` | 🔴 HIGH | Permanently deletes ALL documents from `race_results` collection |
| `purge-scores.js` | 🔴 HIGH | Permanently deletes ALL documents from `scores` collection |
| `delete-all-scores.ts` | 🔴 HIGH | Bulk deletes all score documents; standings become empty |
| `clear-feedback-and-errors.ts` | 🔴 HIGH | Permanently deletes all `feedback` and `error_logs` documents |
| `purge-test-season.ts` | 🟡 MEDIUM | Deletes race_results + test-team scores + prediction subcollections |
| `cleanup-consistency-reports.js` | 🟡 MEDIUM | Removes consistency-report documents from `error_logs` |
| `cleanup-notified-feedback.js` | 🟡 MEDIUM | Deletes resolved feedback entries after user notification |
| `remove-breakdown-from-scores.js` | 🟡 MEDIUM | Strips `breakdown` field from all score documents (irreversible) |
| `redact-email-pins.ts` | 🟡 MEDIUM | Overwrites plaintext PINs in `email_logs` with redacted values |
| `migrate-*.ts / *.js` | 🟡 MEDIUM | Data migrations — hard to reverse |
| `keep-latest-predictions.ts` | 🟡 MEDIUM | Deletes older prediction documents, keeping only the latest |

---

## Before Running Any Script

```bash
# 1. Confirm you are targeting the correct Firebase project:
node -e "const sa = require('./service-account.json'); console.log('Project:', sa.project_id);"

# 2. Take a backup
node scripts/backup-race-results.js

# 3. Run the least destructive operation first if possible
#    (e.g., analyse before purge)
```

---

## Recovery

If a destructive script was run in error:

1. Check if `restore-race-results.js` or `restore-r1-r2.js` applies.
2. Check Firebase Firestore console for any automatic daily backups.
3. Contact Aaron immediately — some data may be recoverable from `analyze-backup.js` output files.

---

## Security Note

`reset-db.ts` has a `_safety-checks` guard that blocks production execution.
All other HIGH risk scripts have **no such guard** — they will run on whatever project
the service account credential points to.
