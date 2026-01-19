import { collection, query, where, getDocs, doc, setDoc, deleteDoc, getDoc, collectionGroup } from 'firebase/firestore';
import { F1Drivers } from './data';

// Wacky Racers scoring: fixed rules, no admin configuration needed
const WACKY_RACERS_SCORING = {
  perCorrectDriver: 1,    // +1 for each driver appearing anywhere in Top 6
  bonus5Correct: 3,       // +3 bonus if exactly 5 of 6 predictions correct
  bonus6Correct: 5,       // +5 bonus if all 6 predictions correct
  // Max possible: 6 + 5 = 11 points
};

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

interface Prediction {
  id: string;
  raceId: string;
  userId: string;
  predictions: string[];
}

/**
 * Normalize raceId to match the format used by predictions.
 * Predictions use: raceName.replace(/\s+/g, '-') e.g., "Australian-Grand-Prix"
 * Admin results use: "Australian Grand Prix - GP" which needs to be converted
 */
function normalizeRaceId(raceId: string): string {
  // Remove " - GP" or " - Sprint" suffix if present
  let baseName = raceId
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '');

  // Convert to dash-separated format (no lowercase - predictions don't use lowercase)
  return baseName.replace(/\s+/g, '-');
}

/**
 * Calculate scores for a specific race based on Wacky Racers rules:
 * - +1 point per driver appearing anywhere in Top 6 (position doesn't matter)
 * - +3 bonus if exactly 5 of 6 predictions are correct
 * - +5 bonus if all 6 predictions are correct
 * - Max possible: 6 + 5 = 11 points
 */
export async function calculateRaceScores(
  firestore: any,
  raceResult: RaceResult
): Promise<{ userId: string; totalPoints: number; breakdown: string }[]> {
  const actualResults = [
    raceResult.driver1,
    raceResult.driver2,
    raceResult.driver3,
    raceResult.driver4,
    raceResult.driver5,
    raceResult.driver6
  ];

  // Normalize the raceId to match prediction format
  const normalizedRaceId = normalizeRaceId(raceResult.raceId);

  console.log(`[Scoring] Looking for predictions with raceId: "${normalizedRaceId}" (original: "${raceResult.raceId}")`);

  // Get all predictions for this race using collectionGroup query
  let predictionsSnapshot;
  try {
    const predictionsQuery = query(
      collectionGroup(firestore, 'predictions'),
      where('raceId', '==', normalizedRaceId)
    );
    predictionsSnapshot = await getDocs(predictionsQuery);
    console.log(`[Scoring] CollectionGroup query returned ${predictionsSnapshot.size} results`);
  } catch (error: any) {
    console.error(`[Scoring] CollectionGroup query failed:`, error);
    predictionsSnapshot = { size: 0, docs: [], forEach: () => {} } as any;
  }

  // If collectionGroup returned no results, fall back to prediction_submissions
  if (predictionsSnapshot.size === 0) {
    console.log(`[Scoring] Falling back to prediction_submissions collection`);
    const fallbackQuery = query(
      collection(firestore, 'prediction_submissions'),
      where('raceId', '==', normalizedRaceId)
    );
    predictionsSnapshot = await getDocs(fallbackQuery);
    console.log(`[Scoring] Fallback query returned ${predictionsSnapshot.size} results`);
  }

  console.log(`[Scoring] Found ${predictionsSnapshot.size} predictions`);

  const scores: { userId: string; totalPoints: number; breakdown: string }[] = [];

  predictionsSnapshot.forEach((predDoc) => {
    const data = predDoc.data();

    // Handle both data structures:
    // - users/{userId}/predictions: { predictions: [driverId1, driverId2, ...], userId: string }
    // - prediction_submissions: { predictions: { P1: id, P2: id, ... }, userId: string }
    let userPredictions: string[] = [];
    let userId: string;

    if (Array.isArray(data.predictions)) {
      // Standard predictions collection format
      userPredictions = data.predictions;
      // Extract userId from path for subcollection, or use field
      const pathParts = predDoc.ref.path.split('/');
      userId = pathParts.length > 2 ? pathParts[1] : data.userId;
    } else if (data.predictions && typeof data.predictions === 'object') {
      // prediction_submissions format: { P1: id, P2: id, ... }
      userPredictions = [
        data.predictions.P1,
        data.predictions.P2,
        data.predictions.P3,
        data.predictions.P4,
        data.predictions.P5,
        data.predictions.P6,
      ].filter(Boolean);
      userId = data.userId;
    } else {
      console.warn(`[Scoring] Unknown prediction format for doc ${predDoc.id}`);
      return; // Skip this document
    }

    if (!userId) {
      console.warn(`[Scoring] No userId found for prediction ${predDoc.id}`);
      return;
    }

    let correctCount = 0;
    const breakdownParts: string[] = [];

    // Wacky Racers: +1 for each driver that appears anywhere in Top 6
    userPredictions.forEach((driverId, index) => {
      const driverName = F1Drivers.find(d => d.id === driverId)?.name || driverId;

      if (actualResults.includes(driverId)) {
        correctCount++;
        breakdownParts.push(`${driverName} (+${WACKY_RACERS_SCORING.perCorrectDriver})`);
      } else {
        breakdownParts.push(`${driverName} (miss)`);
      }
    });

    // Base points: +1 per correct driver
    let totalPoints = correctCount * WACKY_RACERS_SCORING.perCorrectDriver;

    // Bonus points based on how many correct
    if (correctCount === 5) {
      totalPoints += WACKY_RACERS_SCORING.bonus5Correct;
      breakdownParts.push(`5/6 bonus +${WACKY_RACERS_SCORING.bonus5Correct}`);
    } else if (correctCount === 6) {
      totalPoints += WACKY_RACERS_SCORING.bonus6Correct;
      breakdownParts.push(`6/6 bonus +${WACKY_RACERS_SCORING.bonus6Correct}`);
    }

    scores.push({
      userId,
      totalPoints,
      breakdown: breakdownParts.join(', ')
    });
  });

  return scores;
}

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

/**
 * Update scores collection for a race
 */
export async function updateRaceScores(
  firestore: any,
  raceId: string,
  raceResult: RaceResult
): Promise<UpdateScoresResult> {
  // Calculate scores using Wacky Racers rules (no admin config needed)
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
    await setDoc(scoreDocRef, {
      oduserId: score.userId,
      userId: score.userId,
      raceId: normalizedRaceId,
      totalPoints: score.totalPoints,
      breakdown: score.breakdown
    });

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

/**
 * Delete all scores for a race
 */
export async function deleteRaceScores(firestore: any, raceId: string): Promise<number> {
  // Normalize the raceId to match how scores are stored
  const normalizedRaceId = normalizeRaceId(raceId);

  const scoresQuery = query(
    collection(firestore, 'scores'),
    where('raceId', '==', normalizedRaceId)
  );
  const scoresSnapshot = await getDocs(scoresQuery);

  let deletedCount = 0;
  for (const scoreDoc of scoresSnapshot.docs) {
    await deleteDoc(scoreDoc.ref);
    deletedCount++;
  }

  return deletedCount;
}

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
