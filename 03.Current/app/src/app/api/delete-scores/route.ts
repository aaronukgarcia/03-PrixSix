// GUID: API_DELETE_SCORES-000-v03
// [Intent] API route that deletes all scores and the race result document for a given race. Used by admins to undo/re-do scoring.
// [Inbound Trigger] Admin triggers score deletion from the admin scoring page (POST request with raceId).
// [Downstream Impact] Removes score documents from the scores collection and the race result from race_results. Standings recalculate on next page load. Audit log records the deletion.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
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
      await logError({
        correlationId,
        error: 'Forbidden: Admin access required',
        context: {
          route: '/api/delete-scores',
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

    // GUID: API_DELETE_SCORES-006-v03
    // [Intent] Queries all score documents matching the normalised raceId, deletes them in a batch along with the race result document, and writes an audit log entry -- all committed atomically.
    // [Inbound Trigger] After request validation and normalisation.
    // [Downstream Impact] Removes all score documents for the race and the race_results document. The batch is atomic; either all deletes succeed or none do. Standings will reflect the removal on next load.
    // Find all scores for this race
    const scoresQuery = await db.collection('scores')
      .where('raceId', '==', normalizedRaceId)
      .get();

    // Create batch delete
    const batch = db.batch();
    let deletedCount = 0;

    scoresQuery.forEach((scoreDoc) => {
      batch.delete(scoreDoc.ref);
      deletedCount++;
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
        scoresDeleted: deletedCount,
        deletedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all deletes atomically
    await batch.commit();

    console.log(`[DeleteScores] Deleted ${deletedCount} scores for race ${raceId}`);

    return NextResponse.json({
      success: true,
      scoresDeleted: deletedCount,
    });

  // GUID: API_DELETE_SCORES-007-v03
  // [Intent] Top-level error handler that catches any unhandled exception during score deletion, logs it with a correlation ID, and returns a 500 response.
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
        route: '/api/delete-scores',
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
