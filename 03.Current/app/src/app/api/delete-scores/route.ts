// GUID: API_DELETE_SCORES-000-v05
// @SECURITY_FIX: Added cascade deletion for predictions (ADMINCOMP-023).
// @BUG_FIX: GEMINI-AUDIT-132 — Fixed two cascade deletion bugs: (1) score query was using
//   normalizeRaceIdForComparison (lowercase) but scores are stored in Title-Case with -GP/-Sprint
//   suffix (e.g., "Australian-Grand-Prix-GP"), so the query always returned 0 scores. Fixed by
//   querying scores with the raw raceId sent from the admin page. (2) predictions query was
//   targeting db.collection('predictions') (top-level) but predictions live in
//   users/{uid}/predictions subcollections — fixed by using db.collectionGroup('predictions').
// [Intent] API route that deletes all scores, predictions, and the race result document for a given race. Used by admins to undo/re-do scoring.
// [Inbound Trigger] Admin triggers score deletion from the admin scoring page (POST request with raceId).
// [Downstream Impact] Removes score documents from the scores collection, prediction documents from the predictions subcollections, and the race result from race_results. Standings recalculate on next page load. Audit log records the deletion.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { normalizeRaceId } from '@/lib/normalize-race-id';

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

// GUID: API_DELETE_SCORES-002-v05
// @BUG_FIX: GEMINI-AUDIT-132 — Replaced incorrect normalizeRaceIdForComparison alias with normalizeRaceId.
//   Scores are stored in Title-Case with full GP/Sprint suffix (e.g., "Australian-Grand-Prix-GP"),
//   so normalizedRaceId is only used for prediction lookup (strips -GP suffix, preserves -Sprint).
//   Score deletion uses the raw raceId from the request, which matches the stored format.
// [Intent] normalizeRaceId() strips the -GP suffix and preserves -Sprint, matching how predictions
//   store their raceId. Scores use the raw raceId directly (Title-Case with -GP/-Sprint suffix).
// [Inbound Trigger] n/a -- import at top of file.
// [Downstream Impact] See LIB_NORMALIZE_RACE_ID-000 for normalisation logic.

// GUID: API_DELETE_SCORES-003-v04
// @BUG_FIX: GEMINI-AUDIT-132 — Fixed score query (uses raw raceId) and prediction query
//   (uses collectionGroup + normalizeRaceId). Both previously silently deleted 0 documents.
// [Intent] Main POST handler that authenticates the admin, queries all score documents for the
//   specified race (by raw raceId), all predictions (via collectionGroup + normalizedRaceId),
//   batch-deletes them along with the race result document, and logs an audit event.
// [Inbound Trigger] HTTP POST from the admin scoring page requesting deletion of a race's scores.
// [Downstream Impact] Permanently removes score documents, prediction subcollection documents, and
//   the race_result document from Firestore. This enables re-scoring. The submit-prediction lockout
//   is lifted because the race_results document no longer exists.
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

    // GUID: API_DELETE_SCORES-005-v04
    // @BUG_FIX: GEMINI-AUDIT-132 — Two IDs are now derived from the incoming raceId:
    //   (1) raw raceId: used for score deletion — scores stored as "Australian-Grand-Prix-GP"
    //   (2) normalizedRaceId: used for prediction lookup — stored as "Australian-Grand-Prix"
    //   (normalizeRaceId strips -GP suffix, preserves -Sprint suffix for sprint races)
    // [Intent] Parses the request body and validates that a raceId is provided, then derives two
    //   normalizations: the raw raceId for score/result deletion and normalizedRaceId for predictions.
    // [Inbound Trigger] After successful auth and admin check.
    // [Downstream Impact] raceId drives scores and race_results deletion; normalizedRaceId drives
    //   the collectionGroup prediction deletion. A missing raceId returns 400.
    const data: DeleteScoresRequest = await request.json();
    const { raceId, raceName } = data;

    if (!raceId) {
      return NextResponse.json(
        { success: false, error: 'Missing raceId' },
        { status: 400 }
      );
    }

    // For prediction lookup: strips -GP suffix, preserves -Sprint (matches stored prediction raceId)
    const normalizedRaceId = normalizeRaceId(raceId);

    // GUID: API_DELETE_SCORES-006-v05
    // @SECURITY_FIX: Added cascade deletion for predictions (ADMINCOMP-023).
    // @BUG_FIX: GEMINI-AUDIT-132 — Score query now uses raw raceId (matches stored Title-Case
    //   "Australian-Grand-Prix-GP" format). Previously used lowercase normalized ID → 0 scores found.
    // [Intent] Queries all score and prediction documents matching the race, deletes them in a batch
    //   along with the race result document, and writes an audit log entry -- all committed atomically.
    // [Inbound Trigger] After request validation and normalisation.
    // [Downstream Impact] Removes all score documents, all prediction documents for the race, and the
    //   race_results document. The batch is atomic; either all deletes succeed or none do. Standings
    //   will reflect the removal on next load.
    // Find all scores for this race (scores stored with raw raceId, e.g. "Australian-Grand-Prix-GP")
    const scoresQuery = await db.collection('scores')
      .where('raceId', '==', raceId)
      .get();

    // GUID: API_DELETE_SCORES-008-v03
    // @SECURITY_FIX: Query predictions for cascade deletion (ADMINCOMP-023).
    // @BUG_FIX: GEMINI-AUDIT-132 — Changed from db.collection('predictions') (top-level, always
    //   returns 0) to db.collectionGroup('predictions') (queries all user subcollections).
    // @BUG_FIX: GEMINI-AUDIT-132 (residual) — Two collectionGroup queries handle both prediction
    //   raceId formats: (1) user-submitted GP predictions store raceId with -GP suffix
    //   ("Australian-Grand-Prix-GP" via generateRaceId in submit-prediction); (2) carry-forward
    //   predictions store raceId without -GP suffix ("Australian-Grand-Prix" via normalizeRaceId
    //   in calculate-scores). Sprint predictions use the same format in both paths.
    //   Merging by document path prevents double-deletion of Sprint predictions.
    // [Intent] Find ALL user predictions for this race across all user subcollections, handling both
    //   raceId storage formats (raw with -GP suffix and normalized without).
    // [Inbound Trigger] Same batch operation as score deletion.
    // [Downstream Impact] Prevents orphaned predictions after race result deletion. Both index entries
    //   in firestore.indexes.json (fieldOverride COLLECTION_GROUP on predictions.raceId) support
    //   these single-field equality queries.
    // Query 1: user-submitted predictions (raceId stored with -GP/-Sprint suffix)
    const predictionsQuery1 = await db.collectionGroup('predictions')
      .where('raceId', '==', raceId)
      .get();
    // Query 2: carry-forward predictions (raceId stored without -GP suffix via normalizeRaceId)
    // Only needed if the formats differ (GP races differ; Sprint races produce same value)
    const predictionsQuery2 = normalizedRaceId !== raceId
      ? await db.collectionGroup('predictions')
          .where('raceId', '==', normalizedRaceId)
          .get()
      : null;
    // Merge by document path to avoid duplicate deletes
    const predictionDocsByPath = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>();
    predictionsQuery1.forEach(doc => predictionDocsByPath.set(doc.ref.path, doc));
    if (predictionsQuery2) {
      predictionsQuery2.forEach(doc => predictionDocsByPath.set(doc.ref.path, doc));
    }

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
    // Delete all predictions (merged from both format queries)
    predictionDocsByPath.forEach((predictionDoc) => {
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
