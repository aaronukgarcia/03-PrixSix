// GUID: API_PIT_WALL_HISTORICAL_REPLAY-000-v02
// [Intent] Firestore-first replay route with full-fidelity ingest on cache miss.
//          v02: Checks Firestore for pre-ingested chunks. If 'complete', returns redirect
//               to replay-chunks API. If 'none', triggers full ingest pipeline that
//               simultaneously streams NDJSON to client AND writes chunks to Firestore.
//               If 'ingesting', returns 202 (another request is already ingesting).
//               Keeps backward compat: showreel still uses the old downsampled path.
// [Inbound Trigger] Called by useReplayPlayer (GPS Replay) and useHistoricalReplay (showreel).
// [Downstream Impact] Writes to replay_chunks, replay_meta, replay_sessions on first ingest.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { getSecret } from '@/lib/secrets-manager';
import { getSessionFirestoreStatus, ingestReplaySession } from '@/lib/replay-ingest';
import type { HistoricalReplayData, HistoricalDriver, ReplayFrame } from '@/app/(app)/pit-wall/_types/showreel.types';
import { trackReplayAccess } from '@/lib/pit-wall-metrics';

export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes — historical data doesn't change

/** Downsample interval: keep one position per driver per this many milliseconds */
const DOWNSAMPLE_INTERVAL_MS = 5_000;
/** Frame grouping window: positions within this many ms of each other collapse into one frame */
const FRAME_GROUPING_MS = 2_500;

const replayCache = new Map<number, { data: HistoricalReplayData; expiresAt: number }>();

let cachedToken: { token: string; expiresAt: number } | null = null;

// ---------------------------------------------------------------------------
// Helpers (kept for showreel backward compat path)
// ---------------------------------------------------------------------------

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-004-v01
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-005-v01
async function getOpenF1Token(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  let username: string, password: string;
  try {
    username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
    password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });
  } catch {
    return null;
  }
  try {
    const res = await fetchWithTimeout(OPENF1_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password, grant_type: 'password' }).toString(),
    }, 8_000);
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-006-v01
async function openF1FetchRaw(path: string, token: string | null): Promise<{ ok: boolean; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${OPENF1_BASE}${path}`, { headers, next: { revalidate: 0 } });
  const text = await res.text();
  return { ok: res.ok, text };
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-007-v01
function isRestrictedResponse(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return (
      parsed &&
      !Array.isArray(parsed) &&
      typeof parsed.detail === 'string' &&
      parsed.detail.toLowerCase().includes('restricted')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Showreel path (downsampled, backward compat)
// ---------------------------------------------------------------------------

interface RawPosition {
  driver_number: number;
  date: string;
  x: number;
  y: number;
  z: number;
  position: number;
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-002-v01
function downsamplePositions(raw: RawPosition[]): RawPosition[] {
  const byDriver = new Map<number, RawPosition[]>();
  for (const p of raw) {
    const list = byDriver.get(p.driver_number) ?? [];
    list.push(p);
    byDriver.set(p.driver_number, list);
  }

  const result: RawPosition[] = [];
  for (const [, positions] of byDriver) {
    positions.sort((a, b) => a.date.localeCompare(b.date));
    let windowStart = -Infinity;
    for (const pos of positions) {
      const ts = new Date(pos.date).getTime();
      if (ts - windowStart >= DOWNSAMPLE_INTERVAL_MS) {
        result.push(pos);
        windowStart = ts;
      }
    }
  }
  return result;
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-003-v01
function buildReplayFrames(positions: RawPosition[], sessionStartMs: number): ReplayFrame[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a.date.localeCompare(b.date));
  const frames: ReplayFrame[] = [];
  let i = 0;

  while (i < sorted.length) {
    const anchor = sorted[i];
    const anchorMs = new Date(anchor.date).getTime();
    const frame: ReplayFrame = {
      virtualTimeMs: anchorMs - sessionStartMs,
      wallTimeMs: anchorMs,
      positions: [],
    };

    while (i < sorted.length) {
      const posMs = new Date(sorted[i].date).getTime();
      if (posMs - anchorMs > FRAME_GROUPING_MS) break;
      frame.positions.push({
        driverNumber: sorted[i].driver_number,
        x: sorted[i].x,
        y: sorted[i].y,
        position: sorted[i].position,
      });
      i++;
    }

    if (frame.positions.length > 0) frames.push(frame);
  }
  return frames;
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-008-v01
// [Intent] Showreel (downsampled) path — kept for backward compat with useHistoricalReplay.
//          Fetches drivers + positions + session from OpenF1, downsamples to 5s intervals,
//          returns JSON (not NDJSON). Used when mode=showreel query param is set.
async function handleShowreelPath(
  sessionKey: number,
  correlationId: string,
): Promise<NextResponse> {
  const cached = replayCache.get(sessionKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  let token: string | null = null;
  try { token = await getOpenF1Token(); } catch { /* proceed without */ }

  let driversText: string, positionsText: string, sessionText: string;
  let driversOk: boolean, positionsOk: boolean, sessionOk: boolean;

  try {
    const [driversResult, positionsResult, sessionResult] = await Promise.all([
      openF1FetchRaw(`/drivers?session_key=${sessionKey}`, token),
      openF1FetchRaw(`/position?session_key=${sessionKey}`, token),
      openF1FetchRaw(`/sessions?session_key=${sessionKey}`, token),
    ]);
    ({ ok: driversOk, text: driversText } = driversResult);
    ({ ok: positionsOk, text: positionsText } = positionsResult);
    ({ ok: sessionOk, text: sessionText } = sessionResult);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        { error: 'OpenF1 request timed out', code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code, correlationId },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message, code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code, correlationId },
      { status: 500 },
    );
  }

  if (isRestrictedResponse(driversText) || isRestrictedResponse(positionsText) || isRestrictedResponse(sessionText)) {
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_OPENF1_RESTRICTED.message, code: ERRORS.PIT_WALL_OPENF1_RESTRICTED.code, correlationId },
      { status: 503 },
    );
  }

  let rawDrivers: any[], rawPositions: RawPosition[], rawSessions: any[];
  try {
    rawDrivers = JSON.parse(driversText);
    rawPositions = JSON.parse(positionsText);
    rawSessions = JSON.parse(sessionText);
  } catch {
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message, code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code, correlationId },
      { status: 502 },
    );
  }

  if (!driversOk || !positionsOk || !sessionOk) {
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message, code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code, correlationId },
      { status: 502 },
    );
  }

  const sessionMeta = Array.isArray(rawSessions) && rawSessions.length > 0 ? rawSessions[0] : null;
  const sessionStartMs = sessionMeta?.date_start ? new Date(sessionMeta.date_start).getTime() : 0;
  const downsampled = downsamplePositions(rawPositions);
  const frames = buildReplayFrames(downsampled, sessionStartMs);
  const drivers: HistoricalDriver[] = (Array.isArray(rawDrivers) ? rawDrivers : []).map((d: any) => ({
    driverNumber: d.driver_number,
    driverCode: d.name_acronym ?? '',
    fullName: d.full_name ?? '',
    teamName: d.team_name ?? '',
    teamColour: d.team_colour ? `#${d.team_colour}` : '#888888',
  }));
  const durationMs = frames.length > 0 ? frames[frames.length - 1].virtualTimeMs : 0;
  const replayData: HistoricalReplayData = {
    sessionKey,
    sessionName: sessionMeta?.session_name ?? '',
    meetingName: sessionMeta?.meeting_name ?? '',
    drivers,
    frames,
    durationMs,
    totalLaps: sessionMeta?.total_laps ?? null,
  };
  replayCache.set(sessionKey, { data: replayData, expiresAt: Date.now() + CACHE_TTL_MS });
  return NextResponse.json(replayData);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-001-v02
// [Intent] v02: Firestore-first check for GPS Replay mode.
//          mode=showreel → downsampled path (backward compat).
//          Default (GPS Replay) → check Firestore status:
//            - 'complete' → return { source: 'firestore', totalChunks } so client uses replay-chunks API
//            - 'ingesting' → return 202
//            - 'none'/'failed' → ingest from OpenF1, stream NDJSON + write Firestore simultaneously
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
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
  const mode = searchParams.get('mode'); // 'showreel' for backward compat

  if (!sessionKeyRaw) {
    return NextResponse.json(
      { error: 'session_key is required', code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code, correlationId },
      { status: 400 },
    );
  }

  const sessionKey = parseInt(sessionKeyRaw, 10);
  if (isNaN(sessionKey) || sessionKey <= 0) {
    return NextResponse.json(
      { error: 'session_key must be a positive integer', code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code, correlationId },
      { status: 400 },
    );
  }

  // Showreel mode: use the old downsampled path (fast, small payload)
  if (mode === 'showreel') {
    return handleShowreelPath(sessionKey, correlationId);
  }

  // Track replay access for admin metrics
  trackReplayAccess(authResult.uid);

  // ---------------------------------------------------------------------------
  // GPS Replay mode: Firestore-first
  // ---------------------------------------------------------------------------

  // GUID: API_PIT_WALL_HISTORICAL_REPLAY-009-v01
  // [Intent] Check Firestore for pre-ingested full-fidelity chunks.
  try {
    const fsStatus = await getSessionFirestoreStatus(sessionKey);

    if (fsStatus.status === 'complete') {
      // Chunks exist in Firestore — tell client to use the replay-chunks API
      return NextResponse.json({
        source: 'firestore',
        sessionKey,
        totalChunks: fsStatus.totalChunks,
        totalFrames: fsStatus.totalFrames,
      });
    }

    if (fsStatus.status === 'ingesting') {
      // Another request is already ingesting — return 202
      return NextResponse.json(
        {
          error: ERRORS.PIT_WALL_REPLAY_INGEST_IN_PROGRESS.message,
          code: ERRORS.PIT_WALL_REPLAY_INGEST_IN_PROGRESS.code,
          correlationId,
          status: 'ingesting',
        },
        { status: 202 },
      );
    }

    // Status is 'none' or 'failed' — trigger full ingest with NDJSON streaming
    // GUID: API_PIT_WALL_HISTORICAL_REPLAY-010-v01
    // [Intent] Stream NDJSON to client while simultaneously writing chunks to Firestore.
    //          Line 1: metadata (drivers, durationMs, etc.)
    //          Lines 2+: individual ReplayFrame objects
    //          Client starts playback after 60 frames arrive.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await ingestReplaySession(sessionKey, {
            // GUID: API_PIT_WALL_HISTORICAL_REPLAY-011-v01
            // [Intent] Keep-alive progress pings — sent to the NDJSON stream while
            //          fetching from OpenF1. Prevents the load balancer from killing
            //          the idle HTTP connection (60s timeout). Client ignores _status lines.
            onProgress: (status) => {
              try {
                controller.enqueue(encoder.encode(JSON.stringify({ _status: 'fetching', ...status }) + '\n'));
              } catch { /* stream may be closed */ }
            },
            onMeta: (meta) => {
              controller.enqueue(encoder.encode(JSON.stringify(meta) + '\n'));
            },
            onFrame: (frame) => {
              controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'));
            },
            onComplete: (stats) => {
              // Final line: completion marker (optional, client handles stream end)
              controller.enqueue(encoder.encode(JSON.stringify({ _complete: true, ...stats }) + '\n'));
              controller.close();
            },
            onError: (errorMsg) => {
              controller.enqueue(encoder.encode(JSON.stringify({ _error: errorMsg }) + '\n'));
              controller.close();
            },
          });
        } catch (err: any) {
          try {
            const msg = err instanceof Error ? err.message : 'Unknown ingest error';
            controller.enqueue(encoder.encode(JSON.stringify({ _error: msg }) + '\n'));
            controller.close();
          } catch {
            // Stream may already be closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'X-Correlation-Id': correlationId,
      },
    });

  } catch (err: any) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_REPLAY_INGEST_FAILED.message,
        code: ERRORS.PIT_WALL_REPLAY_INGEST_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
