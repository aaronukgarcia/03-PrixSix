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
 * Strips trailing " - GP" suffix, converts " - Sprint" to "-Sprint" to distinguish Sprint races.
 * Does NOT lowercase -- predictions store race IDs with original casing.
 *
 * @example normalizeRaceId("Australian Grand Prix - GP") => "Australian-Grand-Prix"
 * @example normalizeRaceId("Chinese Grand Prix - Sprint") => "Chinese-Grand-Prix-Sprint"
 * @example normalizeRaceId("Monaco-Grand-Prix") => "Monaco-Grand-Prix"
 */
export function normalizeRaceId(raceId: string): string {
  return raceId
    .replace(/\s*-\s*GP$/i, '')              // Strip " - GP" suffix for main races
    .replace(/\s*-\s*Sprint$/i, '-Sprint')  // Convert " - Sprint" to "-Sprint" to preserve Sprint identifier
    .replace(/\s+/g, '-');                   // Replace all spaces with hyphens
}

/**
 * Normalize a raceId for cross-collection comparison (lowercased).
 * Use this when comparing race IDs across collections that may store them
 * in different casing (e.g., consistency checker matching predictions to results).
 *
 * @example normalizeRaceIdForComparison("Australian Grand Prix - GP") => "australian-grand-prix"
 * @example normalizeRaceIdForComparison("Chinese Grand Prix - Sprint") => "chinese-grand-prix-sprint"
 */
export function normalizeRaceIdForComparison(raceId: string): string {
  return normalizeRaceId(raceId).toLowerCase();
}

/**
 * Generate a race ID from race name (preserves case).
 * Use this to create race IDs for prediction documents or display purposes.
 *
 * @param raceName - Race name from RaceSchedule (e.g., "Australian Grand Prix")
 * @param type - Race type: 'gp' or 'sprint'
 * @returns Race ID with proper casing (e.g., "Australian-Grand-Prix-GP" or "Chinese-Grand-Prix-Sprint")
 *
 * @example generateRaceId("Australian Grand Prix", "gp") => "Australian-Grand-Prix-GP"
 * @example generateRaceId("Chinese Grand Prix", "sprint") => "Chinese-Grand-Prix-Sprint"
 */
export function generateRaceId(raceName: string, type: 'gp' | 'sprint'): string {
  const base = raceName.replace(/\s+/g, '-');
  return type === 'gp' ? `${base}-GP` : `${base}-Sprint`;
}

/**
 * Generate a lowercase race ID from race name (for Firestore document lookup).
 * Use this when querying Firestore collections that store race IDs in lowercase.
 *
 * @param raceName - Race name from RaceSchedule (e.g., "Australian Grand Prix")
 * @param type - Race type: 'gp' or 'sprint'
 * @returns Lowercase race ID (e.g., "australian-grand-prix-gp" or "chinese-grand-prix-sprint")
 *
 * @example generateRaceIdLowercase("Australian Grand Prix", "gp") => "australian-grand-prix-gp"
 * @example generateRaceIdLowercase("Chinese Grand Prix", "sprint") => "chinese-grand-prix-sprint"
 */
export function generateRaceIdLowercase(raceName: string, type: 'gp' | 'sprint'): string {
  return generateRaceId(raceName, type).toLowerCase();
}
