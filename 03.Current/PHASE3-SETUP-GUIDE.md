# Phase 3: Infrastructure Hardening - Setup Guide

**Status:** Code implementation complete ✅ | Manual Azure setup required ⚠️

This document outlines the manual steps required to complete Phase 3 infrastructure hardening.

---

## 📋 Overview

**What's Already Done (Code):**
- ✅ Health check endpoint (`/api/health`)
- ✅ CI/CD workflow (`.github/workflows/deploy-production.yml`)
- ✅ Secrets manager abstraction (`app/src/lib/secrets-manager.ts`)

**What You Need to Do (Manual):**
1. Create Azure Key Vault
2. Upload secrets to Key Vault
3. Configure Managed Identity on Container Apps
4. Set up GitHub Secrets for CI/CD
5. Create Application Insights (optional - monitoring)

---

## 🔐 Phase 3.A: Azure Key Vault Setup

### Step 1: Create Key Vault Resource

```bash
# Using Azure CLI (recommended)
az login
az account set --subscription <your-subscription-id>

# Create Key Vault in UK South region
az keyvault create \
  --name prixsix-secrets-vault \
  --resource-group <your-resource-group> \
  --location uksouth \
  --enable-rbac-authorization true
```

**Or via Azure Portal:**
1. Navigate to: https://portal.azure.com/#create/Microsoft.KeyVault
2. Resource Group: Select your existing resource group
3. Key Vault Name: `prixsix-secrets-vault`
4. Region: UK South
5. Pricing Tier: Standard
6. **Important:** Enable "Azure role-based access control (RBAC)" under Access Policy

### Step 2: Upload Secrets to Key Vault

**⚠️ CRITICAL:** Before uploading, rotate all secrets!

#### 2a. Rotate Microsoft Graph API Secret

1. Go to: https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps
2. Find your app registration for Prix Six email
3. Navigate to: Certificates & Secrets → Client secrets
4. Delete old secret (after uploading new one to Key Vault)
5. Create new secret, copy value
6. Upload to Key Vault:

```bash
az keyvault secret set \
  --vault-name prixsix-secrets-vault \
  --name graph-client-secret \
  --value "<new-secret-value>"
```

#### 2b. Rotate WhatsApp App Secret

Generate a new cryptographically secure secret:

```bash
# Generate new UUID for WhatsApp secret
node -e "console.log(require('crypto').randomUUID())"

# Upload to Key Vault
az keyvault secret set \
  --vault-name prixsix-secrets-vault \
  --name whatsapp-app-secret \
  --value "<generated-uuid>"
```

**Then update:** WhatsApp worker's environment variable with new secret.

#### 2c. Upload Firebase Admin Service Account

**SECURITY:** This is the critical step that allows removing service-account.json from filesystem!

```bash
# Upload the entire service account JSON as a single secret
az keyvault secret set \
  --vault-name prixsix-secrets-vault \
  --name firebase-admin-key \
  --file "E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json"
```

**Verify upload:**

```bash
az keyvault secret show \
  --vault-name prixsix-secrets-vault \
  --name firebase-admin-key \
  --query "value" -o tsv | jq . # Should display valid JSON
```

### Step 3: Configure Managed Identity

**For Azure Container Apps:**

```bash
# Enable system-assigned managed identity
az containerapp identity assign \
  --name <your-container-app-name> \
  --resource-group <your-resource-group> \
  --system-assigned

# Get the principal ID (copy this for next step)
PRINCIPAL_ID=$(az containerapp identity show \
  --name <your-container-app-name> \
  --resource-group <your-resource-group> \
  --query principalId -o tsv)

echo "Managed Identity Principal ID: $PRINCIPAL_ID"
```

### Step 4: Grant Key Vault Access

```bash
# Grant "Key Vault Secrets User" role to Container App's managed identity
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee $PRINCIPAL_ID \
  --scope "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.KeyVault/vaults/prixsix-secrets-vault"
```

**Verify access:**

```bash
az role assignment list \
  --assignee $PRINCIPAL_ID \
  --scope "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.KeyVault/vaults/prixsix-secrets-vault"
```

### Step 5: Update Container App Environment Variables

```bash
# Set environment variables to enable Key Vault
az containerapp update \
  --name <your-container-app-name> \
  --resource-group <your-resource-group> \
  --set-env-vars \
    USE_KEY_VAULT=true \
    KEY_VAULT_URL=https://prixsix-secrets-vault.vault.azure.net/
```

### Step 6: Remove Secrets from Source Code

**⚠️ ONLY after Step 5 is complete and tested!**

```bash
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current

# Backup service account files (keep offline)
mkdir -p ~/prix-six-backups
cp service-account.json ~/prix-six-backups/
cp whatsapp-worker/service-account.json ~/prix-six-backups/

# Remove from filesystem
rm service-account.json
rm whatsapp-worker/service-account.json

# Remove from .env.local (or rotate and move to Key Vault)
# Remove lines:
# GRAPH_CLIENT_SECRET=...
# WHATSAPP_APP_SECRET=...

# Verify .gitignore covers these files
git status # Should NOT show service-account.json files
```

### Step 7: Purge from Git History (CRITICAL!)

```bash
# Install BFG Repo-Cleaner
# Download from: https://rtyley.github.io/bfg-repo-cleaner/

# Run BFG to remove service-account.json from ALL commits
java -jar bfg.jar --delete-files service-account.json

# Clean up repository
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push (requires coordination if working with others!)
git push origin --force --all
```

**⚠️ WARNING:** Force push rewrites history. Coordinate with team first!

---

## 🔄 Phase 3.B: CI/CD Pipeline Setup

### Step 1: Set up GitHub Secrets

Navigate to: https://github.com/<your-username>/prix-six/settings/secrets/actions

**Add these secrets:**

1. **FIREBASE_SERVICE_ACCOUNT**
   - Value: Contents of your Firebase service account JSON
   - Used by GitHub Actions to deploy to Firebase

```bash
# Get service account from Key Vault (after uploading in 3.A)
az keyvault secret show \
  --vault-name prixsix-secrets-vault \
  --name firebase-admin-key \
  --query "value" -o tsv
```

Copy the output and paste as the secret value in GitHub.

### Step 2: Enable GitHub Actions

1. Go to: https://github.com/<your-username>/prix-six/actions
2. Enable workflows if disabled
3. The workflow will run automatically on next push to `main` branch

### Step 3: Configure Production Environment

1. Go to: https://github.com/<your-username>/prix-six/settings/environments
2. Click "New environment"
3. Name: `production`
4. Enable "Required reviewers"
5. Add yourself as required reviewer
6. Save

**Now:** Manual approval required before production deployments!

### Step 4: Test the Workflow

```bash
# Make a trivial change to trigger workflow
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current
git commit --allow-empty -m "test: Trigger CI/CD workflow"
git push origin main
```

**Watch the workflow:** https://github.com/<your-username>/prix-six/actions

**Expected:**
- ✅ Version validation passes
- ✅ Tests run (or pass with --passWithNoTests)
- ✅ Security scan completes
- ✅ Build succeeds
- ⏸️ Deploy waits for your approval
- ✅ After approval: Deploys to Firebase
- ✅ Smoke tests verify deployment

---

## 📊 Phase 3.C: Monitoring & Alerting (Optional)

### Step 1: Create Application Insights

```bash
# Create Application Insights resource
az monitor app-insights component create \
  --app prix-six-insights \
  --location uksouth \
  --resource-group <your-resource-group> \
  --application-type web

# Get instrumentation key
INSTRUMENTATION_KEY=$(az monitor app-insights component show \
  --app prix-six-insights \
  --resource-group <your-resource-group> \
  --query instrumentationKey -o tsv)

echo "Instrumentation Key: $INSTRUMENTATION_KEY"
```

### Step 2: Install OpenTelemetry (TODO - Future Enhancement)

**Note:** This requires code changes to integrate OpenTelemetry SDK. Deferred to Phase 4.

For now, use the health endpoint for basic monitoring:

```bash
# Set up uptime monitoring in Azure Monitor or external service
# Endpoint: https://prix6.win/api/health
# Expected: HTTP 200 with JSON response
# Alert: If status !== 200 for 2+ consecutive checks
```

### Step 3: Configure Alerts (Azure Portal)

1. Go to Application Insights → Alerts
2. Create new alert rules:

**Alert 1: Health Check Failures**
- Metric: Availability
- Condition: < 95% over 5 minutes
- Action: Email admin

**Alert 2: High Error Rate**
- Metric: Failed requests
- Condition: > 10 failures in 5 minutes
- Action: Email admin

**Alert 3: Slow Response Time**
- Metric: Server response time
- Condition: > 2 seconds average over 5 minutes
- Action: Email admin

---

## ✅ Verification Checklist

**Phase 3.A: Azure Key Vault**
- [ ] Key Vault created with RBAC enabled
- [ ] All 3 secrets uploaded (firebase-admin-key, graph-client-secret, whatsapp-app-secret)
- [ ] Managed Identity assigned to Container App
- [ ] "Key Vault Secrets User" role granted
- [ ] Environment variables set (USE_KEY_VAULT=true, KEY_VAULT_URL=...)
- [ ] Service account files removed from filesystem
- [ ] Service account files purged from git history
- [ ] Old secrets rotated (Graph API, WhatsApp)

**Phase 3.B: CI/CD**
- [ ] GitHub secret FIREBASE_SERVICE_ACCOUNT added
- [ ] Production environment configured with required reviewers
- [ ] Workflow runs successfully on push to main
- [ ] Manual approval gate works
- [ ] Deployment completes successfully
- [ ] Smoke tests pass post-deployment

**Phase 3.C: Monitoring**
- [ ] Health endpoint accessible at https://prix6.win/api/health
- [ ] Health endpoint returns 200 with service status
- [ ] (Optional) Application Insights created
- [ ] (Optional) Alert rules configured

---

## 🔄 Local Development Setup

**After Key Vault is set up, local development requires Azure CLI:**

```bash
# Install Azure CLI: https://aka.ms/installazurecli

# Login with your Azure account
az login

# Verify access to Key Vault
az keyvault secret show \
  --vault-name prixsix-secrets-vault \
  --name firebase-admin-key

# Now run the app locally (secrets fetched from Key Vault automatically)
cd app
npm run dev
```

**Or use environment variables for local dev:**

Leave `USE_KEY_VAULT` unset (defaults to `false`), and secrets-manager will use `.env.local`.

---

## 🚨 Rollback Plan

**If Key Vault integration breaks production:**

1. **Immediate:** Set environment variables directly on Container App:

```bash
az containerapp update \
  --name <app-name> \
  --resource-group <rg> \
  --set-env-vars \
    USE_KEY_VAULT=false \
    GRAPH_CLIENT_SECRET="<backup-value>" \
    WHATSAPP_APP_SECRET="<backup-value>"
```

2. **Restore service account:** Upload backup from `~/prix-six-backups/` to server

3. **Deploy previous version:** Use Firebase Hosting version history to rollback

---

## 📝 Next Steps

**After completing all Phase 3 steps:**

1. Update `book-of-work.json` to mark Phase 3 issues as remediated
2. Bump version to `1.57.0` (Phase 3 complete)
3. Proceed to Phase 4: Cleanup & final audit

**Estimated Time:**
- Azure Key Vault setup: 30-45 minutes
- CI/CD configuration: 15-30 minutes
- Monitoring setup (optional): 30 minutes
- **Total: 1.5-2 hours** (manual work)

---

## 🆘 Troubleshooting

**"Failed to fetch secret from Key Vault (403)"**
- Check Managed Identity has "Key Vault Secrets User" role
- Verify PRINCIPAL_ID is correct
- Wait 5 minutes for Azure RBAC propagation

**"Secret 'X' not found"**
- Check secret name matches exactly (case-sensitive)
- Verify secret was uploaded: `az keyvault secret list --vault-name prixsix-secrets-vault`

**"DefaultAzureCredential failed"**
- In production: Ensure Managed Identity is assigned
- Locally: Run `az login` first
- Check `USE_KEY_VAULT` and `KEY_VAULT_URL` environment variables

**"GitHub Actions deployment fails"**
- Verify FIREBASE_SERVICE_ACCOUNT secret is valid JSON
- Check Firebase project ID matches (`prix-six`)
- Ensure GitHub Actions enabled for the repository

---

**End of Phase 3 Setup Guide**
