# EMAIL-006 Phase 1B - Quick Start Guide

**⏱️ 5-Minute Quick Start**

---

## Step 1: Dry Run (2 minutes)

```bash
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current\app
npx ts-node --project tsconfig.scripts.json scripts/migrate-mask-pins.ts
```

**Check:** Did it say "DRY RUN MODE"? ✅

---

## Step 2: Review Output (2 minutes)

Look for:
- ✅ "Documents needing migration: X"
- ✅ "Backup created: ..."
- ✅ Sample outputs showing PIN masking

---

## Step 3: Execute Migration (1 minute)

1. **Edit `scripts/migrate-mask-pins.ts` line 17:**
   ```typescript
   dryRun: false,  // Change from true to false
   ```

2. **Save and run:**
   ```bash
   npx ts-node --project tsconfig.scripts.json scripts/migrate-mask-pins.ts
   ```

3. **Check for success:**
   - ✅ "Verification: ✅ PASSED"
   - ✅ "Phase 1B COMPLETE"

---

## ✅ Done!

**Next:** Proceed to Phase 1C (credential rotation audit)

**Files Created:**
- ✅ Backup: `email-logs-backup/backup-YYYY-MM-DD/`
- ✅ Log: `migration-logs/mask-pins-log.txt`

**Need Help?** See `MIGRATION-GUIDE.md` for full details

---

## 🔙 Rollback (If Needed)

```bash
npx ts-node --project tsconfig.scripts.json scripts/rollback-mask-pins.ts
```

**⚠️ Only use in emergency!**
