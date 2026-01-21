# ============================================================
# Prix Six WhatsApp Worker - Azure Deployment Script
# ============================================================

# Variables - using your existing resources
$RESOURCE_GROUP = "garcia"
$LOCATION = "uksouth"
$STORAGE_ACCOUNT = "garcialtdstorage"
$BLOB_CONTAINER = "whatsapp-session"
$ACR_NAME = "prixsixacr"
$CONTAINER_NAME = "prixsix-whatsapp"
$IMAGE_NAME = "prixsix-whatsapp-worker"

Write-Host "=== Phase 1: Setup Storage & Registry ===" -ForegroundColor Cyan

# 1. Create blob container for session persistence
Write-Host "Creating blob container for WhatsApp session..." -ForegroundColor Yellow
az storage container create `
    --name $BLOB_CONTAINER `
    --account-name $STORAGE_ACCOUNT `
    --auth-mode login

# 2. Get storage connection string
Write-Host "Getting storage connection string..." -ForegroundColor Yellow
$STORAGE_CONNECTION = az storage account show-connection-string `
    --name $STORAGE_ACCOUNT `
    --resource-group $RESOURCE_GROUP `
    --query connectionString -o tsv

Write-Host "Storage connection string retrieved" -ForegroundColor Green

# 3. Create Container Registry
Write-Host "Creating Container Registry..." -ForegroundColor Yellow
az acr create `
    --resource-group $RESOURCE_GROUP `
    --name $ACR_NAME `
    --sku Basic `
    --admin-enabled true

# 4. Get ACR credentials
Write-Host "Getting ACR credentials..." -ForegroundColor Yellow
$ACR_SERVER = az acr show --name $ACR_NAME --query loginServer -o tsv
$ACR_USERNAME = az acr credential show --name $ACR_NAME --query username -o tsv
$ACR_PASSWORD = az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv

Write-Host "ACR Server: $ACR_SERVER" -ForegroundColor Green

Write-Host "`n=== Phase 2: Build & Push Docker Image ===" -ForegroundColor Cyan

# 5. Login to ACR
Write-Host "Logging into Container Registry..." -ForegroundColor Yellow
az acr login --name $ACR_NAME

# 6. Build and push (run from whatsapp-worker directory)
Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -t ${IMAGE_NAME}:latest .

Write-Host "Tagging image for ACR..." -ForegroundColor Yellow
docker tag ${IMAGE_NAME}:latest ${ACR_SERVER}/${IMAGE_NAME}:latest

Write-Host "Pushing image to ACR..." -ForegroundColor Yellow
docker push ${ACR_SERVER}/${IMAGE_NAME}:latest

Write-Host "`n=== Phase 3: Deploy Container Instance ===" -ForegroundColor Cyan

# 7. Generate a random API key for securing endpoints
$API_KEY = [System.Guid]::NewGuid().ToString()
Write-Host "Generated API Key: $API_KEY" -ForegroundColor Magenta
Write-Host "SAVE THIS - you'll need it for Firebase to call the worker" -ForegroundColor Magenta

# 8. Create Container Instance
Write-Host "Deploying container instance..." -ForegroundColor Yellow
az container create `
    --resource-group $RESOURCE_GROUP `
    --name $CONTAINER_NAME `
    --image ${ACR_SERVER}/${IMAGE_NAME}:latest `
    --registry-login-server $ACR_SERVER `
    --registry-username $ACR_USERNAME `
    --registry-password $ACR_PASSWORD `
    --cpu 1 `
    --memory 1.5 `
    --ports 3000 `
    --ip-address Public `
    --os-type Linux `
    --environment-variables `
        PORT=3000 `
        WHATSAPP_GROUP_NAME="Prix Six" `
        AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION" `
        AZURE_STORAGE_CONTAINER="$BLOB_CONTAINER" `
        WORKER_API_KEY="$API_KEY" `
    --restart-policy Always

# 9. Get the public IP
Write-Host "`n=== Deployment Complete ===" -ForegroundColor Cyan
$CONTAINER_IP = az container show `
    --resource-group $RESOURCE_GROUP `
    --name $CONTAINER_NAME `
    --query ipAddress.ip -o tsv

Write-Host "`nWhatsApp Worker deployed!" -ForegroundColor Green
Write-Host "Health check: http://${CONTAINER_IP}:3000/health" -ForegroundColor Green
Write-Host "Status: http://${CONTAINER_IP}:3000/status" -ForegroundColor Green
Write-Host "`nAPI Key (save this): $API_KEY" -ForegroundColor Magenta

Write-Host "`n=== Next Step: Scan QR Code ===" -ForegroundColor Cyan
Write-Host "Run this to view logs and scan the QR code:" -ForegroundColor Yellow
Write-Host "az container logs --resource-group $RESOURCE_GROUP --name $CONTAINER_NAME --follow" -ForegroundColor White