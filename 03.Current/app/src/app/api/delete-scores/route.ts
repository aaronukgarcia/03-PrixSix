// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST
// Auth:        Firebase Auth bearer token + isAdmin check
// Reads:       collectionGroup(predictions) x2 (both raceId formats — see GOTCHAS #5)
// Writes:      DELETE predictions (all formats), DELETE race_results/{raceId}, audit_logs
// Errors:      PX-2001 (auth), PX-2003 (admin), PX-1001 (missing raceId)
// Idempotent:  YES — deleting already-deleted docs is a no-op
// Side-effects: Lifts pit lane lock (race_results doc gone → predictions re-open)
// Key gotcha:  Must run TWO collectionGroup queries (raw + normalized raceId) — one format
//              misses carry-forward predictions. See API_DELETE_SCORES-008 for detail.
// ──────────────────────────────────────────────────────────────────
// GUID: API_DELETE_SCORES-000-v06
// @ARCH_CHANGE (SSOT-001): scores collection eliminated. This route now deletes predictions + race_result only.
//   Score documents are no longer written or deleted — scores are computed in real-time from race_results + predictions.
// @SECURITY_FIX: Added cascade deletion for predictions (ADMINCOMP-023).
// @BUG_FIX: GEMINI-AUDIT-132 — predictions query fixed to use collectionGroup + dual-format lookup.
// [Intent] API route that deletes all predictions and the race result document for a given race. Used by admins to undo/re-do scoring.
// [Inbound Trigger] Admin triggers deletion from the admin scoring page (POST request with raceId).
// [Downstream Impact] Removes prediction documents from the predictions subcollections, and the race result from race_results. Standings recalculate on next page load (no scores to delete). Audit log records the deletion.

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

    // *** IMPORTANT — TWO PREDICTION FORMATS EXIST IN FIRESTORE (both must be deleted) ***
    // User-submitted predictions store raceId WITH -GP suffix:  "Australian-Grand-Prix-GP"
    // Carry-forward predictions store raceId WITHOUT -GP suffix: "Australian-Grand-Prix"
    // This is a known, intentional asymmetry — see normalize-race-id.ts for full explanation.
    // We derive both formats here and run dual collectionGroup queries below to catch all docs.
    // (GEMINI-AUDIT-132: this dual-query was the real fix; GEMINI-AUDIT-131: scoring false alarm)
    const normalizedRaceId = normalizeRaceId(raceId); // strips -GP → "Australian-Grand-Prix"

    // GUID: API_DELETE_SCORES-006-v06
    // @ARCH_CHANGE (SSOT-001): Score documents are no longer stored or deleted here.
    //   Scores are computed in real-time from race_results + predictions on every page load.
    // @SECURITY_FIX: Added cascade deletion for predictions (ADMINCOMP-023).
    // [Intent] Queries all prediction documents matching the race, deletes them in a batch
    //   along with the race result document, and writes an audit log entry -- all committed atomically.
    // [Inbound Trigger] After request validation and normalisation.
    // [Downstream Impact] Removes all prediction documents for the race, and the
    //   race_results document. The batch is atomic; either all deletes succeed or none do. Standings
    //   will recompute correctly on next load (no race_results = no scores shown).

    // GUID: API_DELETE_SCORES-008-v04
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
    let predictionsDeleted = 0;

    // GUID: API_DELETE_SCORES-009-v02
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
        predictionsDeleted,
        deletedAt: new Date().toISOString(),
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    // Commit all deletes atomically
    await batch.commit();

    console.log(`[DeleteScores] Deleted ${predictionsDeleted} predictions and race result for race ${raceId}`);

    return NextResponse.json({
      success: true,
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
