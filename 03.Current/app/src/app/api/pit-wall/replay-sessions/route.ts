// GUID: API_REPLAY_SESSIONS-000-v01
// [Intent] Returns the list of available GPS replay sessions from Firestore
//          replay_sessions collection. Authenticated users only (any signed-in user).
//          Sessions are pre-ingested by scripts/ingest-*-replay.js.
// [Inbound Trigger] Called by PitWallClient on entering replay mode to populate session picker.
// [Downstream Impact] Returns ReplaySessionMetadata[] for useReplayPlayer.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

// GUID: API_REPLAY_SESSIONS-001-v01
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();
  getFirebaseAdmin();

  const authResult = await verifyAuthToken(req.headers.get('Authorization'));
  if (!authResult) {
    return NextResponse.json(
      { error: ERRORS.SESSION_INVALID.message, code: ERRORS.SESSION_INVALID.code, correlationId },
      { status: 401 },
    );
  }

  try {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const snapshot = await db
      .collection('replay_sessions')
      .where('status', '==', 'available')
      .orderBy('dateStart', 'desc')
      .limit(20)
      .get();

    const sessions = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        sessionKey:         d.sessionKey,
        sessionName:        d.sessionName,
        meetingName:        d.meetingName,
        circuitKey:         d.circuitKey,
        year:               d.year,
        dateStart:          d.dateStart,
        durationMs:         d.durationMs,
        totalDrivers:       d.totalDrivers,
        totalFrames:        d.totalFrames,
        downloadUrl:        d.downloadUrl,
        fileSizeBytesGzip:  d.fileSizeBytesGzip,
        fileSizeBytesRaw:   d.fileSizeBytesRaw,
        samplingIntervalMs: d.samplingIntervalMs,
      };
    });

    return NextResponse.json({ sessions });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_REPLAY_SESSIONS_FAILED.message,
        code:  ERRORS.PIT_WALL_REPLAY_SESSIONS_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
