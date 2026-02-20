// GUID: API_ADMIN_OPENF1_LOCATION-000-v01
// @FEATURE: Server-side proxy for OpenF1 location data (GPS coordinates of cars on track).
// [Intent] Fetch real-time car positions from OpenF1 /location endpoint with OAuth2 authentication.
//          Prevents client-side CORS issues and properly handles OpenF1 OAuth2 token.
// [Inbound Trigger] GET /api/admin/openf1-location?sessionKey={number}
// [Downstream Impact] Returns array of car positions with GPS coordinates and speed data.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { getSecret } from '@/lib/secrets-manager';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

// Module-level token cache (same as openf1-sessions)
let cachedToken: { token: string; expiresAt: number } | null = null;

// GUID: API_ADMIN_OPENF1_LOCATION-001-v01
// [Intent] Get OpenF1 OAuth2 access token with caching.
// [Inbound Trigger] Called before fetching location data.
// [Downstream Impact] Returns cached token if valid, otherwise fetches new token.
async function getOpenF1Token(): Promise<string | null> {
    const correlationId = generateCorrelationId();

    // Check cache
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
        console.log(`[OpenF1 Auth ${correlationId}] Using cached token`);
        return cachedToken.token;
    }

    try {
        const username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
        const password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });

        console.log(`[OpenF1 Auth ${correlationId}] Requesting new token...`);
        const res = await fetch(OPENF1_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username, password }),
        });

        if (!res.ok) {
            console.error(`[OpenF1 Auth ${correlationId}] Token request failed: ${res.status}`);
            return null;
        }

        const data = await res.json();
        const token = data.access_token;

        if (!token) {
            console.error(`[OpenF1 Auth ${correlationId}] No access_token in response`);
            return null;
        }

        cachedToken = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
        console.log(`[OpenF1 Auth ${correlationId}] Token acquired`);
        return token;

    } catch (err) {
        console.error(`[OpenF1 Auth ${correlationId}] Error:`, err);
        return null;
    }
}

// GUID: API_ADMIN_OPENF1_LOCATION-002-v01
// [Intent] GET handler - fetch location data for a session from OpenF1.
// [Inbound Trigger] GET /api/admin/openf1-location?sessionKey=12345
// [Downstream Impact] Returns array of car positions or error response.
export async function GET(request: NextRequest) {
    const correlationId = generateCorrelationId();
    console.log(`[openf1-location GET ${correlationId}] Request received`);

    try {
        // Auth check
        const authHeader = request.headers.get('Authorization');
        const verifiedUser = await verifyAuthToken(authHeader);

        if (!verifiedUser) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized', correlationId },
                { status: 401 }
            );
        }

        // Get sessionKey from query params
        const { searchParams } = new URL(request.url);
        const sessionKey = searchParams.get('sessionKey');

        if (!sessionKey || isNaN(Number(sessionKey))) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Missing or invalid sessionKey parameter',
                    errorCode: ERRORS.VALIDATION_MISSING_FIELDS.code,
                    correlationId,
                },
                { status: 400 }
            );
        }

        // Get OpenF1 token
        const openf1Token = await getOpenF1Token();
        if (!openf1Token) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Failed to authenticate with OpenF1',
                    errorCode: ERRORS.OPENF1_FETCH_FAILED.code,
                    correlationId,
                },
                { status: 502 }
            );
        }

        // Fetch location data from OpenF1
        console.log(`[openf1-location GET ${correlationId}] Fetching location data for session ${sessionKey}...`);
        const res = await fetch(
            `${OPENF1_BASE}/location?session_key=${sessionKey}`,
            {
                headers: { 'Authorization': `Bearer ${openf1Token}` },
            }
        );

        if (!res.ok) {
            console.error(`[openf1-location GET ${correlationId}] OpenF1 returned ${res.status}`);
            return NextResponse.json(
                {
                    success: false,
                    error: `OpenF1 location endpoint returned ${res.status}`,
                    errorCode: ERRORS.OPENF1_FETCH_FAILED.code,
                    correlationId,
                },
                { status: 502 }
            );
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
            console.warn(`[openf1-location GET ${correlationId}] Unexpected response format`);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Unexpected response format from OpenF1',
                    errorCode: ERRORS.OPENF1_NO_DATA.code,
                    correlationId,
                },
                { status: 502 }
            );
        }

        console.log(`[openf1-location GET ${correlationId}] ${data.length} position records returned`);

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
        });

    } catch (error: any) {
        console.error(`[openf1-location GET ${correlationId}] Error:`, error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch location data',
                errorCode: ERRORS.OPENF1_FETCH_FAILED.code,
                correlationId,
            },
            { status: 500 }
        );
    }
}
