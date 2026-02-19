// =============================================================================
// FILE:    app/src/app/api/admin/fetch-timing-data/route.ts
// AUTHOR:  gill
// DATE:    2026-02-19
// TIME:    ~18:00 UTC
//
// PURPOSE:
//   Admin-only POST endpoint. Receives a sessionKey, fetches the matching
//   session metadata, meeting metadata, driver list, and per-driver lap times
//   from the OpenF1 API, computes the best valid lap per driver, sorts the
//   results, and writes the final object to Firestore at
//   app-settings/pub-chat-timing. The ThePaddockPubChat component reads that
//   document to render the live timing card.
//
// FIXES APPLIED BY GILL — 2026-02-19
// ---------------------------------------------------------------------------
//
//   FIX 1 — TIMEOUT PROTECTION (fetchWithTimeout)
//   Root cause of correlation ID err_mltvda18_e8c93192:
//   Every fetch() call in the previous version had NO timeout. Node.js fetch
//   does not apply a default timeout. When the OpenF1 API is slow or hanging
//   outside of race season (or during infrastructure issues), the request
//   would hang indefinitely. Eventually the serverless function's own wall-
//   clock limit would kill it and throw an uncaught exception, which landed
//   in the top-level catch block and produced a generic OPENF1_FETCH_FAILED
//   error with an "err_" correlation ID but no actionable detail.
//   Fix: every fetch() call is now replaced with fetchWithTimeout(), which
//   uses an AbortController to cancel the request after FETCH_TIMEOUT_MS
//   (10 seconds). If the timeout fires, fetch throws an AbortError, which
//   the caller catches gracefully and returns a 504 response with a clear
//   message explaining that OpenF1 timed out.
//
//   FIX 2 — SAFE JSON PARSING (safeParseJson)
//   Previously, all responses called .json() directly. If OpenF1 returned
//   an HTML page instead of JSON (e.g. a Cloudflare challenge page, a rate-
//   limit page, or a maintenance notice), .json() throws a SyntaxError.
//   That SyntaxError propagated uncaught to the top-level catch block,
//   producing a generic 500 with no information about what was actually
//   returned. Fix: safeParseJson() reads the raw response body as text first,
//   then tries to JSON.parse it, and if that fails it throws a descriptive
//   Error that includes the HTTP status and the first 300 characters of the
//   raw body, giving a clear picture of what OpenF1 actually returned.
//
//   FIX 3 — VERBOSE LOGGING
//   Added console.log / console.warn / console.error calls at every
//   significant step so that Firebase App Hosting / Cloud Run logs clearly
//   show the progress and location of any failure.
//
// UNCHANGED BEHAVIOUR:
//   Auth flow, admin check, Zod validation, Firestore write target, and audit
//   logging are all unchanged. Only the HTTP fetch layer is hardened.
// =============================================================================

// GUID: API_ADMIN_FETCH_TIMING_DATA-000-v03
// AUTHOR: gill — 2026-02-19
// @AUTH_FIX:    OpenF1 OAuth2 authentication with token caching (previous author).
// @TIMEOUT_FIX: Added FETCH_TIMEOUT_MS constant and fetchWithTimeout helper (gill).
// @JSON_FIX:    Added safeParseJson helper to guard against HTML error responses (gill).
// [Intent] Module-level declarations — base URLs, timeout constant, token cache.
//          Every OpenF1 HTTP call in this file reads FETCH_TIMEOUT_MS and calls
//          fetchWithTimeout(). The token cache is module-scoped so it survives
//          across warm requests within the same server instance.
// [Inbound Trigger] Loaded once by Next.js when this route first receives a request.
// [Downstream Impact] Changing OPENF1_BASE or OPENF1_TOKEN_URL breaks all OpenF1
//                     calls. Changing FETCH_TIMEOUT_MS affects ALL fetch operations
//                     in this file (token, session, meeting, drivers, laps).

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError, verifyAuthToken } from '@/lib/firebase-admin';
import { ERROR_CODES } from '@/lib/error-codes';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { z } from 'zod';

// Force Next.js to treat this route as fully dynamic at runtime.
// Without this, the static analyser may try to pre-render it and fail because
// it references environment variables and makes outbound HTTP calls.
export const dynamic = 'force-dynamic';

// Base URL for all OpenF1 v1 API calls (sessions, meetings, drivers, laps).
const OPENF1_BASE = 'https://api.openf1.org/v1';

// URL used to exchange username/password for an OAuth2 access token.
// This is a POST endpoint that accepts application/x-www-form-urlencoded body.
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';

// Maximum milliseconds to wait for any single OpenF1 HTTP call before aborting.
// 10 seconds is generous for a well-behaved API and avoids indefinite hangs
// outside of race season when OpenF1 infrastructure may be quieter or slower.
// If you need to raise this (e.g. for very large lap datasets), update BOTH
// this constant and the equivalent one in openf1-sessions/route.ts.
const FETCH_TIMEOUT_MS = 10_000;

// Module-level OAuth2 token cache. Shared across all warm requests on the
// same server instance. Avoids a round-trip to OPENF1_TOKEN_URL on every call.
// Structure: { token: string, expiresAt: number (ms epoch) } | null
let cachedToken: { token: string; expiresAt: number } | null = null;


// =============================================================================
// GUID: API_ADMIN_FETCH_TIMING_DATA-014-v01
// AUTHOR: gill — 2026-02-19
// [Intent] Wrap the native fetch() with an AbortController-based timeout so
//          that no outbound HTTP call can hang longer than timeoutMs.
//          This is the core fix for the "err_mltvda18_e8c93192" class of errors.
//          When the timeout fires, AbortController.abort() is called, which
//          causes fetch() to throw a DOMException with name "AbortError".
//          The caller is responsible for catching and handling the AbortError.
// [Inbound Trigger] Called by getOpenF1Token(), and every OpenF1 data fetch
//                   inside the POST handler (session, meeting, drivers, laps).
// [Downstream Impact] If timeoutMs is too short, valid slow responses will be
//                     aborted. If timeoutMs is too long, the benefit is reduced.
//                     Currently set to FETCH_TIMEOUT_MS (10 seconds).
// =============================================================================
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  // Create a new AbortController for this specific request.
  // Each request gets its own controller so aborting one does not affect others.
  const controller = new AbortController();

  // Schedule the abort signal to fire after timeoutMs milliseconds.
  // setTimeout returns a NodeJS.Timeout handle which we must clear on success
  // to prevent the timer from firing after the request has already completed.
  const timeoutId = setTimeout(() => {
    // Log the timeout so Cloud Run / App Hosting logs capture which URL hung.
    console.warn(`[fetchWithTimeout] Aborting request to ${url} after ${timeoutMs}ms timeout`);
    controller.abort();
  }, timeoutMs);

  try {
    // Merge the caller's options with our abort signal.
    // If the caller also passed a signal, this overwrites it — that is acceptable
    // because no caller in this file uses its own signal.
    const response = await fetch(url, { ...options, signal: controller.signal });

    // Request completed within the time limit — cancel the pending timeout
    // timer so it does not fire unnecessarily after the function returns.
    clearTimeout(timeoutId);

    return response;
  } catch (err) {
    // Clear the timer regardless of what threw, to avoid memory leaks.
    clearTimeout(timeoutId);

    // Re-throw so the caller can handle it (AbortError → 504, network error → 502).
    throw err;
  }
}


// =============================================================================
// GUID: API_ADMIN_FETCH_TIMING_DATA-015-v01
// AUTHOR: gill — 2026-02-19
// [Intent] Safely parse the JSON body of an OpenF1 HTTP response.
//          Reads the raw text first, then calls JSON.parse(). If parsing fails
//          (because OpenF1 returned an HTML page, a Cloudflare challenge, or any
//          other non-JSON body), throws a descriptive Error that includes the
//          HTTP status code and the first 300 characters of the raw body.
//          This replaces direct .json() calls throughout the POST handler.
// [Inbound Trigger] Called after every successful (res.ok) or non-ok response
//                   where we need to inspect the body (token endpoint, session,
//                   meeting, drivers — NOT laps, which have their own inline guard).
// [Downstream Impact] If OpenF1 changes its response format to something other
//                     than JSON, this function will throw with a helpful message
//                     instead of a cryptic "Unexpected token '<'" SyntaxError.
// =============================================================================
async function safeParseJson<T>(
  response: Response,
  context: string,
  correlationId: string,
): Promise<T> {
  // Read the entire response body as plain text first.
  // This avoids the SyntaxError that .json() throws on non-JSON bodies.
  const rawText = await response.text();

  try {
    // Attempt to parse the text as JSON.
    return JSON.parse(rawText) as T;
  } catch (parseErr) {
    // JSON.parse failed — OpenF1 returned something that is not valid JSON.
    // Include the HTTP status and a preview of the raw body in the error
    // message so that the developer can immediately understand what was returned.
    const preview = rawText.slice(0, 300).replace(/\s+/g, ' ').trim();
    throw new Error(
      `[${context} ${correlationId}] OpenF1 returned non-JSON response ` +
      `(HTTP ${response.status}). Body preview: "${preview}"`
    );
  }
}


// =============================================================================
// GUID: API_ADMIN_FETCH_TIMING_DATA-013-v02
// AUTHOR: gill — 2026-02-19 (updated from previous version)
// @AUTH_FIX:    Added OpenF1 OAuth2 authentication with caching (previous author).
// @TIMEOUT_FIX: Now calls fetchWithTimeout() instead of bare fetch() (gill).
// @JSON_FIX:    Token endpoint response now parsed via safeParseJson() (gill).
// [Intent] Acquire an OpenF1 OAuth2 access token, caching it for 55 minutes
//          to avoid a token round-trip on every API call. Returns null if
//          credentials are not configured (falls back to public/unauthenticated
//          access, which will likely receive a 401 from OpenF1).
// [Inbound Trigger] Called at the start of the POST handler before any
//                   OpenF1 data fetch. Also called by openf1-sessions/route.ts
//                   which has its own independent copy of this function.
// [Downstream Impact] If this returns null, all downstream OpenF1 calls are
//                     made without an Authorization header. With a subscription
//                     plan, those calls will receive 401 responses.
//                     If this throws (e.g. token endpoint timeout), it propagates
//                     to the POST handler's top-level catch block.
// =============================================================================
async function getOpenF1Token(): Promise<string | null> {
  // Generate a correlation ID specifically for this token-fetch attempt.
  // This is separate from the main request correlation ID so token errors
  // can be traced independently in the logs.
  const correlationId = generateCorrelationId();

  // Check whether the cached token is still valid before making a network call.
  // cachedToken.expiresAt is set to Date.now() + 55 minutes when the token
  // is first acquired. We compare against Date.now() to account for elapsed time.
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    console.log(`[OpenF1 Auth ${correlationId}] Using cached token (expires in ${Math.round((cachedToken.expiresAt - Date.now()) / 1000)}s)`);
    return cachedToken.token;
  }

  // Read credentials from environment variables.
  // These must be set as Firebase App Hosting secrets via:
  //   firebase apphosting:secrets:set OPENF1_USERNAME --backend prixsix
  //   firebase apphosting:secrets:set OPENF1_PASSWORD --backend prixsix
  const username = process.env.OPENF1_USERNAME;
  const password = process.env.OPENF1_PASSWORD;

  // If either credential is absent, warn and return null.
  // This is a configuration error, not a runtime error — the developer
  // needs to set the environment variables in Firebase App Hosting secrets.
  if (!username || !password) {
    console.warn(
      `[OpenF1 Auth ${correlationId}] Credentials not configured. ` +
      `Ensure OPENF1_USERNAME and OPENF1_PASSWORD are set as App Hosting secrets.`
    );
    // Returning null signals to the caller that we have no token.
    // The caller will make OpenF1 requests without an Authorization header.
    return null;
  }

  console.log(`[OpenF1 Auth ${correlationId}] Requesting new access token from ${OPENF1_TOKEN_URL}`);

  try {
    // POST to the OpenF1 token endpoint with credentials as a form-encoded body.
    // Using fetchWithTimeout so a slow/hanging token endpoint does not block forever.
    const res = await fetchWithTimeout(
      OPENF1_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          // OpenF1 token endpoint requires standard form encoding, not JSON.
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ username, password }),
      },
    );

    // A non-2xx status from the token endpoint means our credentials were
    // rejected (401), or there is a server-side problem (5xx).
    if (!res.ok) {
      console.error(
        `[OpenF1 Auth ${correlationId}] Token endpoint returned HTTP ${res.status}. ` +
        `Check OPENF1_USERNAME and OPENF1_PASSWORD are correct.`
      );
      // Returning null rather than throwing — the caller will try to proceed
      // without authentication and will handle the resulting 401 gracefully.
      return null;
    }

    // Parse the token endpoint response safely, guarding against non-JSON bodies.
    const data = await safeParseJson<{ access_token: string }>(res, 'OpenF1 token', correlationId);

    // Extract the access token from the response payload.
    const token = data.access_token;

    // Guard: if OpenF1 returned a response that parsed as JSON but did not
    // include an access_token field, we cannot proceed with auth.
    if (!token) {
      console.error(`[OpenF1 Auth ${correlationId}] Token response did not contain access_token field.`);
      return null;
    }

    // Store the token in the module-level cache with an expiry of 55 minutes.
    // OpenF1 tokens expire after 60 minutes — we use 55 to leave a 5-minute
    // safety margin so a cached token does not expire mid-request.
    cachedToken = {
      token,
      expiresAt: Date.now() + 55 * 60 * 1000,
    };

    console.log(`[OpenF1 Auth ${correlationId}] Token acquired and cached for 55 minutes.`);
    return token;

  } catch (err) {
    // A network error or AbortError (timeout) from fetchWithTimeout.
    // Log it and return null so the caller can attempt to proceed without auth.
    console.error(`[OpenF1 Auth ${correlationId}] Token fetch threw:`, err);
    return null;
  }
}


// =============================================================================
// GUID: API_ADMIN_FETCH_TIMING_DATA-001-v02
// AUTHOR: gill — 2026-02-19
// @SECURITY_FIX: Removed adminUid from schema — now uses authenticated UID (previous author).
// [Intent] Zod schema that validates the incoming POST request body.
//          Only sessionKey is required — adminUid is no longer accepted as
//          a request parameter to prevent privilege-escalation attacks.
// [Inbound Trigger] Every incoming POST request body is parsed against this
//                   schema before any further processing occurs.
// [Downstream Impact] Any request missing sessionKey, or with sessionKey as a
//                     non-positive integer, is rejected with HTTP 400 before
//                     any external calls are made. Prevents wasted API calls.
// =============================================================================
const fetchTimingRequestSchema = z.object({
  // sessionKey must be a positive integer (OpenF1 session identifiers are
  // always positive integers, e.g. 9161 for the 2024 Monaco Qualifying).
  sessionKey: z.number().int().positive(),
}).strict(); // .strict() rejects any extra fields not listed above.


// =============================================================================
// GUID: API_ADMIN_FETCH_TIMING_DATA-002-v01
// AUTHOR: gill — 2026-02-19 (unchanged logic, no version bump needed but
//          including author tag for consistency with this update pass)
// [Intent] Convert a lap duration in decimal seconds to a human-readable
//          "M:SS.mmm" string (e.g. 62.345 → "1:02.345").
// [Inbound Trigger] Called for each driver's computed best lap duration
//                   before the result is written to Firestore.
// [Downstream Impact] The formatted string is stored in Firestore and displayed
//                     as-is by the ThePaddockPubChat UI. Changing the format
//                     here requires a corresponding UI change.
// =============================================================================
function formatLapDuration(seconds: number): string {
  // Whole minutes component.
  const mins = Math.floor(seconds / 60);

  // Remaining seconds (including fractional milliseconds).
  const secs = seconds % 60;

  // Format seconds to 3 decimal places for millisecond precision.
  const secsStr = secs.toFixed(3);

  // Pad the seconds to two digits before the decimal point
  // so that e.g. 1:02.345 is shown rather than 1:2.345.
  const paddedSecs = secs < 10 ? `0${secsStr}` : secsStr;

  return `${mins}:${paddedSecs}`;
}


// =============================================================================
// GUID: API_ADMIN_FETCH_TIMING_DATA-003-v03
// AUTHOR: gill — 2026-02-19
// @SECURITY_FIX: Proper authentication via verifyAuthToken (previous author).
// @TIMEOUT_FIX:  All fetch() calls replaced with fetchWithTimeout() (gill).
// @JSON_FIX:     All .json() calls replaced with safeParseJson() (gill).
// [Intent] Main POST handler. Orchestrates the full OpenF1 fetch pipeline:
//          1. Verify Firebase Auth token.
//          2. Verify admin privileges.
//          3. Validate request body with Zod.
//          4. Acquire OpenF1 OAuth2 token.
//          5. Fetch session metadata.
//          6. Fetch meeting metadata.
//          7. Fetch driver list and deduplicate.
//          8. Fetch per-driver lap data in parallel.
//          9. Compute best lap per driver, filter nulls, sort by time.
//         10. Write result to Firestore app-settings/pub-chat-timing.
//         11. Write audit log entry.
// [Inbound Trigger] POST /api/admin/fetch-timing-data with JSON body { sessionKey }.
// [Downstream Impact] Overwrites app-settings/pub-chat-timing — ThePaddockPubChat
//                     immediately reflects the new data. Appends to audit_logs.
// =============================================================================
export async function POST(request: NextRequest) {
  // Generate the primary correlation ID for this request. This same ID is used
  // in all log lines, error responses, and the error_logs Firestore write so
  // that any error can be traced from the UI back to the server logs.
  const correlationId = generateCorrelationId();

  console.log(`[fetch-timing-data POST ${correlationId}] Request received.`);

  try {
    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-003-v03 — Step 1: Authentication
    // Verify the Firebase Auth bearer token from the Authorization header.
    // verifyAuthToken() returns the decoded token (including uid) or null.
    // We must do this FIRST, before reading the request body, to avoid
    // wasting resources on unauthenticated requests.
    // -------------------------------------------------------------------------
    const authHeader = request.headers.get('Authorization');
    const verifiedUser = await verifyAuthToken(authHeader);

    if (!verifiedUser) {
      // No valid token provided — return 401 Unauthorized.
      // We do not reveal WHY auth failed (expired, missing, malformed) to
      // avoid giving attackers useful information.
      console.warn(`[fetch-timing-data POST ${correlationId}] Auth failed — no valid token.`);
      return NextResponse.json(
        { success: false, error: 'Unauthorized', correlationId },
        { status: 401 },
      );
    }

    console.log(`[fetch-timing-data POST ${correlationId}] Auth OK. UID: ${verifiedUser.uid}`);

    // -------------------------------------------------------------------------
    // Step 2: Parse and validate the request body against the Zod schema.
    // We do this before the admin check to return fast on malformed input
    // without hitting Firestore unnecessarily.
    // -------------------------------------------------------------------------
    const body = await request.json();
    const parsed = fetchTimingRequestSchema.safeParse(body);

    if (!parsed.success) {
      // Zod found validation errors — return 400 with the field-level details
      // so the caller knows exactly which fields were wrong.
      console.warn(`[fetch-timing-data POST ${correlationId}] Validation failed:`, parsed.error.flatten());
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: parsed.error.flatten().fieldErrors,
          errorCode: ERROR_CODES.VALIDATION_MISSING_FIELDS.code,
          correlationId,
        },
        { status: 400 },
      );
    }

    // Extract the validated sessionKey from the parsed body.
    const { sessionKey } = parsed.data;
    console.log(`[fetch-timing-data POST ${correlationId}] sessionKey=${sessionKey}`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-004-v03
    // AUTHOR: gill — 2026-02-19
    // @SECURITY_FIX: Uses authenticated UID, not request-body UID (previous author).
    // [Intent] Verify the authenticated user has isAdmin=true in Firestore before
    //          allowing any OpenF1 data fetch or Firestore write.
    // [Inbound Trigger] Auth token verified; sessionKey validated.
    // [Downstream Impact] Non-admin users receive 403. Prevents unauthorised
    //                     Firestore writes to app-settings/pub-chat-timing.
    // -------------------------------------------------------------------------
    const { db, FieldValue } = await getFirebaseAdmin();

    // Use the UID from the verified token — NOT from the request body.
    // Using the request body would allow privilege escalation: an attacker
    // could submit an admin's UID in the body while authenticating as a
    // regular user.
    const adminUid = verifiedUser.uid;

    // Fetch the user's Firestore document to check the isAdmin flag.
    const adminDoc = await db.collection('users').doc(adminUid).get();

    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      console.warn(`[fetch-timing-data POST ${correlationId}] UID ${adminUid} is not admin.`);
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied. Admin access required.',
          errorCode: ERROR_CODES.AUTH_PERMISSION_DENIED.code,
          correlationId,
        },
        { status: 403 },
      );
    }

    console.log(`[fetch-timing-data POST ${correlationId}] Admin check passed for UID ${adminUid}.`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-005-v03
    // AUTHOR: gill — 2026-02-19
    // @AUTH_FIX:    Added token acquisition (previous author).
    // @TIMEOUT_FIX: Now calls fetchWithTimeout() (gill).
    // @JSON_FIX:    Now calls safeParseJson() (gill).
    // [Intent] Acquire the OpenF1 OAuth2 token then fetch session metadata
    //          for the requested sessionKey.
    // [Inbound Trigger] Admin check passed; about to contact OpenF1.
    // [Downstream Impact] The session document provides sessionName, dateStart,
    //                     and the meetingKey needed for the next fetch.
    // -------------------------------------------------------------------------

    // Attempt to get an OAuth2 token for OpenF1. Returns null if credentials
    // are not configured or if the token endpoint is unreachable.
    const openf1Token = await getOpenF1Token();

    // Build the Authorization header object. If we have no token, authHeaders
    // will be empty and requests will be made without authentication (which will
    // result in 401 from OpenF1 if a subscription is required).
    const authHeaders: HeadersInit = {};
    if (openf1Token) {
      authHeaders['Authorization'] = `Bearer ${openf1Token}`;
    } else {
      console.warn(`[fetch-timing-data POST ${correlationId}] No OpenF1 token available — proceeding unauthenticated.`);
    }

    // Fetch session metadata. Using fetchWithTimeout so a slow OpenF1 response
    // does not block the serverless function indefinitely.
    console.log(`[fetch-timing-data POST ${correlationId}] Fetching session metadata for key ${sessionKey}...`);
    let sessionRes: Response;
    try {
      sessionRes = await fetchWithTimeout(
        `${OPENF1_BASE}/sessions?session_key=${sessionKey}`,
        { headers: authHeaders },
      );
    } catch (fetchErr: any) {
      // fetchWithTimeout threw — either a timeout (AbortError) or a network error.
      const isTimeout = fetchErr?.name === 'AbortError';
      console.error(`[fetch-timing-data POST ${correlationId}] Session fetch ${isTimeout ? 'timed out' : 'failed'}:`, fetchErr);
      return NextResponse.json(
        {
          success: false,
          error: isTimeout
            ? `OpenF1 sessions endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s. The API may be slow outside of race season.`
            : `OpenF1 sessions endpoint network error: ${fetchErr.message}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 504 },
      );
    }

    // Check the HTTP status before attempting to parse the body.
    if (!sessionRes.ok) {
      // Provide a specific message if 401 and we have no token — this is a
      // configuration problem (missing env vars) that the developer needs to fix.
      if (sessionRes.status === 401 && !openf1Token) {
        console.error(`[fetch-timing-data POST ${correlationId}] OpenF1 sessions returned 401 — credentials not configured.`);
        return NextResponse.json(
          {
            success: false,
            error: 'OpenF1 API requires authentication. Please configure OPENF1_USERNAME and OPENF1_PASSWORD environment variables.',
            errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
            correlationId,
          },
          { status: 502 },
        );
      }
      console.error(`[fetch-timing-data POST ${correlationId}] Sessions endpoint returned HTTP ${sessionRes.status}.`);
      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 sessions endpoint returned ${sessionRes.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 },
      );
    }

    // Parse the session response. safeParseJson guards against HTML error pages.
    const sessions = await safeParseJson<any[]>(sessionRes, 'sessions', correlationId);

    // OpenF1 returns an array — it should contain exactly one session for the
    // given key. An empty array means the sessionKey does not exist.
    if (!Array.isArray(sessions) || sessions.length === 0) {
      console.warn(`[fetch-timing-data POST ${correlationId}] No session found for key ${sessionKey}.`);
      return NextResponse.json(
        {
          success: false,
          error: 'No session found for the given session key',
          errorCode: ERROR_CODES.OPENF1_NO_DATA.code,
          correlationId,
        },
        { status: 404 },
      );
    }

    // Take the first (and normally only) session in the array.
    const session = sessions[0];
    console.log(`[fetch-timing-data POST ${correlationId}] Session: "${session.session_name}" (meetingKey=${session.meeting_key})`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-006-v03
    // AUTHOR: gill — 2026-02-19
    // @AUTH_FIX:    Added OpenF1 OAuth2 auth (previous author).
    // @TIMEOUT_FIX: Now calls fetchWithTimeout() (gill).
    // @JSON_FIX:    Now calls safeParseJson() (gill).
    // [Intent] Fetch meeting metadata to get the meeting name, location, circuit,
    //          and country associated with this session's meetingKey.
    // [Inbound Trigger] Session data fetched successfully; meetingKey extracted.
    // [Downstream Impact] Meeting data populates the session header fields in
    //                     the Firestore document. Missing meeting data results
    //                     in empty strings in the UI (graceful degradation).
    // -------------------------------------------------------------------------
    const meetingKey = session.meeting_key;

    console.log(`[fetch-timing-data POST ${correlationId}] Fetching meeting metadata for meetingKey=${meetingKey}...`);
    let meetingRes: Response;
    try {
      meetingRes = await fetchWithTimeout(
        `${OPENF1_BASE}/meetings?meeting_key=${meetingKey}`,
        { headers: authHeaders },
      );
    } catch (fetchErr: any) {
      const isTimeout = fetchErr?.name === 'AbortError';
      console.error(`[fetch-timing-data POST ${correlationId}] Meeting fetch ${isTimeout ? 'timed out' : 'failed'}:`, fetchErr);
      return NextResponse.json(
        {
          success: false,
          error: isTimeout
            ? `OpenF1 meetings endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
            : `OpenF1 meetings endpoint network error: ${fetchErr.message}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 504 },
      );
    }

    if (!meetingRes.ok) {
      console.error(`[fetch-timing-data POST ${correlationId}] Meetings endpoint returned HTTP ${meetingRes.status}.`);
      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 meetings endpoint returned ${meetingRes.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 },
      );
    }

    // Parse meeting response. Use safeParseJson in case OpenF1 returns HTML.
    const meetings = await safeParseJson<any[]>(meetingRes, 'meetings', correlationId);

    // Meeting data is optional — if the array is empty or the field is absent,
    // we default to empty strings in the Firestore write below.
    const meeting = (Array.isArray(meetings) && meetings.length > 0) ? meetings[0] : {};
    console.log(`[fetch-timing-data POST ${correlationId}] Meeting: "${meeting.meeting_name ?? '(unknown)'}"`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-007-v03
    // AUTHOR: gill — 2026-02-19
    // @AUTH_FIX:    Added OpenF1 OAuth2 auth (previous author).
    // @TIMEOUT_FIX: Now calls fetchWithTimeout() (gill).
    // @JSON_FIX:    Now calls safeParseJson() (gill).
    // [Intent] Fetch all drivers who participated in the session. The driver
    //          list determines how many lap-data requests will be made in the
    //          parallel fetch below.
    // [Inbound Trigger] Session and meeting data fetched successfully.
    // [Downstream Impact] If no drivers are returned, the handler returns 404.
    //                     The driver list flows into the deduplication step and
    //                     then the parallel lap fetch.
    // -------------------------------------------------------------------------
    console.log(`[fetch-timing-data POST ${correlationId}] Fetching drivers for sessionKey=${sessionKey}...`);
    let driversRes: Response;
    try {
      driversRes = await fetchWithTimeout(
        `${OPENF1_BASE}/drivers?session_key=${sessionKey}`,
        { headers: authHeaders },
      );
    } catch (fetchErr: any) {
      const isTimeout = fetchErr?.name === 'AbortError';
      console.error(`[fetch-timing-data POST ${correlationId}] Drivers fetch ${isTimeout ? 'timed out' : 'failed'}:`, fetchErr);
      return NextResponse.json(
        {
          success: false,
          error: isTimeout
            ? `OpenF1 drivers endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
            : `OpenF1 drivers endpoint network error: ${fetchErr.message}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 504 },
      );
    }

    if (!driversRes.ok) {
      console.error(`[fetch-timing-data POST ${correlationId}] Drivers endpoint returned HTTP ${driversRes.status}.`);
      return NextResponse.json(
        {
          success: false,
          error: `OpenF1 drivers endpoint returned ${driversRes.status}`,
          errorCode: ERROR_CODES.OPENF1_FETCH_FAILED.code,
          correlationId,
        },
        { status: 502 },
      );
    }

    // Parse drivers response safely.
    const drivers = await safeParseJson<any[]>(driversRes, 'drivers', correlationId);

    if (!Array.isArray(drivers) || drivers.length === 0) {
      console.warn(`[fetch-timing-data POST ${correlationId}] No drivers returned for sessionKey=${sessionKey}.`);
      return NextResponse.json(
        {
          success: false,
          error: 'No drivers found for this session',
          errorCode: ERROR_CODES.OPENF1_NO_DATA.code,
          correlationId,
        },
        { status: 404 },
      );
    }

    console.log(`[fetch-timing-data POST ${correlationId}] ${drivers.length} driver records returned (before dedup).`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-008-v02
    // AUTHOR: gill — 2026-02-19
    // [Intent] Deduplicate the driver list by driver_number.
    //          OpenF1 sometimes returns multiple records per driver (e.g. when
    //          a driver changes car number mid-season or when data is patched).
    //          We keep only the first occurrence for each driver_number to avoid
    //          fetching lap data twice for the same driver.
    // [Inbound Trigger] Raw driver array returned from OpenF1 drivers endpoint.
    // [Downstream Impact] uniqueDrivers.size determines how many lap-fetch
    //                     requests are launched in the Promise.all below.
    //                     A smaller deduplicated set means fewer outbound calls.
    // -------------------------------------------------------------------------
    const uniqueDrivers = new Map<number, typeof drivers[0]>();
    for (const d of drivers) {
      // Only add the driver if they have a valid driver_number and have not
      // already been seen. This preserves the first-occurrence order from OpenF1.
      if (d.driver_number && !uniqueDrivers.has(d.driver_number)) {
        uniqueDrivers.set(d.driver_number, d);
      }
    }

    console.log(`[fetch-timing-data POST ${correlationId}] ${uniqueDrivers.size} unique drivers after deduplication. Fetching lap data...`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-009-v03
    // AUTHOR: gill — 2026-02-19
    // @AUTH_FIX:    Added OpenF1 OAuth2 auth (previous author).
    // @TIMEOUT_FIX: Each lap fetch now uses fetchWithTimeout() (gill).
    // @JSON_FIX:    Lap response body now read via response.text() + JSON.parse()
    //               inline rather than direct .json(), guarding against non-JSON
    //               bodies. Individual driver failures return null (graceful) (gill).
    // [Intent] Fetch lap data for every unique driver simultaneously using
    //          Promise.all. For each driver, find their best lap time (excluding
    //          pit-out laps and laps with no duration). Return null for drivers
    //          with no valid lap data — they are filtered out below.
    // [Inbound Trigger] Deduplicated driver list ready.
    // [Downstream Impact] Produces the sorted timing array written to Firestore.
    //                     If all drivers return null, the 404 guard below fires.
    //                     Individual null results are silently excluded from output.
    // -------------------------------------------------------------------------
    const driverResults = await Promise.all(
      Array.from(uniqueDrivers.values()).map(async (driver) => {
        // Each driver gets its own try/catch so a single driver's failure
        // (timeout, bad data, no laps) does not abort the entire Promise.all.
        try {
          let lapsRes: Response;
          try {
            lapsRes = await fetchWithTimeout(
              `${OPENF1_BASE}/laps?session_key=${sessionKey}&driver_number=${driver.driver_number}`,
              { headers: authHeaders },
            );
          } catch (fetchErr: any) {
            // Timeout or network error for this driver's lap data.
            // Log and return null — this driver will be excluded from results.
            const isTimeout = fetchErr?.name === 'AbortError';
            console.warn(
              `[fetch-timing-data POST ${correlationId}] Lap fetch for driver ${driver.driver_number} ` +
              `${isTimeout ? 'timed out' : `threw: ${fetchErr.message}`} — excluding driver.`
            );
            return null;
          }

          // If OpenF1 returns a non-2xx for this driver, skip them rather than aborting.
          if (!lapsRes.ok) {
            console.warn(`[fetch-timing-data POST ${correlationId}] Laps for driver ${driver.driver_number} returned HTTP ${lapsRes.status} — excluding.`);
            return null;
          }

          // Read raw text first to guard against non-JSON lap responses.
          const rawLapsText = await lapsRes.text();
          let laps: any[];
          try {
            laps = JSON.parse(rawLapsText);
          } catch {
            // OpenF1 returned non-JSON for this driver's laps. Skip them.
            console.warn(`[fetch-timing-data POST ${correlationId}] Laps for driver ${driver.driver_number} returned non-JSON — excluding.`);
            return null;
          }

          // An empty or non-array response means the driver has no recorded laps.
          if (!Array.isArray(laps) || laps.length === 0) return null;

          // Filter out pit-out laps (these have anomalously slow times) and
          // laps without a duration (incomplete laps, e.g. red flag stoppages).
          const validLaps = laps.filter(
            (lap: any) => lap.lap_duration != null && lap.lap_duration > 0 && !lap.is_pit_out_lap,
          );

          // If there are no valid laps for this driver, exclude them.
          if (validLaps.length === 0) return null;

          // Find the fastest valid lap using a reduce over the array.
          const bestLap = validLaps.reduce(
            (best: any, lap: any) => (lap.lap_duration < best.lap_duration ? lap : best),
            validLaps[0],
          );

          // Build and return the driver result object.
          return {
            driver:          driver.last_name    || driver.name_acronym || `#${driver.driver_number}`,
            fullName:        driver.full_name     || driver.last_name   || '',
            driverNumber:    driver.driver_number,
            team:            driver.team_name     || 'Unknown',
            teamColour:      driver.team_colour   || '666666',
            laps:            validLaps.length,
            bestLapDuration: bestLap.lap_duration,
            time:            formatLapDuration(bestLap.lap_duration),
          };

        } catch (err) {
          // Catch-all for any unexpected error processing a single driver.
          // Log and return null so the rest of the results are preserved.
          console.warn(`[fetch-timing-data POST ${correlationId}] Unexpected error for driver ${driver.driver_number}:`, err);
          return null;
        }
      }),
    );

    // -------------------------------------------------------------------------
    // Filter out null entries (drivers with no valid laps or fetch errors),
    // sort ascending by best lap duration (fastest = position 1), and assign
    // the 1-based position index.
    // -------------------------------------------------------------------------
    const validResults = driverResults
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.bestLapDuration - b.bestLapDuration)
      .map((r, i) => ({ ...r, position: i + 1 }));

    console.log(`[fetch-timing-data POST ${correlationId}] ${validResults.length} drivers with valid lap data.`);

    // If every driver returned null, there is nothing useful to write.
    if (validResults.length === 0) {
      console.warn(`[fetch-timing-data POST ${correlationId}] No valid lap data found for any driver.`);
      return NextResponse.json(
        {
          success: false,
          error: 'No valid lap data found for any driver in this session',
          errorCode: ERROR_CODES.OPENF1_NO_DATA.code,
          correlationId,
        },
        { status: 404 },
      );
    }

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-010-v02
    // AUTHOR: gill — 2026-02-19
    // [Intent] Write the computed timing data to Firestore so that
    //          ThePaddockPubChat can read and display it immediately.
    //          Uses .set() (not .update()) to fully overwrite the document,
    //          ensuring stale fields from a previous session are not retained.
    // [Inbound Trigger] At least one driver has valid lap data.
    // [Downstream Impact] Overwrites app-settings/pub-chat-timing. The
    //                     ThePaddockPubChat component re-renders on the next
    //                     Firestore snapshot event.
    // -------------------------------------------------------------------------
    const timingData = {
      session: {
        meetingKey,
        meetingName:  meeting.meeting_name       || session.session_name || 'Unknown Meeting',
        sessionKey,
        sessionName:  session.session_name        || 'Unknown Session',
        circuitName:  meeting.circuit_short_name  || '',
        location:     meeting.location            || '',
        countryName:  meeting.country_name        || '',
        dateStart:    session.date_start          || '',
      },
      drivers:    validResults,
      // Server timestamp ensures the stored time reflects when the data was
      // written to Firestore, not when the server received the request.
      fetchedAt:  FieldValue.serverTimestamp(),
      fetchedBy:  adminUid,
    };

    console.log(`[fetch-timing-data POST ${correlationId}] Writing timing data to Firestore...`);
    await db.doc('app-settings/pub-chat-timing').set(timingData);
    console.log(`[fetch-timing-data POST ${correlationId}] Firestore write complete.`);

    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-011-v02
    // AUTHOR: gill — 2026-02-19
    // [Intent] Write an audit log entry recording that this admin performed a
    //          timing data fetch. Used for compliance and support tracing.
    // [Inbound Trigger] Firestore timing data write completed successfully.
    // [Downstream Impact] Appends to the audit_logs collection. No downstream
    //                     component reads this for functional purposes.
    // -------------------------------------------------------------------------
    await db.collection('audit_logs').add({
      userId:    adminUid,
      action:    'ADMIN_FETCH_TIMING_DATA',
      details: {
        sessionKey,
        meetingKey,
        sessionName:  session.session_name,
        driverCount:  validResults.length,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    console.log(`[fetch-timing-data POST ${correlationId}] Audit log written. Done.`);

    // Return a success response with a summary of what was fetched.
    return NextResponse.json({
      success:      true,
      message:      `Fetched timing data for ${validResults.length} drivers`,
      driverCount:  validResults.length,
      sessionName:  session.session_name,
    });

  } catch (error: any) {
    // -------------------------------------------------------------------------
    // GUID: API_ADMIN_FETCH_TIMING_DATA-012-v03
    // AUTHOR: gill — 2026-02-19
    // [Intent] Top-level catch block. Handles any uncaught exception that
    //          escaped the try block above (e.g. a getFirebaseAdmin() failure,
    //          or an unexpected thrown value).
    //          Logs the traced error to Firestore error_logs and returns a
    //          safe 500 response. The correlationId in the response allows the
    //          developer to find the full error detail in error_logs.
    // [Inbound Trigger] Any unhandled exception within the POST handler.
    // [Downstream Impact] Writes to error_logs collection. The correlationId
    //                     is returned to the client and displayed in the UI
    //                     as a selectable reference for support.
    // -------------------------------------------------------------------------
    console.error(`[fetch-timing-data POST ${correlationId}] Unhandled exception:`, error);

    try {
      // Attempt to log the error to Firestore. This itself could fail (e.g. if
      // Firebase Admin is misconfigured), so we wrap it in its own try/catch.
      const { db: errorDb } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.OPENF1_FETCH_FAILED, {
        correlationId,
        context: { route: '/api/admin/fetch-timing-data', action: 'POST' },
        cause: error instanceof Error ? error : undefined,
      });
      await logTracedError(traced, errorDb);

      return NextResponse.json(
        {
          success:      false,
          error:        traced.definition.message,
          errorCode:    traced.definition.code,
          correlationId: traced.correlationId,
        },
        { status: 500 },
      );
    } catch (loggingErr) {
      // Even the error-logging failed. Return a minimal response so the client
      // is not left hanging. The original error detail is in the console logs.
      console.error(`[fetch-timing-data POST ${correlationId}] Error logging also failed:`, loggingErr);
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
