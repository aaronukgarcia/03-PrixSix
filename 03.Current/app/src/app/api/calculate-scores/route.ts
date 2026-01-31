// GUID: API_CALCULATE_SCORES-000-v03
// [Intent] API route that calculates race scores for all teams based on submitted race results and team predictions. Core scoring engine for the Prix Six fantasy league.
// [Inbound Trigger] Admin submits race results via the admin scoring page (POST request with top-6 driver finishing order).
// [Downstream Impact] Writes to scores, race_results, and audit_logs collections. Creates carry-forward prediction documents. Feeds the standings page and all downstream score displays.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { F1Drivers } from '@/lib/data';
import { SCORING_POINTS, calculateDriverPoints } from '@/lib/scoring-rules';
import { normalizeRaceId } from '@/lib/normalize-race-id';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_CALCULATE_SCORES-001-v03
// [Intent] Defines the shape of the incoming race result submission from the admin.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] Used for type-safe destructuring of the request payload; changes here require matching changes in the admin scoring form.
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

// GUID: API_CALCULATE_SCORES-002-v03
// [Intent] Represents a single team's score result for the API response.
// [Inbound Trigger] Populated during the scoring loop for each team.
// [Downstream Impact] Returned in the JSON response; consumed by the admin UI to display per-team score breakdowns.
interface ScoreWithTeam {
  teamName: string;
  prediction: string;
  points: number;
}

// GUID: API_CALCULATE_SCORES-003-v03
// [Intent] Represents a ranked entry in the overall standings returned by the API.
// [Inbound Trigger] Built after all scores are calculated and aggregated.
// [Downstream Impact] Returned in the JSON response; consumed by the admin UI to show updated league standings after scoring.
interface StandingEntry {
  rank: number;
  teamName: string;
  totalPoints: number;
}

// GUID: API_CALCULATE_SCORES-004-v04
// @TECH_DEBT: Local normalizeRaceIdForPredictions replaced with shared normalizeRaceId import (Golden Rule #3).
// [Intent] Race ID normalisation is now handled by the shared normalizeRaceId() utility.
// [Inbound Trigger] n/a -- import at top of file.
// [Downstream Impact] See LIB_NORMALIZE_RACE_ID-000 for normalisation logic.
const normalizeRaceIdForPredictions = normalizeRaceId;

// GUID: API_CALCULATE_SCORES-005-v03
// [Intent] Creates a Firestore document ID for race results that preserves GP vs Sprint distinction (e.g. "australia-gp" or "australia-sprint").
// [Inbound Trigger] Called once per scoring request to determine where to store the race result and score documents.
// [Downstream Impact] Score documents use this ID as a prefix. The delete-scores route and results display pages depend on this format. Changes here break score lookups and deletion.
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

// GUID: API_CALCULATE_SCORES-006-v03
// [Intent] Main POST handler that orchestrates the entire scoring pipeline: auth check, admin verification, prediction resolution (including carry-forwards), score calculation, batch write of scores/results/audit, and standings aggregation.
// [Inbound Trigger] HTTP POST from the admin scoring page with top-6 race results.
// [Downstream Impact] Writes scores, race_results, carry-forward predictions, and audit_logs to Firestore. Returns per-team scores and updated league standings. This is the most critical write path in the application.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_CALCULATE_SCORES-007-v03
    // [Intent] Authenticates the request by verifying the Firebase Auth bearer token and confirms the user has admin privileges.
    // [Inbound Trigger] Every POST request to this endpoint.
    // [Downstream Impact] Blocks all non-authenticated or non-admin users. If bypassed, any user could submit race results and modify scores.
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

    // GUID: API_CALCULATE_SCORES-008-v03
    // [Intent] Parses and validates the race result request body, ensuring all six driver positions are provided.
    // [Inbound Trigger] After successful auth and admin check.
    // [Downstream Impact] The six driver IDs become the "actual results" against which all predictions are scored. Missing fields cause a 400 error.
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

    // GUID: API_CALCULATE_SCORES-009-v03
    // [Intent] Loads all users to build lookup maps from userId/teamId to team names, including secondary teams, for score attribution.
    // [Inbound Trigger] After request validation succeeds.
    // [Downstream Impact] The userMap is used throughout scoring to resolve team names for display. The userSecondaryTeamNames map enables secondary team prediction matching.
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

    // GUID: API_CALCULATE_SCORES-010-v03
    // [Intent] Fetches all predictions across all users via a collectionGroup query, then organises them by team and race to support the carry-forward resolution logic.
    // [Inbound Trigger] After user maps are built.
    // [Downstream Impact] This is the raw data source for all scoring. If the collectionGroup query fails (e.g. missing index), scoring falls back to an empty set and no scores are calculated.
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

    // GUID: API_CALCULATE_SCORES-011-v03
    // [Intent] Builds a nested map (teamId -> raceId -> prediction) from all prediction documents, keeping only the latest prediction per team per race. Handles both primary and secondary team predictions.
    // [Inbound Trigger] After all predictions are fetched.
    // [Downstream Impact] Feeds into the carry-forward resolution logic (API_CALCULATE_SCORES-012). Incorrect team/race mapping here cascades into wrong scores.
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

    // GUID: API_CALCULATE_SCORES-012-v03
    // [Intent] Resolves each team's effective prediction for the current race by checking for a race-specific prediction first, then falling back to the most recent prediction from any earlier race (carry-forward rule).
    // [Inbound Trigger] After teamPredictionsByRace is fully populated.
    // [Downstream Impact] Produces the definitive latestPredictions map used for scoring. Carry-forward predictions also trigger creation of synthetic prediction documents (API_CALCULATE_SCORES-015).
    // Now resolve which prediction to use for each team for THIS race
    // Priority: 1) Prediction for this specific race, 2) Latest prediction from any previous race
    // Track carry-forwards so we can create prediction documents for them
    const latestPredictions = new Map<string, { predictions: string[]; timestamp: Date; teamName?: string; isCarryForward: boolean }>();

    teamPredictionsByRace.forEach((raceMap, teamId) => {
      // First, check if there's a prediction for the specific race being scored
      if (raceMap.has(normalizedRaceId)) {
        const racePrediction = raceMap.get(normalizedRaceId)!;
        latestPredictions.set(teamId, { ...racePrediction, isCarryForward: false });
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

      if (latestPrediction !== null) {
        // Type assertion needed because TypeScript doesn't track assignments inside forEach
        const pred = latestPrediction as { predictions: string[]; timestamp: Date; teamName?: string };
        latestPredictions.set(teamId, {
          predictions: pred.predictions,
          timestamp: pred.timestamp,
          teamName: pred.teamName,
          isCarryForward: true,
        });
        console.log(`[Scoring] Team ${teamId}: No prediction for ${normalizedRaceId}, using carry-forward from previous race`);
      }
    });

    // Count carry-forwards for logging
    const carryForwardCount = Array.from(latestPredictions.values()).filter(p => p.isCarryForward).length;
    console.log(`[Scoring] Found ${latestPredictions.size} teams with predictions to score (${carryForwardCount} carry-forwards)`);

    // GUID: API_CALCULATE_SCORES-013-v03
    // [Intent] Converts the latestPredictions map into a snapshot-like iterable format to maintain compatibility with the downstream scoring loop which was originally written against Firestore query snapshots.
    // [Inbound Trigger] After carry-forward resolution completes.
    // [Downstream Impact] Consumed by the scoring loop (API_CALCULATE_SCORES-014). If the shape changes, the scoring loop breaks.
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

    // GUID: API_CALCULATE_SCORES-014-v03
    // [Intent] Core scoring loop: iterates over each team's prediction, calculates points per driver using the hybrid position-based scoring system (calculateDriverPoints), applies the all-6 bonus, and prepares batch writes for score documents.
    // [Inbound Trigger] After predictionsSnapshot is built.
    // [Downstream Impact] Writes score documents to the scores collection. Score breakdown strings are stored and displayed on the results page. Changes to scoring logic here directly affect league standings.
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

    // GUID: API_CALCULATE_SCORES-015-v03
    // [Intent] Creates synthetic prediction documents in Firestore for teams whose predictions were carried forward, ensuring the results page can find a prediction document for every scored team on every race.
    // [Inbound Trigger] After the scoring loop completes, for each team flagged as isCarryForward.
    // [Downstream Impact] Results page queries predictions by raceId; without these documents, carry-forward teams would appear to have no prediction for the race.
    // Create prediction documents for carry-forwards so results page can find them
    // This ensures every scored race has a corresponding prediction document per team
    let carryForwardPredictionsCreated = 0;
    latestPredictions.forEach((predData, teamId) => {
      if (predData.isCarryForward) {
        // Extract base userId from teamId (remove "-secondary" suffix if present)
        const isSecondary = teamId.endsWith('-secondary');
        const baseUserId = isSecondary ? teamId.replace(/-secondary$/, '') : teamId;

        // Create prediction document in user's subcollection
        // Document ID format: {teamId}_{normalizedRaceId}
        const predDocId = `${teamId}_${normalizedRaceId}`;
        const predDocRef = db.collection('users').doc(baseUserId).collection('predictions').doc(predDocId);

        batch.set(predDocRef, {
          userId: baseUserId,
          teamId: teamId,
          teamName: predData.teamName || userMap.get(teamId) || 'Unknown',
          raceId: normalizedRaceId,
          raceName: raceName.replace(/\s*-\s*(GP|Sprint)$/i, ''), // Store base race name
          predictions: predData.predictions,
          submittedAt: FieldValue.serverTimestamp(),
          isCarryForward: true, // Mark as system-created carry-forward
        });
        carryForwardPredictionsCreated++;
      }
    });

    if (carryForwardPredictionsCreated > 0) {
      console.log(`[Scoring] Creating ${carryForwardPredictionsCreated} carry-forward prediction documents`);
    }

    // GUID: API_CALCULATE_SCORES-016-v03
    // [Intent] Writes the official race result document to the race_results collection, storing the top-6 finishing order. Also creates an audit log entry for the result submission.
    // [Inbound Trigger] After all score and carry-forward documents are prepared in the batch.
    // [Downstream Impact] The race_results document is used by submit-prediction to enforce pit-lane lockout (no predictions after results exist). The audit log provides an admin activity trail.
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

    // GUID: API_CALCULATE_SCORES-017-v03
    // [Intent] Aggregates all scores across all races to produce updated overall league standings with tie-aware ranking, returned in the API response.
    // [Inbound Trigger] After the batch commit succeeds.
    // [Downstream Impact] The standings array is returned to the admin UI for immediate display. This is a read-time aggregation, not persisted; the standings page performs its own aggregation.
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

  // GUID: API_CALCULATE_SCORES-018-v03
  // [Intent] Top-level error handler that catches any unhandled exception during scoring, logs it with a correlation ID, and returns a 500 response with the correlation ID for user-reportable error tracing.
  // [Inbound Trigger] Any uncaught exception within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response enables support to trace the specific failure.
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
