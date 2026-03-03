// ── CONTRACT ──────────────────────────────────────────────────────
// Method:      POST
// Auth:        Firebase Auth bearer token; must be league owner OR isAdmin
// Reads:       users/{uid} (isAdmin), leagues/{leagueId} (ownership + isGlobal — INSIDE transaction)
// Writes:      DELETE leagues/{leagueId}, audit_logs (both inside same Firestore transaction)
// Errors:      PX-2001 (auth), PX-2002 (permission denied / global protected), PX-1002 (invalid leagueId format), PX-9001 (unknown)
// Idempotent:  NO — re-attempting after deletion returns 404
// Side-effects: All member associations permanently lost
// Key gotcha:  runTransaction (not batch) to eliminate TOCTOU race on isGlobal + ownerId.
//              Double global guard: checks BOTH leagueId === 'global' AND isGlobal field.
//              leagueId is regex-validated before any Firestore call to block path traversal.
// ──────────────────────────────────────────────────────────────────
// GUID: API_LEAGUE_DELETE-000-v02
// [Intent] Server-side API route for deleting a league. Uses Admin SDK to bypass Firestore
//          security rules, enforcing ownership or admin privilege server-side.
//          Resolves GEMINI-002 breakage where Firestore rules restricted client-side delete to
//          admin-only, leaving non-admin owners unable to delete their own leagues.
// [Inbound Trigger] POST from league UI pages when owner confirms league deletion.
// [Downstream Impact] Permanently deletes leagues/{leagueId} document. All member associations lost.
//                     Writes audit log entry atomically (Firestore transaction). Non-global leagues only.
// @RED_TEAM (Wave 13): leagueId regex validated before any Firestore call; runTransaction used instead
//   of batch to eliminate TOCTOU race on isGlobal/ownerId; double global guard (constant + field);
//   audit log inside transaction for guaranteed atomicity.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

export const dynamic = 'force-dynamic';

// Firestore auto-generated IDs: 20 alphanumeric chars. Allow 'global' and custom IDs.
// Regex blocks path traversal (slashes, dots) and overlong inputs before reaching the SDK.
const LEAGUE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
// Hard-coded ID of the protected global league (matches GLOBAL_LEAGUE_ID in lib/types/league.ts)
const GLOBAL_LEAGUE_ID = 'global';

// GUID: API_LEAGUE_DELETE-001-v02
// [Intent] POST handler — authenticates user, validates leagueId format, verifies league ownership
//          or admin status atomically via Firestore transaction, then deletes + audits in one operation.
// [Inbound Trigger] POST with Authorization bearer token + JSON body { leagueId: string }.
// [Downstream Impact] Deletes leagues/{leagueId}. Writes audit_logs entry inside same transaction.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_LEAGUE_DELETE-002-v01
    // [Intent] Authenticate the requesting user via Firebase ID token.
    // [Inbound Trigger] Authorization header extracted from request.
    // [Downstream Impact] Returns 401 if token missing or invalid.
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.AUTH_INVALID_TOKEN.message,
          errorCode: ERRORS.AUTH_INVALID_TOKEN.code,
          correlationId,
        },
        { status: 401 }
      );
    }

    // GUID: API_LEAGUE_DELETE-003-v02
    // [Intent] Validate request body — leagueId must match Firestore ID character set.
    //          Rejects path traversal chars (slashes, dots) before any SDK call.
    // @RED_TEAM (Wave 13): Added LEAGUE_ID_REGEX to prevent path traversal via slash/dot in leagueId.
    // [Inbound Trigger] Request body parsed after auth succeeds.
    // [Downstream Impact] Returns 400 if leagueId missing, empty, or contains invalid characters.
    const body = await request.json();
    const { leagueId } = body;

    if (!leagueId || typeof leagueId !== 'string' || !LEAGUE_ID_REGEX.test(leagueId)) {
      return NextResponse.json(
        {
          success: false,
          error: ERRORS.VALIDATION_INVALID_FORMAT.message,
          errorCode: ERRORS.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();

    // GUID: API_LEAGUE_DELETE-004-v02
    // [Intent] Check user admin status before entering transaction (isAdmin field is protected
    //          by Firestore rules, so TOCTOU risk for this read is negligible).
    // [Inbound Trigger] leagueId format validated.
    // [Downstream Impact] isAdmin used inside transaction for permission check.
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    const isAdmin = userDoc.exists && userDoc.data()?.isAdmin === true;

    // GUID: API_LEAGUE_DELETE-005-v02
    // [Intent] Atomically read league, enforce all business rules, delete league, and write audit log
    //          using a Firestore transaction. Eliminates TOCTOU races on isGlobal and ownerId.
    // @RED_TEAM (Wave 13): runTransaction replaces batch — re-reads league inside transaction so
    //   any isGlobal or ownerId change between validation and deletion is caught atomically.
    //   Audit log write is inside the same transaction (not a sequential await) for guaranteed atomicity.
    // [Inbound Trigger] Auth and format validation passed.
    // [Downstream Impact] League document permanently removed; audit_logs entry created. Both atomic.
    const leagueRef = db.collection('leagues').doc(leagueId);
    let leagueName = leagueId; // fallback for success message

    await db.runTransaction(async (tx) => {
      const leagueDoc = await tx.get(leagueRef);

      if (!leagueDoc.exists) {
        throw Object.assign(new Error('not_found'), { code: 'not_found' });
      }

      const leagueData = leagueDoc.data()!;
      leagueName = leagueData.name || leagueId;

      // GUID: API_LEAGUE_DELETE-006-v02
      // [Intent] Double global guard — checks both the constant ID and the isGlobal field.
      //          Either condition alone is sufficient to block deletion of the global league.
      // @RED_TEAM (Wave 13): Double guard prevents deletion even if isGlobal is temporarily
      //   flipped to false by admin error. Both checks execute inside the transaction.
      if (leagueId === GLOBAL_LEAGUE_ID || leagueData.isGlobal === true) {
        throw Object.assign(new Error('global_protected'), { code: 'global_protected' });
      }

      const isOwner = leagueData.ownerId === verifiedUser.uid;
      if (!isAdmin && !isOwner) {
        throw Object.assign(new Error('permission_denied'), { code: 'permission_denied' });
      }

      // Both delete and audit log inside the same transaction — atomic guarantee.
      tx.delete(leagueRef);

      const auditRef = db.collection('audit_logs').doc();
      tx.set(auditRef, {
        userId: verifiedUser.uid,
        action: 'LEAGUE_DELETED',
        details: {
          leagueId,
          leagueName,
          deletedBy: isAdmin && !isOwner ? 'admin' : 'owner',
          memberCount: (leagueData.memberUserIds || []).length,
        },
        correlationId,
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({
      success: true,
      message: `League "${leagueName}" deleted successfully`,
      correlationId,
    });

  } catch (error: any) {
    // Map transaction-thrown error codes to appropriate HTTP responses
    if (error?.code === 'not_found') {
      return NextResponse.json(
        { success: false, error: ERRORS.RACE_NOT_FOUND.message, errorCode: ERRORS.RACE_NOT_FOUND.code, correlationId },
        { status: 404 }
      );
    }
    if (error?.code === 'global_protected' || error?.code === 'permission_denied') {
      return NextResponse.json(
        { success: false, error: ERRORS.AUTH_PERMISSION_DENIED.message, errorCode: ERRORS.AUTH_PERMISSION_DENIED.code, correlationId },
        { status: 403 }
      );
    }

    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/leagues/delete', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: ERRORS.UNKNOWN_ERROR.message,
        errorCode: ERRORS.UNKNOWN_ERROR.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
