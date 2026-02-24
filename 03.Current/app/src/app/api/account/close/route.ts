// GUID: API_ACCOUNT_CLOSE-000-v01
// [Intent] Server-side account closure endpoint — permanently deletes a user's Firestore document,
//   predictions subcollection, presence document, and Firebase Auth account using Admin SDK.
//   Client-side Firestore rules deny user-document deletes; this route bypasses them safely.
// [Inbound Trigger] POST request from profile/page.tsx handleCloseAccount after user confirms deletion.
// [Downstream Impact] Irreversible: removes users/{uid}, users/{uid}/predictions/*, presence/{uid}
//   from Firestore and deletes the Firebase Auth record. Triggers sign-out on the client.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';

// GUID: API_ACCOUNT_CLOSE-001-v01
// [Intent] DELETE_SUBCOLLECTION_BATCH_SIZE controls how many prediction documents are deleted per
//   Firestore batch write. Firestore enforces a hard limit of 500 operations per batch.
// [Inbound Trigger] Used by the predictions subcollection deletion loop.
// [Downstream Impact] If a user has >500 predictions (unlikely but possible), the loop will execute
//   multiple batches. Increasing this risks exceeding the Firestore batch limit.
const DELETE_SUBCOLLECTION_BATCH_SIZE = 400;

// GUID: API_ACCOUNT_CLOSE-002-v01
// [Intent] POST handler — verifies the caller's Firebase ID token, then atomically deletes:
//   1. All documents in users/{uid}/predictions subcollection (batched)
//   2. The users/{uid} Firestore document
//   3. The presence/{uid} Firestore document (best-effort, non-fatal if missing)
//   4. The Firebase Auth account record for uid
//   Writes an audit log entry before deletion completes.
// [Inbound Trigger] Called exclusively by profile/page.tsx handleCloseAccount via fetch POST.
// [Downstream Impact] Irreversible deletion of all user data. Firestore subcollection docs are deleted
//   first so they are not orphaned if the parent delete fails. Auth deletion last — if it fails the
//   Firestore data is already gone, but the user can retry (Auth record is the gating factor).
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  // GUID: API_ACCOUNT_CLOSE-003-v01
  // [Intent] Authenticate the request via the Authorization: Bearer <token> header.
  //   Returns 401 immediately for missing, expired, or invalid tokens.
  // [Inbound Trigger] Every POST to this endpoint before any data mutation.
  // [Downstream Impact] Prevents unauthenticated callers from deleting arbitrary user accounts.
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

  const uid = verifiedUser.uid;

  try {
    const { db, FieldValue } = await getFirebaseAdmin();

    // GUID: API_ACCOUNT_CLOSE-004-v01
    // [Intent] Delete all documents in users/{uid}/predictions subcollection using batched writes.
    //   Subcollection documents are NOT automatically deleted when the parent document is deleted,
    //   so explicit deletion is required to prevent orphaned prediction data.
    // [Inbound Trigger] Called as the first mutation step in this handler.
    // [Downstream Impact] Permanently removes all prediction history for the user. Batching prevents
    //   exceeding the 500-operation Firestore batch limit for users with many predictions.
    const predictionsRef = db.collection('users').doc(uid).collection('predictions');
    let predictionsSnap = await predictionsRef.limit(DELETE_SUBCOLLECTION_BATCH_SIZE).get();

    while (!predictionsSnap.empty) {
      const batch = db.batch();
      predictionsSnap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      if (predictionsSnap.docs.length < DELETE_SUBCOLLECTION_BATCH_SIZE) {
        break; // Last page — no more documents
      }
      predictionsSnap = await predictionsRef.limit(DELETE_SUBCOLLECTION_BATCH_SIZE).get();
    }

    // GUID: API_ACCOUNT_CLOSE-005-v01
    // [Intent] Write a final audit log entry recording the account closure event before the user
    //   document is deleted. This ensures an audit trail exists even after the account is gone.
    //   Written directly via Admin SDK since the client-side audit module is unavailable here.
    // [Inbound Trigger] After predictions are deleted, before users/{uid} is deleted.
    // [Downstream Impact] Creates a record in audit_logs with action 'account_closed'. This entry
    //   will persist after the user document is removed (audit_logs is a top-level collection).
    try {
      await db.collection('audit_logs').add({
        userId: uid,
        email: verifiedUser.email ?? null,
        action: 'account_closed',
        details: {
          initiatedBy: 'user',
          route: '/api/account/close',
          correlationId,
        },
        correlationId,
        timestamp: FieldValue.serverTimestamp(),
      });
    } catch (auditErr) {
      // Non-fatal: log to console but do not block account deletion
      if (process.env.NODE_ENV !== 'production') {
        console.error('[API_ACCOUNT_CLOSE] Audit log write failed (non-fatal):', auditErr);
      }
    }

    // GUID: API_ACCOUNT_CLOSE-006-v01
    // [Intent] Delete the users/{uid} Firestore document via Admin SDK. Admin SDK bypasses the
    //   Firestore security rules that deny client-side deletes on user documents.
    // [Inbound Trigger] After predictions subcollection and audit log are handled.
    // [Downstream Impact] Permanently removes the user profile, preferences, team assignments,
    //   and all fields stored on the users document. Irreversible.
    await db.collection('users').doc(uid).delete();

    // GUID: API_ACCOUNT_CLOSE-007-v01
    // [Intent] Delete the presence/{uid} document. Presence documents track online status and are
    //   separate from the users collection. Best-effort: a missing presence doc is not an error.
    // [Inbound Trigger] After the users/{uid} document is deleted.
    // [Downstream Impact] Removes the user's online presence record. If absent (e.g. user never
    //   went online with presence tracking active), the delete is a no-op and that is acceptable.
    try {
      await db.collection('presence').doc(uid).delete();
    } catch (presenceErr) {
      // Non-fatal: presence document may not exist
      if (process.env.NODE_ENV !== 'production') {
        console.error('[API_ACCOUNT_CLOSE] Presence delete failed (non-fatal):', presenceErr);
      }
    }

    // GUID: API_ACCOUNT_CLOSE-008-v01
    // [Intent] Delete the Firebase Auth account for uid using the Admin Auth SDK. This is the final
    //   step so that re-authentication is impossible after all Firestore data is removed.
    //   If this step fails, the Firestore data is already deleted — the user has no document to
    //   sign in to, and the auth record can be cleaned up manually by an admin.
    // [Inbound Trigger] After all Firestore deletions complete successfully.
    // [Downstream Impact] Permanently removes the Firebase Auth record. The user cannot sign in
    //   again even if they know their credentials. Irreversible without admin intervention.
    const { getAuth } = await import('firebase-admin/auth');
    await getAuth().deleteUser(uid);

    return NextResponse.json({ success: true, correlationId });

  } catch (error: unknown) {
    // GUID: API_ACCOUNT_CLOSE-009-v01
    // [Intent] Top-level catch for any unhandled error during the deletion pipeline.
    //   Logs to error_logs via logError (Golden Rule #1) and returns a structured error response
    //   with correlation ID so the user can report the exact failure to support.
    // [Inbound Trigger] Any thrown exception from Firestore Admin, Firebase Auth Admin, or unexpected
    //   runtime errors within this handler.
    // [Downstream Impact] The deletion may be partially complete if the error occurs mid-pipeline.
    //   The correlationId in the response links to the error_logs entry for admin investigation.
    const err = error instanceof Error ? error : new Error(String(error));

    await logError({
      correlationId,
      error: err,
      context: {
        route: '/api/account/close',
        action: 'account_closure',
        userId: uid,
        additionalInfo: {
          errorCode: ERRORS.FIRESTORE_WRITE_FAILED.code,
        },
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.error('[API_ACCOUNT_CLOSE] Deletion failed:', err.message);
    }

    return NextResponse.json(
      {
        success: false,
        error: ERRORS.FIRESTORE_WRITE_FAILED.message,
        errorCode: ERRORS.FIRESTORE_WRITE_FAILED.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
