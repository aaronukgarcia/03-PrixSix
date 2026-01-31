// GUID: LIB_NORMALIZE_RACE_ID-000-v03
// [Intent] Single source of truth for race ID normalisation across the entire application.
//   Exports two functions: normalizeRaceId() for canonical formatting (preserves case) and
//   normalizeRaceIdForComparison() for cross-collection matching (lowercased). This eliminates
//   duplicated normalisation logic in scoring.ts, consistency.ts, calculate-scores/route.ts,
//   delete-scores/route.ts, and ResultsManager.tsx (Golden Rule #3: no duplicated logic).
// [Inbound Trigger] Imported by any module that needs to normalise race IDs for storage or comparison.
// [Downstream Impact] Changing normalisation logic here affects all race ID lookups across the app.
//   All consumers must be tested when this changes. See dependencies in code.json.

/**
 * Normalize a raceId to canonical dash-separated format.
 * Strips trailing " - GP" and " - Sprint" suffixes, replaces spaces with hyphens.
 * Does NOT lowercase -- predictions store race IDs with original casing.
 *
 * @example normalizeRaceId("Australian Grand Prix - GP") => "Australian-Grand-Prix"
 * @example normalizeRaceId("Chinese Grand Prix - Sprint") => "Chinese-Grand-Prix"
 * @example normalizeRaceId("Monaco-Grand-Prix") => "Monaco-Grand-Prix"
 */
export function normalizeRaceId(raceId: string): string {
  return raceId
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '')
    .replace(/\s+/g, '-');
}

/**
 * Normalize a raceId for cross-collection comparison (lowercased).
 * Use this when comparing race IDs across collections that may store them
 * in different casing (e.g., consistency checker matching predictions to results).
 *
 * @example normalizeRaceIdForComparison("Australian Grand Prix - GP") => "australian-grand-prix"
 */
export function normalizeRaceIdForComparison(raceId: string): string {
  return normalizeRaceId(raceId).toLowerCase();
}
