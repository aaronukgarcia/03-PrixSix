// GUID: API_SUBMIT_PREDICTION-000-v03
// [Intent] API route that accepts and stores a user's top-6 driver prediction for a specific race and team. Enforces server-side lockout rules (results exist, qualifying started).
// [Inbound Trigger] User submits a prediction from the predictions page (POST request with userId, teamId, raceId, and six driver picks).
// [Downstream Impact] Writes to users/{userId}/predictions subcollection and audit_logs. Predictions are consumed by the calculate-scores route at scoring time. Lockout enforcement prevents late submissions.

import { NextRequest, NextResponse } from 'next/server';
import { RaceSchedule } from '@/lib/data';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { generateRaceId, generateRaceIdLowercase } from '@/lib/normalize-race-id';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_SUBMIT_PREDICTION-001-v03
// [Intent] Defines the shape of the incoming prediction submission from the user.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] Used for type-safe destructuring; changes here require matching changes in the prediction form component.
interface PredictionRequest {
  userId: string;
  teamId: string;
  teamName: string;
  raceId: string;
  raceName: string;
  predictions: string[];
}

// GUID: API_SUBMIT_PREDICTION-002-v03
// [Intent] Main POST handler that authenticates the user, validates the prediction payload, enforces server-side lockout rules (race results exist or qualifying has started), and atomically writes the prediction and audit log to Firestore.
// [Inbound Trigger] HTTP POST from the predictions page when a user submits or updates their prediction.
// [Downstream Impact] Creates/updates a prediction document in users/{userId}/predictions/{teamId}_{raceId}. This document is read by calculate-scores during scoring. The audit log records the submission for traceability.
export async function POST(request: NextRequest) {
  try {
    // GUID: API_SUBMIT_PREDICTION-003-v03
    // [Intent] Authenticates the request by verifying the Firebase Auth bearer token and confirms the authenticated user matches the userId in the request body (prevents submitting on behalf of another user).
    // [Inbound Trigger] Every POST request to this endpoint.
    // [Downstream Impact] Blocks unauthenticated requests (401) and cross-user submissions (403). Critical security gate.
    // SECURITY: Verify the Firebase Auth token
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorised: Invalid or missing authentication token' },
        { status: 401 }
      );
    }

    const data: PredictionRequest = await request.json();
    const { userId, teamId, teamName, raceId, raceName, predictions } = data;

    // SECURITY: Verify the userId in the request matches the authenticated user
    if (userId !== verifiedUser.uid) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Cannot submit predictions for another user' },
        { status: 403 }
      );
    }

    // SECURITY: Verify team ownership (API-013 fix) - prevent submitting for another user's team
    // User can only submit predictions for their own primary team or secondary teams
    const { db: authDb } = await getFirebaseAdmin();
    const userDoc = await authDb.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const userData = userDoc.data();
    const userTeams = [userData?.teamName]; // Primary team

    // Add secondary teams if they exist
    if (userData?.secondaryTeams && Array.isArray(userData.secondaryTeams)) {
      userTeams.push(...userData.secondaryTeams);
    }

    // Verify the teamId belongs to this user
    if (!userTeams.includes(teamId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Cannot submit predictions for a team you do not own',
          correlationId
        },
        { status: 403 }
      );
    }

    // GUID: API_SUBMIT_PREDICTION-004-v03
    // [Intent] Validates that all required fields are present and that the predictions array contains exactly 6 driver IDs.
    // [Inbound Trigger] After auth verification passes.
    // [Downstream Impact] Prevents malformed predictions from being stored. The scoring engine assumes exactly 6 predictions per team; fewer or more would produce incorrect scores.
    // Validate required fields
    if (!userId || !teamId || !teamName || !raceId || !raceName || !predictions) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate predictions array
    if (!Array.isArray(predictions) || predictions.length !== 6) {
      return NextResponse.json(
        { success: false, error: 'Predictions must be an array of 6 driver IDs' },
        { status: 400 }
      );
    }

    // SECURITY: Use atomic batch write to prevent partial failures
    const { db, FieldValue } = await getFirebaseAdmin();

    // GUID: API_SUBMIT_PREDICTION-005-v03
    // [Intent] Server-side lockout enforcement: checks if race results already exist in Firestore (locks predictions once results are entered) and if qualifying has started based on the RaceSchedule (time-based lockout). Two independent checks provide defence-in-depth.
    // [Inbound Trigger] After payload validation, before writing the prediction.
    // [Downstream Impact] Returns 403 if the pit lane is closed. Without this, users could submit predictions after results are known, undermining the fantasy league's integrity. The race_results check depends on the document ID format from API_CALCULATE_SCORES-005.
    // SERVER-SIDE LOCKOUT ENFORCEMENT 1: Check if race results already exist
    // This locks the race once results are entered (for preseason testing and normal flow)
    const race = RaceSchedule.find(r => r.name === raceName || r.name.replace(/\s+/g, '-') === raceId);
    if (race) {
      // Check both GP and Sprint result IDs (using centralized race ID generation - Golden Rule #3)
      const gpResultId = generateRaceIdLowercase(race.name, 'gp');
      const sprintResultId = generateRaceIdLowercase(race.name, 'sprint');

      // For sprint weekends, check if sprint results exist (locks sprint predictions)
      // For GP predictions, check if GP results exist
      const isSprintPrediction = raceId.toLowerCase().includes('sprint');
      const resultIdToCheck = isSprintPrediction ? sprintResultId : gpResultId;

      const resultDoc = await db.collection('race_results').doc(resultIdToCheck).get();
      if (resultDoc.exists) {
        return NextResponse.json(
          { success: false, error: 'Pit lane is closed. Race results have already been entered.' },
          { status: 403 }
        );
      }

      // SERVER-SIDE LOCKOUT ENFORCEMENT 2: Check if qualifying has started
      const qualifyingTime = new Date(race.qualifyingTime).getTime();
      if (Date.now() > qualifyingTime) {
        return NextResponse.json(
          { success: false, error: 'Pit lane is closed. Predictions cannot be submitted after qualifying starts.' },
          { status: 403 }
        );
      }
    }

    // GUID: API_SUBMIT_PREDICTION-005a-v01
    // [Intent] Normalize raceId to Title-Case format (e.g., "British-Grand-Prix-Sprint") for consistency.
    //          Client may send any case format, so we enforce single source of truth here.
    // [Inbound Trigger] After all validation passes, before storing prediction.
    // [Downstream Impact] Ensures all predictions use consistent Title-Case race IDs, matching the format
    //                     required for scoring and consistency checking.
    const isSprintRace = raceId.toLowerCase().includes('sprint') || raceName.toLowerCase().includes('sprint');
    const baseRaceName = raceName.replace(/\s*-\s*(GP|Sprint)\s*$/i, '').trim();
    const normalizedRaceId = generateRaceId(baseRaceName, isSprintRace ? 'sprint' : 'gp');

    // GUID: API_SUBMIT_PREDICTION-006-v04
    // @CASE_FIX: Now stores normalized Title-Case raceId instead of raw client input (Golden Rule #3).
    // [Intent] Atomically writes the prediction document to the user's predictions subcollection (using merge to allow updates) and creates an audit log entry, committed as a single batch.
    // [Inbound Trigger] After all validation and lockout checks pass.
    // [Downstream Impact] The prediction document (keyed as {teamId}_{normalizedRaceId}) becomes the source of truth for scoring. The merge strategy allows users to update their prediction by re-submitting. The audit log provides a submission trail.
    const batch = db.batch();

    const predictionId = `${teamId}_${normalizedRaceId}`;
    const predictionRef = db.collection('users').doc(userId).collection('predictions').doc(predictionId);
    const auditRef = db.collection('audit_logs').doc();

    // 1. Write prediction to user's subcollection (single source of truth)
    batch.set(predictionRef, {
      id: predictionId,
      userId,
      teamId,
      teamName,
      raceId: normalizedRaceId,
      raceName,
      predictions,
      submittedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // 2. Log audit event
    batch.set(auditRef, {
      userId,
      action: 'prediction_submitted',
      details: {
        teamName,
        raceName,
        raceId: normalizedRaceId,
        predictions,
        submittedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all writes atomically
    await batch.commit();

    return NextResponse.json({ success: true, message: 'Prediction submitted successfully' });

  // GUID: API_SUBMIT_PREDICTION-007-v04
  // [Intent] Top-level error handler that catches any unhandled exception during prediction submission, logs it with a correlation ID, and returns a 500 response.
  // [Inbound Trigger] Any uncaught exception within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response enables support to trace the specific failure.
  } catch (error: any) {
    const correlationId = generateCorrelationId();
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/submit-prediction', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      { success: false, error: traced.definition.message, correlationId: traced.correlationId },
      { status: 500 }
    );
  }
}
