// GUID: API_PURGE_REPLAY-000-v01
// [Intent] Admin API route to purge durable replay data from Firestore.
//          Deletes replay_chunks + replay_meta documents for a session (or all sessions),
//          resets firestoreStatus on replay_sessions doc, and logs to audit_logs.
// [Inbound Trigger] Admin UI or manual API call.
// [Downstream Impact] After purge, next replay request will re-ingest from OpenF1.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { purgeReplaySession } from '@/lib/replay-ingest';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';

// GUID: API_PURGE_REPLAY-001-v01
// [Intent] DELETE handler — purges replay chunks + meta for one or all sessions.
//          Query params:
//            session_key — purge one session
//            all=true — purge all sessions
export async function DELETE(req: NextRequest): Promise<NextResponse> {
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

    // GUID: API_PURGE_REPLAY-002-v01
    // [Intent] Admin-only gate — verify the calling user has isAdmin: true in Firestore.
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden', code: ERRORS.AUTH_ADMIN_REQUIRED.code, correlationId },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const sessionKeyRaw = searchParams.get('session_key');
    const purgeAll = searchParams.get('all') === 'true';

    if (!sessionKeyRaw && !purgeAll) {
      return NextResponse.json(
        { error: 'session_key or all=true is required', code: ERRORS.PIT_WALL_REPLAY_PURGE_FAILED.code, correlationId },
        { status: 400 },
      );
    }

    const sessionKey = sessionKeyRaw ? parseInt(sessionKeyRaw, 10) : 0;
    if (sessionKeyRaw && (isNaN(sessionKey) || sessionKey <= 0)) {
      return NextResponse.json(
        { error: 'session_key must be a positive integer', code: ERRORS.PIT_WALL_REPLAY_PURGE_FAILED.code, correlationId },
        { status: 400 },
      );
    }

    // GUID: API_PURGE_REPLAY-003-v01
    // [Intent] Execute purge and log to audit_logs.
    const result = await purgeReplaySession(sessionKey, purgeAll);

    const adminEmail = userDoc.data()?.email || verifiedUser.uid;
    await db.collection('audit_logs').add({
      action: 'ADMIN_PURGE_REPLAY',
      adminEmail,
      userId: verifiedUser.uid,
      sessionKey: purgeAll ? 'ALL' : sessionKey,
      deletedChunks: result.deletedChunks,
      sessionsReset: result.sessionsReset,
      correlationId,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      deletedChunks: result.deletedChunks,
      sessionsReset: result.sessionsReset,
      correlationId,
    });

  } catch (err: any) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_REPLAY_PURGE_FAILED.message,
        code: ERRORS.PIT_WALL_REPLAY_PURGE_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
