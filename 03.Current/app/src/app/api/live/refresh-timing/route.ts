// =============================================================================
// FILE:    app/src/app/api/live/refresh-timing/route.ts
// AUTHOR:  bob
// DATE:    2026-03-04
//
// PURPOSE:
//   Player-facing POST endpoint. Any signed-in user can call this to trigger
//   an auto-refresh of the latest OpenF1 session timing data. Rate-gated to
//   once every 15 minutes — if the data is fresh, returns immediately without
//   hitting OpenF1. Writes to app-settings/pub-chat-timing (same document as
//   the admin fetch-timing-data route).
//
// KEY DIFFERENCES FROM /api/admin/fetch-timing-data:
//   - No admin check — any authenticated user can trigger a refresh
//   - Always uses session_key=latest (no sessionKey in request body)
//   - Rate gate: if fetchedAt < 15 min → returns { fresh: true } immediately
//   - Fetches all laps in a single call (not per-driver) and groups client-side
//   - fetchedBy is set to 'auto' (not the user's UID)
// =============================================================================

// GUID: API_LIVE_REFRESH_TIMING-000-v01
// [Intent] Module-level constants, token cache, and helpers for the live timing
//          auto-refresh endpoint. Mirrors the admin route's timeout/parse helpers
//          but targets session_key=latest rather than a specific session.
// [Inbound Trigger] Loaded once by Next.js on first request to this route.
// [Downstream Impact] FETCH_TIMEOUT_MS controls all outbound HTTP call timeouts.
//                     cachedToken is shared across warm requests on the same instance.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { getSecret } from '@/lib/secrets-manager';

export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';
const FETCH_TIMEOUT_MS = 10_000;

// Rate gate: do not hit OpenF1 if data is fresher than this.
const RATE_GATE_MS = 15 * 60 * 1000; // 15 minutes

// Module-level OAuth2 token cache (shared with warm requests on same instance).
let cachedToken: { token: string; expiresAt: number } | null = null;


// =============================================================================
// GUID: API_LIVE_REFRESH_TIMING-001-v01
// [Intent] Wrap fetch() with an AbortController-based timeout so no outbound
//          HTTP call can hang longer than timeoutMs milliseconds.
// [Inbound Trigger] Called by every OpenF1 fetch in this module.
// [Downstream Impact] AbortError propagates to caller; other errors re-thrown.
// =============================================================================
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`[live/refresh-timing] Aborting ${url} after ${timeoutMs}ms`);
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}


// =============================================================================
// GUID: API_LIVE_REFRESH_TIMING-002-v01
// [Intent] Safely parse JSON from an HTTP response — reads body as text first,
//          then JSON.parse. Throws a descriptive error on non-JSON bodies
//          (HTML Cloudflare pages, rate-limit pages, etc.).
// [Inbound Trigger] Called after every OpenF1 fetch in this module.
// [Downstream Impact] Prevents cryptic SyntaxError on non-JSON OpenF1 responses.
// =============================================================================
async function safeParseJson<T>(response: Response, context: string): Promise<T> {
  const rawText = await response.text();
  try {
    return JSON.parse(rawText) as T;
  } catch {
    const preview = rawText.slice(0, 300).replace(/\s+/g, ' ').trim();
    throw new Error(
      `[${context}] OpenF1 returned non-JSON (HTTP ${response.status}). Preview: "${preview}"`,
    );
  }
}


// =============================================================================
// GUID: API_LIVE_REFRESH_TIMING-003-v01
// [Intent] Acquire an OpenF1 OAuth2 access token, caching it for 55 minutes.
//          Returns null if credentials are not configured (unauthenticated access).
// [Inbound Trigger] Called once per POST handler before any OpenF1 data fetch.
// [Downstream Impact] If null, all OpenF1 calls are made without Authorization
//                     header — will receive 401 from OpenF1 if subscription required.
// =============================================================================
async function getOpenF1Token(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  let username: string;
  let password: string;
  try {
    username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
    password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });
  } catch {
    console.warn('[live/refresh-timing] OpenF1 credentials not configured — proceeding unauthenticated.');
    return null;
  }

  try {
    const res = await fetchWithTimeout(OPENF1_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
    });
    if (!res.ok) return null;
    const data = await safeParseJson<{ access_token: string }>(res, 'OpenF1 token');
    if (!data.access_token) return null;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}


// =============================================================================
// GUID: API_LIVE_REFRESH_TIMING-004-v01
// [Intent] Convert lap duration in decimal seconds to "M:SS.mmm" string.
// [Inbound Trigger] Called for each driver's best lap before Firestore write.
// [Downstream Impact] Format consumed directly by ThePaddockPubChat UI.
// =============================================================================
function formatLapDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const secsStr = secs.toFixed(3);
  const paddedSecs = secs < 10 ? `0${secsStr}` : secsStr;
  return `${mins}:${paddedSecs}`;
}


// =============================================================================
// GUID: API_LIVE_REFRESH_TIMING-005-v01
// [Intent] Main POST handler for the live timing auto-refresh endpoint.
//          1. Verify Firebase Auth token (any signed-in user).
//          2. Read app-settings/pub-chat-timing to check rate gate.
//          3. If data is fresh (<15 min), return { fresh: true } immediately.
//          4. Acquire OpenF1 OAuth2 token.
//          5. Fetch latest session metadata (session_key=latest).
//          6. Fetch meeting metadata.
//          7. Fetch all drivers for session.
//          8. Fetch all laps for session; group by driver, compute best valid lap.
//          9. Fetch stints for tyre compound enrichment (best-effort).
//         10. Write PubChatTimingData to app-settings/pub-chat-timing.
//         11. Return { success: true, fresh: false, sessionName, location }.
// [Inbound Trigger] POST /api/live/refresh-timing with Bearer token in Authorization.
// [Downstream Impact] Overwrites app-settings/pub-chat-timing — any player reading
//                     the /live page will see the updated data on next Firestore read.
// =============================================================================
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();
  console.log(`[live/refresh-timing POST ${correlationId}] Request received.`);

  try {
    // ── Step 1: Auth — any signed-in user (no admin check) ────────────────────
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      console.warn(`[live/refresh-timing POST ${correlationId}] Auth failed.`);
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 },
      );
    }

    // ── Step 2: Rate gate — check how old the current Firestore data is ───────
    const { db, FieldValue, Timestamp } = await getFirebaseAdmin();

    const timingDocRef = db.doc('app-settings/pub-chat-timing');
    const timingSnap = await timingDocRef.get();

    if (timingSnap.exists) {
      const data = timingSnap.data();
      if (data?.fetchedAt) {
        // fetchedAt is a Firestore Timestamp — convert to ms epoch
        const fetchedAtMs: number =
          typeof data.fetchedAt.toMillis === 'function'
            ? data.fetchedAt.toMillis()
            : data.fetchedAt._seconds * 1000;

        const ageMs = Date.now() - fetchedAtMs;
        if (ageMs < RATE_GATE_MS) {
          console.log(
            `[live/refresh-timing POST ${correlationId}] Data is fresh (${Math.round(ageMs / 1000)}s old) — skipping OpenF1 fetch.`,
          );
          return NextResponse.json({ success: true, fresh: true });
        }
        console.log(
          `[live/refresh-timing POST ${correlationId}] Data is stale (${Math.round(ageMs / 1000)}s old) — refreshing.`,
        );
      }
    } else {
      console.log(`[live/refresh-timing POST ${correlationId}] No existing timing data — fetching fresh.`);
    }

    // ── Step 3: Acquire OpenF1 OAuth2 token ───────────────────────────────────
    const openf1Token = await getOpenF1Token();
    const authHeaders: HeadersInit = openf1Token
      ? { Authorization: `Bearer ${openf1Token}` }
      : {};

    if (!openf1Token) {
      console.warn(`[live/refresh-timing POST ${correlationId}] No OpenF1 token — proceeding unauthenticated.`);
    }

    // ── Step 4: Fetch latest session ──────────────────────────────────────────
    console.log(`[live/refresh-timing POST ${correlationId}] Fetching latest session...`);
    let sessionRes: Response;
    try {
      sessionRes = await fetchWithTimeout(
        `${OPENF1_BASE}/sessions?session_key=latest`,
        { headers: authHeaders },
      );
    } catch (fetchErr: any) {
      const isTimeout = fetchErr?.name === 'AbortError';
      const msg = isTimeout
        ? `OpenF1 sessions endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : `OpenF1 sessions endpoint error: ${fetchErr.message}`;
      console.error(`[live/refresh-timing POST ${correlationId}] ${msg}`);
      return NextResponse.json(
        { success: false, error: msg, correlationId },
        { status: isTimeout ? 504 : 502 },
      );
    }

    if (!sessionRes.ok) {
      const msg = `OpenF1 sessions returned ${sessionRes.status}`;
      console.error(`[live/refresh-timing POST ${correlationId}] ${msg}`);
      return NextResponse.json(
        { success: false, error: msg, correlationId },
        { status: 502 },
      );
    }

    const sessions = await safeParseJson<any[]>(sessionRes, 'sessions');
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No sessions returned from OpenF1', correlationId },
        { status: 404 },
      );
    }

    const session = sessions[0];
    const sessionKey: number = session.session_key;
    const meetingKey: number = session.meeting_key;
    console.log(
      `[live/refresh-timing POST ${correlationId}] Latest session: "${session.session_name}" (key=${sessionKey}, meetingKey=${meetingKey})`,
    );

    // ── Step 5: Fetch meeting metadata ────────────────────────────────────────
    console.log(`[live/refresh-timing POST ${correlationId}] Fetching meeting ${meetingKey}...`);
    let meeting: any = {};
    try {
      const meetingRes = await fetchWithTimeout(
        `${OPENF1_BASE}/meetings?meeting_key=${meetingKey}`,
        { headers: authHeaders },
      );
      if (meetingRes.ok) {
        const meetings = await safeParseJson<any[]>(meetingRes, 'meetings');
        if (Array.isArray(meetings) && meetings.length > 0) {
          meeting = meetings[0];
        }
      }
    } catch (err) {
      // Meeting data is enrichment — non-fatal
      console.warn(`[live/refresh-timing POST ${correlationId}] Meeting fetch failed (non-fatal):`, err);
    }

    // ── Step 6: Fetch all drivers for the session ─────────────────────────────
    console.log(`[live/refresh-timing POST ${correlationId}] Fetching drivers...`);
    let drivers: any[] = [];
    try {
      const driversRes = await fetchWithTimeout(
        `${OPENF1_BASE}/drivers?session_key=${sessionKey}`,
        { headers: authHeaders },
      );
      if (!driversRes.ok) {
        throw new Error(`Drivers endpoint returned ${driversRes.status}`);
      }
      const raw = await safeParseJson<any[]>(driversRes, 'drivers');
      drivers = Array.isArray(raw) ? raw : [];
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: `Failed to fetch drivers: ${err.message}`, correlationId },
        { status: 502 },
      );
    }

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No drivers found for this session', correlationId },
        { status: 404 },
      );
    }

    // Deduplicate by driver_number (keep first occurrence)
    const uniqueDrivers = new Map<number, any>();
    for (const d of drivers) {
      if (d.driver_number && !uniqueDrivers.has(d.driver_number)) {
        uniqueDrivers.set(d.driver_number, d);
      }
    }
    console.log(`[live/refresh-timing POST ${correlationId}] ${uniqueDrivers.size} unique drivers.`);

    // ── Step 7: Fetch ALL laps in one call and group by driver ─────────────────
    console.log(`[live/refresh-timing POST ${correlationId}] Fetching all laps...`);
    const lapsByDriver = new Map<number, any[]>();
    try {
      const lapsRes = await fetchWithTimeout(
        `${OPENF1_BASE}/laps?session_key=${sessionKey}`,
        { headers: authHeaders },
      );
      if (lapsRes.ok) {
        const rawLaps = await lapsRes.text();
        let allLaps: any[] = [];
        try {
          allLaps = JSON.parse(rawLaps);
        } catch {
          console.warn(`[live/refresh-timing POST ${correlationId}] Laps returned non-JSON — skipping.`);
        }
        if (Array.isArray(allLaps)) {
          for (const lap of allLaps) {
            const dNum = lap.driver_number;
            if (!dNum) continue;
            if (!lapsByDriver.has(dNum)) lapsByDriver.set(dNum, []);
            lapsByDriver.get(dNum)!.push(lap);
          }
        }
      } else {
        console.warn(`[live/refresh-timing POST ${correlationId}] Laps returned ${lapsRes.status} — no lap data.`);
      }
    } catch (err) {
      console.warn(`[live/refresh-timing POST ${correlationId}] Laps fetch failed (non-fatal):`, err);
    }

    // ── Step 8: Compute best valid lap per driver ─────────────────────────────
    const driverResults: Array<{
      driver: string;
      fullName: string;
      driverNumber: number;
      team: string;
      teamColour: string;
      laps: number;
      bestLapDuration: number;
      time: string;
      tyreCompound?: string;
    }> = [];

    for (const [driverNumber, driverInfo] of uniqueDrivers.entries()) {
      const laps = lapsByDriver.get(driverNumber) ?? [];
      const validLaps = laps.filter(
        (lap: any) => lap.lap_duration != null && lap.lap_duration > 0 && !lap.is_pit_out_lap,
      );
      if (validLaps.length === 0) continue;

      const bestLap = validLaps.reduce(
        (best: any, lap: any) => (lap.lap_duration < best.lap_duration ? lap : best),
        validLaps[0],
      );

      driverResults.push({
        driver:          driverInfo.last_name    || driverInfo.name_acronym || `#${driverNumber}`,
        fullName:        driverInfo.full_name     || driverInfo.last_name   || '',
        driverNumber,
        team:            driverInfo.team_name     || 'Unknown',
        teamColour:      driverInfo.team_colour   || '666666',
        laps:            validLaps.length,
        bestLapDuration: bestLap.lap_duration,
        time:            formatLapDuration(bestLap.lap_duration),
      });
    }

    if (driverResults.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid lap data found for any driver', correlationId },
        { status: 404 },
      );
    }

    // Sort ascending by best lap duration
    driverResults.sort((a, b) => a.bestLapDuration - b.bestLapDuration);
    // Assign positions
    const positionedResults = driverResults.map((r, i) => ({ ...r, position: i + 1 }));

    // ── Step 9: Fetch stints for tyre compound enrichment (best-effort) ───────
    try {
      const stintsRes = await fetchWithTimeout(
        `${OPENF1_BASE}/stints?session_key=${sessionKey}`,
        { headers: authHeaders },
        8_000,
      );
      if (stintsRes.ok) {
        const rawStints = await stintsRes.text();
        let stints: any[] = [];
        try { stints = JSON.parse(rawStints); } catch { /* non-fatal */ }
        if (Array.isArray(stints) && stints.length > 0) {
          const latestCompoundMap = new Map<number, string>();
          for (const s of stints) {
            const dNum = s.driver_number;
            const compound = (s.compound || '').toUpperCase();
            if (!dNum || !compound) continue;
            const existing = latestCompoundMap.get(dNum);
            if (
              !existing ||
              (s.lap_start || 0) >
                (stints.find((x) => x.driver_number === dNum && x.compound === existing)?.lap_start || 0)
            ) {
              latestCompoundMap.set(dNum, compound);
            }
          }
          for (const r of positionedResults) {
            const compound = latestCompoundMap.get(r.driverNumber);
            if (compound) (r as any).tyreCompound = compound;
          }
        }
      }
    } catch (stintsErr) {
      console.warn(`[live/refresh-timing POST ${correlationId}] Stints fetch failed (non-fatal):`, stintsErr);
    }

    // ── Step 10: Write to Firestore ────────────────────────────────────────────
    const timingData = {
      session: {
        meetingKey,
        meetingName:  meeting.meeting_name      || session.session_name || 'Unknown Meeting',
        sessionKey,
        sessionName:  session.session_name       || 'Unknown Session',
        circuitName:  meeting.circuit_short_name || '',
        location:     meeting.location           || '',
        countryName:  meeting.country_name       || '',
        dateStart:    session.date_start         || '',
      },
      drivers:    positionedResults,
      fetchedAt:  FieldValue.serverTimestamp(),
      fetchedBy:  'auto',
    };

    console.log(`[live/refresh-timing POST ${correlationId}] Writing ${positionedResults.length} drivers to Firestore...`);
    await timingDocRef.set(timingData);
    console.log(`[live/refresh-timing POST ${correlationId}] Write complete.`);

    return NextResponse.json({
      success:     true,
      fresh:       false,
      sessionName: session.session_name,
      location:    meeting.location || '',
      driverCount: positionedResults.length,
    });

  } catch (error: any) {
    // ── Top-level catch — GR#1 error logging ──────────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[live/refresh-timing POST ${correlationId}] Unhandled exception:`, error);
    }

    try {
      const tracedError = createTracedError(ERRORS.OPENF1_FETCH_FAILED, {
        correlationId,
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { route: '/api/live/refresh-timing' },
      });
      const { db: errorDb } = await getFirebaseAdmin();
      await logTracedError(tracedError, errorDb);
    } catch {
      /* logging failure is non-fatal */
    }

    return NextResponse.json(
      {
        success:      false,
        error:        'An unexpected error occurred while refreshing timing data',
        correlationId,
      },
      { status: 500 },
    );
  }
}
