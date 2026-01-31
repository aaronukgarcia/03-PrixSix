// GUID: LIB_SCORING-000-v04
// [Intent] Orchestration module for race score calculation, persistence, and standings
// generation. Reads predictions from Firestore, applies the scoring rules defined in
// scoring-rules.ts, writes score documents back to Firestore, and computes league standings.
// [Inbound Trigger] Called from admin API routes when an admin submits or resumes race results.
// [Downstream Impact] Writes to the 'scores' Firestore collection. Standings computed here
// are returned to the admin UI and used for league table display. Depends on scoring-rules.ts
// for point values and the calculateDriverPoints function.

import { collection, query, where, getDocs, doc, setDoc, deleteDoc, collectionGroup, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { F1Drivers } from './data';
import { SCORING_POINTS, calculateDriverPoints } from './scoring-rules';
import { normalizeRaceId } from './normalize-race-id';

// GUID: LIB_SCORING-001-v04
// [Intent] Define the shape of a race result document containing the top 6 finishing
// drivers keyed by position (driver1 through driver6) plus metadata.
// [Inbound Trigger] Used as a parameter type for calculateRaceScores and updateRaceScores.
// [Downstream Impact] Any change to this interface requires updating all callers that
// construct RaceResult objects (admin scoring API routes).

interface RaceResult {
  id: string;
  raceId: string;
  driver1: string;
  driver2: string;
  driver3: string;
  driver4: string;
  driver5: string;
  driver6: string;
}

// GUID: LIB_SCORING-002-v04
// [Intent] Define the shape of a user prediction document containing the raceId,
// userId, and ordered array of predicted driver IDs.
// [Inbound Trigger] Used for typing within calculateRaceScores when processing
// prediction documents from Firestore.
// [Downstream Impact] Changes require updating Firestore query result handling.

interface Prediction {
  id: string;
  raceId: string;
  userId: string;
  predictions: string[];
}

// GUID: LIB_SCORING-003-v04
// @TECH_DEBT: Local normalizeRaceId replaced with shared import from normalize-race-id.ts (Golden Rule #3).
// [Intent] Race ID normalisation is now handled by the shared normalizeRaceId() utility.
// [Inbound Trigger] n/a -- import at top of file.
// [Downstream Impact] See LIB_NORMALIZE_RACE_ID-000 for normalisation logic.

// GUID: LIB_SCORING-004-v04
// @SECURITY_RISK: Previously silently swallowed collectionGroup failures, masking missing index or permission errors.
// @ERROR_PRONE: Previously accepted null/duplicate drivers without validation.
// [Intent] Core scoring engine: fetches all predictions for a given race from Firestore
// using a collectionGroup query, then iterates each user's prediction array applying
// the hybrid position-based scoring model (exact/1-off/2-off/3+-off) plus the all-6 bonus.
// Returns an array of per-user score objects with total points and human-readable breakdown.
// [Inbound Trigger] Called by updateRaceScores when admin triggers score calculation.
// [Downstream Impact] The returned scores are written to the 'scores' collection by
// updateRaceScores. Breakdown strings are stored and displayed in the admin UI.
// Depends on calculateDriverPoints from scoring-rules.ts and F1Drivers from data.ts.

/**
 * Calculate scores for a specific race based on Prix Six Hybrid rules:
 * - +6 points for exact position
 * - +4 points for 1 position off
 * - +3 points for 2 positions off
 * - +2 points for 3+ positions off (but in top 6)
 * - 0 points if driver not in top 6
 * - +10 bonus if all 6 predictions are in the top 6 (regardless of position)
 * - Max possible: 36 (all exact) + 10 (bonus) = 46 points
 */
export async function calculateRaceScores(
  firestore: any,
  raceResult: RaceResult
): Promise<{ userId: string; totalPoints: number; breakdown: string }[]> {
  const correlationId = `score_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  const actualResults = [
    raceResult.driver1,
    raceResult.driver2,
    raceResult.driver3,
    raceResult.driver4,
    raceResult.driver5,
    raceResult.driver6
  ];

  // Validate race result: no null drivers
  const nullDrivers = actualResults.filter((d, i) => !d);
  if (nullDrivers.length > 0) {
    throw new Error(`[PX-2010] Race result contains ${nullDrivers.length} null/empty driver(s) (Ref: ${correlationId})`);
  }

  // Validate race result: no duplicate drivers
  const driverSet = new Set(actualResults);
  if (driverSet.size !== actualResults.length) {
    throw new Error(`[PX-2011] Race result contains duplicate drivers (Ref: ${correlationId})`);
  }

  // Normalize the raceId to match prediction format
  const normalizedRaceId = normalizeRaceId(raceResult.raceId);

  console.log(`[Scoring] [${correlationId}] Looking for predictions with raceId: "${normalizedRaceId}" (original: "${raceResult.raceId}")`);

  // Get all predictions for this race using collectionGroup query
  // @SECURITY_RISK fix: throw on failure instead of silently returning empty results
  let predictionsSnapshot;
  try {
    const predictionsQuery = query(
      collectionGroup(firestore, 'predictions'),
      where('raceId', '==', normalizedRaceId)
    );
    predictionsSnapshot = await getDocs(predictionsQuery);
    console.log(`[Scoring] [${correlationId}] CollectionGroup query returned ${predictionsSnapshot.size} results`);
  } catch (error: any) {
    console.error(`[Scoring] [${correlationId}] CollectionGroup query failed [PX-4005]:`, error);
    throw new Error(`[PX-4005] CollectionGroup query failed for race "${normalizedRaceId}" (Ref: ${correlationId}): ${error.message}`);
  }

  console.log(`[Scoring] Found ${predictionsSnapshot.size} predictions`);

  const scores: { userId: string; totalPoints: number; breakdown: string }[] = [];

  predictionsSnapshot.forEach((predDoc: QueryDocumentSnapshot<DocumentData>) => {
    const data = predDoc.data();

    // Data structure: users/{userId}/predictions: { predictions: [driverId1, driverId2, ...], userId: string }
    let userPredictions: string[] = [];
    let userId: string;

    if (Array.isArray(data.predictions)) {
      userPredictions = data.predictions;
      // Extract userId from path for subcollection, or use field
      const pathParts = predDoc.ref.path.split('/');
      userId = pathParts.length > 2 ? pathParts[1] : data.userId;
    } else {
      console.warn(`[Scoring] Unknown prediction format for doc ${predDoc.id}`);
      return; // Skip this document
    }

    if (!userId) {
      console.warn(`[Scoring] No userId found for prediction ${predDoc.id}`);
      return;
    }

    let totalPoints = 0;
    let correctCount = 0;
    const breakdownParts: string[] = [];

    // Prix Six Hybrid scoring: check each prediction position
    userPredictions.forEach((driverId, predictedPosition) => {
      const driverName = F1Drivers.find(d => d.id === driverId)?.name || driverId;
      const actualPosition = actualResults.indexOf(driverId);

      // Calculate points using hybrid position-based system
      const points = calculateDriverPoints(predictedPosition, actualPosition);
      totalPoints += points;

      if (actualPosition !== -1) {
        // Driver is in top 6
        correctCount++;
      }

      breakdownParts.push(`${driverName}+${points}`);
    });

    // Bonus: +10 if all 6 predictions are in the top 6
    if (correctCount === 6) {
      totalPoints += SCORING_POINTS.bonusAll6;
      breakdownParts.push(`BonusAll6+${SCORING_POINTS.bonusAll6}`);
    }

    scores.push({
      userId,
      totalPoints,
      breakdown: breakdownParts.join(', ')
    });
  });

  return scores;
}

// GUID: LIB_SCORING-005-v04
// [Intent] Define auxiliary TypeScript interfaces for the score-with-team-name
// shape (used in email/report output), the standings entry shape (rank + team + points),
// and the combined result returned by updateRaceScores.
// [Inbound Trigger] Used as return types by updateRaceScores.
// [Downstream Impact] Consumers of updateRaceScores (admin API routes, email templates)
// depend on these shapes for rendering scores and standings.

interface ScoreWithTeam {
  teamName: string;
  prediction: string;
  points: number;
}

interface StandingEntry {
  rank: number;
  teamName: string;
  totalPoints: number;
}

interface UpdateScoresResult {
  scoresUpdated: number;
  scores: ScoreWithTeam[];
  standings: StandingEntry[];
}

// GUID: LIB_SCORING-006-v04
// @AUDIT_NOTE: Removed `oduserId` typo field that was being written to Firestore alongside `userId`.
// [Intent] End-to-end orchestrator: calculates scores for a race, persists each
// user's score document to the 'scores' collection, then recomputes the full league
// standings across all races. Returns the race scores and updated standings.
// [Inbound Trigger] Called from admin API route when race results are submitted/recalculated.
// [Downstream Impact] Writes score documents (keyed as {raceId}_{userId}) to Firestore.
// Reads the entire 'scores' collection to compute league standings with tie-aware ranking.
// Depends on calculateRaceScores (LIB_SCORING-004) and normalizeRaceId (LIB_NORMALIZE_RACE_ID-000).

/**
 * Update scores collection for a race
 */
export async function updateRaceScores(
  firestore: any,
  raceId: string,
  raceResult: RaceResult
): Promise<UpdateScoresResult> {
  const correlationId = `score_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  // Calculate scores using Prix Six rules
  const calculatedScores = await calculateRaceScores(firestore, raceResult);

  // Use normalized raceId for storing scores (consistent with predictions)
  const normalizedRaceId = normalizeRaceId(raceResult.raceId);

  // Get all users to map userId to teamName
  const usersSnapshot = await getDocs(collection(firestore, 'users'));
  const userMap = new Map<string, string>();
  usersSnapshot.forEach(doc => {
    userMap.set(doc.id, doc.data().teamName || 'Unknown');
  });

  // Write scores to Firestore and build scores list for email
  const scores: ScoreWithTeam[] = [];
  for (const score of calculatedScores) {
    const scoreDocRef = doc(firestore, 'scores', `${normalizedRaceId}_${score.userId}`);
    try {
      await setDoc(scoreDocRef, {
        userId: score.userId,
        raceId: normalizedRaceId,
        totalPoints: score.totalPoints,
        breakdown: score.breakdown
      });
    } catch (error: any) {
      console.error(`[Scoring] [${correlationId}] Failed to write score for user ${score.userId} [PX-5006]:`, error);
      throw new Error(`[PX-5006] Failed to write score for user ${score.userId} (Ref: ${correlationId}): ${error.message}`);
    }

    scores.push({
      teamName: userMap.get(score.userId) || 'Unknown',
      prediction: score.breakdown,
      points: score.totalPoints,
    });
  }

  // Calculate overall standings
  const allScoresSnapshot = await getDocs(collection(firestore, 'scores'));
  const userTotals = new Map<string, number>();

  allScoresSnapshot.forEach(doc => {
    const data = doc.data();
    const userId = data.userId;
    const points = data.totalPoints || 0;
    userTotals.set(userId, (userTotals.get(userId) || 0) + points);
  });

  // Build standings array with proper tie-breaking (shared ranks)
  const sortedStandings = Array.from(userTotals.entries())
    .map(([userId, totalPoints]) => ({
      teamName: userMap.get(userId) || 'Unknown',
      totalPoints,
      rank: 0,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints);

  // Assign ranks with ties: equal points = same rank, next rank skips
  let currentRank = 1;
  const standings: StandingEntry[] = sortedStandings.map((entry, index) => {
    if (index > 0 && entry.totalPoints < sortedStandings[index - 1].totalPoints) {
      currentRank = index + 1; // Skip ranks for ties
    }
    return { ...entry, rank: currentRank };
  });

  return {
    scoresUpdated: calculatedScores.length,
    scores,
    standings,
  };
}

// GUID: LIB_SCORING-007-v04
// [Intent] Delete all score documents for a given race from the 'scores' collection.
// Used when an admin needs to re-score a race or void results.
// [Inbound Trigger] Called from admin API route when race scores are cleared.
// [Downstream Impact] Removes score documents from Firestore. League standings
// will be incorrect until scores are recalculated. Depends on normalizeRaceId
// (LIB_NORMALIZE_RACE_ID-000) for consistent raceId lookup.

/**
 * Delete all scores for a race
 */
export async function deleteRaceScores(firestore: any, raceId: string): Promise<number> {
  const correlationId = `score_del_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  // Normalize the raceId to match how scores are stored
  const normalizedRaceId = normalizeRaceId(raceId);

  const scoresQuery = query(
    collection(firestore, 'scores'),
    where('raceId', '==', normalizedRaceId)
  );
  const scoresSnapshot = await getDocs(scoresQuery);

  let deletedCount = 0;
  for (const scoreDoc of scoresSnapshot.docs) {
    try {
      await deleteDoc(scoreDoc.ref);
      deletedCount++;
    } catch (error: any) {
      console.error(`[Scoring] [${correlationId}] Failed to delete score ${scoreDoc.id} [PX-5007]:`, error);
      throw new Error(`[PX-5007] Failed to delete score ${scoreDoc.id} (Ref: ${correlationId}): ${error.message}`);
    }
  }

  return deletedCount;
}

// GUID: LIB_SCORING-008-v04
// [Intent] Format a RaceResult into a compact display string showing position numbers
// and 3-letter driver abbreviations (e.g. "1-VER, 2-HAM, 3-NOR...") for admin UI
// and email summaries.
// [Inbound Trigger] Called from admin components or API responses that need a
// human-readable race result summary.
// [Downstream Impact] Purely presentational; no data mutation. Depends on F1Drivers
// from data.ts for driver name lookups.

/**
 * Format race result for display (e.g., "1-VER, 2-HAM, 3-NOR...")
 */
export function formatRaceResultSummary(result: RaceResult): string {
  const drivers = [
    result.driver1,
    result.driver2,
    result.driver3,
    result.driver4,
    result.driver5,
    result.driver6
  ];

  return drivers
    .map((driverId, index) => {
      const driver = F1Drivers.find(d => d.id === driverId);
      const shortName = driver?.name?.substring(0, 3).toUpperCase() || driverId.substring(0, 3).toUpperCase();
      return `${index + 1}-${shortName}`;
    })
    .join(', ');
}
