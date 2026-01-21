import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { F1Drivers } from '@/lib/data';
import { SCORING_POINTS } from '@/lib/scoring-rules';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// Use shared scoring constants
const PRIX_SIX_SCORING = SCORING_POINTS;

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
 * Normalize raceId to match the format used by predictions.
 */
function normalizeRaceId(raceId: string): string {
  let baseName = raceId
    .replace(/\s*-\s*GP$/i, '')
    .replace(/\s*-\s*Sprint$/i, '');
  return baseName.replace(/\s+/g, '-');
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
    const normalizedRaceId = normalizeRaceId(raceName);

    console.log(`[Scoring] Processing race: ${raceName} (normalized: ${normalizedRaceId})`);

    // Get all predictions for this race using collectionGroup query
    let predictionsSnapshot;
    try {
      predictionsSnapshot = await db.collectionGroup('predictions')
        .where('raceId', '==', normalizedRaceId)
        .get();
      console.log(`[Scoring] CollectionGroup query returned ${predictionsSnapshot.size} results`);
    } catch (error: any) {
      console.error(`[Scoring] CollectionGroup query failed:`, error);
      predictionsSnapshot = { size: 0, docs: [] } as any;
    }

    // Fallback to prediction_submissions if no results
    if (predictionsSnapshot.size === 0) {
      console.log(`[Scoring] Falling back to prediction_submissions collection`);
      predictionsSnapshot = await db.collection('prediction_submissions')
        .where('raceId', '==', normalizedRaceId)
        .get();
      console.log(`[Scoring] Fallback query returned ${predictionsSnapshot.size} results`);
    }

    // Get all users to map userId to teamName
    const usersSnapshot = await db.collection('users').get();
    const userMap = new Map<string, string>();
    usersSnapshot.forEach(doc => {
      userMap.set(doc.id, doc.data().teamName || 'Unknown');
    });

    // Calculate scores and prepare batch write
    const batch = db.batch();
    const scores: ScoreWithTeam[] = [];
    const calculatedScores: { userId: string; totalPoints: number; breakdown: string }[] = [];

    predictionsSnapshot.forEach((predDoc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const predData = predDoc.data();

      // Handle both data structures
      let userPredictions: string[] = [];
      let userId: string;

      if (Array.isArray(predData.predictions)) {
        userPredictions = predData.predictions;
        const pathParts = predDoc.ref.path.split('/');
        userId = pathParts.length > 2 ? pathParts[1] : predData.userId;
      } else if (predData.predictions && typeof predData.predictions === 'object') {
        userPredictions = [
          predData.predictions.P1,
          predData.predictions.P2,
          predData.predictions.P3,
          predData.predictions.P4,
          predData.predictions.P5,
          predData.predictions.P6,
        ].filter(Boolean);
        userId = predData.userId;
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

      // Calculate score using Prix Six rules
      userPredictions.forEach((driverId, index) => {
        const driverName = F1Drivers.find(d => d.id === driverId)?.name || driverId;
        const actualPosition = actualResults.indexOf(driverId);

        if (actualPosition === index) {
          totalPoints += PRIX_SIX_SCORING.exactPosition;
          correctCount++;
          breakdownParts.push(`${driverName}+${PRIX_SIX_SCORING.exactPosition}`);
        } else if (actualPosition !== -1) {
          totalPoints += PRIX_SIX_SCORING.wrongPosition;
          correctCount++;
          breakdownParts.push(`${driverName}+${PRIX_SIX_SCORING.wrongPosition}`);
        } else {
          breakdownParts.push(`${driverName}+0`);
        }
      });

      // Bonus for all 6 in top 6
      if (correctCount === 6) {
        totalPoints += PRIX_SIX_SCORING.bonusAll6;
        breakdownParts.push(`BonusAll6+${PRIX_SIX_SCORING.bonusAll6}`);
      }

      calculatedScores.push({ userId, totalPoints, breakdown: breakdownParts.join(', ') });

      // Add to batch
      const scoreDocRef = db.collection('scores').doc(`${normalizedRaceId}_${userId}`);
      batch.set(scoreDocRef, {
        userId,
        raceId: normalizedRaceId,
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
    // Use normalizedRaceId for consistent document ID (removes " - GP" suffix)
    const resultDocId = normalizedRaceId.toLowerCase();
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
