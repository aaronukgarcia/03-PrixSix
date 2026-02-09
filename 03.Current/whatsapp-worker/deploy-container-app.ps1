# ============================================================
# Prix Six WhatsApp Worker - Azure Container Apps Deployment
# ============================================================
# This script deploys to Container Apps with scale-to-zero
# Cost: $0 when idle, ~$1/day when active

param(
    [switch]$SkipBuild,
    [switch]$CreateEnvironment
)

# Variables
$RESOURCE_GROUP = "garcia"
$LOCATION = "uksouth"
$STORAGE_ACCOUNT = "garcialtdstorage"
$BLOB_CONTAINER = "whatsapp-session"
$ACR_NAME = "prixsixacr"
$CONTAINER_APP_NAME = "prixsix-whatsapp"
$CONTAINER_APP_ENV = "prixsix-env"
$IMAGE_NAME = "prixsix-whatsapp-worker"

Write-Host "=== Azure Container Apps Deployment ===" -ForegroundColor Cyan
Write-Host "Cost-optimized with scale-to-zero" -ForegroundColor Green

Write-Host "`n=== Phase 1: Verify Storage & Registry ===" -ForegroundColor Cyan

# 1. Ensure blob container exists
Write-Host "Checking blob container for session persistence..." -ForegroundColor Yellow
$containerExists = az storage container exists `
    --name $BLOB_CONTAINER `
    --account-name $STORAGE_ACCOUNT `
    --auth-mode login `
    --query exists -o tsv

if ($containerExists -eq "false") {
    Write-Host "Creating blob container..." -ForegroundColor Yellow
    az storage container create `
        --name $BLOB_CONTAINER `
        --account-name $STORAGE_ACCOUNT `
        --auth-mode login
}

# 2. Get storage connection string
Write-Host "Getting storage connection string..." -ForegroundColor Yellow
$STORAGE_CONNECTION = az storage account show-connection-string `
    --name $STORAGE_ACCOUNT `
    --resource-group $RESOURCE_GROUP `
    --query connectionString -o tsv

# 3. Get ACR credentials
Write-Host "Getting ACR credentials..." -ForegroundColor Yellow
$ACR_SERVER = az acr show --name $ACR_NAME --query loginServer -o tsv
$ACR_USERNAME = az acr credential show --name $ACR_NAME --query username -o tsv
$ACR_PASSWORD = az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv

Write-Host "ACR Server: $ACR_SERVER" -ForegroundColor Green

if (-not $SkipBuild) {
    Write-Host "`n=== Phase 2: Build & Push Docker Image ===" -ForegroundColor Cyan

    # 4. Login to ACR
    Write-Host "Logging into Container Registry..." -ForegroundColor Yellow
    az acr login --name $ACR_NAME

    # 5. Build and push (run from whatsapp-worker directory)
    Write-Host "Building Docker image..." -ForegroundColor Yellow
    docker build -t ${IMAGE_NAME}:latest .

    Write-Host "Tagging image for ACR..." -ForegroundColor Yellow
    docker tag ${IMAGE_NAME}:latest ${ACR_SERVER}/${IMAGE_NAME}:latest

    Write-Host "Pushing image to ACR..." -ForegroundColor Yellow
    docker push ${ACR_SERVER}/${IMAGE_NAME}:latest
} else {
    Write-Host "`n=== Phase 2: Skipping Build (using existing image) ===" -ForegroundColor Cyan
}

Write-Host "`n=== Phase 3: Container Apps Environment ===" -ForegroundColor Cyan

# 6. Check if Container Apps environment exists
$envExists = az containerapp env show `
    --name $CONTAINER_APP_ENV `
    --resource-group $RESOURCE_GROUP `
    --query name -o tsv 2>$null

if (-not $envExists -or $CreateEnvironment) {
    Write-Host "Creating Container Apps environment..." -ForegroundColor Yellow
    az containerapp env create `
        --name $CONTAINER_APP_ENV `
        --resource-group $RESOURCE_GROUP `
        --location $LOCATION
    Write-Host "Environment created" -ForegroundColor Green
} else {
    Write-Host "Using existing environment: $CONTAINER_APP_ENV" -ForegroundColor Green
}

Write-Host "`n=== Phase 4: Deploy Container App ===" -ForegroundColor Cyan

# 7. Generate or reuse API key
$API_KEY_FILE = ".api-key.txt"
if (Test-Path $API_KEY_FILE) {
    $API_KEY = Get-Content $API_KEY_FILE
    Write-Host "Using existing API Key from $API_KEY_FILE" -ForegroundColor Green
} else {
    $API_KEY = [System.Guid]::NewGuid().ToString()
    $API_KEY | Out-File -FilePath $API_KEY_FILE -NoNewline
    Write-Host "Generated new API Key: $API_KEY" -ForegroundColor Magenta
    Write-Host "Saved to $API_KEY_FILE" -ForegroundColor Magenta
}

# 8. Check if container app exists
$appExists = az containerapp show `
    --name $CONTAINER_APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --query name -o tsv 2>$null

if ($appExists) {
    Write-Host "Updating existing container app..." -ForegroundColor Yellow
    az containerapp update `
        --name $CONTAINER_APP_NAME `
        --resource-group $RESOURCE_GROUP `
        --image ${ACR_SERVER}/${IMAGE_NAME}:latest `
        --set-env-vars `
            PORT=3000 `
            WHATSAPP_GROUP_NAME="Prix Six" `
            AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION" `
            AZURE_STORAGE_CONTAINER="$BLOB_CONTAINER" `
            WORKER_API_KEY="$API_KEY"
} else {
    Write-Host "Creating new container app..." -ForegroundColor Yellow
    az containerapp create `
        --name $CONTAINER_APP_NAME `
        --resource-group $RESOURCE_GROUP `
        --environment $CONTAINER_APP_ENV `
        --image ${ACR_SERVER}/${IMAGE_NAME}:latest `
        --registry-server $ACR_SERVER `
        --registry-username $ACR_USERNAME `
        --registry-password $ACR_PASSWORD `
        --target-port 3000 `
        --ingress external `
        --min-replicas 0 `
        --max-replicas 1 `
        --cpu 1.0 `
        --memory 2.0Gi `
        --env-vars `
            PORT=3000 `
            WHATSAPP_GROUP_NAME="Prix Six" `
            AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION" `
            AZURE_STORAGE_CONTAINER="$BLOB_CONTAINER" `
            WORKER_API_KEY="$API_KEY" `
        --scale-rule-name http-rule `
        --scale-rule-type http `
        --scale-rule-http-concurrency 10
}

# 9. Get the FQDN
Write-Host "`n=== Deployment Complete ===" -ForegroundColor Cyan
$FQDN = az containerapp show `
    --name $CONTAINER_APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --query properties.configuration.ingress.fqdn -o tsv

Write-Host "`nWhatsApp Worker deployed with scale-to-zero!" -ForegroundColor Green
Write-Host "FQDN: https://$FQDN" -ForegroundColor Green
Write-Host "Health check: https://$FQDN/health" -ForegroundColor Green
Write-Host "Status: https://$FQDN/status" -ForegroundColor Green
Write-Host "Process queue: https://$FQDN/process-queue" -ForegroundColor Green
Write-Host "`nAPI Key: $API_KEY" -ForegroundColor Magenta
Write-Host "(Saved in $API_KEY_FILE)" -ForegroundColor Magenta

Write-Host "`n=== Cost Optimization ===" -ForegroundColor Cyan
Write-Host "- Scales to ZERO when idle (no cost)" -ForegroundColor Green
Write-Host "- Auto-starts on HTTP requests" -ForegroundColor Green
Write-Host "- ~`$1/day when active" -ForegroundColor Green
Write-Host "- Estimated monthly: `$4-10 (vs `$32 with always-on ACI)" -ForegroundColor Green

Write-Host "`n=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Update Next.js .env.local with:" -ForegroundColor Yellow
Write-Host "   WHATSAPP_WORKER_URL=https://$FQDN" -ForegroundColor White
Write-Host "   WHATSAPP_APP_SECRET=$API_KEY" -ForegroundColor White
Write-Host "`n2. Test by calling: curl -X POST https://$FQDN/process-queue -H 'X-API-Key: $API_KEY'" -ForegroundColor Yellow
Write-Host "`n3. First run: Check logs for QR code if needed" -ForegroundColor Yellow
Write-Host "   az containerapp logs show --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --follow" -ForegroundColor White
