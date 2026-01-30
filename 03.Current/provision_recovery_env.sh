#!/usr/bin/env bash
# GUID: PROVISION_RECOVERY-000-v03
#
# provision_recovery_env.sh
#
# [Intent] One-time infrastructure setup for the Prix Six backup & recovery system.
#          Creates all GCP resources needed before Cloud Functions can run.
#
# [Inbound Trigger] Manual execution by a GCP project Owner.
#
# [Downstream Impact]
#   - Creates gs://prix6-backups bucket with IRREVERSIBLE 7-day Object Retention Lock
#   - Creates prix6-recovery-test GCP project with billing and Firestore
#   - Enables PITR on the main project's Firestore
#   - Grants IAM roles so Cloud Functions can export, import, and clean up
#
# What this script does:
#   1. Creates gs://prix6-backups bucket with 7-day Object Retention Lock
#   2. Creates prix6-recovery-test GCP project and links billing
#   3. Enables required APIs on both projects
#   4. Creates Firestore database in the recovery project
#   5. Enables PITR on the main project's Firestore
#   6. Grants IAM roles for export and restore operations
#
# Prerequisites:
#   - gcloud CLI authenticated with Owner access to prix6-prod
#   - Billing account ID available
#
# Usage:
#   chmod +x provision_recovery_env.sh
#   ./provision_recovery_env.sh
#
# WARNING: The 7-day retention lock on the bucket is IRREVERSIBLE.
#          Once set, the minimum retention period cannot be reduced.
#
set -euo pipefail

# ── Configuration ───────────────────────────────────────────────
# GUID: PROVISION_RECOVERY-001-v03
# [Intent] Centralise all tuneable parameters at the top of the script.
#          RETENTION_DAYS controls the Object Retention Lock duration.
# [Inbound Trigger] Script start.
# [Downstream Impact] Every step below references these values.
MAIN_PROJECT="prix6-prod"
RECOVERY_PROJECT="prix6-recovery-test"
BUCKET="prix6-backups"
REGION="europe-west2"
RETENTION_DAYS=7
RETENTION_SECONDS=$((RETENTION_DAYS * 86400))

# ── Helpers ─────────────────────────────────────────────────────
# GUID: PROVISION_RECOVERY-002-v03
# [Intent] Provide consistent, severity-prefixed output for scripted ops.
#          confirm() gates destructive / irreversible operations behind y/N prompt.
# [Inbound Trigger] Called throughout the script.
# [Downstream Impact] fail() exits with code 1; confirm() exits on non-Y answer.
log()   { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*" >&2; }
fail()  { echo "[ERROR] $*" >&2; exit 1; }

confirm() {
  read -rp "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "Aborted by user."
}

# ── Pre-flight checks ──────────────────────────────────────────
# GUID: PROVISION_RECOVERY-003-v03
# [Intent] Verify that gcloud and gsutil CLIs are installed before attempting
#          any GCP operations. Print a summary of what will happen and require
#          explicit confirmation.
# [Inbound Trigger] Script start, after configuration.
# [Downstream Impact] Exits early if CLIs are missing. Shows the user exactly
#                     which projects/buckets will be affected.
command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI not found. Install it first."
command -v gsutil >/dev/null 2>&1 || fail "gsutil not found. Install Google Cloud SDK."

CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
log "Current gcloud project: ${CURRENT_PROJECT:-<none>}"
log "Main project:           $MAIN_PROJECT"
log "Recovery project:       $RECOVERY_PROJECT"
log "Backup bucket:          gs://$BUCKET"
log "Region:                 $REGION"
log "Retention:              $RETENTION_DAYS days (IRREVERSIBLE lock)"
echo ""
confirm "Proceed with provisioning?"

# ── Step 1: Create backup bucket with retention lock ────────────
# GUID: PROVISION_RECOVERY-010-v03
# [Intent] Create the GCS bucket that will hold all Firestore exports and
#          Auth JSON backups. The bucket uses Uniform Bucket-Level Access (-b on)
#          and a 7-day Object Retention Lock. The lock is applied in two stages:
#          first set the retention policy, then lock it (irreversible).
# [Inbound Trigger] User confirmed provisioning.
# [Downstream Impact] Once locked, objects in this bucket cannot be deleted or
#                     overwritten before the retention period expires. This is
#                     the core immutability guarantee of the backup system.
#                     The dailyBackup Cloud Function writes to this bucket.
log "Step 1: Creating backup bucket gs://$BUCKET ..."

if gsutil ls -b "gs://$BUCKET" &>/dev/null; then
  warn "Bucket gs://$BUCKET already exists. Skipping creation."
else
  gsutil mb -p "$MAIN_PROJECT" -l "$REGION" -b on "gs://$BUCKET"
  log "Bucket created."
fi

log "Setting ${RETENTION_DAYS}-day retention policy ..."
gsutil retention set "${RETENTION_SECONDS}s" "gs://$BUCKET"

log "Locking retention policy (IRREVERSIBLE) ..."
confirm "This will permanently lock the ${RETENTION_DAYS}-day retention. Continue?"
gsutil retention lock "gs://$BUCKET"
log "Retention lock applied."

# ── Step 2: Create recovery project ────────────────────────────
# GUID: PROVISION_RECOVERY-020-v03
# [Intent] Create a separate GCP project (prix6-recovery-test) used exclusively
#          by the Sunday smoke test. The smoke test imports backups into this
#          project's Firestore, verifies critical documents, then deletes everything.
#          Using a separate project prevents any risk to production data.
# [Inbound Trigger] Step 1 completed.
# [Downstream Impact] The project needs billing linked to use Firestore.
#                     The runRecoveryTest Cloud Function targets this project.
log "Step 2: Creating recovery project $RECOVERY_PROJECT ..."

if gcloud projects describe "$RECOVERY_PROJECT" &>/dev/null; then
  warn "Project $RECOVERY_PROJECT already exists. Skipping creation."
else
  gcloud projects create "$RECOVERY_PROJECT" --name="Prix Six Recovery Test"
  log "Project created."
fi

# GUID: PROVISION_RECOVERY-021-v03
# [Intent] Link billing to the recovery project. Firestore requires an active
#          billing account. Uses the first open billing account found.
# [Inbound Trigger] Recovery project created or already exists.
# [Downstream Impact] Without billing, Firestore operations will fail with
#                     PERMISSION_DENIED. The smoke test would report PX-7004.
log "Linking billing account ..."
BILLING_ACCOUNT=$(gcloud billing accounts list --format="value(ACCOUNT_ID)" --filter="open=true" | head -1)
if [[ -z "$BILLING_ACCOUNT" ]]; then
  fail "No open billing account found. Link billing manually: gcloud billing projects link $RECOVERY_PROJECT --billing-account=ACCOUNT_ID"
fi
gcloud billing projects link "$RECOVERY_PROJECT" --billing-account="$BILLING_ACCOUNT"
log "Billing linked: $BILLING_ACCOUNT"

# ── Step 3: Enable APIs ────────────────────────────────────────
# GUID: PROVISION_RECOVERY-030-v03
# [Intent] Enable all GCP APIs required by the backup Cloud Functions.
#          Main project needs: Firestore (export), Cloud Functions, Cloud Run
#          (2nd-gen functions), Cloud Build (deployment), Cloud Scheduler (cron).
#          Recovery project needs: Firestore (import target), Firebase (project setup).
# [Inbound Trigger] Projects exist with billing.
# [Downstream Impact] Without these APIs enabled, `firebase deploy --only functions`
#                     and the Cloud Function invocations will fail.
log "Step 3: Enabling APIs ..."

MAIN_APIS=(
  firestore.googleapis.com
  cloudfunctions.googleapis.com
  run.googleapis.com
  cloudbuild.googleapis.com
  cloudscheduler.googleapis.com
)

RECOVERY_APIS=(
  firestore.googleapis.com
  firebase.googleapis.com
)

log "Enabling APIs on $MAIN_PROJECT ..."
for api in "${MAIN_APIS[@]}"; do
  gcloud services enable "$api" --project="$MAIN_PROJECT" --quiet
done

log "Enabling APIs on $RECOVERY_PROJECT ..."
for api in "${RECOVERY_APIS[@]}"; do
  gcloud services enable "$api" --project="$RECOVERY_PROJECT" --quiet
done
log "APIs enabled."

# ── Step 4: Create Firestore DB in recovery project ────────────
# GUID: PROVISION_RECOVERY-040-v03
# [Intent] Create the Firestore database in the recovery project that will
#          receive imported backups during the Sunday smoke test.
#          Must be in the same region as the main project for cross-project
#          import compatibility.
# [Inbound Trigger] APIs enabled on recovery project.
# [Downstream Impact] The runRecoveryTest Cloud Function imports data into
#                     this database and reads from it for verification.
log "Step 4: Creating Firestore database in $RECOVERY_PROJECT ..."

if gcloud firestore databases describe --project="$RECOVERY_PROJECT" &>/dev/null; then
  warn "Firestore database already exists in $RECOVERY_PROJECT. Skipping."
else
  gcloud firestore databases create \
    --project="$RECOVERY_PROJECT" \
    --location="$REGION" \
    --type=firestore-native
  log "Firestore database created."
fi

# ── Step 5: Enable PITR on main project ────────────────────────
# GUID: PROVISION_RECOVERY-050-v03
# [Intent] Enable Point-in-Time Recovery on the main project's Firestore.
#          PITR allows restoring to any point within the last 7 days (or
#          configured window) without needing to import from a GCS export.
#          This is a complementary safeguard alongside the daily GCS exports.
# [Inbound Trigger] Recovery project Firestore created.
# [Downstream Impact] Firestore retains version history for PITR window.
#                     Slightly increases storage costs.
log "Step 5: Enabling Point-in-Time Recovery on $MAIN_PROJECT ..."
gcloud firestore databases update \
  --project="$MAIN_PROJECT" \
  --enable-pitr \
  --quiet
log "PITR enabled."

# ── Step 6: IAM permissions ────────────────────────────────────
# GUID: PROVISION_RECOVERY-060-v03
# [Intent] Grant the minimum IAM permissions required for the backup system:
#          1. Cloud Functions SA → datastore.importExportAdmin on main project
#             (to trigger Firestore managed exports)
#          2. Cloud Functions SA → storage.admin on backup bucket
#             (to write Auth JSON and manage export output)
#          3. Firestore service agent → storage.objectAdmin on backup bucket
#             (Firestore's internal agent writes the managed export files —
#              this is separate from the Cloud Functions SA)
#          4. Cloud Functions SA → datastore.importExportAdmin on recovery project
#             (to import backups for smoke test)
#          5. Cloud Functions SA → datastore.user on recovery project
#             (to read documents during smoke test verification)
# [Inbound Trigger] PITR enabled.
# [Downstream Impact] Without these permissions, Cloud Functions will fail with
#                     PERMISSION_DENIED errors (PX-7002, PX-7005).
log "Step 6: Configuring IAM permissions ..."

# GUID: PROVISION_RECOVERY-061-v04
# [Intent] Derive service account emails from the project number.
#          FIRESTORE_SA is the internal agent Firestore uses to write managed
#          export files to GCS (NOT the firebase-adminsdk SA).
#          FUNCTIONS_SA is the Compute Engine default SA used by 2nd-gen Cloud
#          Functions (Cloud Run-based), NOT the legacy App Engine appspot SA.
# [Inbound Trigger] IAM step started.
# [Downstream Impact] Used in the gsutil/gcloud iam commands below. If either SA
#                     doesn't have bucket access, Firestore exports fail with
#                     PERMISSION_DENIED in the LRO result.
PROJECT_NUMBER=$(gcloud projects describe "$MAIN_PROJECT" --format="value(projectNumber)")
FIRESTORE_SA="service-${PROJECT_NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com"
FUNCTIONS_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# GUID: PROVISION_RECOVERY-062-v03
# [Intent] Grant export admin to the Cloud Functions SA so it can call
#          exportDocuments() on the main project's Firestore.
# [Inbound Trigger] SA emails derived.
# [Downstream Impact] Required by BACKUP_FUNCTIONS-011 (Firestore managed export).
log "Granting datastore.importExportAdmin to $FUNCTIONS_SA ..."
gcloud projects add-iam-policy-binding "$MAIN_PROJECT" \
  --member="serviceAccount:$FUNCTIONS_SA" \
  --role="roles/datastore.importExportAdmin" \
  --condition=None \
  --quiet

# GUID: PROVISION_RECOVERY-063-v03
# [Intent] Grant storage admin on the backup bucket so the Cloud Functions SA
#          can write the Auth JSON export and manage objects.
# [Inbound Trigger] Export admin granted.
# [Downstream Impact] Required by BACKUP_FUNCTIONS-012 (Auth JSON write).
log "Granting storage.admin on gs://$BUCKET to $FUNCTIONS_SA ..."
gsutil iam ch "serviceAccount:${FUNCTIONS_SA}:roles/storage.admin" "gs://$BUCKET"

# GUID: PROVISION_RECOVERY-064-v03
# [Intent] Grant the Firestore service agent objectAdmin on the backup bucket.
#          This is the agent that actually writes the managed export files — it's
#          separate from the Cloud Functions SA and easy to forget.
# [Inbound Trigger] Cloud Functions SA permissions granted.
# [Downstream Impact] Without this, Firestore exportDocuments() returns success
#                     on the API call but the LRO fails with permission denied.
log "Granting storage.objectAdmin on gs://$BUCKET to Firestore service agent ..."
gsutil iam ch "serviceAccount:${FIRESTORE_SA}:roles/storage.objectAdmin" "gs://$BUCKET"

# GUID: PROVISION_RECOVERY-064b-v03
# [Intent] Grant the recovery project's Firestore service agent objectAdmin on the
#          backup bucket. When importDocuments() runs against the recovery project,
#          it is the RECOVERY project's Firestore agent (not the main project's)
#          that reads the export files from GCS. objectViewer is NOT sufficient —
#          the import operation requires objectAdmin.
# [Inbound Trigger] Main project Firestore agent permissions granted.
# [Downstream Impact] Without this, runRecoveryTest smoke test fails with
#                     PX-7004 PERMISSION_DENIED on the import step.
RECOVERY_PROJECT_NUMBER=$(gcloud projects describe "$RECOVERY_PROJECT" --format="value(projectNumber)")
RECOVERY_FIRESTORE_SA="service-${RECOVERY_PROJECT_NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com"
log "Granting storage.objectAdmin on gs://$BUCKET to recovery Firestore service agent ..."
gsutil iam ch "serviceAccount:${RECOVERY_FIRESTORE_SA}:roles/storage.objectAdmin" "gs://$BUCKET"

# GUID: PROVISION_RECOVERY-065-v03
# [Intent] Grant import/export admin on the recovery project so the smoke test
#          can import backups into the recovery Firestore.
# [Inbound Trigger] Bucket permissions granted.
# [Downstream Impact] Required by BACKUP_FUNCTIONS-022 (recovery import).
log "Granting datastore.importExportAdmin on $RECOVERY_PROJECT ..."
gcloud projects add-iam-policy-binding "$RECOVERY_PROJECT" \
  --member="serviceAccount:$FUNCTIONS_SA" \
  --role="roles/datastore.importExportAdmin" \
  --condition=None \
  --quiet

# GUID: PROVISION_RECOVERY-066-v03
# [Intent] Grant datastore.user on the recovery project so the smoke test can
#          read documents (system_status/heartbeat, users) for verification.
# [Inbound Trigger] Import admin granted on recovery project.
# [Downstream Impact] Required by BACKUP_FUNCTIONS-023 (smoke test reads).
log "Granting datastore.user on $RECOVERY_PROJECT (for smoke test reads) ..."
gcloud projects add-iam-policy-binding "$RECOVERY_PROJECT" \
  --member="serviceAccount:$FUNCTIONS_SA" \
  --role="roles/datastore.user" \
  --condition=None \
  --quiet

# ── Done ────────────────────────────────────────────────────────
# GUID: PROVISION_RECOVERY-070-v03
# [Intent] Print a summary of everything that was provisioned and next steps.
# [Inbound Trigger] All steps completed successfully.
# [Downstream Impact] Human guidance — operator should deploy Cloud Functions next.
echo ""
log "=========================================="
log "  Provisioning complete!"
log "=========================================="
log ""
log "Bucket:           gs://$BUCKET (${RETENTION_DAYS}-day retention lock)"
log "Recovery project: $RECOVERY_PROJECT"
log "PITR:             Enabled on $MAIN_PROJECT"
log ""
log "Next steps:"
log "  1. cd functions && npm install"
log "  2. firebase deploy --only functions"
log "  3. Verify with: gcloud functions call dailyBackup --project=$MAIN_PROJECT"
