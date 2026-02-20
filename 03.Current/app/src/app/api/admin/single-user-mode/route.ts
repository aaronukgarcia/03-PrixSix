// GUID: API_ADMIN_SINGLE_USER_MODE-000-v02
// @SECURITY_FIX: New authenticated server-side endpoint replacing direct client Firestore writes (GEMINI-AUDIT-025, ADMINCOMP-009).
// [Intent] Admin API route for activating/deactivating Single User Mode. Verifies Firebase Auth token and server-side admin status before executing presence purge or flag operations.
// [Inbound Trigger] POST request from OnlineUsersManager component (activate/deactivate buttons).
// [Downstream Impact] Activate: purges all presence sessions (except admin's own), sets singleUserModeEnabled=true in admin_configuration/global. Deactivate: clears the flag. Both write to audit_logs.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { z } from 'zod';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_SINGLE_USER_MODE-001-v01
// [Intent] Zod schema for strict request body validation — only activate/deactivate actions are permitted.
// [Inbound Trigger] Every incoming POST request body is parsed against this schema before any processing.
// [Downstream Impact] Rejects malformed requests immediately. Adding new actions requires updating this schema.
const singleUserModeRequestSchema = z.object({
  adminUid: z.string().min(1),
  action: z.enum(['activate', 'deactivate']),
  currentSessionId: z.string().optional(),
});

// GUID: API_ADMIN_SINGLE_USER_MODE-002-v01
// [Intent] POST handler — the only supported method. Validates token, verifies admin, executes activate or deactivate.
// [Inbound Trigger] POST /api/admin/single-user-mode from OnlineUsersManager component.
// [Downstream Impact] Writes to admin_configuration/global and optionally purges presence documents. Audit log entry written on every successful operation.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  // GUID: API_ADMIN_SINGLE_USER_MODE-003-v01
  // [Intent] Verify the caller's Firebase ID token to authenticate the request.
  // [Inbound Trigger] Every request must supply a valid Bearer token in the Authorization header.
  // [Downstream Impact] Returns 401 if token is absent or invalid, preventing unauthenticated access.
  const authHeader = request.headers.get('Authorization');
  const verifiedUser = await verifyAuthToken(authHeader);
  if (!verifiedUser) {
    await logError({
      correlationId,
      error: 'Missing or invalid Authorization token on single-user-mode request',
      context: { route: '/api/admin/single-user-mode' },
    });
    return NextResponse.json(
      { success: false, error: ERROR_CODES.AUTH_INVALID_TOKEN.message, errorCode: ERROR_CODES.AUTH_INVALID_TOKEN.code, correlationId },
      { status: 401 }
    );
  }

  let body: z.infer<typeof singleUserModeRequestSchema>;
  try {
    const raw = await request.json();
    body = singleUserModeRequestSchema.parse(raw);
  } catch {
    await logError({
      correlationId,
      error: 'Invalid request body on single-user-mode',
      context: { route: '/api/admin/single-user-mode' },
    });
    return NextResponse.json(
      { success: false, error: 'Invalid request body', errorCode: 'PX-4000', correlationId },
      { status: 400 }
    );
  }

  const { adminUid, action, currentSessionId } = body;

  // GUID: API_ADMIN_SINGLE_USER_MODE-004-v01
  // [Intent] Guard: token UID must match the adminUid in the request body to prevent IDOR.
  // [Inbound Trigger] Checked immediately after token verification and body parsing.
  // [Downstream Impact] Returns 403 if the token UID doesn't match adminUid, closing the IDOR vector.
  if (verifiedUser.uid !== adminUid) {
    await logError({
      correlationId,
      error: `Token UID mismatch on single-user-mode: token=${verifiedUser.uid}, body=${adminUid}`,
      context: { route: '/api/admin/single-user-mode', action },
    });
    return NextResponse.json(
      { success: false, error: ERROR_CODES.AUTH_PERMISSION_DENIED.message, errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code, correlationId },
      { status: 403 }
    );
  }

  try {
    const { db } = await getFirebaseAdmin();

    // GUID: API_ADMIN_SINGLE_USER_MODE-005-v01
    // [Intent] Server-side admin verification — confirms the caller has isAdmin=true in Firestore.
    // [Inbound Trigger] Every request, after token/UID checks pass.
    // [Downstream Impact] Returns 403 if caller is not an admin, preventing non-admins from triggering Single User Mode even with a valid token.
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      await logError({
        correlationId,
        error: `Non-admin attempted single-user-mode operation: uid=${verifiedUser.uid}, action=${action}`,
        context: { route: '/api/admin/single-user-mode', action },
      });
      return NextResponse.json(
        { success: false, error: ERROR_CODES.AUTH_ADMIN_REQUIRED.message, errorCode: ERROR_CODES.AUTH_ADMIN_REQUIRED.code, correlationId },
        { status: 403 }
      );
    }

    const adminData = userDoc.data()!;
    const configRef = db.collection('admin_configuration').doc('global');
    const now = new Date().toISOString();

    if (action === 'activate') {
      // Purge all presence sessions (except admin's own current session)
      const presenceSnap = await db.collection('presence').get();
      const batch = db.batch();
      let purgedCount = 0;

      for (const presenceDoc of presenceSnap.docs) {
        if (presenceDoc.id === verifiedUser.uid) {
          // Keep admin's own session but clear others if they have multiple.
          // @SECURITY_FIX: Validate currentSessionId against server-side presence data before using
          // as keep-filter to prevent client-controlled value from zeroing out the admin's own sessions.
          const adminSessions: string[] = presenceDoc.data().sessions || [];
          const adminActivity: Record<string, number> = presenceDoc.data().sessionActivity || {};
          // Only use currentSessionId if it actually exists in the server-side sessions list
          const verifiedSessionId = (currentSessionId && adminSessions.includes(currentSessionId))
            ? currentSessionId
            : adminSessions[0] ?? null;
          if (verifiedSessionId && adminSessions.length > 1) {
            const keptSession = adminSessions.filter((s: string) => s === verifiedSessionId);
            const keptActivity: Record<string, number> = {};
            if (adminActivity[verifiedSessionId]) {
              keptActivity[verifiedSessionId] = adminActivity[verifiedSessionId];
            }
            batch.update(presenceDoc.ref, {
              sessions: keptSession,
              sessionActivity: keptActivity,
              online: true,
            });
            purgedCount += adminSessions.length - keptSession.length;
          }
          // If admin has only 1 session, leave their presence document untouched
        } else {
          // Fully clear all other users' sessions
          const sessionCount = presenceDoc.data().sessions?.length || 0;
          batch.update(presenceDoc.ref, {
            sessions: [],
            sessionActivity: {},
            online: false,
          });
          purgedCount += sessionCount;
        }
      }

      // Set Single User Mode flag
      batch.set(configRef, {
        singleUserModeEnabled: true,
        singleUserAdminId: verifiedUser.uid,
        singleUserModeActivatedAt: now,
      }, { merge: true });

      // Write audit log
      const auditRef = db.collection('audit_logs').doc();
      batch.set(auditRef, {
        correlationId,
        userId: verifiedUser.uid,
        userEmail: adminData.email || null,
        action: 'SINGLE_USER_MODE_ACTIVATED',
        details: { activatedBy: adminData.teamName || 'unknown', purgedCount, currentSessionId: currentSessionId || null },
        timestamp: now,
      });

      await batch.commit();

      return NextResponse.json({ success: true, purgedCount, correlationId });

    } else {
      // deactivate
      const batch = db.batch();

      batch.set(configRef, {
        singleUserModeEnabled: false,
        singleUserAdminId: null,
        singleUserModeActivatedAt: null,
      }, { merge: true });

      const auditRef = db.collection('audit_logs').doc();
      batch.set(auditRef, {
        correlationId,
        userId: verifiedUser.uid,
        userEmail: adminData.email || null,
        action: 'SINGLE_USER_MODE_DEACTIVATED',
        details: { deactivatedBy: adminData.teamName || 'unknown' },
        timestamp: now,
      });

      await batch.commit();

      return NextResponse.json({ success: true, correlationId });
    }

  } catch (error: any) {
    await logError({
      correlationId,
      error: `single-user-mode ${action} failed: ${error.message}`,
      context: { route: '/api/admin/single-user-mode', action, adminUid },
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', correlationId },
      { status: 500 }
    );
  }
}
