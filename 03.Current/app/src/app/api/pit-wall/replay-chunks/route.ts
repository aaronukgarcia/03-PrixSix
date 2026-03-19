// GUID: API_REPLAY_CHUNKS-000-v01
// [Intent] Chunk-loading API for GPS Replay Firestore mode.
//          Reads pre-ingested replay chunks from Firestore and returns NDJSON.
//          First request (from=0) includes metadata line, then flattened frames.
//          Client calls this in groups of 3 chunks for progressive loading.
// [Inbound Trigger] Called by useReplayPlayer when firestoreStatus === 'complete'.
// [Downstream Impact] Returns frames to client for RAF playback — same format as ingest NDJSON stream.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { loadChunks, loadReplayMeta } from '@/lib/replay-ingest';

export const dynamic = 'force-dynamic';

// GUID: API_REPLAY_CHUNKS-001-v01
// [Intent] GET handler — reads chunks from Firestore and streams as NDJSON.
//          Query params:
//            session_key (required) — session to load
//            from (default 0) — chunk index to start from
//            count (default 3) — number of chunks to return
export async function GET(req: NextRequest): Promise<Response> {
  const correlationId = generateCorrelationId();
  getFirebaseAdmin();

  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuthToken(authHeader);
  if (!authResult) {
    return NextResponse.json(
      { error: ERRORS.SESSION_INVALID.message, code: ERRORS.SESSION_INVALID.code, correlationId },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const sessionKeyRaw = searchParams.get('session_key');
  const fromRaw = searchParams.get('from') ?? '0';
  const countRaw = searchParams.get('count') ?? '3';

  if (!sessionKeyRaw) {
    return NextResponse.json(
      { error: 'session_key is required', code: ERRORS.PIT_WALL_REPLAY_CHUNKS_FAILED.code, correlationId },
      { status: 400 },
    );
  }

  const sessionKey = parseInt(sessionKeyRaw, 10);
  const from = parseInt(fromRaw, 10);
  const count = Math.min(parseInt(countRaw, 10), 10); // cap at 10 chunks per request

  if (isNaN(sessionKey) || sessionKey <= 0 || isNaN(from) || from < 0 || isNaN(count) || count <= 0) {
    return NextResponse.json(
      { error: 'Invalid parameters', code: ERRORS.PIT_WALL_REPLAY_CHUNKS_FAILED.code, correlationId },
      { status: 400 },
    );
  }

  try {
    const encoder = new TextEncoder();
    const lines: string[] = [];

    // GUID: API_REPLAY_CHUNKS-002-v01
    // [Intent] If from=0, include metadata as first NDJSON line so client gets
    //          drivers, durationMs, etc. before frames arrive.
    if (from === 0) {
      const meta = await loadReplayMeta(sessionKey);
      if (!meta) {
        return NextResponse.json(
          { error: ERRORS.PIT_WALL_REPLAY_META_NOT_FOUND.message, code: ERRORS.PIT_WALL_REPLAY_META_NOT_FOUND.code, correlationId },
          { status: 404 },
        );
      }
      lines.push(JSON.stringify({
        sessionKey: meta.sessionKey,
        sessionName: meta.sessionName,
        meetingName: meta.meetingName,
        durationMs: meta.durationMs,
        totalLaps: meta.totalLaps,
        totalChunks: meta.totalChunks,
        totalFrames: meta.totalFrames,
        drivers: meta.drivers,
        radioMessages: meta.radioMessages,
        samplingIntervalMs: 500,
      }));
    }

    // GUID: API_REPLAY_CHUNKS-003-v01
    // [Intent] Load requested chunks and flatten frames into NDJSON lines.
    const chunks = await loadChunks(sessionKey, from, count);

    for (const chunk of chunks) {
      for (const frame of chunk.frames) {
        lines.push(JSON.stringify(frame));
      }
    }

    // Return as NDJSON
    const body = lines.join('\n') + '\n';
    return new Response(encoder.encode(body), {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'public, max-age=86400', // chunks are immutable once written
        'X-Correlation-Id': correlationId,
        'X-Chunks-Returned': String(chunks.length),
      },
    });

  } catch (err: any) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_REPLAY_CHUNKS_FAILED.message,
        code: ERRORS.PIT_WALL_REPLAY_CHUNKS_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
