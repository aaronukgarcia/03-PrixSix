import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { F1Drivers } from '@/lib/data';
import { SCORING_POINTS, calculateDriverPoints } from '@/lib/scoring-rules';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

interface RaceResultRequest {
  raceId: string;
  raceName: string;
  driver1: string;
  driver2: string;
  driver3: string;
  driver4: string;
  driver5: string;
  driver6: string;
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

/**
 * Normalize raceId to match the format used by predictions (base race name only).
 */
function normalizeRaceIdForPredictions(raceId: string): string {
  let baseName = raceId
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '');
  return baseName.replace(/\s+/g, '-');
}

/**
 * Create document ID for race results - preserves GP/Sprint distinction.
 * Sprint races get "-sprint" suffix, GP races get "-gp" suffix.
 */
function createRaceResultDocId(raceName: string): string {
  const isSprint = /\s*-\s*Sprint$/i.test(raceName);
  const baseName = raceName
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

  return isSprint ? `${baseName}-sprint` : `${baseName}-gp`;
}

export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // SECURITY: Verify the Firebase Auth token
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorised: Invalid or missing authentication token' },
        { status: 401 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    // SECURITY: Verify the user is an admin
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      await logError({
        correlationId,
        error: 'Forbidden: Admin access required',
        context: {
          route: '/api/calculate-scores',
          action: 'POST',
          userId: verifiedUser.uid,
          additionalInfo: { reason: 'non_admin_attempt' },
        },
      });
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const data: RaceResultRequest = await request.json();
    const { raceId, raceName, driver1, driver2, driver3, driver4, driver5, driver6 } = data;

    // Validate required fields
    if (!raceId || !raceName || !driver1 || !driver2 || !driver3 || !driver4 || !driver5 || !driver6) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const actualResults = [driver1, driver2, driver3, driver4, driver5, driver6];
    const normalizedRaceId = normalizeRaceIdForPredictions(raceName);
    const resultDocId = createRaceResultDocId(raceName);

    console.log(`[Scoring] Processing race: ${raceName} (predictions: ${normalizedRaceId}, result doc: ${resultDocId})`);

    // Get all users FIRST to map userId/teamId to teamName
    // This is needed to identify secondary team predictions
    const usersSnapshot = await db.collection('users').get();
    const userMap = new Map<string, string>();
    const userSecondaryTeamNames = new Map<string, string>(); // userId -> secondaryTeamName

    usersSnapshot.forEach(doc => {
      const data = doc.data();
      // Primary team
      userMap.set(doc.id, data.teamName || 'Unknown');
      // Secondary team (if exists)
      if (data.secondaryTeamName) {
        userMap.set(`${doc.id}-secondary`, data.secondaryTeamName);
        userSecondaryTeamNames.set(doc.id, data.secondaryTeamName);
      }
    });

    // Get ALL predictions - predictions carry forward all season
    // For each team: use race-specific prediction if exists, otherwise latest previous prediction
    let allPredictionsSnapshot;
    try {
      allPredictionsSnapshot = await db.collectionGroup('predictions').get();
      console.log(`[Scoring] CollectionGroup query returned ${allPredictionsSnapshot.size} total predictions`);
    } catch (error: any) {
      console.error(`[Scoring] CollectionGroup query failed:`, error);
      allPredictionsSnapshot = { size: 0, docs: [] } as any;
    }

    // Build map of all predictions per team, organised by race
    // Key: teamId (e.g., "userId" or "userId-secondary")
    // Value: Map of raceId -> { predictions, timestamp, teamName }
    const teamPredictionsByRace = new Map<string, Map<string, { predictions: string[]; timestamp: Date; teamName?: string }>>();

    allPredictionsSnapshot.forEach((predDoc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const predData = predDoc.data();
      if (!Array.isArray(predData.predictions) || predData.predictions.length !== 6) {
        return; // Skip invalid predictions
      }

      // Path is users/{userId}/predictions/{predId}
      const pathParts = predDoc.ref.path.split('/');
      const userId = pathParts[1];

      // Determine teamId - either from teamId field or by checking if teamName matches secondary team
      let teamId: string;
      if (predData.teamId) {
        teamId = predData.teamId;
      } else {
        // Check if this prediction's teamName matches the user's secondary team name
        const userSecondaryTeam = userSecondaryTeamNames.get(userId);
        if (userSecondaryTeam && predData.teamName === userSecondaryTeam) {
          teamId = `${userId}-secondary`;
        } else {
          teamId = userId;
        }
      }

      const timestamp = predData.submittedAt?.toDate?.() || predData.createdAt?.toDate?.() || new Date(0);

      // Normalise the prediction's raceId for comparison
      const predRaceId = predData.raceId ? normalizeRaceIdForPredictions(predData.raceId) : null;

      // Get or create the team's prediction map
      if (!teamPredictionsByRace.has(teamId)) {
        teamPredictionsByRace.set(teamId, new Map());
      }
      const teamRaces = teamPredictionsByRace.get(teamId)!;

      // Store prediction keyed by normalised raceId (or 'unknown' if missing)
      const raceKey = predRaceId || 'unknown';
      const existing = teamRaces.get(raceKey);

      // Keep only the latest prediction for each team+race combination
      if (!existing || timestamp > existing.timestamp) {
        teamRaces.set(raceKey, {
          predictions: predData.predictions,
          timestamp,
          teamName: predData.teamName,
        });
      }
    });

    // Now resolve which prediction to use for each team for THIS race
    // Priority: 1) Prediction for this specific race, 2) Latest prediction from any previous race
    const latestPredictions = new Map<string, { predictions: string[]; timestamp: Date; teamName?: string }>();

    teamPredictionsByRace.forEach((raceMap, teamId) => {
      // First, check if there's a prediction for the specific race being scored
      if (raceMap.has(normalizedRaceId)) {
        const racePrediction = raceMap.get(normalizedRaceId)!;
        latestPredictions.set(teamId, racePrediction);
        console.log(`[Scoring] Team ${teamId}: Using race-specific prediction for ${normalizedRaceId}`);
        return;
      }

      // No race-specific prediction - fall back to the latest prediction from any race
      let latestPrediction: { predictions: string[]; timestamp: Date; teamName?: string } | null = null;

      raceMap.forEach((pred, predRaceId) => {
        if (!latestPrediction || pred.timestamp > latestPrediction.timestamp) {
          latestPrediction = pred;
        }
      });

      if (latestPrediction) {
        latestPredictions.set(teamId, latestPrediction);
        console.log(`[Scoring] Team ${teamId}: No prediction for ${normalizedRaceId}, using carry-forward from previous race`);
      }
    });

    console.log(`[Scoring] Found ${latestPredictions.size} teams with predictions to score (including carry-forwards)`);

    // Convert to snapshot-like format for compatibility with existing scoring code
    const predictionsSnapshot = {
      size: latestPredictions.size,
      docs: Array.from(latestPredictions.entries()).map(([teamId, data]) => ({
        id: teamId,
        data: () => ({
          predictions: data.predictions,
          teamId: teamId,
          teamName: data.teamName,
        }),
        ref: { path: `virtual/${teamId}` },
      })),
      forEach: function(callback: (doc: any) => void) {
        this.docs.forEach(callback);
      },
    };

    // Calculate scores and prepare batch write
    const batch = db.batch();
    const scores: ScoreWithTeam[] = [];
    const calculatedScores: { userId: string; totalPoints: number; breakdown: string }[] = [];

    predictionsSnapshot.forEach((predDoc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const predData = predDoc.data();

      // Data structure: users/{userId}/predictions with array format
      let userPredictions: string[] = [];
      let userId: string;

      if (Array.isArray(predData.predictions)) {
        userPredictions = predData.predictions;
        // Use teamId to distinguish primary vs secondary teams
        // teamId is either "userId" (primary) or "userId-secondary" (secondary team)
        // Fall back to extracting from path if teamId not present (legacy data)
        if (predData.teamId) {
          userId = predData.teamId;
        } else {
          const pathParts = predDoc.ref.path.split('/');
          userId = pathParts.length > 2 ? pathParts[1] : predData.userId;
        }
      } else {
        console.warn(`[Scoring] Unknown prediction format for doc ${predDoc.id}`);
        return;
      }

      if (!userId) {
        console.warn(`[Scoring] No userId found for prediction ${predDoc.id}`);
        return;
      }

      let totalPoints = 0;
      let correctCount = 0;
      const breakdownParts: string[] = [];

      // Calculate score using Prix Six hybrid rules
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

      // Bonus for all 6 in top 6
      if (correctCount === 6) {
        totalPoints += SCORING_POINTS.bonusAll6;
        breakdownParts.push(`BonusAll6+${SCORING_POINTS.bonusAll6}`);
      }

      calculatedScores.push({ userId, totalPoints, breakdown: breakdownParts.join(', ') });

      // Add to batch - use resultDocId to distinguish Sprint from GP scores
      const scoreDocRef = db.collection('scores').doc(`${resultDocId}_${userId}`);
      batch.set(scoreDocRef, {
        userId,
        raceId: resultDocId, // Store with GP/Sprint distinction
        raceName: raceName,  // Store original display name
        totalPoints,
        breakdown: breakdownParts.join(', '),
        calculatedAt: FieldValue.serverTimestamp(),
      });

      scores.push({
        teamName: userMap.get(userId) || 'Unknown',
        prediction: breakdownParts.join(', '),
        points: totalPoints,
      });
    });

    // Write race result document
    // Use resultDocId which preserves GP/Sprint distinction
    const resultDocRef = db.collection('race_results').doc(resultDocId);
    batch.set(resultDocRef, {
      id: resultDocId,
      raceId: raceName,
      driver1,
      driver2,
      driver3,
      driver4,
      driver5,
      driver6,
      submittedAt: FieldValue.serverTimestamp(),
    });

    // Log audit event
    const auditRef = db.collection('audit_logs').doc();
    batch.set(auditRef, {
      userId: verifiedUser.uid,
      action: 'RACE_RESULTS_SUBMITTED',
      details: {
        raceId: resultDocId,
        raceName,
        result: actualResults.map((d, i) => `P${i + 1}:${d}`).join(', '),
        scoresUpdated: calculatedScores.length,
        submittedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all writes atomically
    await batch.commit();

    console.log(`[Scoring] Successfully calculated ${calculatedScores.length} scores`);

    // Calculate overall standings
    const allScoresSnapshot = await db.collection('scores').get();
    const userTotals = new Map<string, number>();

    allScoresSnapshot.forEach(doc => {
      const scoreData = doc.data();
      const userId = scoreData.userId;
      const points = scoreData.totalPoints || 0;
      userTotals.set(userId, (userTotals.get(userId) || 0) + points);
    });

    // Build standings with tie-breaking
    const sortedStandings = Array.from(userTotals.entries())
      .map(([userId, totalPoints]) => ({
        teamName: userMap.get(userId) || 'Unknown',
        totalPoints,
        rank: 0,
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints);

    let currentRank = 1;
    const standings: StandingEntry[] = sortedStandings.map((entry, index) => {
      if (index > 0 && entry.totalPoints < sortedStandings[index - 1].totalPoints) {
        currentRank = index + 1;
      }
      return { ...entry, rank: currentRank };
    });

    return NextResponse.json({
      success: true,
      scoresUpdated: calculatedScores.length,
      scores,
      standings,
    });

  } catch (error: any) {
    let requestData = {};
    try {
      requestData = await request.clone().json();
    } catch {}

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/calculate-scores',
        action: 'POST',
        requestData,
        userAgent: request.headers.get('user-agent') || undefined,
      },
    });

    return NextResponse.json(
      { success: false, error: error.message, correlationId },
      { status: 500 }
    );
  }
}
