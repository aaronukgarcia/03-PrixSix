// GUID: API_PIT_WALL_HISTORICAL_SESSIONS-000-v01
// [Intent] Look up 2025 historical sessions from OpenF1 for a given circuit.
//          Used by the Pre-Race Showreel to find races to replay before live sessions.
// [Inbound Trigger] Called by usePreRaceMode when pre-race window opens (< 2 hours to race).
// [Downstream Impact] Returns HistoricalSession[] — the showreel schedule is built from this data.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { getSecret } from '@/lib/secrets-manager';
import type { HistoricalSession } from '@/app/(app)/pit-wall/_types/showreel.types';

export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const RACE_DURATION_S = 5400;   // 90 min default for Race
const SPRINT_DURATION_S = 1800; // 30 min default for Sprint

const sessionCache = new Map<string, { data: HistoricalSession[]; expiresAt: number }>();

let cachedToken: { token: string; expiresAt: number } | null = null;

// GUID: API_PIT_WALL_HISTORICAL_SESSIONS-002-v01
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

// GUID: API_PIT_WALL_HISTORICAL_SESSIONS-003-v01
// [Intent] Obtain an OpenF1 bearer token using stored credentials, with in-memory caching.
//          Returns null if credentials are unavailable (unauthenticated requests still work
//          for most OpenF1 endpoints).
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

// GUID: API_PIT_WALL_HISTORICAL_SESSIONS-001-v01
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
  const circuitKeyRaw = searchParams.get('circuit_key');
  const circuitShortName = searchParams.get('circuit_short_name');

  if (!circuitKeyRaw && !circuitShortName) {
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.message, code: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code, correlationId },
      { status: 400 },
    );
  }

  const circuitKey = circuitKeyRaw ? parseInt(circuitKeyRaw, 10) : null;
  if (circuitKeyRaw && (isNaN(circuitKey!) || circuitKey! <= 0)) {
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.message, code: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code, correlationId },
      { status: 400 },
    );
  }

  // Cache key based on the lookup parameter provided
  const cacheKey = circuitKey != null ? String(circuitKey) : circuitShortName!;
  const cached = sessionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ sessions: cached.data, fetchedAt: Date.now() });
  }

  let token: string | null = null;
  try {
    token = await getOpenF1Token();
  } catch {
    // proceed without token
  }

  // Build OpenF1 URL
  let openF1Url = `${OPENF1_BASE}/sessions?year=2025`;
  if (circuitKey != null) {
    openF1Url += `&circuit_key=${circuitKey}`;
  } else {
    openF1Url += `&circuit_short_name=${encodeURIComponent(circuitShortName!)}`;
  }

  let rawData: any[];
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchWithTimeout(openF1Url, { headers, next: { revalidate: 0 } });

    // Detect OpenF1 "restricted" response (can be 200 with JSON error body)
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.message,
          code: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code,
          correlationId,
        },
        { status: 502 },
      );
    }

    // OpenF1 returns { detail: "..." } with "restricted" when rate-limited / access denied
    if (parsed && !Array.isArray(parsed) && typeof parsed.detail === 'string' && parsed.detail.toLowerCase().includes('restricted')) {
      return NextResponse.json(
        {
          error: ERRORS.PIT_WALL_OPENF1_RESTRICTED.message,
          code: ERRORS.PIT_WALL_OPENF1_RESTRICTED.code,
          correlationId,
        },
        { status: 503 },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          error: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.message,
          code: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code,
          correlationId,
        },
        { status: 502 },
      );
    }

    rawData = Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        {
          error: 'OpenF1 request timed out',
          code: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code,
          correlationId,
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.message,
        code: ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }

  // Filter to Race and Sprint session types only
  const relevant = rawData.filter(
    (s: any) => s.session_type === 'Race' || s.session_type === 'Sprint',
  );

  if (relevant.length === 0) {
    return NextResponse.json({
      sessions: [],
      warning: ERRORS.PIT_WALL_SHOWREEL_NO_SESSIONS.message,
      code: ERRORS.PIT_WALL_SHOWREEL_NO_SESSIONS.code,
    });
  }

  const sessions: HistoricalSession[] = relevant.map((s: any) => ({
    sessionKey: s.session_key,
    sessionName: s.session_name,
    meetingName: s.meeting_name,
    circuitKey: s.circuit_key,
    circuitShortName: s.circuit_short_name,
    country: s.country_name,
    year: 2025,
    dateStart: s.date_start,
    dateEnd: s.date_end,
    durationSeconds: s.session_type === 'Sprint' ? SPRINT_DURATION_S : RACE_DURATION_S,
    sessionType: s.session_type,
  }));

  sessionCache.set(cacheKey, { data: sessions, expiresAt: Date.now() + CACHE_TTL_MS });

  return NextResponse.json({ sessions, fetchedAt: Date.now() });
}
