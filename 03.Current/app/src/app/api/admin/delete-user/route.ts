// GUID: API_ADMIN_DELETE_USER-000-v04
// @SECURITY_FIX: GEMINI-AUDIT-114 — IDOR / Privilege Escalation fix.
//   Previously: adminUid was taken from the request body and used directly for the admin Firestore
//   lookup with no token verification. An attacker could authenticate as user A but supply admin
//   B's UID in the body to perform admin-level deletions on B's behalf.
//   Fixed: verifyAuthToken() is now called FIRST (before body parsing). The token-verified UID
//   is asserted to match the body adminUid. The Firestore admin privilege check uses verifiedUser.uid
//   (from the token), eliminating the IDOR vector entirely.
// [Intent] Admin API route for deleting a user account — coordinates removal from Firebase Auth, Firestore users/presence collections, and league memberships with full audit logging.
// [Inbound Trigger] POST request from admin UI (UserManagement component) when an admin deletes a user.
// [Downstream Impact] Removes user from Firebase Auth, Firestore users and presence collections, and all league memberUserIds arrays. Writes audit_logs. Irreversible operation.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { z } from 'zod';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_DELETE_USER-001-v03
// [Intent] Zod schema for validating delete request — ensures both userId and adminUid are present and non-empty.
// [Inbound Trigger] Every incoming POST request body is parsed against this schema.
// [Downstream Impact] Rejects malformed requests before any deletion operations occur.
const deleteUserRequestSchema = z.object({
  userId: z.string().min(1),
  adminUid: z.string().min(1),
});

// GUID: API_ADMIN_DELETE_USER-002-v03
// [Intent] POST handler that orchestrates user deletion: validates input, checks admin permissions, prevents self-deletion, removes Auth + Firestore records, cleans up league memberships, and logs audit events.
// [Inbound Trigger] POST /api/admin/delete-user with JSON body containing userId and adminUid.
// [Downstream Impact] Deletes from Firebase Auth, Firestore users and presence collections, removes from leagues.memberUserIds. Writes to audit_logs and error_logs. Partial failure is possible if Auth succeeds but Firestore fails.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // GUID: API_ADMIN_DELETE_USER-002a-v01
    // @SECURITY_FIX: GEMINI-AUDIT-114 — Token verification MUST come before body parsing.
    // [Intent] Verify the Firebase Auth token from the Authorization header. The UID from the
    //          verified token is the authoritative identity — the body adminUid is only accepted
    //          after confirming it matches the token UID.
    // [Inbound Trigger] Every incoming POST request.
    // [Downstream Impact] Returns 401 if token is missing or invalid. Prevents unauthenticated
    //                     deletions and closes the IDOR vector where body adminUid was trusted.
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

    const body = await request.json();
    const parsed = deleteUserRequestSchema.safeParse(body);

    // GUID: API_ADMIN_DELETE_USER-003-v03
    // [Intent] Early return on Zod validation failure — provides field-level errors to the caller.
    // [Inbound Trigger] Request body fails schema validation.
    // [Downstream Impact] Returns 400 with VALIDATION_MISSING_FIELDS error code. No deletion operations occur.
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: parsed.error.flatten().fieldErrors,
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { userId, adminUid } = parsed.data;

    // GUID: API_ADMIN_DELETE_USER-003a-v01
    // @SECURITY_FIX: GEMINI-AUDIT-114 — Token UID must match the body adminUid.
    // [Intent] Confirm the token-verified UID matches the body-supplied adminUid. This prevents
    //          an attacker from authenticating as user A but supplying admin B's UID in the body
    //          to perform deletions under B's identity (IDOR / privilege escalation).
    // [Inbound Trigger] After Zod validation succeeds, before any Firestore operations.
    // [Downstream Impact] Returns 403 if UIDs differ. Log includes both UIDs for audit trail.
    if (verifiedUser.uid !== adminUid) {
      console.warn(
        `[Admin Delete ${correlationId}] Token UID mismatch: token=${verifiedUser.uid}, body adminUid=${adminUid}`
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Admin UID mismatch',
          errorCode: ERRORS.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // GUID: API_ADMIN_DELETE_USER-004-v04
    // @SECURITY_FIX: GEMINI-AUDIT-114 — Admin privilege check now uses verifiedUser.uid (from token),
    //   NOT the body-supplied adminUid. At this point verifiedUser.uid === adminUid is already
    //   confirmed by the mismatch check above, so the lookup is equivalent but the authoritative
    //   source is the token, preventing any residual body-trust.
    // [Intent] Verify the requesting user has admin privileges before allowing deletion.
    // [Inbound Trigger] Every valid POST request — admin check is mandatory.
    // [Downstream Impact] Returns 403 if not admin. Prevents unauthorised account deletion.
    const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied. Admin access required.',
          errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    // GUID: API_ADMIN_DELETE_USER-005-v03
    // [Intent] Safety guard — prevent admins from accidentally deleting their own account.
    // [Inbound Trigger] userId equals adminUid in the request.
    // [Downstream Impact] Returns 400. Preserves the admin account that initiated the request.
    if (userId === adminUid) {
      return NextResponse.json(
        {
          success: false,
          error: 'You cannot delete your own account.',
          errorCode: ERROR_CODES.VALIDATION_INVALID_FORMAT.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_ADMIN_DELETE_USER-006-v03
    // [Intent] Capture user data before deletion for inclusion in the audit log.
    // [Inbound Trigger] All pre-deletion checks have passed.
    // [Downstream Impact] userData is referenced in the audit_logs entry at SEQ 009. If user doc does not exist, audit log records 'unknown'.
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    // GUID: API_ADMIN_DELETE_USER-007-v04
    // [Intent] Delete user from Firebase Auth. If user is already missing from Auth (orphaned Firestore record), proceed with Firestore cleanup only.
    // [Inbound Trigger] User data captured; ready for coordinated deletion.
    // [Downstream Impact] Sets authDeleted flag used by Firestore error handler. If Auth deletion succeeds but Firestore fails, a critical error is logged because the user cannot log in but their data remains. Non-auth/user-not-found errors are re-thrown.
    let authDeleted = false;
    try {
      await auth.deleteUser(userId);
      authDeleted = true;
    } catch (authError: any) {
      // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV
      if (process.env.NODE_ENV !== 'production') { console.error(`[Admin Delete Auth Error ${correlationId}]`, authError); }

      if (authError.code === 'auth/user-not-found') {
        console.warn(`[Admin Delete] User ${userId} not found in Auth, cleaning up Firestore only`);
      } else {
        throw authError;
      }
    }

    // GUID: API_ADMIN_DELETE_USER-008-v04
    // [Intent] Delete Firestore user and presence documents in a batch. Logs a critical error if Auth was already deleted but Firestore cleanup fails (split-brain state).
    // [Inbound Trigger] Auth deletion completed or user was not found in Auth.
    // [Downstream Impact] Removes users/{userId} and presence/{userId}. If batch fails after Auth deletion, error_logs receives a critical entry for manual remediation.
    try {
      const batch = db.batch();
      batch.delete(db.collection('users').doc(userId));
      batch.delete(db.collection('presence').doc(userId));
      await batch.commit();
    } catch (firestoreError: any) {
      // Critical: Auth was deleted but Firestore cleanup failed
      if (authDeleted) {
        const traced = createTracedError(ERRORS.FIRESTORE_WRITE_FAILED, {
          correlationId,
          context: { route: '/api/admin/delete-user', action: 'firestore_cleanup_after_auth_delete', userId, authDeleted: true, critical: true },
          cause: firestoreError instanceof Error ? firestoreError : undefined,
        });
        await logTracedError(traced, db);
      }
      throw firestoreError;
    }

    // GUID: API_ADMIN_DELETE_USER-009-v03
    // [Intent] Remove the deleted user's ID from all league memberUserIds arrays. Best-effort — failure is logged but does not block the response.
    // [Inbound Trigger] Firestore user/presence documents have been deleted.
    // [Downstream Impact] Updates leagues collection. If cleanup fails, orphaned userId remains in league arrays — Consistency Checker should detect this.
    try {
      const leaguesSnapshot = await db.collection('leagues').get();
      const leagueUpdates: Promise<any>[] = [];

      leaguesSnapshot.forEach(leagueDoc => {
        const leagueData = leagueDoc.data();
        if (leagueData.memberUserIds?.includes(userId)) {
          leagueUpdates.push(
            leagueDoc.ref.update({
              memberUserIds: FieldValue.arrayRemove(userId),
              updatedAt: FieldValue.serverTimestamp(),
            })
          );
        }
      });

      await Promise.all(leagueUpdates);
    } catch (leagueError: any) {
      console.warn(`[Admin Delete] Could not clean up league memberships:`, leagueError.message);
    }

    // GUID: API_ADMIN_DELETE_USER-010-v03
    // [Intent] Write an audit log entry recording who deleted whom and the deleted user's details.
    // [Inbound Trigger] Successful completion of all deletion operations.
    // [Downstream Impact] Populates audit_logs for compliance. Provides traceability for deleted accounts.
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'ADMIN_DELETE_USER',
      details: {
        targetUserId: userId,
        deletedEmail: userData?.email || 'unknown',
        deletedTeamName: userData?.teamName || 'unknown',
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: 'User deleted successfully.',
    });

  } catch (error: any) {
    // GUID: API_ADMIN_DELETE_USER-011-v04
    // [Intent] Top-level error handler — catches any unhandled exceptions, logs to error_logs, and returns a safe 500 response with correlation ID.
    // [Inbound Trigger] Any uncaught exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId to client for support reference. Golden Rule #1 compliance.
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
      correlationId,
      context: { route: '/api/admin/delete-user', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      },
      { status: 500 }
    );
  }
}
