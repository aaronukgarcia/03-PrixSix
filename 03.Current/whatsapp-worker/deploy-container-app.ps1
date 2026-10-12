# ============================================================
# Prix Six WhatsApp Worker - Azure Container Apps Deployment
# ============================================================
# GUID: WORKER_DEPLOY_SCRIPT-000-v03
# v03 (2026-10-12, COST-CONTAINER-001 + the undeployed-2.2.5 lesson):
#   * Builds in the cloud with `az acr build` (no local Docker needed) and tags the image with the
#     version from package.json AND :latest, so /health can prove what is running.
#   * Updates the image WITHOUT touching the existing environment variables. v02 regenerated
#     WHATSAPP_APP_SECRET from a local file that only one machine had — running it anywhere else
#     would have rotated the HMAC secret and broken every caller. Env changes are now explicit
#     (scripts/ops-*.ps1 or `az containerapp update --set-env-vars`), never a side effect of a deploy.
#   * Applies the RACE-WINDOW schedule (scale-schedule.js): minReplicas 0, maxReplicas 1, one KEDA
#     cron rule per remaining race (3 days before -> 2 days after race day, UTC). Between windows the
#     worker is OFF. The old "keep-warm, never scale to zero" rule (2026-06-25) protected the 07:00
#     send from cold-start false-SENT; inside a window the container has been warm for days, and
#     QUEUE_PROCESSOR-000 already awaits waitForStable() before every send, so that failure cannot
#     recur. Re-run with -SkipBuild whenever app/src/lib/data.ts changes (new season, moved race).
#   * Verifies the deploy: polls /health until it reports the new version, or fails loudly.
# Cost: ACR Tasks build ~GBP 0.02 per run; the app bills only while a window is open.
# Run from this folder:  .\deploy-container-app.ps1 [-SkipBuild] [-SkipSchedule]

param(
    [switch]$SkipBuild,
    [switch]$SkipSchedule
)

$ErrorActionPreference = 'Stop'
$az = "C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
if (-not (Test-Path $az)) { $az = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd" }
if (-not (Test-Path $az)) { throw "Azure CLI not found" }

$RESOURCE_GROUP      = "garcia"
$SUBSCRIPTION        = "8e1afaa3-1ce8-4269-9f57-71fdd88c70c3"
$ACR_NAME            = "prixsixacr"
$CONTAINER_APP_NAME  = "prixsix-whatsapp"
$IMAGE_NAME          = "prixsix-whatsapp-worker"
$APP_ID              = "/subscriptions/$SUBSCRIPTION/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.App/containerApps/$CONTAINER_APP_NAME"
$API                 = "2024-03-01"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$pkg = Get-Content "$here\package.json" -Raw | ConvertFrom-Json
$VERSION = $pkg.version
$srcVersion = (Select-String -Path "$here\src\index.ts" -Pattern "const WORKER_VERSION = '([^']+)'").Matches[0].Groups[1].Value
if ($srcVersion -ne $VERSION) { throw "package.json ($VERSION) and src/index.ts WORKER_VERSION ($srcVersion) disagree - fix before deploying" }

Write-Host "=== Prix Six WhatsApp worker $VERSION -> $CONTAINER_APP_NAME ===" -ForegroundColor Cyan

$ACR_SERVER = & $az acr show --name $ACR_NAME --query loginServer -o tsv
$IMAGE = "$ACR_SERVER/${IMAGE_NAME}:$VERSION"

if (-not $SkipBuild) {
    Write-Host "`n=== Phase 1: cloud build $IMAGE ===" -ForegroundColor Cyan
    & $az acr build --registry $ACR_NAME --image "${IMAGE_NAME}:$VERSION" --image "${IMAGE_NAME}:latest" --file Dockerfile .
    if ($LASTEXITCODE -ne 0) { throw "az acr build failed" }
} else {
    Write-Host "`n=== Phase 1: skipping build, using existing $IMAGE ===" -ForegroundColor Cyan
    $tags = & $az acr repository show-tags --name $ACR_NAME --repository $IMAGE_NAME -o tsv
    if ($tags -notcontains $VERSION) { throw "Tag $VERSION is not in $ACR_NAME/$IMAGE_NAME - run without -SkipBuild" }
}

Write-Host "`n=== Phase 2: point the app at the new image (env vars untouched) ===" -ForegroundColor Cyan
$SUFFIX = "v" + ($VERSION -replace '\.', '')
$currentImage = & $az rest --method get --url "https://management.azure.com${APP_ID}?api-version=$API" --query "properties.template.containers[0].image" -o tsv
if ($currentImage -eq $IMAGE) {
    Write-Host "App already runs $IMAGE - no new revision needed" -ForegroundColor Green
} else {
    $revision = & $az containerapp update --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP `
        --image $IMAGE --revision-suffix $SUFFIX `
        --query properties.latestRevisionName -o tsv
    if ($LASTEXITCODE -ne 0) { throw "az containerapp update failed" }
    Write-Host "Revision: $revision" -ForegroundColor Green
}

if (-not $SkipSchedule) {
    Write-Host "`n=== Phase 3: race-window scale schedule ===" -ForegroundColor Cyan
    node "$here\scale-schedule.js"
    if ($LASTEXITCODE -ne 0) { throw "scale-schedule.js refused to produce a schedule" }
    # A template change needs a NEW revision name. The suffix set in Phase 2 is sticky, so a PATCH
    # without its own revisionSuffix is Accepted (202) and then fails silently with provisioningState
    # 'Failed' and the old scale left in place (bitten 2026-10-12). Hence the -sched suffix + the poll.
    $patch = node "$here\scale-schedule.js" --patch | ConvertFrom-Json
    $patch.properties.template | Add-Member -NotePropertyName revisionSuffix -NotePropertyValue "$SUFFIX-sched-$(Get-Date -Format 'MMdd')" -Force
    $patchFile = Join-Path $env:TEMP "prixsix-whatsapp-scale.json"
    $patch | ConvertTo-Json -Depth 10 -Compress | Set-Content -Path $patchFile -Encoding ascii
    & $az rest --method patch --url "https://management.azure.com${APP_ID}?api-version=$API" --body "@$patchFile" --output none
    if ($LASTEXITCODE -ne 0) { throw "scale PATCH was rejected" }
    Remove-Item $patchFile -ErrorAction SilentlyContinue
    $prov = "InProgress"
    $deadline = (Get-Date).AddMinutes(5)
    while ($prov -notin @("Succeeded", "Failed", "Canceled") -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $prov = & $az rest --method get --url "https://management.azure.com${APP_ID}?api-version=$API" --query properties.provisioningState -o tsv
    }
    if ($prov -ne "Succeeded") { throw "scale PATCH ended with provisioningState=$prov - schedule NOT applied" }
    & $az rest --method get --url "https://management.azure.com${APP_ID}?api-version=$API" `
        --query "properties.template.scale.{min:minReplicas,max:maxReplicas,rules:rules[].name}" -o json
    $applied = & $az rest --method get --url "https://management.azure.com${APP_ID}?api-version=$API" --query "properties.template.scale.minReplicas" -o tsv
    if ($applied -ne "0") { throw "minReplicas is $applied after the PATCH - schedule NOT applied" }
} else {
    Write-Host "`n=== Phase 3: skipping schedule ===" -ForegroundColor Cyan
}

Write-Host "`n=== Phase 4: verify /health reports $VERSION ===" -ForegroundColor Cyan
$FQDN = & $az containerapp show --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn -o tsv
$deadline = (Get-Date).AddMinutes(5)
$live = $null
while ((Get-Date) -lt $deadline) {
    try {
        $h = Invoke-RestMethod -Uri "https://$FQDN/health" -TimeoutSec 15
        $live = $h.version
        if ($live -eq $VERSION) { break }
    } catch { }
    Start-Sleep -Seconds 10
}
if ($live -eq $VERSION) {
    Write-Host "LIVE: https://$FQDN/health reports $live" -ForegroundColor Green
} else {
    Write-Host "NOT VERIFIED: /health reports '$live' (wanted $VERSION). If a race window is not open the app is" -ForegroundColor Red
    Write-Host "scaled to zero by design - check 'az containerapp replica list' and the schedule above." -ForegroundColor Red
    exit 1
}
