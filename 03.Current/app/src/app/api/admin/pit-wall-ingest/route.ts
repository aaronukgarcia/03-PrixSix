// GUID: API_ADMIN_PITWALL_INGEST-000-v01
// [Intent] Admin-only endpoint to trigger replay ingest for a given OpenF1 session.
//          Validates admin auth, checks current Firestore status to avoid duplicate ingests,
//          then fires-and-forgets the ingestReplaySession pipeline. Returns 202 immediately.
// [Inbound Trigger] Admin clicks "Ingest" button in PitWallManager replay sessions table.
// [Downstream Impact] Writes to replay_sessions (status), replay_chunks (data), replay_meta.
//                     Writes to audit_logs for traceability.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { ingestReplaySession, getSessionFirestoreStatus } from '@/lib/replay-ingest';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_PITWALL_INGEST-001-v01
// [Intent] POST handler — triggers replay ingest for a session. Fire-and-forget pattern:
//          returns 202 Accepted immediately while ingest runs in the background.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();

  try {
    // Auth: verify Firebase token
    const authHeader = req.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);
    if (!verifiedUser) {
      return NextResponse.json(
        { error: 'Unauthorised', code: ERRORS.SESSION_INVALID.code, correlationId },
        { status: 401 },
      );
    }

    // Admin-only gate
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden', code: ERRORS.AUTH_ADMIN_REQUIRED.code, correlationId },
        { status: 403 },
      );
    }

    // Parse request body
    const body = await req.json().catch(() => null);
    if (!body || typeof body.sessionKey !== 'number') {
      return NextResponse.json(
        { error: 'Missing or invalid sessionKey', code: ERRORS.PIT_WALL_INGEST_TRIGGER_FAILED.code, correlationId },
        { status: 400 },
      );
    }

    const { sessionKey } = body;

    // Check current Firestore status — don't start if already ingesting or complete
    const currentStatus = await getSessionFirestoreStatus(sessionKey);
    if (currentStatus.status === 'ingesting') {
      return NextResponse.json(
        { status: 'already_ingesting', sessionKey, correlationId },
        { status: 200 },
      );
    }
    if (currentStatus.status === 'complete') {
      return NextResponse.json(
        { status: 'already_complete', sessionKey, totalChunks: currentStatus.totalChunks, totalFrames: currentStatus.totalFrames, correlationId },
        { status: 200 },
      );
    }

    // Audit log
    const adminEmail = userDoc.data()?.email || verifiedUser.uid;
    await db.collection('audit_logs').add({
      action: 'ADMIN_TRIGGER_REPLAY_INGEST',
      adminEmail,
      userId: verifiedUser.uid,
      sessionKey,
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    });

    // Fire-and-forget: start ingest in background, return 202 immediately
    // GUID: API_ADMIN_PITWALL_INGEST-002-v01
    // [Intent] Detached promise — ingest runs asynchronously. No-op callbacks because
    //          data streams to Firestore, not to a client response stream.
    ingestReplaySession(sessionKey, {
      onFirestoreProgress: true, // write progress to session doc for admin panel real-time visibility
      onProgress: () => {},
      onMeta: () => {},
      onFrame: () => {},
      onComplete: () => {},
      onError: () => {},
    }).catch((err: any) => {
      console.error(`[admin-ingest] Failed for session ${sessionKey}:`, err.message);
    });

    return NextResponse.json(
      { status: 'started', sessionKey, correlationId },
      { status: 202 },
    );
  } catch (err: any) {
    console.error('[admin-ingest] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Pit Wall ingest trigger failed', code: ERRORS.PIT_WALL_INGEST_TRIGGER_FAILED.code, correlationId },
      { status: 500 },
    );
  }
}
