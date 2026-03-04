# GOTCHAS.md — Permanent Trap Registry

> Every time a subtle bug bites you, it goes here.
> These are NOT "to fix" — they are "know before you touch".
> Last updated: 2026-03-03

---

## 1. Race ID Asymmetry (DO NOT FIX — GEMINI-AUDIT-131: FALSE ALARM)

**The trap:** `generateRaceId()` and `normalizeRaceId()` produce different IDs for the same race.

```
generateRaceId("Australian Grand Prix", 'gp')  → "Australian-Grand-Prix-GP"   (stored in race_results, score doc IDs)
normalizeRaceId("Australian-Grand-Prix-GP")    → "Australian-Grand-Prix"       (prediction lookup key)
```

**Why it's NOT a bug:** Both sides of every scoring comparison call `normalizeRaceId()` — stored prediction raceIds are normalized on read, and the incoming result raceId is normalized before lookup. They always match.

**Why it must stay asymmetric:** Sprint carry-forward works because GP predictions are stored under `"Chinese-Grand-Prix"` (no `-GP` suffix). The Sprint engine strips `-Sprint` to get `"Chinese-Grand-Prix"` and finds the GP prediction. If you preserved `-GP`, the Sprint lookup would break for every Sprint race.

**See:** `app/src/lib/normalize-race-id.ts` (full AUDIT HISTORY block), `app/src/app/api/calculate-scores/route.ts` lines 142–149.

---

## 2. Scores Survive `race_results` Deletion

**The trap:** An admin deletes a `race_results` document expecting standings to clear. Standings still show the full season.

**Why:** Score documents (`scores/{raceId}_{userId}`) are computed and stored separately. Deleting the source (`race_results`) does NOT cascade to the derived data (`scores`).

**The fix:** Use `/api/delete-scores` route — it atomically deletes `race_results` + the matching score documents + orphaned predictions in a single batch.

**NEVER** delete `race_results` directly via Firestore console without also clearing `scores`.

---

## 3. `_simulate_season.js` Locks the Predictions Page

**The trap:** After running the season simulation script, the predictions page shows "Pit Lane Closed" for ALL races even though qualifying hasn't happened yet.

**Why:** The script populates `race_results` docs for all 24 races. The predictions page checks `race_results` collection for the current race — finding a doc locks it immediately.

**Fix:**
```js
// Inline admin script to wipe all race_results:
const snap = await db.collection('race_results').get();
const batch = db.batch();
snap.docs.forEach(d => batch.delete(d.ref));
await batch.commit();
```

---

## 4. Dashboard vs Predictions Page Disagreement on Pit Lane Status

**The trap:** Dashboard shows "Pit Lane Open" but predictions page shows "Pit Lane Closed" (or vice versa).

**Why:** They use different logic:
- **Dashboard:** `qualifyingTime > now` only — no Firestore check
- **Predictions page:** `!hasResults && qualifyingTime > now` — checks both `race_results` AND qualifying time

**Root cause:** Stale `race_results` document exists for a race whose qualifying is still in the future.

**Fix:** Check `race_results` collection for the race ID. Delete the stale doc if qualifying time hasn't passed.

---

## 5. Two Prediction raceId Formats Exist in Firestore

**The trap:** Deleting predictions for a race — half the docs don't get deleted.

**Why:** User-submitted predictions store raceId **with** `-GP` suffix: `"Australian-Grand-Prix-GP"` (from `generateRaceId()` in `submit-prediction`). Carry-forward predictions store raceId **without** `-GP` suffix: `"Australian-Grand-Prix"` (from `normalizeRaceId()` in `calculate-scores`).

**Fix:** Always run **two** `collectionGroup` queries — one for each format — and merge by document path to prevent double-deletion. See `delete-scores/route.ts` for the reference implementation.

---

## 6. `git ls-files` False Positive

**The trap:** `git ls-files <path> && echo "TRACKED"` — "TRACKED" always prints even when the file isn't tracked.

**Why:** `git ls-files` exits 0 whether or not it found anything. The `&&` only checks the exit code, not the output.

**Correct check:**
```bash
# Check if output is non-empty:
[ -n "$(git ls-files path/to/file)" ] && echo "TRACKED" || echo "NOT TRACKED"
# Or:
git log --all --full-history -- "path/to/file"  # empty = never committed
```

---

## 7. Consistency Checker Reports Land in `consistency_reports`, NOT `error_logs`

**The trap:** Searching `error_logs` for CC report IDs — finds nothing.

**Why:** CC exports to `consistency_reports` collection, keyed by `correlationId` (format: `cc_XXXXXXXXXX_XXXXXXXX`).

**Query:**
```js
db.collection('consistency_reports').where('correlationId', '==', 'cc_xxx_yyy').get()
```

---

## 8. Secondary Team IDs Use `-secondary` Suffix — Can Be Malformed

**The trap:** `memberUserIds` array in the `leagues` collection can contain IDs like `"abc123-secondary"`. These are NOT valid Firestore user doc IDs.

**Why:** Secondary team predictions store a `teamId` of `{userId}-secondary`. These leaked into the leagues membership array during early development.

**Fix:** When cleaning league membership, treat any ID ending in `-secondary` as malformed — strip or drop it.

**See:** Global League cleanup 2026-03-03 — 138 IDs → 37 real players (101 ghosts removed).

---

## 9. `collectionGroup('predictions')` is Intentionally Unbounded in `calculate-scores`

**The trap:** Adding a `.limit()` to the predictions collectionGroup query in `calculate-scores` to "fix" a potential unbounded read warning.

**Why this breaks things:** The scoring engine needs ALL predictions ever submitted to resolve carry-forwards. Truncating the set would silently mis-score any team whose latest prediction lands outside the limit.

**Expected maximum:** ~6,000 docs per season. Safety monitor logs a WARNING if > 10,000.

**See:** `calculate-scores/route.ts` GUID `API_CALCULATE_SCORES-010-v05` for full rationale.

---

## 10. `error_logs` Collection Is Write-Only — Nothing Derives From It

**The trap:** Assuming clearing `error_logs` affects scores, standings, or other computed state.

**It doesn't.** `error_logs` is a pure audit trail. Safe to wipe at any time without side effects.

---

## 11. Bot Crawlers Triggered Firebase SDK Errors (Fixed v1.99.3)

**The trap:** Seeing Firebase SDK errors from unauthenticated sessions — looks like a real auth bug.

**Why:** Bingbot and other crawlers hit app pages (e.g. `/dashboard`). The auth guard is client-side only (`useEffect`) — the HTML shell renders before the redirect fires. Firebase SDK initialises with no auth session → logs errors.

**Fixed:** `isBotCrawler()` filter in `GlobalErrorLogger.tsx` + `robots.txt` default-deny.

---

## 12. `official_teams` Williams Driver Numbers (2026 Season)

**The trap:** Team Lens shows no drivers for Williams because driver numbers are wrong or missing.

**Expected 2026:** Carlos Sainz (#55), Alex Albon (#23).

**Verify:** Check `official_teams/williams` doc in Firestore. The Team Lens joins on `drivers[].number` against OpenF1 `driver_number`.

---

## 13. `APP_LAYOUT-001` Auth Guard Is Client-Side Only

**The trap:** Assuming the auth guard in `(app)/layout.tsx` prevents server-side HTML rendering of protected routes.

**Why it doesn't:** The guard uses `useEffect` — the full HTML shell renders on the server before the client checks auth state and redirects. Bots and crawlers see the page HTML.

**Mitigation:** `robots.txt` blocks all app routes. Do not add server-sensitive data to the initial HTML shell.

---

## 14. Firestore `app-settings/hot-news` Uses `FieldValue.increment(1)`

**The trap:** Reading `refreshCount` as a plain integer immediately after a write — may get stale value.

**Why:** `FieldValue.increment()` is a server-side atomic operation. The local Firestore SDK may not reflect the new value until the next snapshot.

**Pattern:** The `HotNewsFeed` server component re-fetches on each page load — always gets fresh value.
