// =============================================================================
// FILE:    app/src/app/api/admin/openf1-sessions/route.ts
// AUTHOR:  gill
// DATE:    2026-02-19
// TIME:    ~18:00 UTC
//
// PURPOSE:
//   Admin-only GET endpoint that proxies OpenF1 meetings and sessions lookups
//   for the PubChatPanel dropdown selectors. Avoids CORS issues (OpenF1 does
//   not set permissive CORS headers for all origins) and enforces admin auth
//   so the endpoint cannot be used as a free public proxy.
//
//   Two modes, selected by query parameter:
//     ?year=YYYY      → returns list of meetings for that calendar year
//     ?meetingKey=NNN → returns list of sessions for that meeting
//
// FIXES APPLIED BY GILL — 2026-02-19
// ---------------------------------------------------------------------------
//
//   FIX 1 — TIMEOUT PROTECTION (fetchWithTimeout)
//   All fetch() calls previously had no timeout. If OpenF1 was slow or
//   unresponsive (common outside of race season), the serverless function
//   would hang until the infrastructure-level timeout killed it, producing
//   an uncaught exception and a generic "err_" correlation ID error. Every
//   fetch() call is now replaced with fetchWithTimeout(), which uses
//   AbortController to cancel the request after FETCH_TIMEOUT_MS (10 seconds)
//   and return a clean 504 response with a descriptive error message.
//
//   FIX 2 — SAFE JSON PARSING (safeParseJson)
//   Previously all responses called .json() directly. If OpenF1 returned an
//   HTML page (e.g. a Cloudflare challenge, rate-limit page, or maintenance
//   notice), .json() would throw a SyntaxError that propagated uncaught to
//   the top-level catch block, producing a generic 500. safeParseJson() reads
//   the raw body text first, then tries JSON.parse(), and throws a descriptive
//   Error including the HTTP status and a body preview if parsing fails.
//
//   FIX 3 — VERBOSE LOGGING
//   Added console.log / console.warn / console.error at every significant step
//   so that Firebase App Hosting / Cloud Run logs clearly show request progress.
//
// NOTE ON TOKEN CACHE DUPLICATION:
//   getOpenF1Token() and the cachedToken variable are duplicated between this
//   file and fetch-timing-data/route.ts. Each file maintains its own module-
//   level token cache. They operate independently: a token fetched by one
//   route is not shared with the other. This is acceptable because Next.js
//   route handlers run in the same process and the 55-minute cache means both
//   caches will typically be warm at the same time. A future refactor could
//   extract the token helper to a shared lib file, but that is out of scope
//   for this fix pass.
// =============================================================================

// GUID: API_ADMIN_OPENF1_SESSIONS-000-v03
// AUTHOR: gill — 2026-02-19
// @AUTH_FIX:    Added OpenF1 OAuth2 authentication with token caching (previous author).
// @TIMEOUT_FIX: Added FETCH_TIMEOUT_MS constant and fetchWithTimeout helper (gill).
// @JSON_FIX:    Added safeParseJson helper to guard against HTML error responses (gill).
// [Intent] Module-level declarations — base URLs, timeout constant, token cache.
//          Every OpenF1 HTTP call in this file reads FETCH_TIMEOUT_MS and calls
//          fetchWithTimeout(). The cachedToken is module-scoped so it persists
//          across warm requests within the same server instance.
// [Inbound Trigger] Module loaded by Next.js when this route first receives a request.
// [Downstream Impact] Changing OPENF1_BASE or OPENF1_TOKEN_URL breaks all OpenF1
//                     calls. Changing FETCH_TIMEOUT_MS affects the meetings and
//                     sessions fetches, as well as the token endpoint call.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { getSecret } from '@/lib/secrets-manager';

// Force Next.js to treat this route as fully dynamic at runtime so it does
// not attempt to pre-render it during the build step.
export const dynamic = 'force-dynamic';

// Base URL for all OpenF1 v1 API calls (meetings and sessions endpoints).
const OPENF1_BASE = 'https://api.openf1.org/v1';

// URL used to exchange username/password credentials for an OAuth2 access token.
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

// Maximum milliseconds to wait for any single OpenF1 HTTP call before aborting.
// Must match FETCH_TIMEOUT_MS in fetch-timing-data/route.ts — if you change
// this value, update the other file too to keep behaviour consistent.
const FETCH_TIMEOUT_MS = 10_000;

// Module-level OAuth2 token cache for this route's server instance.
// This cache is independent of the cache in fetch-timing-data/route.ts.
// Structure: { token: string, expiresAt: number (ms epoch) } | null
let cachedToken: { token: string; expiresAt: number } | null = null;


// =============================================================================
// GUID: API_ADMIN_OPENF1_SESSIONS-006-v01
// AUTHOR: gill — 2026-02-19
// [Intent] Wrap the native fetch() with an AbortController-based timeout so
//          that no outbound HTTP call can hang longer than timeoutMs milliseconds.
//          When the timeout fires, AbortController.abort() causes fetch() to
//          throw a DOMException with name "AbortError". The caller catches this
//          and returns an appropriate HTTP 504 response.
// [Inbound Trigger] Called by getOpenF1Token(), and by the meetings and sessions
//                   fetch operations inside the GET handler.
// [Downstream Impact] If timeoutMs is too short, valid slow responses will be
//                     aborted. Currently set to FETCH_TIMEOUT_MS (10 seconds).
// =============================================================================
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  // Create a new AbortController dedicated to this single fetch call.
  // Each request gets its own controller so aborting one does not cancel others.
  const controller = new AbortController();

  // Schedule the abort after timeoutMs. If the request completes normally,
  // we clearTimeout() below so the timer never fires.
  const timeoutId = setTimeout(() => {
    console.warn(`[fetchWithTimeout] Aborting request to ${url} after ${timeoutMs}ms timeout`);
    controller.abort();
  }, timeoutMs);

  try {
    // Merge the caller's RequestInit with our abort signal.
    const response = await fetch(url, { ...options, signal: controller.signal });

    // Request completed before the timeout — cancel the timer.
    clearTimeout(timeoutId);

    return response;
  } catch (err) {
    // Clear the timer on any error to prevent memory leaks.
    clearTimeout(timeoutId);

    // Re-throw so the caller can distinguish AbortError (timeout) from
    // other network errors.
    throw err;
  }
}


// =============================================================================
// GUID: API_ADMIN_OPENF1_SESSIONS-007-v01
// AUTHOR: gill — 2026-02-19
// [Intent] Safely parse the JSON body of an OpenF1 HTTP response by reading
//          the raw text first and then calling JSON.parse(). If parsing fails,
//          throws a descriptive Error including the HTTP status and a 300-char
//          preview of the raw body, making it immediately obvious what OpenF1
//          actually returned (HTML, plain text, etc.).
// [Inbound Trigger] Called after every OpenF1 API response (meetings, sessions,
//                   and the token endpoint) where the body needs to be parsed.
// [Downstream Impact] Prevents SyntaxErrors from propagating to the top-level
//                     catch block and producing generic 500 errors with no
//                     actionable information.
// =============================================================================
async function safeParseJson<T>(
  response: Response,
  context: string,
  correlationId: string,
): Promise<T> {
  // Read the full response body as a string before attempting to parse it.
  // This is the key difference from calling response.json() directly.
  const rawText = await response.text();

  try {
    return JSON.parse(rawText) as T;
  } catch (parseErr) {
    // JSON.parse failed — construct a descriptive error message.
    // Truncate the body preview to 300 chars and collapse whitespace so the
    // message fits on a single log line.
    const preview = rawText.slice(0, 300).replace(/\s+/g, ' ').trim();
    throw new Error(
      `[${context} ${correlationId}] OpenF1 returned non-JSON response ` +
      `(HTTP ${response.status}). Body preview: "${preview}"`
    );
  }
}


// =============================================================================
// GUID: API_ADMIN_OPENF1_SESSIONS-005-v02
// AUTHOR: gill — 2026-02-19 (updated from previous version)
// @AUTH_FIX:    Added OpenF1 OAuth2 authentication with caching (previous author).
// @TIMEOUT_FIX: Now calls fetchWithTimeout() instead of bare fetch() (gill).
// @JSON_FIX:    Token response now parsed via safeParseJson() (gill).
// [Intent] Acquire an OpenF1 OAuth2 access token, caching it for 55 minutes.
//          Returns null if credentials are not configured in environment
//          variables (OPENF1_USERNAME, OPENF1_PASSWORD).
// [Inbound Trigger] Called at the start of the GET handler before any
//                   OpenF1 meetings or sessions request.
// [Downstream Impact] Returning null means all downstream requests are made
//                     without an Authorization header. With a subscription plan,
//                     those requests will receive 401 from OpenF1.
// =============================================================================
async function getOpenF1Token(): Promise<string | null> {
  // Per-token-fetch correlation ID for log tracing.
  const correlationId = generateCorrelationId();

  // Return the cached token if it is still within its valid window.
  // expiresAt is set to Date.now() + 55 minutes when the token is first cached.
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    console.log(`[OpenF1 Auth ${correlationId}] Using cached token (expires in ${Math.round((cachedToken.expiresAt - Date.now()) / 1000)}s)`);
    return cachedToken.token;
  }

  // Read credentials from Azure Key Vault (production) or environment variables (local dev).
  // Production: Secrets stored in prixsix-secrets-vault as 'openf1-username' and 'openf1-password'
  // Local dev: Set OPENF1_USERNAME and OPENF1_PASSWORD in .env.local (falls back automatically)
  let username: string;
  let password: string;

  try {
    // secrets-manager automatically uses Key Vault (if USE_KEY_VAULT=true) or env vars (local dev)
    username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
    password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });
  } catch (error: any) {
    console.warn(
      `[OpenF1 Auth ${correlationId}] Credentials not configured: ${error.message}. ` +
      `Ensure secrets exist in Azure Key Vault (production) or .env.local (development).`
    );
    return null;
  }

  console.log(`[OpenF1 Auth ${correlationId}] Requesting new access token...`);

  try {
    // POST credentials to the token endpoint using fetchWithTimeout.
    const res = await fetchWithTimeout(
      OPENF1_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      },
    );

    // A non-2xx response means our credentials were rejected or the server erred.
    if (!res.ok) {
      console.error(
        `[OpenF1 Auth ${correlationId}] Token endpoint returned HTTP ${res.status}. ` +
        `Verify OPENF1_USERNAME and OPENF1_PASSWORD are correct.`
      );
      return null;
    }

    // Safely parse the token response.
    const data = await safeParseJson<{ access_token: string }>(res, 'OpenF1 token', correlationId);
    const token = data.access_token;

    // Guard against a response that parsed as JSON but lacked access_token.
    if (!token) {
      console.error(`[OpenF1 Auth ${correlationId}] Token response did not contain access_token.`);
      return null;
    }

    // Cache the token for 55 minutes (5-minute safety margin before the 60-min expiry).
    cachedToken = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
    console.log(`[OpenF1 Auth ${correlationId}] Token acquired and cached for 55 minutes.`);
    return token;

  } catch (err) {
    // Covers AbortError (timeout) and network errors from fetchWithTimeout.
    console.error(`[OpenF1 Auth ${correlationId}] Token fetch threw:`, err);
    return null;
  }
}


// =============================================================================
// GUID: API_ADMIN_OPENF1_SESSIONS-001-v03
// AUTHOR: gill — 2026-02-19
// @SECURITY_FIX: Added admin auth (no auth in original version) (previous author).
// @TIMEOUT_FIX:  All fetch() calls replaced with fetchWithTimeout() (gill).
// @JSON_FIX:     All .json() calls replaced with safeParseJson() (gill).
// [Intent] GET handler. Verifies admin auth, then proxies one of two OpenF1
//          endpoints based on the query parameters:
//            ?year=YYYY      → GET /v1/meetings?year=YYYY
//            ?meetingKey=NNN → GET /v1/sessions?meeting_key=NNN
//          Returns a mapped subset of the OpenF1 response so the client only
//          receives the fields it actually needs for the dropdowns.
// [Inbound Trigger] GET /api/admin/openf1-sessions?year=YYYY
//                   GET /api/admin/openf1-sessions?meetingKey=NNN
// [Downstream Impact] No Firestore writes — read-only proxy. Only the admin
//                     UI (PubChatPanel dropdowns) consumes this endpoint.
// =============================================================================
export async function GET(request: NextRequest) {
  // Generate the primary correlation ID for this request.
  const correlationId = generateCorrelationId();

  console.log(`[openf1-sessions GET ${correlationId}] Request received. URL: ${request.url}`);

  try {
    // -------------------------------------------------------------------------
    // Step 1: Verify Firebase Auth token.
    // Must be done first, before any external calls or Firestore reads.
    // -------------------------------------------------------------------------
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      console.warn(`[openf1-sessions GET ${correlationId}] Auth failed — no valid token.`);
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 },
      );
    }

    console.log(`[openf1-sessions GET ${correlationId}] Auth OK. UID: ${verifiedUser.uid}`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_OPENF1_SESSIONS-001-v03 — Step 2: Admin check
    // Fetch the user's Firestore document to verify isAdmin=true.
    // This prevents any authenticated-but-non-admin user from using this
    // endpoint as a free OpenF1 proxy, which could exhaust rate limits or
    // risk getting the server's IP banned by OpenF1.
    // -------------------------------------------------------------------------
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(verifiedUser.uid).get();

    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      console.warn(`[openf1-sessions GET ${correlationId}] UID ${verifiedUser.uid} is not admin.`);
      return NextResponse.json(
        { success: false, error: 'Admin access required', correlationId },
        { status: 403 },
      );
    }

    console.log(`[openf1-sessions GET ${correlationId}] Admin check passed.`);

    // -------------------------------------------------------------------------
    // Step 3: Parse and validate query parameters.
    // Exactly one of ?year or ?meetingKey must be provided.
    // -------------------------------------------------------------------------
    const { searchParams } = new URL(request.url);
    const year       = searchParams.get('year');
    const meetingKey = searchParams.get('meetingKey');

    // If neither parameter is present, reject with 400 — the caller must
    // specify what it wants before we make any outbound request.
    if (!year && !meetingKey) {
      console.warn(`[openf1-sessions GET ${correlationId}] Neither year nor meetingKey provided.`);
      return NextResponse.json(
        {
          success: false,
          error:     'Either year or meetingKey query parameter is required',
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 },
      );
    }

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_OPENF1_SESSIONS-002-v03
    // AUTHOR: gill — 2026-02-19
    // @AUTH_FIX:    Added OpenF1 OAuth2 auth (previous author).
    // @TIMEOUT_FIX: Now calls fetchWithTimeout() (gill).
    // @JSON_FIX:    Now calls safeParseJson() (gill).
    // [Intent] Fetch and return all meetings for the requested calendar year.
    //          Used to populate the "select meeting" dropdown in PubChatPanel.
    // [Inbound Trigger] ?year= query parameter is present.
    // [Downstream Impact] Returns a mapped array of meeting objects.
    //                     Read-only; no Firestore writes.
    // -------------------------------------------------------------------------
    if (year) {
      // Acquire the OpenF1 OAuth2 token before making the API call.
      const openf1Token = await getOpenF1Token();

      // Build auth headers — empty object if no token available.
      const headers: HeadersInit = {};
      if (openf1Token) {
        headers['Authorization'] = `Bearer ${openf1Token}`;
      } else {
        console.warn(`[openf1-sessions GET ${correlationId}] No OpenF1 token — proceeding unauthenticated for meetings fetch.`);
      }

      console.log(`[openf1-sessions GET ${correlationId}] Fetching meetings for year=${year}...`);

      let res: Response;
      try {
        // encodeURIComponent guards against injection if year contains unexpected chars.
        res = await fetchWithTimeout(
          `${OPENF1_BASE}/meetings?year=${encodeURIComponent(year)}`,
          { headers },
        );
      } catch (fetchErr: any) {
        // AbortError = timeout; anything else = network error.
        const isTimeout = fetchErr?.name === 'AbortError';
        console.error(`[openf1-sessions GET ${correlationId}] Meetings fetch ${isTimeout ? 'timed out' : 'failed'}:`, fetchErr);
        return NextResponse.json(
          {
            success: false,
            error: isTimeout
              ? `OpenF1 meetings endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s. The API may be slow outside of race season.`
              : `OpenF1 meetings endpoint network error: ${fetchErr.message}`,
            errorCode:    ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 504 },
        );
      }

      // Handle non-2xx HTTP status from OpenF1.
      if (!res.ok) {
        // Special case: 401 with no token means credentials are not configured.
        if (res.status === 401 && !openf1Token) {
          console.error(`[openf1-sessions GET ${correlationId}] OpenF1 meetings returned 401 — credentials not configured.`);
          return NextResponse.json(
            {
              success: false,
              error:     'OpenF1 API requires authentication. Please configure OPENF1_USERNAME and OPENF1_PASSWORD environment variables.',
              errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
              correlationId,
            },
            { status: 502 },
          );
        }
        console.error(`[openf1-sessions GET ${correlationId}] Meetings endpoint returned HTTP ${res.status}.`);
        return NextResponse.json(
          {
            success: false,
            error:     `OpenF1 meetings endpoint returned ${res.status}`,
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 },
        );
      }

      // Safely parse the meetings response body.
      const meetings = await safeParseJson<any[]>(res, 'meetings', correlationId);

      console.log(`[openf1-sessions GET ${correlationId}] ${Array.isArray(meetings) ? meetings.length : 0} meetings returned for year=${year}.`);

      // Map the OpenF1 meeting objects to the subset of fields the client needs.
      // We only expose what PubChatPanel's dropdown actually uses, avoiding
      // unnecessary data transfer and reducing coupling to OpenF1's schema.
      return NextResponse.json({
        success: true,
        data: Array.isArray(meetings)
          ? meetings.map((m: any) => ({
              meetingKey:  m.meeting_key,
              meetingName: m.meeting_name,
              location:    m.location,
              countryName: m.country_name,
              circuitName: m.circuit_short_name,
              dateStart:   m.date_start,
            }))
          : [], // If OpenF1 returned a non-array, return empty rather than crashing.
      });
    }

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_OPENF1_SESSIONS-003-v03
    // AUTHOR: gill — 2026-02-19
    // @AUTH_FIX:    Added OpenF1 OAuth2 auth (previous author).
    // @TIMEOUT_FIX: Now calls fetchWithTimeout() (gill).
    // @JSON_FIX:    Now calls safeParseJson() (gill).
    // [Intent] Fetch and return all sessions for the requested meetingKey.
    //          Used to populate the "select session" dropdown in PubChatPanel.
    // [Inbound Trigger] ?meetingKey= query parameter is present (and ?year= is absent).
    // [Downstream Impact] Returns a mapped array of session objects.
    //                     Read-only; no Firestore writes.
    // -------------------------------------------------------------------------
    if (meetingKey) {
      // Acquire OAuth2 token for this request.
      const openf1Token = await getOpenF1Token();

      const headers: HeadersInit = {};
      if (openf1Token) {
        headers['Authorization'] = `Bearer ${openf1Token}`;
      } else {
        console.warn(`[openf1-sessions GET ${correlationId}] No OpenF1 token — proceeding unauthenticated for sessions fetch.`);
      }

      console.log(`[openf1-sessions GET ${correlationId}] Fetching sessions for meetingKey=${meetingKey}...`);

      let res: Response;
      try {
        res = await fetchWithTimeout(
          `${OPENF1_BASE}/sessions?meeting_key=${encodeURIComponent(meetingKey)}`,
          { headers },
        );
      } catch (fetchErr: any) {
        const isTimeout = fetchErr?.name === 'AbortError';
        console.error(`[openf1-sessions GET ${correlationId}] Sessions fetch ${isTimeout ? 'timed out' : 'failed'}:`, fetchErr);
        return NextResponse.json(
          {
            success: false,
            error: isTimeout
              ? `OpenF1 sessions endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s. The API may be slow outside of race season.`
              : `OpenF1 sessions endpoint network error: ${fetchErr.message}`,
            errorCode:    ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 504 },
        );
      }

      // Handle non-2xx HTTP status.
      if (!res.ok) {
        if (res.status === 401 && !openf1Token) {
          console.error(`[openf1-sessions GET ${correlationId}] OpenF1 sessions returned 401 — credentials not configured.`);
          return NextResponse.json(
            {
              success: false,
              error:     'OpenF1 API requires authentication. Please configure OPENF1_USERNAME and OPENF1_PASSWORD environment variables.',
              errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
              correlationId,
            },
            { status: 502 },
          );
        }
        console.error(`[openf1-sessions GET ${correlationId}] Sessions endpoint returned HTTP ${res.status}.`);
        return NextResponse.json(
          {
            success: false,
            error:     `OpenF1 sessions endpoint returned ${res.status}`,
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 },
        );
      }

      // Safely parse the sessions response.
      const sessions = await safeParseJson<any[]>(res, 'sessions', correlationId);

      console.log(`[openf1-sessions GET ${correlationId}] ${Array.isArray(sessions) ? sessions.length : 0} sessions returned for meetingKey=${meetingKey}.`);

      // Map to the subset of fields the client dropdown needs.
      return NextResponse.json({
        success: true,
        data: Array.isArray(sessions)
          ? sessions.map((s: any) => ({
              sessionKey:  s.session_key,
              sessionName: s.session_name,
              dateStart:   s.date_start,
            }))
          : [],
      });
    }

    // This line is unreachable because the !year && !meetingKey guard at the
    // top of the try block returns before we get here. It exists to satisfy
    // TypeScript's exhaustiveness check.
    return NextResponse.json({ success: false, error: 'Invalid parameters' }, { status: 400 });

  } catch (error: any) {
    // =========================================================================
    // GUID: API_ADMIN_OPENF1_SESSIONS-004-v03
    // AUTHOR: gill — 2026-02-19
    // [Intent] Top-level catch block. Handles any uncaught exception from the
    //          GET handler (e.g. getFirebaseAdmin() failure, unexpected thrown value).
    //          Logs a traced error to Firestore error_logs and returns a safe 500
    //          response. The correlationId allows the developer to find the full
    //          error detail in the error_logs collection.
    // [Inbound Trigger] Any unhandled exception within the GET handler.
    // [Downstream Impact] Writes to error_logs. correlationId returned to client
    //                     for support reference.
    // =========================================================================
    console.error(`[openf1-sessions GET ${correlationId}] Unhandled exception:`, error);

    try {
      // Attempt to log the traced error to Firestore. Wrapped in its own
      // try/catch in case Firebase Admin itself is broken.
      const { db } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.OPENF1_FETCH_FAILED, {
        correlationId,
        context: { route: '/api/admin/openf1-sessions', action: 'GET' },
        cause: error instanceof Error ? error : undefined,
      });
      await logTracedError(traced, db);

      return NextResponse.json(
        {
          success:       false,
          error:         traced.definition.message,
          errorCode:     traced.definition.code,
          correlationId: traced.correlationId,
        },
        { status: 500 },
      );
    } catch (loggingErr) {
      // Even the error-logging path failed. Return a minimal safe response.
      console.error(`[openf1-sessions GET ${correlationId}] Error logging also failed:`, loggingErr);
      return NextResponse.json(
        {
          success:      false,
          error:        'An unexpected error occurred',
          errorCode:    ERROR_CODES.UNEXPECTED_ERROR?.code ?? 'PX-9001',
          correlationId,
        },
        { status: 500 },
      );
    }
  }
}
