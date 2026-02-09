# WhatsApp Worker - Container Apps Migration Guide

## What Changed

**Before (Container Instance):**
- Always running = $32/month
- Manual deploy/delete workflow
- Container name mismatch issues

**After (Container Apps):**
- Scale-to-zero = $0 when idle
- Auto-scales on demand = ~$4-10/month
- Fully automated

## Cost Breakdown

| Scenario | ACI (Old) | Container Apps (New) | Savings |
|----------|-----------|---------------------|---------|
| **Always running** | $32/mo | $32/mo | $0 |
| **4 race weekends/month** | $17/mo (manual) | $8/mo (auto) | $9/mo (53%) |
| **Idle periods** | $1.08/day | **$0/day** | 100% |

## Deployment Steps

### 1. Deploy the Container App

```powershell
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current\whatsapp-worker
.\deploy-container-app.ps1
```

**First deployment:**
- Takes ~10-15 minutes (creates environment + deploys)
- Saves API key to `.api-key.txt`
- Shows FQDN for the worker

**Subsequent deployments:**
```powershell
.\deploy-container-app.ps1 -SkipBuild  # Faster, reuses existing image
```

### 2. Update Next.js Environment Variables

Add to `app/.env.local`:

```env
# WhatsApp Worker (Container Apps)
WHATSAPP_WORKER_URL=https://<FQDN-from-deployment>
WHATSAPP_APP_SECRET=<API-KEY-from-deployment>
```

### 3. Update WhatsApp Proxy Route

In `app/src/app/api/whatsapp-proxy/route.ts`, update the worker URL logic:

```typescript
// OLD (hardcoded Container Instance):
const WORKER_URL = 'http://prixsix-whatsapp.uksouth.azurecontainer.io:3000';

// NEW (from environment):
const WORKER_URL = process.env.WHATSAPP_WORKER_URL || 'http://localhost:3000';
```

### 4. Add Queue Trigger (Optional but Recommended)

When queuing WhatsApp messages, trigger the worker to scale up:

```typescript
// After adding message to Firestore whatsapp_queue:
await fetch(`${process.env.WHATSAPP_WORKER_URL}/process-queue`, {
  method: 'POST',
  headers: {
    'X-API-Key': process.env.WHATSAPP_APP_SECRET!,
  },
});
```

This ensures the worker wakes up immediately instead of waiting for the next HTTP health check.

## How Scale-to-Zero Works

1. **No activity:** Container scales to 0 replicas after ~10 minutes
2. **Message queued:** Next.js calls `/process-queue` endpoint
3. **Container starts:** Azure spins up container (~30-60 seconds)
4. **WhatsApp connects:** Session restored from blob storage (~10 seconds)
5. **Message sent:** Queue processed
6. **Idle again:** After 10 minutes, scales back to 0

## Testing

### Check if running:
```powershell
curl https://<FQDN>/health
```

### Trigger manually:
```powershell
$API_KEY = Get-Content .api-key.txt
curl -X POST https://<FQDN>/process-queue -H "X-API-Key: $API_KEY"
```

### View logs:
```powershell
az containerapp logs show --name prixsix-whatsapp --resource-group garcia --follow
```

## Rollback Plan

If you need to rollback to Container Instances:

```powershell
# Delete Container App
az containerapp delete --name prixsix-whatsapp --resource-group garcia --yes

# Redeploy with old script
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current\whatsapp-worker
.\deploy-whatsapp.ps1
```

The session data in blob storage is preserved, so no QR code rescan needed.

## FAQ

**Q: Will I lose my WhatsApp session?**
A: No - session is stored in Azure Blob Storage (`garcialtdstorage/whatsapp-session`) which persists across deployments.

**Q: How long does scale-from-zero take?**
A: ~30-60 seconds for container start + ~10 seconds for WhatsApp reconnection = **~60-90 seconds total**

**Q: What if a message is queued while scaled to zero?**
A: The `/process-queue` endpoint triggers scale-up. The message waits in Firestore until worker is ready.

**Q: Can I force it to always run?**
A: Yes, change `--min-replicas 0` to `--min-replicas 1` in the deployment script. Cost becomes same as ACI.

**Q: How do I monitor costs?**
A: Azure Portal → Cost Management → Filter by resource: `prixsix-whatsapp`

## Next Steps

After successful deployment:

1. ✅ Update memory with new URLs and workflow
2. ✅ Test with a real WhatsApp message
3. ✅ Monitor for first race weekend
4. ✅ Compare costs after 1 month
5. ✅ Delete old ACI deployment script (or keep as backup)
