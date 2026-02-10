// GUID: API_DELETE_SCORES-000-v04
// @SECURITY_FIX: Added cascade deletion for predictions (ADMINCOMP-023).
// [Intent] API route that deletes all scores, predictions, and the race result document for a given race. Used by admins to undo/re-do scoring.
// [Inbound Trigger] Admin triggers score deletion from the admin scoring page (POST request with raceId).
// [Downstream Impact] Removes score documents from the scores collection, prediction documents from the predictions collection, and the race result from race_results. Standings recalculate on next page load. Audit log records the deletion.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { normalizeRaceIdForComparison } from '@/lib/normalize-race-id';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_DELETE_SCORES-001-v03
// [Intent] Defines the shape of the incoming delete request, requiring the race identifier and optional display name.
// [Inbound Trigger] Parsed from request body JSON in the POST handler.
// [Downstream Impact] raceId is used to query and delete score documents; raceName is stored in the audit log for human readability.
interface DeleteScoresRequest {
  raceId: string;
  raceName: string;
}

// GUID: API_DELETE_SCORES-002-v04
// @TECH_DEBT: Local normalizeRaceId replaced with shared normalizeRaceIdForComparison import (Golden Rule #3).
//   Delete-scores uses lowercase comparison since score documents may store raceId in different cases.
// [Intent] Race ID normalisation is now handled by the shared normalizeRaceIdForComparison() utility.
// [Inbound Trigger] n/a -- import at top of file.
// [Downstream Impact] See LIB_NORMALIZE_RACE_ID-000 for normalisation logic.
const normalizeRaceId = normalizeRaceIdForComparison;

// GUID: API_DELETE_SCORES-003-v03
// [Intent] Main POST handler that authenticates the admin, queries all score documents for the specified race, batch-deletes them along with the race result document, and logs an audit event.
// [Inbound Trigger] HTTP POST from the admin scoring page requesting deletion of a race's scores.
// [Downstream Impact] Permanently removes score and race_result documents from Firestore. This enables re-scoring. The submit-prediction lockout is lifted because the race_results document no longer exists.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_DELETE_SCORES-004-v03
    // [Intent] Authenticates the request by verifying the Firebase Auth bearer token and confirms the user has admin privileges before allowing score deletion.
    // [Inbound Trigger] Every POST request to this endpoint.
    // [Downstream Impact] Blocks all non-authenticated or non-admin users. If bypassed, any user could delete race scores.
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
      const traced = createTracedError(ERRORS.AUTH_ADMIN_REQUIRED, {
        correlationId,
        context: { route: '/api/delete-scores', action: 'POST', userId: verifiedUser.uid, reason: 'non_admin_attempt' },
      });
      await logTracedError(traced, db);
      return NextResponse.json(
        { success: false, error: traced.definition.message },
        { status: 403 }
      );
    }

    // GUID: API_DELETE_SCORES-005-v03
    // [Intent] Parses the request body and validates that a raceId is provided, then normalises it to match the stored score format.
    // [Inbound Trigger] After successful auth and admin check.
    // [Downstream Impact] The normalised raceId drives the Firestore query that finds scores to delete. A missing raceId returns 400.
    const data: DeleteScoresRequest = await request.json();
    const { raceId, raceName } = data;

    if (!raceId) {
      return NextResponse.json(
        { success: false, error: 'Missing raceId' },
        { status: 400 }
      );
    }

    const normalizedRaceId = normalizeRaceId(raceId);

    // GUID: API_DELETE_SCORES-006-v04
    // @SECURITY_FIX: Added cascade deletion for predictions (ADMINCOMP-023).
    // [Intent] Queries all score and prediction documents matching the normalised raceId, deletes them in a batch along with the race result document, and writes an audit log entry -- all committed atomically.
    // [Inbound Trigger] After request validation and normalisation.
    // [Downstream Impact] Removes all score documents, all prediction documents for the race, and the race_results document. The batch is atomic; either all deletes succeed or none do. Standings will reflect the removal on next load.
    // Find all scores for this race
    const scoresQuery = await db.collection('scores')
      .where('raceId', '==', normalizedRaceId)
      .get();

    // GUID: API_DELETE_SCORES-008-v01
    // @SECURITY_FIX: Query predictions for cascade deletion (ADMINCOMP-023).
    // [Intent] Find all user predictions for this race to delete them along with scores.
    // [Inbound Trigger] Same batch operation as score deletion.
    // [Downstream Impact] Prevents orphaned predictions after race result deletion.
    // Find all predictions for this race
    const predictionsQuery = await db.collection('predictions')
      .where('raceId', '==', normalizedRaceId)
      .get();

    // Create batch delete
    const batch = db.batch();
    let scoresDeleted = 0;
    let predictionsDeleted = 0;

    // Delete all scores
    scoresQuery.forEach((scoreDoc) => {
      batch.delete(scoreDoc.ref);
      scoresDeleted++;
    });

    // GUID: API_DELETE_SCORES-009-v01
    // @SECURITY_FIX: Delete predictions in same batch (ADMINCOMP-023).
    // [Intent] Remove all user predictions for the race to prevent orphaned data.
    // [Inbound Trigger] Part of atomic batch delete operation.
    // [Downstream Impact] Ensures data integrity - no orphaned predictions remain after race deletion.
    // Delete all predictions
    predictionsQuery.forEach((predictionDoc) => {
      batch.delete(predictionDoc.ref);
      predictionsDeleted++;
    });

    // Delete the race result document
    const resultDocId = raceId;
    const resultDocRef = db.collection('race_results').doc(resultDocId);
    batch.delete(resultDocRef);

    // Log audit event
    const auditRef = db.collection('audit_logs').doc();
    batch.set(auditRef, {
      userId: verifiedUser.uid,
      action: 'RACE_RESULTS_DELETED',
      details: {
        raceId: resultDocId,
        raceName: raceName || raceId,
        scoresDeleted,
        predictionsDeleted,
        deletedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all deletes atomically
    await batch.commit();

    console.log(`[DeleteScores] Deleted ${scoresDeleted} scores and ${predictionsDeleted} predictions for race ${raceId}`);

    return NextResponse.json({
      success: true,
      scoresDeleted,
      predictionsDeleted,
    });

  // GUID: API_DELETE_SCORES-007-v04
  // [Intent] Top-level error handler that catches any unhandled exception during score deletion, logs it with a correlation ID, and returns a 500 response.
  // [Inbound Trigger] Any uncaught exception within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response enables support to trace the specific failure.
  } catch (error: any) {
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/delete-scores', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      { success: false, error: traced.definition.message, correlationId: traced.correlationId },
      { status: 500 }
    );
  }
}
