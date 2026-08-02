# Prix Six Backup Retention Policy

> **Effective:** 2026-08-02 · **Owner:** Aaron · **Review:** annually, or when data volume/regulation changes
> Enforcement is automated; this document is the human-readable statement of record that the
> automation is aligned to. If automation and this document disagree, treat it as an incident:
> fix whichever is wrong in the same change (Golden Rule #3).

## What we keep, where, and for how long

| Tier | Store | Contents | Cadence | Retention | Enforced by |
|---|---|---|---|---|---|
| Primary backup | `gs://prix6-backups` (Google) | Firestore export (all collections), Auth users JSON, Storage files | Daily 02:00 UTC | Every daily for **7 days**; beyond that only **Fridays** and **1st-of-month** are kept | `applyBackupRetention` Cloud Function (03:30 UTC daily) + 7-day GCS Object Retention Lock |
| Offsite mirror | Azure Blob `garcialtdstorage/prix6-offsite-backups` (Microsoft) | The full daily export as ONE AES-256-GCM-encrypted zip | Daily 03:00 UTC | Rolling **60 days** of dailies; cool tier after 14 days; blob versions 30 days; soft delete 30 days (blobs and container) | Azure lifecycle policy `prix6-offsite-retention` — deliberately Azure-side, because the mirror function's SAS has **no delete rights** |
| Key escrow | GCP Secret Manager + Azure Key Vault `prixsix-secrets-vault` + Aaron's Apple Passwords | The AES-256 encryption key (3 vendors, no shared trust domain) | n/a | Indefinite; rotate on suspicion of exposure | Manual |

## Why these numbers

- **Offsite = disaster recovery, not archive.** Its one job is surviving a Google-side
  catastrophe (account compromise, accidental purge, lockout). 60 days of dailies gives two
  full months to *notice* a slow-burn problem — including data corruption that silently
  propagates into every subsequent backup — while any single good day in the window restores
  the league. Deep history (season archaeology) is the GCS Friday/monthly tier's job, not the
  offsite's.
- **PII minimisation.** Backups contain player emails and predictions. Keeping encrypted
  offsite copies beyond their recovery usefulness is pure liability (GDPR storage-limitation
  principle). 60 days is defensible as proportionate to the recovery purpose.
- **Cost is a non-issue either way** (~33 MB/day encrypted → ~2 GB steady state, pennies per
  month; the 14-day cool-tier step halves even that), so the retention number is chosen on
  recovery-value and liability grounds, not cost.
- **Why deletion lives in Azure, not in code we run:** the mirror's SAS can create and write
  but never delete or list. A stolen Google-side credential therefore cannot purge offsite
  history; only the Azure lifecycle engine (or Aaron in the Azure portal) removes blobs.

## Known asymmetry (accepted)

The GCS tier keeps Friday + 1st-of-month backups **indefinitely** (no outer age cap in
`applyBackupRetention`). At current sizes this is harmless and useful season history; revisit
if the bucket exceeds ~50 GB or a data-subject erasure request requires reaching into old
archives.

## Operational commitments

- **Restore drill quarterly** (`app/scripts/restore-offsite-backup.js` from `app/`) — key
  fetched from the Azure Key Vault escrow, never GCP, so the drill proves the Google-is-gone
  path. Results recorded to `backup_status/latest`; the admin Offsite Mirror card nags past
  100 days.
- **SAS renewal before 2028-08-02** (2-year token minted 2026-08-02): re-mint with
  `az storage container generate-sas … --permissions cw` and add a new version of the GCP
  secret `AZURE_BACKUP_SAS_URL`.
- **Monitoring:** `/health-check` CHECK 11 (`lastOffsiteMirrorTimestamp` < 26h), admin
  Backups tab cards, failures as PX-7011 in `error_logs` (GR#17).
