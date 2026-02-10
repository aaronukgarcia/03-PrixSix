// GUID: API_ADMIN_FETCH_TIMING_DATA-000-v01
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

// GUID: API_ADMIN_FETCH_TIMING_DATA-001-v02
// @SECURITY_FIX: Removed adminUid from schema - now uses authenticated user's UID instead.
//   Previous version allowed parameter tampering: attacker could submit any admin UID.
// [Intent] Zod schema for validating the fetch request — requires sessionKey only.
// [Inbound Trigger] Every incoming POST request body is parsed against this schema.
// [Downstream Impact] Rejects malformed requests before any OpenF1 API calls are made.
const fetchTimingRequestSchema = z.object({
  sessionKey: z.number().int().positive(),
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

    const { sessionKey } = parsed.data;
    const { db, FieldValue } = await getFirebaseAdmin();

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

    // GUID: API_ADMIN_FETCH_TIMING_DATA-005-v01
    // [Intent] Fetch session metadata from OpenF1 to populate the session header in the UI.
    // [Inbound Trigger] Admin check passed; sessionKey is valid.
    // [Downstream Impact] Session data is stored in Firestore and rendered as the card header.
    const sessionRes = await fetch(`${OPENF1_BASE}/sessions?session_key=${sessionKey}`);
    if (!sessionRes.ok) {
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

    // GUID: API_ADMIN_FETCH_TIMING_DATA-006-v01
    // [Intent] Fetch the meeting metadata to get the meeting name, location, circuit, and country.
    // [Inbound Trigger] Session data fetched successfully; need meeting context.
    // [Downstream Impact] Meeting data populates the session header fields in Firestore.
    const meetingKey = session.meeting_key;
    const meetingRes = await fetch(`${OPENF1_BASE}/meetings?meeting_key=${meetingKey}`);
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

    // GUID: API_ADMIN_FETCH_TIMING_DATA-007-v01
    // [Intent] Fetch all drivers who participated in the session.
    // [Inbound Trigger] Session and meeting data fetched successfully.
    // [Downstream Impact] Driver list determines how many lap-data requests are made.
    const driversRes = await fetch(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`);
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
          error: 'No drivers found for this session',
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

    // GUID: API_ADMIN_FETCH_TIMING_DATA-009-v01
    // [Intent] Fetch lap data for each driver in parallel, compute best lap excluding pit-out laps.
    // [Inbound Trigger] Deduplicated driver list ready.
    // [Downstream Impact] Produces the sorted timing data written to Firestore.
    const driverResults = await Promise.all(
      Array.from(uniqueDrivers.values()).map(async (driver) => {
        try {
          const lapsRes = await fetch(
            `${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driver.driver_number}`
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

    // GUID: API_ADMIN_FETCH_TIMING_DATA-010-v01
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
