import { collection, query, where, getDocs, doc, setDoc, deleteDoc, getDoc, collectionGroup } from 'firebase/firestore';
import { F1Drivers } from './data';

interface ScoringRules {
  exact: number;
  inTop6: number;
  bonus: number;
}

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
 * Calculate scores for a specific race based on results and predictions
 */
export async function calculateRaceScores(
  firestore: any,
  raceResult: RaceResult,
  scoringRules: ScoringRules
): Promise<{ userId: string; totalPoints: number; breakdown: string }[]> {
  const actualResults = [
    raceResult.driver1,
    raceResult.driver2,
    raceResult.driver3,
    raceResult.driver4,
    raceResult.driver5,
    raceResult.driver6
  ];

  // Get all predictions for this race using collectionGroup query
  const predictionsQuery = query(
    collectionGroup(firestore, 'predictions'),
    where('raceId', '==', raceResult.raceId)
  );
  const predictionsSnapshot = await getDocs(predictionsQuery);

  const scores: { userId: string; totalPoints: number; breakdown: string }[] = [];

  predictionsSnapshot.forEach((predDoc) => {
    const prediction = predDoc.data() as Prediction;
    const userPredictions = prediction.predictions || [];

    // Extract userId from the document path (users/{userId}/predictions/{predId})
    const pathParts = predDoc.ref.path.split('/');
    const userId = pathParts[1]; // users/[userId]/predictions/...

    let exactMatches = 0;
    let inTop6Matches = 0;
    const breakdownParts: string[] = [];

    userPredictions.forEach((driverId, index) => {
      const driverName = F1Drivers.find(d => d.id === driverId)?.name || driverId;

      if (driverId === actualResults[index]) {
        // Exact position match
        exactMatches++;
        breakdownParts.push(`P${index + 1}: ${driverName} (exact +${scoringRules.exact})`);
      } else if (actualResults.includes(driverId)) {
        // Driver in top 6 but wrong position
        inTop6Matches++;
        breakdownParts.push(`P${index + 1}: ${driverName} (in top 6 +${scoringRules.inTop6})`);
      } else {
        breakdownParts.push(`P${index + 1}: ${driverName} (miss)`);
      }
    });

    let totalPoints = (exactMatches * scoringRules.exact) + (inTop6Matches * scoringRules.inTop6);

    // Bonus for all 6 drivers correct (regardless of position)
    const allDriversCorrect = userPredictions.every(d => actualResults.includes(d));
    if (allDriversCorrect && userPredictions.length === 6) {
      totalPoints += scoringRules.bonus;
      breakdownParts.push(`All 6 bonus +${scoringRules.bonus}`);
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
  // Get scoring rules
  const scoringDocRef = doc(firestore, 'admin_configuration', 'scoring');
  const scoringDoc = await getDoc(scoringDocRef);
  const scoringRules: ScoringRules = scoringDoc.exists()
    ? scoringDoc.data() as ScoringRules
    : { exact: 5, inTop6: 3, bonus: 10 };

  // Calculate scores
  const calculatedScores = await calculateRaceScores(firestore, raceResult, scoringRules);

  // Get all users to map userId to teamName
  const usersSnapshot = await getDocs(collection(firestore, 'users'));
  const userMap = new Map<string, string>();
  usersSnapshot.forEach(doc => {
    userMap.set(doc.id, doc.data().teamName || 'Unknown');
  });

  // Write scores to Firestore and build scores list for email
  const scores: ScoreWithTeam[] = [];
  for (const score of calculatedScores) {
    const scoreDocRef = doc(firestore, 'scores', `${raceId}_${score.userId}`);
    await setDoc(scoreDocRef, {
      userId: score.userId,
      raceId: raceId,
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

  // Build standings array
  const standings: StandingEntry[] = Array.from(userTotals.entries())
    .map(([userId, totalPoints]) => ({
      teamName: userMap.get(userId) || 'Unknown',
      totalPoints,
      rank: 0,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

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
  const scoresQuery = query(
    collection(firestore, 'scores'),
    where('raceId', '==', raceId)
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
