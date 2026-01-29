#!/usr/bin/env bash
#
# provision_recovery_env.sh
# One-time setup for Prix Six backup infrastructure.
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
MAIN_PROJECT="prix6-prod"
RECOVERY_PROJECT="prix6-recovery-test"
BUCKET="prix6-backups"
REGION="europe-west2"
RETENTION_DAYS=7
RETENTION_SECONDS=$((RETENTION_DAYS * 86400))

# ── Helpers ─────────────────────────────────────────────────────
log()   { echo "[INFO]  $*"; }
warn()  { echo "[WARN]  $*" >&2; }
fail()  { echo "[ERROR] $*" >&2; exit 1; }

confirm() {
  read -rp "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || fail "Aborted by user."
}

# ── Pre-flight checks ──────────────────────────────────────────
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
log "Step 2: Creating recovery project $RECOVERY_PROJECT ..."

if gcloud projects describe "$RECOVERY_PROJECT" &>/dev/null; then
  warn "Project $RECOVERY_PROJECT already exists. Skipping creation."
else
  gcloud projects create "$RECOVERY_PROJECT" --name="Prix Six Recovery Test"
  log "Project created."
fi

# Link billing
log "Linking billing account ..."
BILLING_ACCOUNT=$(gcloud billing accounts list --format="value(ACCOUNT_ID)" --filter="open=true" | head -1)
if [[ -z "$BILLING_ACCOUNT" ]]; then
  fail "No open billing account found. Link billing manually: gcloud billing projects link $RECOVERY_PROJECT --billing-account=ACCOUNT_ID"
fi
gcloud billing projects link "$RECOVERY_PROJECT" --billing-account="$BILLING_ACCOUNT"
log "Billing linked: $BILLING_ACCOUNT"

# ── Step 3: Enable APIs ────────────────────────────────────────
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
log "Step 5: Enabling Point-in-Time Recovery on $MAIN_PROJECT ..."
gcloud firestore databases update \
  --project="$MAIN_PROJECT" \
  --enable-pitr \
  --quiet
log "PITR enabled."

# ── Step 6: IAM permissions ────────────────────────────────────
log "Step 6: Configuring IAM permissions ..."

# Get the project number for the Firestore service agent
PROJECT_NUMBER=$(gcloud projects describe "$MAIN_PROJECT" --format="value(projectNumber)")
FIRESTORE_SA="service-${PROJECT_NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com"
FUNCTIONS_SA="${MAIN_PROJECT}@appspot.gserviceaccount.com"

# Cloud Functions SA needs Firestore export admin
log "Granting datastore.importExportAdmin to $FUNCTIONS_SA ..."
gcloud projects add-iam-policy-binding "$MAIN_PROJECT" \
  --member="serviceAccount:$FUNCTIONS_SA" \
  --role="roles/datastore.importExportAdmin" \
  --condition=None \
  --quiet

# Cloud Functions SA needs Storage Admin on the backup bucket
log "Granting storage.admin on gs://$BUCKET to $FUNCTIONS_SA ..."
gsutil iam ch "serviceAccount:${FUNCTIONS_SA}:roles/storage.admin" "gs://$BUCKET"

# Firestore service agent needs bucket access for managed exports
log "Granting storage.objectAdmin on gs://$BUCKET to Firestore service agent ..."
gsutil iam ch "serviceAccount:${FIRESTORE_SA}:roles/storage.objectAdmin" "gs://$BUCKET"

# Cloud Functions SA needs Firestore admin on recovery project (for import/delete)
log "Granting datastore.importExportAdmin on $RECOVERY_PROJECT ..."
gcloud projects add-iam-policy-binding "$RECOVERY_PROJECT" \
  --member="serviceAccount:$FUNCTIONS_SA" \
  --role="roles/datastore.importExportAdmin" \
  --condition=None \
  --quiet

log "Granting datastore.user on $RECOVERY_PROJECT (for smoke test reads) ..."
gcloud projects add-iam-policy-binding "$RECOVERY_PROJECT" \
  --member="serviceAccount:$FUNCTIONS_SA" \
  --role="roles/datastore.user" \
  --condition=None \
  --quiet

# ── Done ────────────────────────────────────────────────────────
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
