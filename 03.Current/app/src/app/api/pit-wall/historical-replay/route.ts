// GUID: API_PIT_WALL_HISTORICAL_REPLAY-000-v01
// [Intent] Fetch and downsample historical position telemetry from OpenF1 for showreel replay.
//          Returns one position frame per 5 real-time seconds per driver.
// [Inbound Trigger] Called by useHistoricalReplay when a showreel item starts playing.
// [Downstream Impact] Returns HistoricalReplayData — the replay hook uses frames[] for RAF playback.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { getSecret } from '@/lib/secrets-manager';
import type { HistoricalReplayData, HistoricalDriver, ReplayFrame } from '@/app/(app)/pit-wall/_types/showreel.types';

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
// Helpers
// ---------------------------------------------------------------------------

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-004-v01
// [Intent] Fetch with AbortController timeout.
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
// [Intent] Obtain an OpenF1 bearer token using stored credentials, with in-memory caching.
//          Returns null if credentials are unavailable; unauthenticated requests still work
//          for most OpenF1 historical endpoints.
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
// [Intent] Fetch a single OpenF1 path with optional auth bearer token.
//          Returns parsed JSON, the raw text (for restricted detection), or null on failure.
async function openF1FetchRaw(path: string, token: string | null): Promise<{ ok: boolean; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${OPENF1_BASE}${path}`, { headers, next: { revalidate: 0 } });
  const text = await res.text();
  return { ok: res.ok, text };
}

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-007-v01
// [Intent] Detect whether an OpenF1 response body is a "restricted" error.
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
// Core algorithms
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
// [Intent] Downsample raw OpenF1 position data to one record per driver per 5 seconds.
//          A 2-hour race produces ~360,000 raw records; this reduces it to ~2,400.
//          Algorithm: per-driver sort by date ascending, then slide a 5-second window
//          and keep the first entry in each window.
function downsamplePositions(raw: RawPosition[]): RawPosition[] {
  // Group by driver
  const byDriver = new Map<number, RawPosition[]>();
  for (const p of raw) {
    const list = byDriver.get(p.driver_number) ?? [];
    list.push(p);
    byDriver.set(p.driver_number, list);
  }

  const result: RawPosition[] = [];

  for (const [, positions] of byDriver) {
    // Sort ascending by timestamp
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
// [Intent] Convert the downsampled positions into ReplayFrame[].
//          Positions are sorted globally by wall-clock time, then grouped into frames
//          where all entries within FRAME_GROUPING_MS of the frame anchor are merged.
//          virtualTimeMs is measured from the session start timestamp.
function buildReplayFrames(positions: RawPosition[], sessionStartMs: number): ReplayFrame[] {
  if (positions.length === 0) return [];

  // Sort all downsampled positions by wall clock time
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

    // Collect all positions within the grouping window
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

    if (frame.positions.length > 0) {
      frames.push(frame);
    }
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

// GUID: API_PIT_WALL_HISTORICAL_REPLAY-001-v01
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();
  getFirebaseAdmin(); // ensure Admin SDK is initialised

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

  // Return cached replay if still fresh
  const cached = replayCache.get(sessionKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  let token: string | null = null;
  try {
    token = await getOpenF1Token();
  } catch {
    // proceed without token
  }

  // Fetch drivers, positions, and session metadata in parallel
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
        {
          error: 'OpenF1 request timed out',
          code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code,
          correlationId,
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message,
        code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }

  // Check for restricted responses across any of the three fetches
  if (
    isRestrictedResponse(driversText) ||
    isRestrictedResponse(positionsText) ||
    isRestrictedResponse(sessionText)
  ) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_OPENF1_RESTRICTED.message,
        code: ERRORS.PIT_WALL_OPENF1_RESTRICTED.code,
        correlationId,
      },
      { status: 503 },
    );
  }

  // Parse all three payloads
  let rawDrivers: any[], rawPositions: RawPosition[], rawSessions: any[];
  try {
    rawDrivers = JSON.parse(driversText);
    rawPositions = JSON.parse(positionsText);
    rawSessions = JSON.parse(sessionText);
  } catch {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message,
        code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code,
        correlationId,
      },
      { status: 502 },
    );
  }

  if (!driversOk || !positionsOk || !sessionOk) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message,
        code: ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code,
        correlationId,
      },
      { status: 502 },
    );
  }

  const sessionMeta = Array.isArray(rawSessions) && rawSessions.length > 0 ? rawSessions[0] : null;
  const sessionStartMs = sessionMeta?.date_start ? new Date(sessionMeta.date_start).getTime() : 0;

  // Downsample positions
  const downsampled = downsamplePositions(rawPositions);

  // Build replay frames
  const frames = buildReplayFrames(downsampled, sessionStartMs);

  // Map drivers
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
