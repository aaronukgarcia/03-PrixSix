# ============================================================
# Upload local WhatsApp session to Azure Blob Storage
# ============================================================
# This allows you to authenticate locally (scan QR once) and
# then use that session in Azure Container Instances.
# ============================================================

$STORAGE_ACCOUNT = "garcialtdstorage"
$CONTAINER_NAME = "whatsapp-session"
$SESSION_NAME = "prixsix-whatsapp"
$LOCAL_AUTH_PATH = ".wwebjs_auth"
$SESSION_FOLDER = "session-$SESSION_NAME"

Write-Host "=== WhatsApp Session Upload ===" -ForegroundColor Cyan

# Check if session folder exists
$sessionPath = Join-Path $LOCAL_AUTH_PATH $SESSION_FOLDER
if (-not (Test-Path $sessionPath)) {
    Write-Host "ERROR: Session folder not found at: $sessionPath" -ForegroundColor Red
    Write-Host "Make sure you've run the worker locally and authenticated first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Found session at: $sessionPath" -ForegroundColor Green

# Create temp zip file
$tempZip = "session-upload-temp.zip"
Write-Host "Zipping session folder..." -ForegroundColor Yellow

# Remove old zip if exists
if (Test-Path $tempZip) {
    Remove-Item $tempZip -Force
}

# Compress the session folder
Compress-Archive -Path $sessionPath -DestinationPath $tempZip -Force

$zipSize = (Get-Item $tempZip).Length / 1MB
Write-Host "Created zip: $tempZip ($([math]::Round($zipSize, 2)) MB)" -ForegroundColor Green

# Upload to Azure
Write-Host "Uploading to Azure Blob Storage..." -ForegroundColor Yellow
Write-Host "  Account: $STORAGE_ACCOUNT" -ForegroundColor Gray
Write-Host "  Container: $CONTAINER_NAME" -ForegroundColor Gray
Write-Host "  Blob: $SESSION_NAME/session.zip" -ForegroundColor Gray

az storage blob upload `
    --account-name $STORAGE_ACCOUNT `
    --container-name $CONTAINER_NAME `
    --name "$SESSION_NAME/session.zip" `
    --file $tempZip `
    --overwrite `
    --auth-mode login

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=== Upload Complete ===" -ForegroundColor Green
    Write-Host "Your WhatsApp session is now in Azure Blob Storage." -ForegroundColor Green
    Write-Host "The Azure container will use this session on next startup." -ForegroundColor Green
} else {
    Write-Host "`nERROR: Upload failed. Check your Azure CLI login." -ForegroundColor Red
    Write-Host "Try: az login" -ForegroundColor Yellow
}

# Cleanup temp zip
Write-Host "`nCleaning up temp file..." -ForegroundColor Gray
Remove-Item $tempZip -Force

Write-Host "Done!" -ForegroundColor Cyan
