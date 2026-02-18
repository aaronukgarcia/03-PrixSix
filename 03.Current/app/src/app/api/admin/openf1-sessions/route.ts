// GUID: API_ADMIN_OPENF1_SESSIONS-000-v02
// @AUTH_FIX: Added OpenF1 OAuth2 authentication with token caching. OpenF1 API changed from
//   public to authenticated access, requiring username/password → access token flow.
//   Requires env vars: OPENF1_USERNAME, OPENF1_PASSWORD
// [Intent] Admin API route that proxies OpenF1 meetings and sessions endpoints for the PubChatPanel
//          dropdown selectors. Avoids CORS issues and allows admin auth verification.
// [Inbound Trigger] GET request from PubChatPanel when populating meeting/session dropdowns.
// [Downstream Impact] Returns meeting or session lists from OpenF1. No Firestore writes.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

// In-memory token cache (expires after 55 minutes, OpenF1 tokens last 1 hour)
let cachedToken: { token: string; expiresAt: number } | null = null;

// GUID: API_ADMIN_OPENF1_SESSIONS-005-v01
// [Intent] Get OpenF1 OAuth2 access token with caching to avoid repeated auth requests.
// [Inbound Trigger] Called before each OpenF1 API request.
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

// GUID: API_ADMIN_OPENF1_SESSIONS-001-v02
// @SECURITY_FIX: Added authentication and admin verification. Previous version had NO AUTH,
//   allowing anyone to use this endpoint as a public proxy to OpenF1 API, enabling:
//   - IP hiding (attacker uses your server as proxy)
//   - Rate limit bypass
//   - Resource exhaustion (unlimited proxy requests)
//   - Risk of your server IP getting banned by OpenF1
// [Intent] GET handler that proxies OpenF1 meetings (when ?year= is provided) or sessions
//          (when ?meetingKey= is provided) to populate admin UI dropdowns.
// [Inbound Trigger] GET /api/admin/openf1-sessions?year=YYYY or ?meetingKey=NNN
// [Downstream Impact] Returns JSON array of meetings or sessions. Read-only; no state changes.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // SECURITY: Verify authentication and admin status before proxying external API
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 }
      );
    }

    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Admin access required', correlationId },
        { status: 403 }
      );
    }

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

    // GUID: API_ADMIN_OPENF1_SESSIONS-002-v02
    // @AUTH_FIX: Added OpenF1 OAuth2 authentication. OpenF1 API now requires auth tokens.
    // [Intent] Fetch meetings for a given year from OpenF1.
    // [Inbound Trigger] ?year= query parameter present.
    // [Downstream Impact] Returns meeting list for the dropdown.
    if (year) {
      // Get OpenF1 access token (cached or fresh)
      const openf1Token = await getOpenF1Token();

      const headers: HeadersInit = {};
      if (openf1Token) {
        headers['Authorization'] = `Bearer ${openf1Token}`;
      }

      const res = await fetch(`${OPENF1_BASE}/meetings?year=${encodeURIComponent(year)}`, {
        headers,
      });

      if (!res.ok) {
        // If 401 and no token configured, provide helpful error message
        if (res.status === 401 && !openf1Token) {
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

    // GUID: API_ADMIN_OPENF1_SESSIONS-003-v02
    // @AUTH_FIX: Added OpenF1 OAuth2 authentication. OpenF1 API now requires auth tokens.
    // [Intent] Fetch sessions for a given meeting from OpenF1.
    // [Inbound Trigger] ?meetingKey= query parameter present.
    // [Downstream Impact] Returns session list for the dropdown.
    if (meetingKey) {
      // Get OpenF1 access token (cached or fresh)
      const openf1Token = await getOpenF1Token();

      const headers: HeadersInit = {};
      if (openf1Token) {
        headers['Authorization'] = `Bearer ${openf1Token}`;
      }

      const res = await fetch(`${OPENF1_BASE}/sessions?meeting_key=${encodeURIComponent(meetingKey)}`, {
        headers,
      });

      if (!res.ok) {
        // If 401 and no token configured, provide helpful error message
        if (res.status === 401 && !openf1Token) {
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
    // GUID: API_ADMIN_OPENF1_SESSIONS-004-v02
    // [Intent] Top-level error handler — logs to error_logs and returns safe 500 response.
    // [Inbound Trigger] Any uncaught exception within the GET handler.
    // [Downstream Impact] Writes to error_logs. Returns correlationId for debugging.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.OPENF1_FETCH_FAILED, {
      correlationId,
      context: { route: '/api/admin/openf1-sessions', action: 'GET' },
      cause: error instanceof Error ? error : undefined,
    });
    await logTracedError(traced, db);

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
