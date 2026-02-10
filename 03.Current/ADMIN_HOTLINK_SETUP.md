# Admin Hot Link Setup Guide

## Firestore TTL Configuration (Step 1B)

### Option 1: Firebase Console (Recommended for manual setup)

1. Navigate to [Firebase Console](https://console.firebase.google.com/project/studio-6033436327-281b1/firestore)
2. Go to **Firestore Database** → **Indexes** tab
3. Click **"Enable TTL"** (if not already enabled)
4. Select collection: `admin_challenges`
5. Select TTL field: `expiresAt`
6. Save configuration

### Option 2: gcloud CLI (Recommended for automated deployment)

```powershell
# Enable Firestore TTL for admin_challenges collection
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  firestore fields ttls update expiresAt `
  --collection-group=admin_challenges `
  --project=studio-6033436327-281b1 `
  --enable-ttl

# Verify TTL configuration
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  firestore fields ttls list `
  --project=studio-6033436327-281b1
```

### How TTL Works

- **Field**: `expiresAt` (timestamp in milliseconds)
- **Behavior**: Firestore automatically deletes documents where `expiresAt` < current time
- **Delay**: Deletion typically occurs within 72 hours of expiration (not instant)
- **Redundancy**: This is why we also have the hourly Cloud Function cleanup (defensive redundancy)

### Verification

After enabling TTL, check Cloud Logging for TTL operations:

```powershell
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  logging read `
  'resource.type="datastore_database" AND protoPayload.methodName="google.firestore.admin.v1.FirestoreAdmin.UpdateField"' `
  --project=studio-6033436327-281b1 `
  --limit=5 `
  --format=json
```

## Deployment Checklist

- [ ] Firestore rules updated (`admin_challenges` and `secondary_email_verification_tokens`)
- [ ] Cloud Function `cleanupExpiredAdminTokens` deployed
- [ ] Firestore TTL enabled for `admin_challenges.expiresAt`
- [ ] Verified TTL configuration via gcloud

---

## Next Steps

1. Create Zod schema for Admin Hot Link validation
2. Implement POST `/api/auth/admin-challenge` endpoint
3. Implement POST `/api/admin/verify-access` endpoint
4. Refactor `/admin` page with SSR verification gate
