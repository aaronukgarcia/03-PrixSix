# Admin Hot Link - Verification Test Suite

## Pre-Deployment Checklist

Before deploying the Admin Hot Link implementation, ensure:

- [ ] Firestore rules updated (`app/src/firestore.rules`)
- [ ] Cloud Function `cleanupExpiredAdminTokens` deployed to Firebase
- [ ] Firestore TTL enabled for `admin_challenges.expiresAt`
- [ ] All API routes compile without TypeScript errors
- [ ] `validation.ts` exports used by API routes
- [ ] Admin page renders without errors (verify locally)

## Deployment Steps

### 1. Deploy Firestore Rules

```powershell
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current
firebase deploy --only firestore:rules --project studio-6033436327-281b1
```

**Verify deployment:**
```powershell
firebase firestore:rules:get --project studio-6033436327-281b1
```

### 2. Deploy Cloud Functions

```powershell
cd functions
npm install  # Ensure dependencies are up to date
cd ..
firebase deploy --only functions --project studio-6033436327-281b1
```

**Verify deployment:**
```powershell
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  functions list `
  --project=studio-6033436327-281b1 `
  --filter="name:cleanupExpiredAdminTokens"
```

### 3. Enable Firestore TTL

```powershell
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  firestore fields ttls update expiresAt `
  --collection-group=admin_challenges `
  --project=studio-6033436327-281b1 `
  --enable-ttl
```

### 4. Deploy Next.js Application

```powershell
cd app
npm run build  # Verify build succeeds
cd ..
git add .
git commit -m "feat: Admin Hot Link MFA implementation (Phase 3.A)"
git push origin main  # Triggers Firebase App Hosting build
```

---

## Manual Test Suite

### Test 1: Direct /admin Access Without Verification (SHOULD BLOCK)

**Purpose:** Verify ADMINCOMP-003 fix (client-side admin bypass prevention)

**Steps:**
1. Log in as an admin user (`aaron@garcia.ltd`)
2. Navigate directly to `https://prix6.win/admin` (bypass magic link)
3. **Expected:** "Verification Required" card is displayed
4. **Expected:** Admin tabs are NOT visible
5. **Expected:** "Send Verification Link" button is shown

**Pass Criteria:**
- ✅ Admin panel tabs blocked
- ✅ Verification gate UI displayed
- ✅ No client-side console errors

**Fail Criteria:**
- ❌ Admin tabs render without verification
- ❌ Can bypass verification by manipulating cookies
- ❌ JavaScript errors in console

---

### Test 2: Admin Self-Email Update (SHOULD REJECT)

**Purpose:** Verify Firestore rule enforcement (admin identity lockdown)

**Steps:**
1. Open browser DevTools console
2. Log in as admin (`aaron@garcia.ltd`)
3. Run this code in console:

```javascript
// Attempt to change own email
const firestore = firebase.firestore();
const userId = firebase.auth().currentUser.uid;

firestore.collection('users').doc(userId).update({
  email: 'hacker@evil.com'
})
.then(() => console.log('❌ SECURITY FAIL: Email update succeeded'))
.catch(err => console.log('✅ PASS: Update blocked -', err.message));
```

**Expected Result:**
```
✅ PASS: Update blocked - Missing or insufficient permissions
```

**Pass Criteria:**
- ✅ Firestore rejects update with `PERMISSION_DENIED`
- ✅ Email remains unchanged in Firestore
- ✅ Error message indicates insufficient permissions

**Fail Criteria:**
- ❌ Email update succeeds
- ❌ No error is thrown
- ❌ Wrong error code (not permissions-related)

---

### Test 3: Expired Magic Link (SHOULD ERROR)

**Purpose:** Verify 10-minute expiry enforcement and PX-registry error codes

**Steps:**
1. Request admin verification link
2. Check email, copy the verification URL
3. **Wait 11 minutes** (expiry time + 1 minute)
4. Click the expired verification link
5. Observe the error page

**Expected Result:**
- Error page shows: "Verification Failed"
- Error message: "AUTH_TOKEN_EXPIRED" or similar
- Correlation ID is displayed
- Helpful text: "The verification link has expired (links expire after 10 minutes)"

**Pass Criteria:**
- ✅ Expired token is rejected
- ✅ Error code from PX-registry is displayed
- ✅ Correlation ID is shown for support
- ✅ Token is deleted from `admin_challenges` collection

**Fail Criteria:**
- ❌ Expired token grants access
- ❌ No error is shown
- ❌ Generic error without correlation ID
- ❌ Token remains in database

---

### Test 4: Malformed Magic Link (SHOULD ERROR)

**Purpose:** Verify input validation and error handling

**Test 4A: Invalid token format**
1. Manually construct URL: `https://prix6.win/admin/verify?token=INVALID&email=aaron@garcia.ltd`
2. Navigate to URL

**Expected:**
- Error page: "Invalid verification link. Missing token or email parameter."
- No server crash

**Test 4B: Missing email parameter**
1. Request verification link
2. Copy URL, remove `&email=...` parameter
3. Navigate to modified URL

**Expected:**
- Error page: "Invalid verification link. Missing token or email parameter."
- Zod validation failure

**Test 4C: Email mismatch**
1. Request verification link for `aaron@garcia.ltd`
2. Copy URL, change email to `other@email.com`
3. Navigate to modified URL

**Expected:**
- Error: "Email mismatch" or "ADMIN_TOKEN_OWNERSHIP_MISMATCH"
- Warning logged to console logs (check Cloud Logging)

**Pass Criteria (all 4A/B/C):**
- ✅ Malformed requests are rejected
- ✅ PX-registry error codes used
- ✅ No server crashes or 500 errors
- ✅ Security warnings logged for suspicious attempts

---

### Test 5: Successful Magic Link Flow (HAPPY PATH)

**Purpose:** Verify end-to-end magic link flow works correctly

**Steps:**
1. Log in as admin (`aaron@garcia.ltd`)
2. Navigate to `https://prix6.win/admin`
3. Click "Send Verification Link"
4. Check email inbox (aaron@garcia.ltd)
5. Click the verification link in email
6. Observe redirect to `/admin/verify`
7. Wait for success message
8. Observe auto-redirect to `/admin`
9. Verify admin panel tabs are visible

**Expected Behavior:**
- Email received within 30 seconds
- Email subject: "Prix Six Admin Access - Verify Your Identity"
- Email body contains clickable link
- `/admin/verify` page shows "Verifying..." spinner
- Success message: "Verification Successful! Redirecting..."
- Auto-redirect after 2 seconds
- Admin panel tabs render
- `adminVerified=true` cookie is set

**Pass Criteria:**
- ✅ Email delivered successfully
- ✅ Link works on first click
- ✅ Verification succeeds
- ✅ Cookie set correctly
- ✅ Admin panel accessible
- ✅ All audit logs created

**Fail Criteria:**
- ❌ Email not received
- ❌ Link doesn't work
- ❌ Verification fails despite valid token
- ❌ Cookie not set
- ❌ Admin panel still blocked after verification

---

### Test 6: Single-Use Token Enforcement

**Purpose:** Verify tokens can only be used once

**Steps:**
1. Request magic link
2. Click link → verify successfully
3. Copy the verification URL
4. Open URL in new incognito window (or clear cookies)
5. Navigate to the copied URL again

**Expected:**
- Error: "Invalid token" or "Token not found"
- Token was deleted after first use

**Pass Criteria:**
- ✅ Second use of token is rejected
- ✅ Error message indicates token is invalid
- ✅ Token document deleted from `admin_challenges`

**Fail Criteria:**
- ❌ Token works multiple times
- ❌ Token remains in database after use

---

### Test 7: Rate Limiting

**Purpose:** Verify rate limits prevent abuse

**Test 7A: Per-user rate limit (3/hour)**
1. Log in as admin
2. Click "Send Verification Link" **4 times in rapid succession**
3. Observe 4th request

**Expected:** 4th request fails with "Rate limit exceeded: 3 requests per hour"

**Test 7B: Cooldown enforcement**
1. After Test 7A, wait 61 minutes
2. Try requesting link again

**Expected:** Request succeeds (rate limit window reset)

**Pass Criteria:**
- ✅ 4th request blocked
- ✅ Clear error message about rate limit
- ✅ Rate limit resets after 1 hour

---

## Automated Test Script (Future Enhancement)

```typescript
// app/__tests__/admin-hotlink.test.ts
import { describe, it, expect } from '@jest/globals';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

// TODO: Implement automated tests using Firebase Emulator
// - Test Firestore rules for email update prevention
// - Test token expiry logic
// - Test rate limiting
```

---

## Security Checklist Post-Deployment

After deployment, verify:

- [ ] FIRESTORE-002 resolved (secondary_email_verification_tokens rules exist)
- [ ] ADMINCOMP-002 resolved (admin can't toggle own isAdmin status)
- [ ] ADMINCOMP-003 resolved (client-side admin check bypassed)
- [ ] EMAIL-002 resolved (encodeURIComponent used in magic link URLs)
- [ ] LIB-001 resolved (crypto.randomBytes used for tokens)
- [ ] LIB-002 resolved (crypto.randomUUID used for correlation IDs)

---

## Monitoring Commands

### Check Cloud Function Logs (Token Cleanup)
```powershell
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  logging read 'resource.type="cloud_function" AND resource.labels.function_name="cleanupExpiredAdminTokens"' `
  --project=studio-6033436327-281b1 `
  --limit=20 `
  --format=json
```

### Check Admin Challenge Attempts
```powershell
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  logging read 'jsonPayload.message="ADMIN_CHALLENGE_SENT"' `
  --project=studio-6033436327-281b1 `
  --limit=10 `
  --format='value(jsonPayload.correlationId, jsonPayload.email, timestamp)'
```

### Check Verification Success/Failures
```powershell
& "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" `
  logging read 'jsonPayload.message=~"ADMIN_(ACCESS_GRANTED|VERIFICATION_FAILED)"' `
  --project=studio-6033436327-281b1 `
  --limit=20 `
  --format=json
```

---

## Rollback Plan

If critical issues are found post-deployment:

### Option 1: Quick Fix (Disable MFA Temporarily)
```typescript
// In app/src/app/(app)/admin/page.tsx
// Temporarily comment out the verification gate (lines ~130-180)
// This restores original behavior while fixes are developed
```

### Option 2: Revert Firestore Rules
```powershell
git checkout HEAD~1 app/src/firestore.rules
firebase deploy --only firestore:rules --project studio-6033436327-281b1
```

### Option 3: Full Rollback
```powershell
git revert HEAD
git push origin main
# Triggers re-deployment with previous version
```

---

**Test Suite Version:** v1.0 (2026-02-10)
**Last Updated By:** Bill (Claude Code)
**Related Issues:** ADMINCOMP-003, FIRESTORE-002, EMAIL-002, LIB-001, LIB-002
