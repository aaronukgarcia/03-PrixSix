# EMAIL-006 Phase 1B Migration Guide

**Security Fix:** Retroactive PIN Masking in email_logs Collection
**Script:** `migrate-mask-pins.ts`
**Created:** 2026-02-17
**Severity:** CRITICAL

---

## 🎯 Purpose

This migration script retroactively masks plaintext PINs in the `email_logs` Firestore collection to prevent credential exposure. Part of EMAIL-006 remediation (v1.55.28).

**Background:**
- Prior to v1.55.28, PINs were logged in plaintext to `email_logs`
- v1.55.28 introduced `maskPin()` utility for new logs
- Historical logs still contain plaintext PINs
- This script cleans up the historical data

---

## 🚦 Before You Start

### Prerequisites
- [x] Firebase Admin SDK service account credentials
- [x] Node.js and TypeScript installed
- [x] Admin access to Prix Six Firestore
- [x] Backup of email_logs collection (script creates one automatically)

### Safety Checklist
- [ ] Confirmed script is in **DRY RUN mode** (`CONFIG.dryRun = true`)
- [ ] Reviewed the code for correctness
- [ ] Have access to Firestore console for manual verification
- [ ] Confirmed backup directory has sufficient disk space
- [ ] Read this entire guide before executing

---

## 📋 Migration Steps

### Step 1: Dry Run (REQUIRED)

```bash
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current\app

# Run in dry run mode (default)
npx ts-node --project tsconfig.scripts.json scripts/migrate-mask-pins.ts
```

**Expected Output:**
```
🚀 EMAIL-006 Phase 1B Migration Script
   Script: migrate-mask-pins.ts
   Mode: DRY RUN
   Backup: ENABLED

✅ Firebase initialized

🔍 Scanning email_logs collection...
   Total documents: 1234
   Documents with PIN field: 567
   Documents needing migration: 123

💾 Backup created: E:\GoogleDrive\Papers\03-PrixSix\03.Current\email-logs-backup\backup-2026-02-17\email-logs-plaintext-pins.json
   Documents backed up: 123

🔬 DRY RUN MODE - No documents will be modified
   Sample 1:
      Document ID: abc123
      To: user@example.com
      Subject: Welcome to Prix Six
      Current PIN: "123456"
      Masked PIN: "••••••"
   ...

📊 MIGRATION SUMMARY REPORT
======================================================================
Email Logs Total:           1234
Documents with PIN field:   567
Documents needing masking:  123

DRY RUN MODE - No changes made
Documents that WOULD be updated: 123

📋 NEXT STEPS
======================================================================
1. Review the sample output above
2. Check the log file for full details
3. If satisfied, set CONFIG.dryRun = false
4. Re-run the script to perform actual migration
```

### Step 2: Review Dry Run Results

1. **Check the samples** - Verify the masking logic is correct
2. **Review the log file:**
   ```bash
   cat E:\GoogleDrive\Papers\03-PrixSix\03.Current\migration-logs\mask-pins-log.txt
   ```
3. **Verify backup was created:**
   ```bash
   dir E:\GoogleDrive\Papers\03-PrixSix\03.Current\email-logs-backup\
   ```
4. **Check document count** - Ensure it matches expectations

### Step 3: Execute Live Migration

**⚠️ WARNING: This will modify your production database**

1. **Edit the script:**
   ```typescript
   // In scripts/migrate-mask-pins.ts, line ~17
   const CONFIG = {
     dryRun: false, // CHANGE THIS TO false
     createBackup: true,
     batchSize: 500,
     // ...
   };
   ```

2. **Save the file**

3. **Run the migration:**
   ```bash
   npx ts-node --project tsconfig.scripts.json scripts/migrate-mask-pins.ts
   ```

4. **Monitor the output:**
   ```
   🔄 Starting migration (LIVE MODE)...
      ✅ Batch 1: Updated 500 documents
      ✅ Batch 2: Updated 234 documents

   🔎 Verifying migration...
      ✅ SUCCESS: All PINs are masked

   📊 MIGRATION SUMMARY REPORT
   ======================================================================
   Documents updated:          734
   Errors:                     0
   Verification:               ✅ PASSED

   ✅ Phase 1B COMPLETE - All PINs masked successfully
   ```

### Step 4: Verify Migration Success

1. **Check Firestore Console:**
   - Navigate to email_logs collection
   - Spot-check random documents
   - Verify `pin` field shows `••••••`
   - Verify new fields: `migrated`, `migratedAt`, `migratedBy`

2. **Run verification query:**
   ```javascript
   // In Firestore console or Firebase CLI
   db.collection('email_logs')
     .where('pin', '==', '••••••')
     .get()
     .then(snapshot => console.log(`Masked: ${snapshot.size}`));
   ```

3. **Check for failures:**
   - Review log file for any errors
   - If errors exist, see Troubleshooting section below

---

## 🔄 Rollback Procedure

If something goes wrong, you can restore from backup:

### Option 1: Use Rollback Script (Recommended)

```bash
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current\app

# Run rollback script (will be created in next step)
npx ts-node --project tsconfig.scripts.json scripts/rollback-mask-pins.ts
```

### Option 2: Manual Rollback

1. **Locate the backup file:**
   ```bash
   dir E:\GoogleDrive\Papers\03-PrixSix\03.Current\email-logs-backup\backup-2026-02-17\
   ```

2. **Review the backup:**
   ```bash
   type email-logs-plaintext-pins.json
   ```

3. **Restore via Firebase CLI or console:**
   - For each document in backup, restore original values
   - Remove migration metadata fields

---

## 🐛 Troubleshooting

### Issue: "service-account.json not found"
**Solution:**
```bash
# Verify service account file exists
dir E:\GoogleDrive\Papers\03-PrixSix\03.Current\app\service-account.json

# If missing, copy from backup or re-download from Firebase Console
```

### Issue: "Batch write failed"
**Symptoms:** Errors during batch commit
**Solution:**
1. Check Firestore permissions
2. Verify service account has write access
3. Review error message in log file
4. Retry failed batch manually

### Issue: "Verification failed - plaintext PINs remain"
**Symptoms:** Verification reports failures
**Solution:**
1. Check log file for failed document IDs
2. Manually inspect those documents in Firestore
3. Run migration again (it's idempotent)
4. If still failing, manually update problem documents

### Issue: "Insufficient disk space for backup"
**Solution:**
```bash
# Check available space
dir E:\GoogleDrive\Papers\03-PrixSix\03.Current\

# If low, temporarily disable backup (NOT RECOMMENDED)
# Or free up space before running
```

---

## 📊 Expected Results

### Before Migration:
```json
{
  "to": "user@example.com",
  "subject": "Welcome to Prix Six",
  "pin": "123456",
  "status": "sent",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

### After Migration:
```json
{
  "to": "user@example.com",
  "subject": "Welcome to Prix Six",
  "pin": "••••••",
  "status": "sent",
  "timestamp": "2026-01-15T10:30:00Z",
  "migrated": true,
  "migratedAt": "2026-02-17T23:45:00Z",
  "migratedBy": "migrate-mask-pins.ts"
}
```

---

## 🔐 Security Notes

### What Gets Backed Up
- Document IDs
- Original PIN values (plaintext)
- Email addresses
- Timestamps
- Subject lines

**⚠️ CRITICAL:** Backup files contain plaintext PINs!
- Store backup directory securely
- Restrict access permissions
- Delete backups after Phase 1C credential rotation
- Do NOT commit backups to git

### Credential Rotation (Phase 1C)
After successful migration:
1. Review backup files for exposed credentials
2. Identify unique PINs that were logged
3. Determine if any are still active credentials
4. Rotate affected credentials
5. Document rotation in security audit log

---

## 📁 File Locations

```
E:\GoogleDrive\Papers\03-PrixSix\03.Current\
├── app\
│   ├── scripts\
│   │   ├── migrate-mask-pins.ts         # Migration script
│   │   ├── rollback-mask-pins.ts        # Rollback script (to be created)
│   │   └── MIGRATION-GUIDE.md           # This file
│   └── service-account.json             # Firebase credentials
├── email-logs-backup\
│   └── backup-2026-02-17\
│       └── email-logs-plaintext-pins.json  # Backup data
└── migration-logs\
    └── mask-pins-log.txt                # Migration log file
```

---

## ✅ Success Criteria

Migration is considered successful when:
- [ ] Dry run completed without errors
- [ ] Backup created successfully
- [ ] Live migration updated all identified documents
- [ ] Zero errors reported in migration
- [ ] Verification passed (no plaintext PINs remain)
- [ ] Spot-check in Firestore console confirms masking
- [ ] Migration log file created and reviewed
- [ ] Backup files secured with restricted access

---

## 📞 Support

If you encounter issues:
1. Check the log file: `migration-logs/mask-pins-log.txt`
2. Review Firestore console for actual data state
3. Verify Firebase service account permissions
4. Check this guide's Troubleshooting section
5. If needed, restore from backup and investigate

---

**Document Version:** 1.0
**Last Updated:** 2026-02-17
**Author:** Bill (Claude Code)
**Related:** EMAIL-006 Phase 1B, VALIDATION-REPORT.md
