// GUID: API_ADMIN_OPENF1_DRIVERS-000-v01
// [Intent] Admin API route for fetching driver list from OpenF1 API to populate driver filter dropdown.
// [Inbound Trigger] GET request from PubChatPanel when a session is selected.
// [Downstream Impact] Returns driver list for the selected session. No Firestore writes.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

// In-memory token cache (shared with openf1-sessions route)
let cachedToken: { token: string; expiresAt: number } | null = null;

// GUID: API_ADMIN_OPENF1_DRIVERS-001-v01
// [Intent] Get OpenF1 OAuth2 access token with caching.
// [Inbound Trigger] Called before OpenF1 API request.
// [Downstream Impact] Returns cached token if valid, otherwise fetches new token.
async function getOpenF1Token(): Promise<string | null> {
  const correlationId = generateCorrelationId();

  // Check cache first
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const username = process.env.OPENF1_USERNAME;
  const password = process.env.OPENF1_PASSWORD;

  if (!username || !password) {
    console.warn(`[OpenF1 Auth ${correlationId}] Credentials not configured`);
    return null;
  }

  try {
    const res = await fetch(OPENF1_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
    });

    if (!res.ok) {
      console.error(`[OpenF1 Auth ${correlationId}] Token fetch failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + 55 * 60 * 1000, // 55 minutes
    };

    console.log(`[OpenF1 Auth ${correlationId}] Token refreshed`);
    return cachedToken.token;
  } catch (err) {
    console.error(`[OpenF1 Auth ${correlationId}]`, err);
    return null;
  }
}

// GUID: API_ADMIN_OPENF1_DRIVERS-002-v01
// [Intent] GET handler that fetches drivers for a given session from OpenF1 API.
// [Inbound Trigger] GET /api/admin/openf1-drivers?sessionKey=NNN
// [Downstream Impact] Returns JSON array of drivers with number and name.
export async function GET(request: NextRequest) {
  const correlationId = generateCorrelationId();

  try {
    // Authentication check
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
    const sessionKey = searchParams.get('sessionKey');

    if (!sessionKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'sessionKey query parameter is required',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 }
      );
    }

    // GUID: API_ADMIN_OPENF1_DRIVERS-003-v01
    // [Intent] Fetch drivers from OpenF1 API with authentication.
    // [Inbound Trigger] Valid session key provided.
    // [Downstream Impact] Returns deduplicated driver list sorted by driver number.
    const openf1Token = await getOpenF1Token();
    const headers: HeadersInit = {};
    if (openf1Token) {
      headers['Authorization'] = `Bearer ${openf1Token}`;
    }

    const res = await fetch(`${OPENF1_BASE}/drivers?session_key=${encodeURIComponent(sessionKey)}`, {
      headers,
    });

    if (!res.ok) {
      if (res.status === 401 && !openf1Token) {
        return NextResponse.json(
          {
            success: false,
            error: 'OpenF1 API requires authentication',
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 drivers endpoint returned ${res.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 }
      );
    }

    const drivers = await res.json();

    // Deduplicate by driver number and format for dropdown
    const uniqueDrivers = new Map<number, { number: number; name: string }>();
    if (Array.isArray(drivers)) {
      for (const d of drivers) {
        if (d.driver_number && !uniqueDrivers.has(d.driver_number)) {
          uniqueDrivers.set(d.driver_number, {
            number: d.driver_number,
            name: d.last_name || d.name_acronym || d.full_name || `#${d.driver_number}`,
          });
        }
      }
    }

    const driverList = Array.from(uniqueDrivers.values()).sort((a, b) => a.number - b.number);

    return NextResponse.json({
      success: true,
      data: driverList,
    });

  } catch (error: any) {
    // GUID: API_ADMIN_OPENF1_DRIVERS-004-v01
    // [Intent] Top-level error handler.
    // [Inbound Trigger] Any uncaught exception.
    // [Downstream Impact] Logs error and returns safe 500 response.
    const { db } = await getFirebaseAdmin();
    const traced = createTracedError(ERRORS.OPENF1_FETCH_FAILED, {
      correlationId,
      context: { route: '/api/admin/openf1-drivers', action: 'GET' },
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
