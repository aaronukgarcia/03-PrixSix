# Operational Script Safety System

## Overview

This directory contains operational scripts for database maintenance, migrations, and testing. Many of these scripts perform **DESTRUCTIVE operations** that can cause **DATA LOSS** if run against the production database.

To prevent accidental data loss, all destructive scripts have been equipped with a **mandatory safety system** that blocks execution against production and requires explicit user confirmation.

## Safety System Components

### 1. Production Environment Check

All destructive scripts check the `FIREBASE_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` environment variables before executing. If the production project ID (`prix-six`) is detected, the script immediately exits with an error.

```typescript
// Example error output:
❌ ERROR: This script cannot run against production database!

   Detected project: prix-six
   Production ID:    prix-six

   This is a DESTRUCTIVE script that modifies/deletes data.
   Running it against production would cause DATA LOSS.

   To run this script safely, use the test project: prix6-test
```

### 2. User Confirmation Prompt

Even when running against a test environment, all destructive scripts require the user to type `CONFIRM` (all caps) before proceeding. This prevents accidental execution via mistyped commands or automated processes.

```
⚠️  ═══════════════════════════════════════════════════════════════
⚠️  WARNING: You are about to run a DESTRUCTIVE operation:
⚠️  DELETE ALL SCORES (entire scores collection)
⚠️  ═══════════════════════════════════════════════════════════════

Type "CONFIRM" (all caps) to proceed, or anything else to cancel:
```

## Protected Scripts (Partial List)

The following scripts have been protected with the safety system:

### P0 - Critical Destructive Scripts
- `reset-db.ts` - Deletes entire database (users, races)
- `delete-all-scores.ts` - Deletes all scores
- `purge-temp-data.ts` - Bulk deletion of users, predictions, submissions, scores
- `delete-race-results.ts` - Deletes all race results
- `reset-season-delete-results.ts` - Season reset (deletes results, scores, audit logs)

### P1 - High-Impact Scripts
- `cleanup-bad-scores.ts` - Deletes malformed scores
- `cleanup-prediction-submissions.ts` - Deletes entire prediction_submissions collection
- `migrate-race-id-case.ts` - Migration to Title-Case race IDs
- `recalculate-all-scores.ts` - Deletes and regenerates all scores

**Note:** Many other scripts in this directory also perform destructive operations. When in doubt, check the script's header comments for `@PHASE_4B` tags and GUID documentation.

## Safe Testing Workflow

### 1. Create Test Firebase Project

Create a dedicated Firebase project for safe script testing:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create new project: `prix6-test` (or similar non-production name)
3. Enable Firestore Database
4. Download service account key: `service-account-test.json`

### 2. Set Environment Variables

Before running ANY destructive script, set the environment to target your test project:

#### PowerShell (Windows)
```powershell
$env:FIREBASE_PROJECT_ID = "prix6-test"
$env:GOOGLE_APPLICATION_CREDENTIALS = ".\service-account-test.json"
```

#### Bash (macOS/Linux)
```bash
export FIREBASE_PROJECT_ID="prix6-test"
export GOOGLE_APPLICATION_CREDENTIALS="./service-account-test.json"
```

### 3. Run Script

Execute the script using ts-node:

```bash
npx ts-node --project tsconfig.scripts.json scripts/your-script.ts
```

### 4. Verify Safety Checks

The script will:
1. Check the project ID (exits if production detected)
2. Display a warning about the destructive operation
3. Prompt you to type `CONFIRM`

Example output:
```
✅ Safe to proceed: Running against project 'prix6-test' (not production)

⚠️  ═══════════════════════════════════════════════════════════════
⚠️  WARNING: You are about to run a DESTRUCTIVE operation:
⚠️  DELETE ALL SCORES (entire scores collection)
⚠️  ═══════════════════════════════════════════════════════════════

Type "CONFIRM" (all caps) to proceed, or anything else to cancel: CONFIRM

✅ Confirmed. Proceeding with operation...
```

## Scripts with Dry-Run Mode

Some scripts support `--dry-run` mode which skips actual database writes and only shows what would be changed:

- `delete-race-results.ts --dry-run` (safe preview)
- `delete-race-results.ts --live` (requires confirmation)
- `reset-season-delete-results.ts --dry-run` (safe preview)
- `reset-season-delete-results.ts --live` (requires confirmation)
- `migrate-race-id-case.ts` (default is dry-run)
- `migrate-race-id-case.ts --apply` (requires confirmation)

**Recommendation:** ALWAYS run in dry-run mode first to verify the script will do what you expect.

## Emergency Bypass (NOT RECOMMENDED)

If you absolutely must run a destructive script against production (e.g., during a planned maintenance window):

1. **DO NOT** modify the safety checks in the scripts
2. **DO NOT** set fake environment variables
3. Instead, follow this process:
   - Document the reason and expected impact
   - Get approval from project owner
   - Take a full database backup first
   - Temporarily modify `_safety-checks.ts` to allow production (with version bump)
   - Run the script with full monitoring
   - Immediately revert the safety check modification
   - Verify expected outcome

**Better approach:** Export data from production, import to test, run script on test, export result, import to production.

## Technical Implementation

All safety checks are implemented via `app/scripts/_safety-checks.ts`:

```typescript
// Check environment
export function ensureNotProduction(): void {
  const projectId = process.env.FIREBASE_PROJECT_ID ||
                   process.env.GOOGLE_CLOUD_PROJECT;

  if (projectId === 'prix-six') {
    console.error('❌ ERROR: Cannot run against production!');
    process.exit(1);
  }
}

// Require confirmation
export async function requireConfirmation(description: string): Promise<void> {
  // Prompts user to type "CONFIRM"
}

// Combined check (most scripts use this)
export async function runSafetyChecks(description: string): Promise<void> {
  ensureNotProduction();
  await requireConfirmation(description);
}
```

Scripts import and call `runSafetyChecks()` at the start of their main function:

```typescript
import { runSafetyChecks } from './_safety-checks';

async function deleteAllScores() {
  await runSafetyChecks('DELETE ALL SCORES (entire scores collection)');
  // ... destructive operations
}
```

## Adding Safety Checks to New Scripts

When creating new destructive scripts, follow this pattern:

1. Import the safety helper:
   ```typescript
   import { runSafetyChecks } from './_safety-checks';
   ```

2. Add safety check at the start of the main function:
   ```typescript
   async function myDestructiveOperation() {
     await runSafetyChecks('DESCRIPTION: What this script will delete/modify');
     // ... rest of script
   }
   ```

3. For scripts with dry-run mode, skip safety checks in dry-run:
   ```typescript
   if (!DRY_RUN) {
     await runSafetyChecks('DESCRIPTION');
   }
   ```

4. Add GUID documentation header:
   ```typescript
   // GUID: SCRIPTS_MYNAME-000-v01
   // @PHASE_4B: Added safety checks to prevent production execution.
   // [Intent] DESTRUCTIVE: Brief description of what gets deleted/modified.
   //          For dev/test environments ONLY.
   // [Inbound Trigger] Manual execution by developer for X purpose.
   // [Downstream Impact] Y data deleted/modified. Now blocked on production.
   ```

## Troubleshooting

### "No project ID detected" Warning

If you see this warning, the script will proceed but safety checks cannot verify you're not targeting production. This happens when:
- `FIREBASE_PROJECT_ID` is not set
- `GOOGLE_CLOUD_PROJECT` is not set
- Firebase Admin uses default credentials

**Solution:** Explicitly set `FIREBASE_PROJECT_ID` before running scripts.

### "Cannot run against production" Error

This is expected behavior when `FIREBASE_PROJECT_ID=prix-six` is detected.

**Solution:** Change to test project:
```powershell
$env:FIREBASE_PROJECT_ID = "prix6-test"
```

### Script Exits Without Running

If the script exits immediately after displaying the safety warning, you either:
1. Cancelled by typing something other than `CONFIRM`
2. Hit Ctrl+C during the prompt

**Solution:** Re-run and type `CONFIRM` exactly (all caps).

## Related Documentation

- **Phase 4B Plan:** `E:\GoogleDrive\Papers\03-PrixSix\03.Current\PHASE3-SETUP-GUIDE.md` (Section on operational script safety)
- **Golden Rules:** Prix Six Golden Rule #11 (Security Review) applies to all script modifications
- **Book of Work:** Issue DEPLOY-003 (Operational Script Safety)

---

**Last Updated:** 2026-02-13 (v1.57.1)
**Phase:** 4B - Operational Script Safety
**Security Level:** CRITICAL - Do not disable safety checks without documented approval
