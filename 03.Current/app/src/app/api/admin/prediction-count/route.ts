// GUID: API_ADMIN_PREDICTION_COUNT-000-v01
// @SECURITY_FIX: Server-side replacement for unbounded client collectionGroup('predictions') read in ResultsManager (GEMINI-AUDIT-027). Moves credential-bearing Firestore read behind auth+admin gate with a hard cap to prevent Denial of Wallet.
// [Intent] Admin API route that counts unique team predictions for display in the ResultsManager confirmation dialog. Returns the count of unique team entries (primary + secondary) across all user prediction sub-collections.
// [Inbound Trigger] GET request from ResultsManager.tsx when admin selects a race to enter results. Replaces the direct client-side collectionGroup query that previously ran without auth or limits.
// [Downstream Impact] Read-only. Returns { count: number }. No writes. Count is informational only — used to show admin how many teams will be scored. Over-cap warning is included if results are truncated.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_PREDICTION_COUNT-001-v01
// [Intent] Safety cap on the number of prediction documents fetched server-side. Prevents Denial of Wallet billing attacks if the predictions collection grows unexpectedly large. Mirrors the GEMINI-AUDIT-017 limit pattern used in ConsistencyChecker.
// [Inbound Trigger] Applied to every collectionGroup query in this route.
// [Downstream Impact] If the real count exceeds this cap, a capped:true flag is returned so the caller can display an appropriate warning. Does NOT affect scoring — calculate-scores has its own unbounded server-side read which is acceptable.
const PREDICTION_FETCH_CAP = 2000;

// GUID: API_ADMIN_PREDICTION_COUNT-002-v01
// [Intent] GET handler: authenticates the caller, verifies admin status, fetches up to PREDICTION_FETCH_CAP prediction documents server-side, counts unique team entries, and returns the count. Previously this query ran directly from the browser client without any limit or auth gate.
// [Inbound Trigger] GET /api/admin/prediction-count — called by ResultsManager when a race is selected.
// [Downstream Impact] Returns { success: true, count: number, capped: boolean }. On auth failure returns 401/403. On error returns 500 with correlationId.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_ADMIN_PREDICTION_COUNT-003-v01
    // [Intent] Authenticate and authorise the request. Only admin users may read the aggregate prediction count. This replaces the previous unauthenticated client-side collectionGroup read.
    // [Inbound Trigger] Every GET request to this endpoint.
    // [Downstream Impact] Rejects unauthenticated or non-admin callers with 401/403 before any Firestore reads occur.
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: ERRORS.AUTH_INVALID_TOKEN.message, errorCode: ERRORS.AUTH_INVALID_TOKEN.code, correlationId },
        { status: 401 }
      );
    }

    const { db } = await getFirebaseAdmin();

    // SECURITY: Verify the user is an admin
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      const traced = createTracedError(ERRORS.AUTH_ADMIN_REQUIRED, {
        correlationId,
        context: { route: '/api/admin/prediction-count', action: 'GET', userId: verifiedUser.uid, reason: 'non_admin_attempt' },
      });
      await logTracedError(traced, db);
      return NextResponse.json(
        { success: false, error: traced.definition.message },
        { status: 403 }
      );
    }

    // GUID: API_ADMIN_PREDICTION_COUNT-004-v01
    // [Intent] Fetch prediction documents server-side with a hard cap (PREDICTION_FETCH_CAP) to prevent unbounded reads. Count unique team entries (primary and secondary) by building a Set of "{userId}_{teamName}" keys.
    // [Inbound Trigger] After admin auth confirmed.
    // [Downstream Impact] Returns count and capped flag. The capped flag is informational — it indicates the count may be an undercount if more predictions exist than the cap. The actual scoring in /api/calculate-scores uses its own full read which is acceptable for an admin-privileged server-side operation.
    // Safety cap to prevent unbounded reads (GEMINI-AUDIT-017 pattern)
    const predictionsSnap = await db
      .collectionGroup('predictions')
      .limit(PREDICTION_FETCH_CAP)
      .get();

    const capped = predictionsSnap.size >= PREDICTION_FETCH_CAP;
    if (capped) {
      console.warn(`[prediction-count] Hit fetch cap of ${PREDICTION_FETCH_CAP} — count may be an undercount (GEMINI-AUDIT-027)`);
    }

    // Count unique teams: each user can have a primary team and an optional secondary team
    // Key format: "{userId}_{teamName}" to uniquely identify each team entry
    const uniqueTeams = new Set<string>();
    predictionsSnap.docs.forEach(doc => {
      // Path: users/{userId}/predictions/{predId}
      const pathParts = doc.ref.path.split('/');
      const userId = pathParts[1];
      const teamName = doc.data().teamName;
      uniqueTeams.add(`${userId}_${teamName || 'primary'}`);
    });

    return NextResponse.json({
      success: true,
      count: uniqueTeams.size,
      capped,
    });

  // GUID: API_ADMIN_PREDICTION_COUNT-005-v01
  // [Intent] Top-level error handler — catches any unhandled exception, logs with correlation ID, and returns a safe 500 with correlationId for support tracing (Golden Rule #1 compliance).
  // [Inbound Trigger] Any uncaught exception in the GET handler.
  // [Downstream Impact] Writes to error_logs. Caller receives a safe error message and correlationId. ResultsManager falls back to displaying 0 teams if this endpoint fails.
  } catch (error: any) {
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.FIRESTORE_READ_FAILED, {
      correlationId,
      context: { route: '/api/admin/prediction-count', action: 'GET' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      { success: false, error: traced.definition.message, correlationId: traced.correlationId },
      { status: 500 }
    );
  }
}
