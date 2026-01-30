// GUID: API_ADMIN_OPENF1_SESSIONS-000-v01
// [Intent] Admin API route that proxies OpenF1 meetings and sessions endpoints for the PubChatPanel
//          dropdown selectors. Avoids CORS issues and allows admin auth verification.
// [Inbound Trigger] GET request from PubChatPanel when populating meeting/session dropdowns.
// [Downstream Impact] Returns meeting or session lists from OpenF1. No Firestore writes.

import { NextRequest, NextResponse } from 'next/server';
import { generateCorrelationId, logError } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';

// GUID: API_ADMIN_OPENF1_SESSIONS-001-v01
// [Intent] GET handler that proxies OpenF1 meetings (when ?year= is provided) or sessions
//          (when ?meetingKey= is provided) to populate admin UI dropdowns.
// [Inbound Trigger] GET /api/admin/openf1-sessions?year=YYYY or ?meetingKey=NNN
// [Downstream Impact] Returns JSON array of meetings or sessions. Read-only; no state changes.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const meetingKey = searchParams.get('meetingKey');

    if (!year && !meetingKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either year or meetingKey query parameter is required',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_ADMIN_OPENF1_SESSIONS-002-v01
    // [Intent] Fetch meetings for a given year from OpenF1.
    // [Inbound Trigger] ?year= query parameter present.
    // [Downstream Impact] Returns meeting list for the dropdown.
    if (year) {
      const res = await fetch(`${OPENF1_BASE}/meetings?year=${encodeURIComponent(year)}`);
      if (!res.ok) {
        return NextResponse.json(
          {
            success: false,
            error: `OpenF1 meetings endpoint returned ${res.status}`,
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 }
        );
      }

      const meetings = await res.json();
      return NextResponse.json({
        success: true,
        data: Array.isArray(meetings)
          ? meetings.map((m: any) => ({
              meetingKey: m.meeting_key,
              meetingName: m.meeting_name,
              location: m.location,
              countryName: m.country_name,
              circuitName: m.circuit_short_name,
              dateStart: m.date_start,
            }))
          : [],
      });
    }

    // GUID: API_ADMIN_OPENF1_SESSIONS-003-v01
    // [Intent] Fetch sessions for a given meeting from OpenF1.
    // [Inbound Trigger] ?meetingKey= query parameter present.
    // [Downstream Impact] Returns session list for the dropdown.
    if (meetingKey) {
      const res = await fetch(`${OPENF1_BASE}/sessions?meeting_key=${encodeURIComponent(meetingKey)}`);
      if (!res.ok) {
        return NextResponse.json(
          {
            success: false,
            error: `OpenF1 sessions endpoint returned ${res.status}`,
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 }
        );
      }

      const sessions = await res.json();
      return NextResponse.json({
        success: true,
        data: Array.isArray(sessions)
          ? sessions.map((s: any) => ({
              sessionKey: s.session_key,
              sessionName: s.session_name,
              dateStart: s.date_start,
            }))
          : [],
      });
    }

    // Unreachable — caught by the !year && !meetingKey guard above
    return NextResponse.json({ success: false, error: 'Invalid parameters' }, { status: 400 });

  } catch (error: any) {
    // GUID: API_ADMIN_OPENF1_SESSIONS-004-v01
    // [Intent] Top-level error handler — logs to error_logs and returns safe 500 response.
    // [Inbound Trigger] Any uncaught exception within the GET handler.
    // [Downstream Impact] Writes to error_logs. Returns correlationId for debugging.
    console.error(`[OpenF1 Sessions Error ${correlationId}]`, error);

    await logError({
      correlationId,
      error,
      context: {
        route: '/api/admin/openf1-sessions',
        action: 'GET',
        additionalInfo: {
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          errorType: error.code || error.name || 'UnknownError',
        },
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch OpenF1 data. Please try again.',
        errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
        correlationId,
      },
      { status: 500 }
    );
  }
}
