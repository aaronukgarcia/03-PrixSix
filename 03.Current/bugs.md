# Role
You are the Lead Developer for "Prix Predictor". You are executing a sequential hot-fix protocol to remediate 28 defects found during a recent QA Shakedown.

# CRITICAL INSTRUCTION: SERIAL EXECUTION
**Do not attempt to fix everything at once.**
You must execute the following 4 Batches **sequentially**.
1. Apply the fix for Batch 1.
2. Verify the file writes are successful.
3. ONLY THEN proceed to Batch 2.
(And so on).

If a Batch fails to write or compiles with errors, **STOP** and report the issue. Do not proceed to the next batch on a broken foundation.

---

## BATCH 1: THE DATA MODEL (Critical Blocking Fix)
**Target:** `PredictionEditor.tsx` and `predictions/page.tsx`
**Defect:** DEF-012 (Data format mismatch)

**Context:**
The editor currently saves 6 individual fields (`driver1`...`driver6`), but the scoring engine reads a `predictions` array. This causes all scores to calculate as 0.

**Action:**
1.  Refactor `PredictionEditor.tsx` to submit data as `{ predictions: [id1, id2, id3, id4, id5, id6] }`.
2.  Update the `useEffect` or data loading logic in `PredictionEditor` (and `page.tsx`) to correctly map this new `predictions` array back to the 6 UI dropdowns so the user sees their saved choices.
3.  **Constraint:** Do not touch `scoring.ts` yet. We are fixing the data to match the engine.

---

## BATCH 2: THE SCORING LOGIC (Business Logic Fix)
**Target:** `scoring.ts` and `ScoringManager.tsx`
**Defect:** DEF-019, DEF-023, DEF-027

**Context:**
Now that the data format is fixed, the scoring rules must match the "Wacky Racers" requirements.

**Action:**
1.  **Update Scoring Rules (`scoring.ts`):**
    Refactor the calculation to match the "Wacky Racers" spec:
    * **+1 Point:** If a predicted driver appears *anywhere* in the actual Top 10 (ignore position).
    * **+3 Points (Bonus):** If exactly 5 out of 6 predictions are correct.
    * **+5 Points (Bonus):** If exactly 6 out of 6 predictions are correct.
    * *Check:* Max possible score is 6 + 5 = 11.

2.  **Fix Tie-Breaking:**
    Update the `calculateStandings` (or equivalent) function.
    * Sort by Points (Descending).
    * Assign Ranks: If User A and User B have equal points, they share the same `rank`.
    * *Example:*
        - User A: 10 pts -> Rank 1
        - User B: 10 pts -> Rank 1
        - User C: 8 pts  -> Rank 3 (not 2)

---

## BATCH 3: SECURITY HARDENING (Access & Lockouts)
**Target:** `predictions/page.tsx` (or API handler) and `provider.tsx`
**Defect:** DEF-014, DEF-006, DEF-025

**Context:**
Security is currently client-side only. We need server-side enforcement.

**Action:**
1.  **Lockouts:** In the server action or API route that handles prediction submission, check `if (Date.now() > race.qualifyingTime)`. Throw an error if true.
2.  **Signups:** In `provider.tsx` (the signup function), fetch the global settings. If `newUserSignupEnabled` is false, throw an error to block the registration.

---

## BATCH 4: AUDIT OBSERVABILITY (Compliance)
**Targets:** Various files
**Defect:** Missing Audit Logs (DEF-001, DEF-009, DEF-018)

**Action:**
1.  **System Init:** Add `logAudit('SYSTEM_INIT')` when admin settings are saved (e.g., in `SiteFunctionsManager`).
2.  **Registration:** Ensure `logAudit('USER_REGISTERED')` fires on successful signup.
3.  **Access Denied:** Add `logAudit('ACCESS_DENIED')` in the `admin/page.tsx` redirect block.
4.  **Consistency:** Global search and replace `race_result_entered` -> `RACE_RESULTS_SUBMITTED` (uppercase) to match specs.

---

# EXECUTE
Please begin with Batch 1. Confirm completion before moving to Batch 2.

---

## BATCH 5: CASE SENSITIVITY FIXES (Critical Data Display Bug)
**Target:** `results/page.tsx`, `standings/page.tsx`, `delete-scores/route.ts`
**Defect:** DEF-041, DEF-042, DEF-044 (from CrossCheck audit 2026-01-22)

**Context:**
Scores are stored with lowercase `raceId` (e.g., `australian-grand-prix-gp`) via `createRaceResultDocId()` in `calculate-scores/route.ts:52`. However, UI pages generate mixed-case IDs (e.g., `Australian-Grand-Prix-GP`) from `race.name.replace(/\s+/g, '-')`. Firestore is case-sensitive, so queries return 0 results despite data existing.

**Root Cause:** `calculate-scores/route.ts:52` uses `.toLowerCase()` when creating score raceIds, but UI pages don't lowercase when querying.

**Action:**
1.  **Fix Results Page (`results/page.tsx:278`):**
    Change: `const scoreRaceId = selectedRaceId;`
    To: `const scoreRaceId = selectedRaceId.toLowerCase();`

2.  **Fix Standings Page (`standings/page.tsx:153-155`):**
    Change:
    ```javascript
    const baseRaceId = race.name.replace(/\s+/g, '-');
    const sprintRaceId = race.hasSprint ? `${baseRaceId}-Sprint` : null;
    const gpRaceId = `${baseRaceId}-GP`;
    ```
    To:
    ```javascript
    const baseRaceId = race.name.replace(/\s+/g, '-').toLowerCase();
    const sprintRaceId = race.hasSprint ? `${baseRaceId}-sprint` : null;
    const gpRaceId = `${baseRaceId}-gp`;
    ```

3.  **Fix Delete Scores API (`delete-scores/route.ts:15-20`):**
    Add `.toLowerCase()` to the `normalizeRaceId` function:
    ```javascript
    function normalizeRaceId(raceId: string): string {
      let baseName = raceId
        .replace(/\s*-\s*GP$/i, '')
        .replace(/\s*-\s*Sprint$/i, '');
      return baseName.replace(/\s+/g, '-').toLowerCase();  // ADD .toLowerCase()
    }
    ```

---

## BATCH 6: SCALABILITY IMPROVEMENTS (Performance)
**Target:** `firebase/provider.tsx`
**Defect:** DEF-046 (from CrossCheck audit 2026-01-22)

**Context:**
Team name uniqueness check reads ALL user documents to check if a name exists. For N users, this downloads N documents.

**Action:**
1.  **Consider adding a `teamName_lowercase` indexed field** to users collection and query that instead of reading all documents.
2.  Or use a dedicated `teamNames` collection for uniqueness checking.

---

## BATCH 7: TIE-BREAKER FIX (Business Logic)
**Target:** `standings/page.tsx`
**Defect:** DEF-050 (from CrossCheck simulation 2026-01-22)

**Context:**
Standings page uses `index + 1` for rank assignment (line 309). This means tied teams get sequential ranks instead of shared ranks.

**Required Behavior (per BATCH 2 spec):**
- User A: 10 pts -> Rank 1
- User B: 10 pts -> Rank 1 (same as A, tied)
- User C: 8 pts -> Rank 3 (not 2, skips over tie)

**Action:**
1.  **Modify standings calculation** in `standings/page.tsx`:
    ```javascript
    // Before building standings array, track actual ranks with ties
    let currentRank = 1;
    let previousPoints = -1;
    const standingsData: StandingEntry[] = sorted.map(([userId, data], index) => {
      // If points are same as previous, use same rank; otherwise use position
      if (data.newOverall !== previousPoints) {
        currentRank = index + 1;
      }
      previousPoints = data.newOverall;

      return {
        rank: currentRank,  // Now handles ties correctly
        ...
      };
    });
    ```

---

## BATCH 8: LATE JOINER RULE (Business Logic)
**Target:** `firebase/provider.tsx` (signup function)
**Defect:** DEF-051 (from CrossCheck simulation 2026-01-22)

**Context:**
Rules page states: "Any team who joins after the season starts will begin in last place, 5 points behind the current last-place team."
This rule is NOT implemented anywhere in the codebase. Late joiners currently start at 0 points.

**Action:**
1.  **In signup function** (`firebase/provider.tsx`), after creating user:
    - Check if any race results exist (query scores collection)
    - If results exist, calculate starting points: `minTeamScore - 5`
    - Store this as an initial negative score adjustment for the user
2.  **Consider adding a `pointsAdjustment` field** to users collection for late joiner penalties

---

## BATCH 9: FIRESTORE INDEX DEPLOYMENT (Blocking Bug)
**Target:** Firebase Console / CLI
**Defect:** DEF-052 (from user report 2026-01-22)

**Context:**
Submissions page shows "Database index required" error. Indexes are correctly defined in `firestore.indexes.json` but have NOT been deployed to Firestore.

**Action:**
1.  **Run from app directory:**
    ```bash
    cd app
    firebase deploy --only firestore:indexes
    ```
2.  Wait for indexes to build (can take several minutes)
3.  Verify in Firebase Console > Firestore > Indexes that all indexes show "Enabled"

**Indexes Required:**
- predictions (collectionGroup): raceId + teamName
- predictions (collectionGroup): raceId + submittedAt
- predictions (collectionGroup): raceId (fieldOverride for ASCENDING and DESCENDING)

---

## BATCH 10: ERROR LOGGING & ADMIN VIEWER (Observability)
**Target:** `submissions/page.tsx`, `admin/_components/ErrorLogViewer.tsx` (new)
**Defect:** DEF-054, DEF-055 (from user request 2026-01-22)

**Context:**
1. "Database index required" error shows user-friendly message but doesn't log to error_logs collection
2. Admin panel has no way to view error_logs - needs a sub-tab

**Action:**
1.  **Update error handling in submissions/page.tsx:**
    - When index error detected, log to error_logs with correlationId and error code PX-4004
    - Use existing logError() function from firebase-admin

2.  **Create ErrorLogViewer component:**
    ```
    admin/_components/ErrorLogViewer.tsx
    ```
    - Query error_logs collection
    - Display: correlationId, error code, message, timestamp, userId, context
    - Add pagination and filtering by error code
    - Similar UI pattern to AuditLogViewer

3.  **Add tab to admin/page.tsx:**
    - Add "Error Logs" tab alongside existing admin tabs
