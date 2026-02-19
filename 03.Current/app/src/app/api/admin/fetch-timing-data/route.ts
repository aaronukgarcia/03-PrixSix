// GUID: API_ADMIN_FETCH_TIMING_DATA-000-v02
// @AUTH_FIX: Added OpenF1 OAuth2 authentication with token caching. OpenF1 API changed from
//   public to authenticated access, requiring username/password → access token flow.
//   Requires env vars: OPENF1_USERNAME, OPENF1_PASSWORD
// [Intent] Admin API route for fetching F1 timing data from the OpenF1 API and storing it in Firestore.
//          Fetches session metadata, driver list, and lap times, computes best laps, and writes the
//          result to app-settings/pub-chat-timing for the ThePaddockPubChat component.
// [Inbound Trigger] POST request from PubChatPanel when admin clicks "Fetch from OpenF1".
// [Downstream Impact] Writes to Firestore app-settings/pub-chat-timing. ThePaddockPubChat reads this
//                     document to render live timing data.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { z } from 'zod';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

// In-memory token cache (shared module-level cache, expires after 55 minutes)
let cachedToken: { token: string; expiresAt: number } | null = null;

// GUID: API_ADMIN_FETCH_TIMING_DATA-013-v01
// [Intent] Get OpenF1 OAuth2 access token with caching to avoid repeated auth requests.
// [Inbound Trigger] Called before each OpenF1 API request (session, meeting, drivers, laps).
// [Downstream Impact] Returns cached token if valid, otherwise fetches new token from OpenF1.
async function getOpenF1Token(): Promise<string | null> {
  const correlationId = generateCorrelationId();

  // Check cache first
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  // Check if credentials are configured
  const username = process.env.OPENF1_USERNAME;
  const password = process.env.OPENF1_PASSWORD;

  if (!username || !password) {
    console.warn(`[OpenF1 Auth ${correlationId}] Credentials not configured (OPENF1_USERNAME/OPENF1_PASSWORD)`);
    return null; // Not configured - will fall back to public API (may get 401)
  }

  try {
    const res = await fetch(OPENF1_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username,
        password,
      }),
    });

    if (!res.ok) {
      console.error(`[OpenF1 Auth ${correlationId}] Token fetch failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const token = data.access_token;

    // Cache token for 55 minutes (tokens expire after 1 hour)
    cachedToken = {
      token,
      expiresAt: Date.now() + 55 * 60 * 1000,
    };

    console.log(`[OpenF1 Auth ${correlationId}] Token refreshed, expires in 55 minutes`);
    return token;

  } catch (err) {
    console.error(`[OpenF1 Auth ${correlationId}]`, err);
    return null;
  }
}

// GUID: API_ADMIN_FETCH_TIMING_DATA-001-v03
// @ENHANCEMENT: Added dataType and driverNumber parameters for rich OpenF1 API exploitation.
// @SECURITY_FIX: Removed adminUid from schema - now uses authenticated user's UID instead.
//   Previous version allowed parameter tampering: attacker could submit any admin UID.
// [Intent] Zod schema for validating the fetch request — requires sessionKey, optional dataType and driverNumber.
// [Inbound Trigger] Every incoming POST request body is parsed against this schema.
// [Downstream Impact] Rejects malformed requests before any OpenF1 API calls are made.
const fetchTimingRequestSchema = z.object({
  sessionKey: z.number().int().positive(),
  dataType: z.enum(['laps', 'positions', 'car_data', 'pit', 'stints', 'intervals', 'race_control', 'team_radio', 'weather', 'location']).optional().default('laps'),
  driverNumber: z.number().int().positive().optional(),
}).strict();

// GUID: API_ADMIN_FETCH_TIMING_DATA-002-v01
// [Intent] Format a lap duration in seconds to "M:SS.mmm" display string.
// [Inbound Trigger] Called for each driver's best lap duration.
// [Downstream Impact] Produces the time string stored in Firestore and displayed in the UI.
function formatLapDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const secsStr = secs.toFixed(3);
  // Pad seconds to ensure "M:SS.mmm" format (e.g. 1:02.345 not 1:2.345)
  const paddedSecs = secs < 10 ? `0${secsStr}` : secsStr;
  return `${mins}:${paddedSecs}`;
}

// GUID: API_ADMIN_FETCH_TIMING_DATA-014-v01
// [Intent] Fetch data from OpenF1 API based on data type and optional driver filter.
// [Inbound Trigger] Called by POST handler with sessionKey, dataType, and optional driverNumber.
// [Downstream Impact] Returns raw data from OpenF1 API for the selected data type.
async function fetchOpenF1Data(
  sessionKey: number,
  dataType: string,
  driverNumber: number | undefined,
  authHeaders: HeadersInit
): Promise<any[]> {
  const baseUrl = `${OPENF1_BASE}/${dataType}?session_key=${sessionKey}`;
  const url = driverNumber ? `${baseUrl}&driver_number=${driverNumber}` : baseUrl;

  const res = await fetch(url, { headers: authHeaders });

  if (!res.ok) {
    throw new Error(`OpenF1 ${dataType} endpoint returned ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// GUID: API_ADMIN_FETCH_TIMING_DATA-003-v02
// @SECURITY_FIX: Added proper authentication via verifyAuthToken. Previous version had parameter
//   tampering vulnerability - attacker could submit any admin UID without authentication:
//   1. No verifyAuthToken() call - endpoint had NO authentication
//   2. Admin check used adminUid from request body (user-controlled)
//   3. Attacker could call endpoint with valid admin UID and bypass all auth
// [Intent] POST handler that orchestrates the OpenF1 fetch pipeline: validates input, checks admin
//          permissions, fetches session/driver/lap data, computes best laps, and writes to Firestore.
// [Inbound Trigger] POST /api/admin/fetch-timing-data with JSON body containing sessionKey.
// [Downstream Impact] Writes to app-settings/pub-chat-timing and audit_logs. Reads from OpenF1 API.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // SECURITY: Verify authentication FIRST before any processing
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = fetchTimingRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: parsed.error.flatten().fieldErrors,
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    const { sessionKey, dataType = 'laps', driverNumber } = parsed.data;
    const { db, FieldValue } = await getFirebaseAdmin();

    // Log the data type and filter being requested
    console.log(`[Fetch Timing ${correlationId}] Session ${sessionKey}, Type: ${dataType}, Driver: ${driverNumber || 'all'}`);

    // GUID: API_ADMIN_FETCH_TIMING_DATA-004-v02
    // @SECURITY_FIX: Now uses authenticated user's UID instead of user-controlled adminUid parameter.
    // [Intent] Verify the authenticated user has admin privileges before allowing the fetch.
    // [Inbound Trigger] Every valid POST request — admin check is mandatory.
    // [Downstream Impact] Returns 403 if not admin. Prevents unauthorised data writes.
    const adminUid = verifiedUser.uid; // Use authenticated user's UID, not request parameter
    const adminDoc = await db.collection('users').doc(adminUid).get();
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied. Admin access required.',
          errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 }
      );
    }

    // GUID: API_ADMIN_FETCH_TIMING_DATA-005-v02
    // @AUTH_FIX: Added OpenF1 OAuth2 authentication. OpenF1 API now requires auth tokens.
    // [Intent] Fetch session metadata from OpenF1 to populate the session header in the UI.
    // [Inbound Trigger] Admin check passed; sessionKey is valid.
    // [Downstream Impact] Session data is stored in Firestore and rendered as the card header.
    const openf1Token = await getOpenF1Token();
    const authHeaders: HeadersInit = {};
    if (openf1Token) {
      authHeaders['Authorization'] = `Bearer ${openf1Token}`;
    }

    const sessionRes = await fetch(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`, {
      headers: authHeaders,
    });
    if (!sessionRes.ok) {
      if (sessionRes.status === 401 && !openf1Token) {
        return NextResponse.json(
          {
            success: false,
            error: 'OpenF1 API requires authentication. Please configure OPENF1_USERNAME and OPENF1_PASSWORD environment variables.',
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 }
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 sessions endpoint returned ${sessionRes.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 }
      );
    }

    const sessions = await sessionRes.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No session found for the given session key',
          errorCode: ERROR_CODES.OPENF1_NO_DATA.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    const session = sessions[0];

    // GUID: API_ADMIN_FETCH_TIMING_DATA-006-v02
    // @AUTH_FIX: Added OpenF1 OAuth2 authentication. OpenF1 API now requires auth tokens.
    // [Intent] Fetch the meeting metadata to get the meeting name, location, circuit, and country.
    // [Inbound Trigger] Session data fetched successfully; need meeting context.
    // [Downstream Impact] Meeting data populates the session header fields in Firestore.
    const meetingKey = session.meeting_key;
    const meetingRes = await fetch(`${OPENF1_BASE}/meetings?meeting_key=${meetingKey}`, {
      headers: authHeaders,
    });
    if (!meetingRes.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 meetings endpoint returned ${meetingRes.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 }
      );
    }

    const meetings = await meetingRes.json();
    const meeting = meetings[0] || {};

    // GUID: API_ADMIN_FETCH_TIMING_DATA-007-v03
    // @ENHANCEMENT: Added driver number filtering for focused data queries.
    // @AUTH_FIX: Added OpenF1 OAuth2 authentication. OpenF1 API now requires auth tokens.
    // [Intent] Fetch all drivers (or specific driver if filtered) who participated in the session.
    // [Inbound Trigger] Session and meeting data fetched successfully.
    // [Downstream Impact] Driver list determines how many lap-data requests are made.
    const driversUrl = driverNumber
      ? `${OPENF1_BASE}/drivers?session_key=${sessionKey}&driver_number=${driverNumber}`
      : `${OPENF1_BASE}/drivers?session_key=${sessionKey}`;

    const driversRes = await fetch(driversUrl, {
      headers: authHeaders,
    });
    if (!driversRes.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 drivers endpoint returned ${driversRes.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 }
      );
    }

    const drivers = await driversRes.json();
    if (!Array.isArray(drivers) || drivers.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: driverNumber ? `Driver #${driverNumber} not found in this session` : 'No drivers found for this session',
          errorCode: ERROR_CODES.OPENF1_NO_DATA.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    // GUID: API_ADMIN_FETCH_TIMING_DATA-008-v01
    // [Intent] Deduplicate drivers by driver_number (OpenF1 may return duplicates).
    // [Inbound Trigger] Raw driver list from OpenF1.
    // [Downstream Impact] Ensures each driver appears only once in the timing table.
    const uniqueDrivers = new Map<number, typeof drivers[0]>();
    for (const d of drivers) {
      if (d.driver_number && !uniqueDrivers.has(d.driver_number)) {
        uniqueDrivers.set(d.driver_number, d);
      }
    }

    // GUID: API_ADMIN_FETCH_TIMING_DATA-009-v02
    // @AUTH_FIX: Added OpenF1 OAuth2 authentication. OpenF1 API now requires auth tokens.
    // [Intent] Fetch lap data for each driver in parallel, compute best lap excluding pit-out laps.
    // [Inbound Trigger] Deduplicated driver list ready.
    // [Downstream Impact] Produces the sorted timing data written to Firestore.
    const driverResults = await Promise.all(
      Array.from(uniqueDrivers.values()).map(async (driver) => {
        try {
          const lapsRes = await fetch(
            `${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driver.driver_number}`,
            { headers: authHeaders }
          );
          if (!lapsRes.ok) return null;

          const laps = await lapsRes.json();
          if (!Array.isArray(laps) || laps.length === 0) return null;

          // Filter out pit-out laps and laps without a duration
          const validLaps = laps.filter(
            (lap: any) => lap.lap_duration != null && lap.lap_duration > 0 && !lap.is_pit_out_lap
          );

          if (validLaps.length === 0) return null;

          const bestLap = validLaps.reduce(
            (best: any, lap: any) => (lap.lap_duration < best.lap_duration ? lap : best),
            validLaps[0]
          );

          return {
            driver: driver.last_name || driver.name_acronym || `#${driver.driver_number}`,
            fullName: driver.full_name || driver.last_name || '',
            driverNumber: driver.driver_number,
            team: driver.team_name || 'Unknown',
            teamColour: driver.team_colour || '666666',
            laps: validLaps.length,
            bestLapDuration: bestLap.lap_duration,
            time: formatLapDuration(bestLap.lap_duration),
          };
        } catch {
          return null;
        }
      })
    );

    // Filter out drivers with no valid laps and sort by best lap ascending
    const validResults = driverResults
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.bestLapDuration - b.bestLapDuration)
      .map((r, i) => ({ ...r, position: i + 1 }));

    if (validResults.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid lap data found for any driver in this session',
          errorCode: ERROR_CODES.OPENF1_NO_DATA.code,
          correlationId,
        },
        { status: 404 }
      );
    }

    // GUID: API_ADMIN_FETCH_TIMING_DATA-010-v02
    // @ENHANCEMENT: Added dataType and driverNumber metadata for display context.
    // [Intent] Write the computed timing data to Firestore for ThePaddockPubChat to read.
    // [Inbound Trigger] Valid timing results computed and sorted.
    // [Downstream Impact] Overwrites app-settings/pub-chat-timing. ThePaddockPubChat renders this data.
    const timingData = {
      session: {
        meetingKey,
        meetingName: meeting.meeting_name || session.session_name || 'Unknown Meeting',
        sessionKey,
        sessionName: session.session_name || 'Unknown Session',
        circuitName: meeting.circuit_short_name || '',
        location: meeting.location || '',
        countryName: meeting.country_name || '',
        dateStart: session.date_start || '',
      },
      dataType,
      driverFilter: driverNumber || null,
      drivers: validResults,
      fetchedAt: FieldValue.serverTimestamp(),
      fetchedBy: adminUid,
    };

    await db.doc('app-settings/pub-chat-timing').set(timingData);

    // GUID: API_ADMIN_FETCH_TIMING_DATA-011-v01
    // [Intent] Audit log the fetch operation for compliance and traceability.
    // [Inbound Trigger] Successful Firestore write.
    // [Downstream Impact] Populates audit_logs for admin action tracking.
    await db.collection('audit_logs').add({
      userId: adminUid,
      action: 'ADMIN_FETCH_TIMING_DATA',
      details: {
        sessionKey,
        meetingKey,
        sessionName: session.session_name,
        driverCount: validResults.length,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: `Fetched timing data for ${validResults.length} drivers`,
      driverCount: validResults.length,
      sessionName: session.session_name,
    });

  } catch (error: any) {
    // GUID: API_ADMIN_FETCH_TIMING_DATA-012-v02
    // [Intent] Top-level error handler — catches any unhandled exceptions, logs to error_logs,
    //          and returns a safe 500 response with correlation ID.
    // [Inbound Trigger] Any uncaught exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. Returns correlationId to client.
    const { db: errorDb } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.OPENF1_FETCH_FAILED, {
      correlationId,
      context: { route: '/api/admin/fetch-timing-data', action: 'POST' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, errorDb);

    return NextResponse.json(
      {
        success: false,
        error: traced.definition.message,
        errorCode: traced.definition.code,
        correlationId: traced.correlationId,
      },
      { status: 500 }
    );
  }
}
