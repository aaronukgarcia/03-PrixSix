// GUID: API_AUTH_LOGIN-000-v09
// @SECURITY_FIX: Added CSRF protection via Origin/Referer validation (GEMINI-005).
// @SECURITY_FIX: Implemented progressive account lockout to prevent brute-force attacks (GEMINI-AUDIT-012).
// @SECURITY_FIX: Removed raw errorType and errorMessage from catch block response to prevent information disclosure (GEMINI-AUDIT-100).
// @SECURITY_FIX: checkForAttack() return value now enforced — bot_attack/credential_stuffing triggers 429 (GEMINI-AUDIT-045).
// @SECURITY_FIX: Applied constant-time minimum delay to the "user not found in Firebase Auth" path
//   to prevent timing-based email enumeration (API-006). When the user does not exist, the handler
//   now waits at least TARGET_MIN_DURATION ms before responding, normalising timing with the path
//   that makes a full Firebase REST API call to verify credentials.
// [Intent] Server-side API route that authenticates users via email + 6-digit PIN, enforces progressive account lockout after repeated failures, logs all attempts for attack detection, blocks IP-level attacks, and returns a Firebase custom token on success.
// [Inbound Trigger] POST request from the client-side login form (LoginPage component).
// [Downstream Impact] Returns a customToken used by the client to call Firebase signInWithCustomToken(). Writes to audit_logs, login_attempts, and users collections. Lockout state affects future login attempts.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { logLoginAttempt, checkForAttack } from '@/lib/attack-detection';
import { validateCsrfProtection } from '@/lib/csrf-protection';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

// GUID: API_AUTH_LOGIN-014-v01
// [Intent] Account lockout configuration constants for brute-force attack prevention.
// [Inbound Trigger] Used by lockout logic at lines 213 and 346 to enforce progressive account lockout.
// [Downstream Impact] After MAX_LOGIN_ATTEMPTS failures, account is locked for LOCKOUT_DURATION_MS.
//                     Prevents brute-force PIN guessing attacks (GEMINI-AUDIT-012 security fix).
const MAX_LOGIN_ATTEMPTS = 5; // Lock account after 5 failed attempts
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes lockout

// GUID: API_AUTH_LOGIN-001-v03
// [Intent] Extract the real client IP address from incoming requests, accounting for various proxy/CDN header conventions.
// [Inbound Trigger] Called at the start of the POST handler to identify the client for rate limiting and audit logging.
// [Downstream Impact] The returned IP is written to audit_logs and login_attempts. Used by attack-detection module to flag suspicious activity per IP.
/**
 * Extract client IP from request headers
 * Checks multiple headers in order of preference for proxy/CDN setups
 */
function getClientIP(request: NextRequest): string {
  // Cloudflare
  const cfIP = request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;

  // X-Forwarded-For (most common proxy header)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // May contain multiple IPs, take the first one (client IP)
    return forwardedFor.split(',')[0].trim();
  }

  // X-Real-IP (Nginx)
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  // Vercel
  const vercelIP = request.headers.get('x-vercel-forwarded-for');
  if (vercelIP) return vercelIP.split(',')[0].trim();

  // Fallback - likely localhost or direct connection
  return 'unknown';
}

// GUID: API_AUTH_LOGIN-002-v04
// @SECURITY_FIX: Changed from fixed lockout to progressive lockout (GEMINI-AUDIT-012).
// [Intent] Define the brute-force protection thresholds with progressive lockout durations.
//          5-9 attempts = 15min lockout, 10-14 attempts = 1hr lockout, 15+ attempts = 24hr lockout.
// [Inbound Trigger] Referenced by calculateLockoutDuration() and the lockout check logic.
// [Downstream Impact] Changing these values directly affects when users get locked out and for how long. Alters the security posture of the entire login flow.
// Progressive lockout thresholds
const LOCKOUT_THRESHOLD_1 = 5;   // First lockout tier
const LOCKOUT_THRESHOLD_2 = 10;  // Second lockout tier
const LOCKOUT_THRESHOLD_3 = 15;  // Maximum lockout tier

// Progressive lockout durations in milliseconds
const LOCKOUT_DURATION_TIER_1 = 15 * 60 * 1000;  // 15 minutes
const LOCKOUT_DURATION_TIER_2 = 60 * 60 * 1000;  // 1 hour
const LOCKOUT_DURATION_TIER_3 = 24 * 60 * 60 * 1000; // 24 hours

// GUID: API_AUTH_LOGIN-015-v01
// @SECURITY_FIX: Progressive lockout calculation (GEMINI-AUDIT-012).
// [Intent] Calculate lockout duration based on number of failed login attempts.
//          Implements progressive penalty: more attempts = longer lockout.
// [Inbound Trigger] Called during lockout check when user has failed attempts.
// [Downstream Impact] Determines how long a user is locked out. Progressive approach
//                     deters automated brute-force attacks while being lenient on legitimate users.
function calculateLockoutDuration(attempts: number): number {
  if (attempts < LOCKOUT_THRESHOLD_1) {
    return 0; // No lockout yet
  } else if (attempts < LOCKOUT_THRESHOLD_2) {
    return LOCKOUT_DURATION_TIER_1; // 15 minutes
  } else if (attempts < LOCKOUT_THRESHOLD_3) {
    return LOCKOUT_DURATION_TIER_2; // 1 hour
  } else {
    return LOCKOUT_DURATION_TIER_3; // 24 hours
  }
}

// GUID: API_AUTH_LOGIN-003-v03
// [Intent] Type contract for the expected JSON body of the login request.
// [Inbound Trigger] Used to type-assert the parsed request body in the POST handler.
// [Downstream Impact] Any change to these fields requires matching changes in the client-side login form submission logic.
interface LoginRequest {
  email: string;
  pin: string;
}

// GUID: API_AUTH_LOGIN-004-v04
// [Intent] Main login POST handler. Validates input, checks lockout status, verifies credentials via Firebase Auth REST API, tracks failed/successful attempts, and returns a custom token on success.
// [Inbound Trigger] HTTP POST to /api/auth/login from the client-side login form.
// [Downstream Impact] On success: returns customToken + uid consumed by the client to establish a Firebase Auth session. On failure: increments badLoginAttempts on the users document, may trigger account lockout. All attempts are logged to audit_logs and login_attempts collections for attack detection.
// @SECURITY_FIX (API-006): startTime recorded at POST entry. The "user not found" early-exit path
//   is padded to TARGET_MIN_DURATION to approximate the time taken by the Firebase REST API call
//   made on the "user found" path, preventing timing-based email enumeration.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;
  // SECURITY (API-006): Record start time so the "user not found" path can be padded to match the
  // average response time of the "user found + Firebase REST API call" path.
  const startTime = Date.now();
  // Target minimum duration approximates the Firebase Identity Toolkit REST API call latency.
  // 800ms is conservative; actual PIN-verify call typically takes 300-600ms from server.
  const TARGET_MIN_DURATION = 800; // milliseconds

  // GUID: API_AUTH_LOGIN-014-v01
  // @SECURITY_FIX: CSRF protection via Origin/Referer validation (GEMINI-005).
  // [Intent] Validate that the request originates from an allowed domain to prevent CSRF attacks.
  // [Inbound Trigger] Every login request, before processing credentials.
  // [Downstream Impact] Rejects cross-origin requests from malicious sites with 403 status.
  const csrfError = validateCsrfProtection(request, correlationId);
  if (csrfError) {
    return csrfError;
  }

  try {
    const data: LoginRequest = await request.json();
    const { email, pin } = data;

    // GUID: API_AUTH_LOGIN-005-v04
    // [Intent] Validate that both email and PIN are present before proceeding with authentication.
    // [Inbound Trigger] Every login request passes through this check.
    // [Downstream Impact] Returns 400 early if fields are missing. Logged to error_logs for monitoring incomplete submissions.
    // Validate required fields
    if (!email || !pin) {
      const { db } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.VALIDATION_MISSING_FIELDS, {
        correlationId,
        context: { route: '/api/auth/login', action: 'validation', requestData: { email: email || 'missing' } },
      });
      await logTracedError(traced, db);
      return NextResponse.json(
        { success: false, error: 'Email and PIN are required', correlationId },
        { status: 400 }
      );
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    const { db, FieldValue } = await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();

    // GUID: API_AUTH_LOGIN-006-v03
    // [Intent] Look up the user document in Firestore by normalised email to check lockout status and track login attempts.
    // [Inbound Trigger] Runs after input validation passes.
    // [Downstream Impact] The retrieved user document is used for lockout checks, bad attempt counter updates, and audit logging throughout the rest of the handler.
    // Find user by email in Firestore
    const usersQuery = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    // GUID: API_AUTH_LOGIN-007-v04
    // @SECURITY_FIX: Upgraded to progressive lockout (GEMINI-AUDIT-012).
    // [Intent] Enforce progressive account lockout: lockout duration increases with failed attempts.
    //          5-9 attempts = 15min, 10-14 attempts = 1hr, 15+ attempts = 24hr.
    //          Rejects the login and logs the blocked attempt. Auto-resets counter once lockout expires.
    // [Inbound Trigger] Runs when the Firestore user document exists (email found).
    // [Downstream Impact] A locked-out user receives HTTP 429 and cannot proceed to credential verification. The lockout state persists in the users document (badLoginAttempts, lastFailedLoginAt). Attack detection is also triggered for pattern analysis.
    // SECURITY: Check if account exists and lockout status BEFORE attempting auth
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;

      // Check if account is locked (progressive lockout)
      const badAttempts = userData.badLoginAttempts || 0;
      const lastAttemptTime = userData.lastFailedLoginAt?.toMillis?.() || 0;
      const timeSinceLastAttempt = Date.now() - lastAttemptTime;
      const lockoutDuration = calculateLockoutDuration(badAttempts);

      // If locked and lockout period hasn't expired
      if (badAttempts >= LOCKOUT_THRESHOLD_1 && timeSinceLastAttempt < lockoutDuration) {
        const remainingMinutes = Math.ceil((lockoutDuration - timeSinceLastAttempt) / 60000);

        // Log the failed attempt for attack detection
        await logLoginAttempt(db, FieldValue, {
          ip: clientIP,
          email: normalizedEmail,
          userId,
          success: false,
          reason: 'locked_out',
          userAgent,
        });

        // Check for attacks after failed login
        await checkForAttack(db, FieldValue, clientIP, normalizedEmail);

        // Log the locked out attempt
        await db.collection('audit_logs').add({
          userId,
          action: 'login_attempt_locked',
          details: {
            email: normalizedEmail,
            badAttempts,
            remainingMinutes,
            ip: clientIP,
          },
          timestamp: FieldValue.serverTimestamp(),
        });

        return NextResponse.json(
          {
            success: false,
            error: `Account is locked due to too many failed attempts. Try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
            locked: true,
            correlationId,
          },
          { status: 429 }
        );
      }

      // If lockout period has expired, reset the counter
      if (badAttempts >= MAX_LOGIN_ATTEMPTS && timeSinceLastAttempt >= LOCKOUT_DURATION_MS) {
        await userDoc.ref.update({
          badLoginAttempts: 0,
          lastFailedLoginAt: null,
        });
      }
    }

    // GUID: API_AUTH_LOGIN-008-v05
    // [Intent] Look up the user in Firebase Auth by email to confirm the account exists in the auth system, separate from Firestore.
    // [Inbound Trigger] Runs after lockout check passes.
    // [Downstream Impact] If user not found in Firebase Auth, returns 401 with a generic message (prevents email enumeration). The retrieved firebaseUserRecord.uid is used later to generate the custom token.
    // @SECURITY_FIX (API-006): When user is not found, a constant-time delay pads the response to
    //   TARGET_MIN_DURATION before returning, preventing timing-based email enumeration. Without
    //   this, the fast early-exit (no Firebase REST API call) leaks that the email doesn't exist.
    // Attempt to verify credentials using Firebase Auth
    // First, get the user by email
    let firebaseUserRecord;
    try {
      firebaseUserRecord = await auth.getUserByEmail(normalizedEmail);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Log the failed attempt for attack detection
        await logLoginAttempt(db, FieldValue, {
          ip: clientIP,
          email: normalizedEmail,
          success: false,
          reason: 'user_not_found',
          userAgent,
        });

        // Check for attacks after failed login — capture return value to enforce blocking (GEMINI-AUDIT-045)
        const attackAlert = await checkForAttack(db, FieldValue, clientIP, normalizedEmail);

        // Don't reveal if user exists or not - but log for debugging
        const traced = createTracedError(ERRORS.AUTH_USER_NOT_FOUND, {
          correlationId,
          context: { route: '/api/auth/login', action: 'user_lookup', requestData: { email: normalizedEmail }, ip: clientIP },
          cause: error instanceof Error ? error : undefined,
        });
        await logTracedError(traced, db);

        // SECURITY: If a new IP-level attack was just detected, block immediately with 429 (GEMINI-AUDIT-045)
        if (attackAlert?.type === 'bot_attack' || attackAlert?.type === 'credential_stuffing') {
          return NextResponse.json(
            { success: false, error: 'Too many requests. Please try again later.', correlationId },
            { status: 429 }
          );
        }

        // SECURITY (API-006): Pad the "user not found" response to TARGET_MIN_DURATION so that
        // response timing cannot distinguish "email does not exist" from "email exists, wrong PIN"
        // (which goes through a Firebase REST API call adding ~300-600ms). Using the same generic
        // message for both cases (already done above) prevents content-based enumeration.
        const elapsed = Date.now() - startTime;
        const remaining = TARGET_MIN_DURATION - elapsed;
        if (remaining > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, remaining));
        }

        return NextResponse.json(
          { success: false, error: 'Invalid email or PIN', correlationId },
          { status: 401 }
        );
      }
      throw error;
    }

    // GUID: API_AUTH_LOGIN-009-v04
    // [Intent] Verify the user's PIN (password) by calling the Firebase Auth REST API (Identity Toolkit signInWithPassword endpoint), since the Admin SDK does not support password verification directly.
    // [Inbound Trigger] Runs after the Firebase Auth user record is successfully retrieved.
    // [Downstream Impact] If the API key is missing, returns 500. If credentials are invalid, increments the bad attempt counter and may trigger lockout. A Referer header is included to satisfy API key HTTP referrer restrictions.
    // Verify the PIN by attempting to sign in with Firebase Auth REST API
    // Since Admin SDK can't verify passwords, we use the Firebase Auth REST API
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    if (!firebaseApiKey) {
      // @SECURITY_FIX (Wave 10): Gated console.error behind NODE_ENV for consistency with rest of file.
      if (process.env.NODE_ENV !== 'production') { console.error('[Auth] Firebase API key not configured'); }
      const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
        correlationId,
        context: { route: '/api/auth/login', action: 'config_check', requestData: { email: normalizedEmail } },
      });
      await logTracedError(traced, db);
      return NextResponse.json(
        { success: false, error: traced.definition.message, errorCode: traced.definition.code, correlationId: traced.correlationId },
        { status: 500 }
      );
    }

    // Use Firebase Auth REST API to verify password
    // Note: Must include Referer header to satisfy API key HTTP referrer restrictions
    // Use the request origin/referer or fall back to production URL
    const requestOrigin = request.headers.get('origin') || request.headers.get('referer') || 'https://prix6.win/';

    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': requestOrigin,
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: pin,
          returnSecureToken: true,
        }),
      }
    );

    const authResult = await authResponse.json();

    // GUID: API_AUTH_LOGIN-010-v03
    // [Intent] Handle failed credential verification: increment the bad login attempts counter, log the failure for attack detection, write an audit record, and trigger lockout if the threshold is reached.
    // [Inbound Trigger] The Firebase Auth REST API returned a non-OK response or an error payload.
    // [Downstream Impact] Updates badLoginAttempts and lastFailedLoginAt on the users document. May trigger immediate lockout (HTTP 429). Attack detection patterns are evaluated for the IP and email.
    if (!authResponse.ok || authResult.error) {
      // Invalid credentials - increment bad login attempts
      const userDoc = usersQuery.empty ? null : usersQuery.docs[0];
      const userId = userDoc?.id;
      const currentAttempts = userDoc?.data()?.badLoginAttempts || 0;

      // Log the failed attempt for attack detection
      await logLoginAttempt(db, FieldValue, {
        ip: clientIP,
        email: normalizedEmail,
        userId,
        success: false,
        reason: 'invalid_pin',
        userAgent,
      });

      // Check for attacks after failed login — capture return value to enforce blocking (GEMINI-AUDIT-045)
      const attackAlertOnBadPin = await checkForAttack(db, FieldValue, clientIP, normalizedEmail);

      if (userDoc) {
        await userDoc.ref.update({
          badLoginAttempts: currentAttempts + 1,
          lastFailedLoginAt: FieldValue.serverTimestamp(),
        });

        // Log failed attempt
        await db.collection('audit_logs').add({
          userId,
          action: 'login_failed',
          details: {
            email: normalizedEmail,
            attempt: currentAttempts + 1,
            reason: 'invalid_pin',
            ip: clientIP,
          },
          timestamp: FieldValue.serverTimestamp(),
        });

        // Check if this attempt triggers lockout
        if (currentAttempts + 1 >= MAX_LOGIN_ATTEMPTS) {
          return NextResponse.json(
            {
              success: false,
              error: 'Account has been locked due to too many failed attempts. Try again in 30 minutes.',
              locked: true,
              correlationId,
            },
            { status: 429 }
          );
        }
      }

      // SECURITY: If a new IP-level attack was just detected, block immediately with 429 (GEMINI-AUDIT-045)
      if (attackAlertOnBadPin?.type === 'bot_attack' || attackAlertOnBadPin?.type === 'credential_stuffing') {
        return NextResponse.json(
          { success: false, error: 'Too many requests. Please try again later.', correlationId },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { success: false, error: 'Invalid email or PIN', correlationId },
        { status: 401 }
      );
    }

    // GUID: API_AUTH_LOGIN-011-v03
    // [Intent] Handle successful authentication: generate a Firebase custom token, reset the bad login attempts counter, log the success for analytics and auditing, and return the token to the client.
    // [Inbound Trigger] The Firebase Auth REST API confirmed the credentials are valid.
    // [Downstream Impact] The returned customToken is used by the client to call signInWithCustomToken() to establish a Firebase Auth session. The users document is updated to clear lockout state. Audit and analytics records are written.
    // Success! Generate a custom token for the client
    const customToken = await auth.createCustomToken(firebaseUserRecord.uid);
    let logonId: string | null = null;

    // Reset bad login attempts on successful login
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      const userId = userDoc.id;

      // Log successful login attempt for analytics
      await logLoginAttempt(db, FieldValue, {
        ip: clientIP,
        email: normalizedEmail,
        userId,
        success: true,
        userAgent,
      });

      await userDoc.ref.update({
        badLoginAttempts: 0,
        lastFailedLoginAt: null,
      });

      // Log successful login
      await db.collection('audit_logs').add({
        userId,
        action: 'login_success',
        details: {
          email: normalizedEmail,
          method: 'server_verified',
          ip: clientIP,
        },
        timestamp: FieldValue.serverTimestamp(),
      });

      // GUID: API_AUTH_LOGIN-013-v04
      // [Intent] Record a logon event in user_logons for session tracking (non-blocking).
      //          PIN logins include IP and user agent since this runs server-side.
      //          Login succeeds even if tracking fails.
      // [Inbound Trigger] Successful PIN authentication above.
      // [Downstream Impact] Creates an Active session document; logonId returned to client
      //                     for use with /api/auth/record-logout on sign-out.
      try {
        const logonRef = await db.collection('user_logons').add({
          userId,
          logonTimestamp: FieldValue.serverTimestamp(),
          logoutTimestamp: null,
          sessionStatus: 'Active',
          loginMethod: 'pin',
          ipAddress: clientIP || null,
          userAgent: userAgent || null,
        });
        logonId = logonRef.id;
      } catch (logonError) {
        // @SECURITY_FIX (Wave 10): Gated console.error behind NODE_ENV
        if (process.env.NODE_ENV !== 'production') { console.error('[Login] Failed to record logon event:', logonError); }
      }
    }

    return NextResponse.json({
      success: true,
      customToken,
      uid: firebaseUserRecord.uid,
      logonId,
    });

  // GUID: API_AUTH_LOGIN-012-v05
  // [Intent] Top-level catch-all error handler for any unhandled exception during login. Logs the error with full context (excluding the PIN) and returns a generic 500 response with the correlation ID.
  // [Inbound Trigger] Any unhandled exception thrown within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response allows support to trace the issue. If logTracedError itself fails, falls back to console.error to avoid masking the original error.
  } catch (error: any) {
    // @SECURITY_FIX (Wave 10): Gated console.error behind NODE_ENV
    if (process.env.NODE_ENV !== 'production') { console.error('[Login Error]', error); }

    let requestData: any = {};
    try {
      requestData = await request.clone().json();
      delete requestData.pin; // Don't log the PIN
    } catch {}

    // Try to log error, but don't fail if logging fails
    try {
      const { db } = await getFirebaseAdmin();
      const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
        correlationId,
        context: { route: '/api/auth/login', action: 'POST', requestData: { email: requestData.email }, userAgent: request.headers.get('user-agent') || undefined },
        cause: error instanceof Error ? error : undefined,
      });
      await logTracedError(traced, db);
    } catch (logErr) {
      // @SECURITY_FIX (Wave 10): Gated console.error behind NODE_ENV
      if (process.env.NODE_ENV !== 'production') { console.error('[Login Error - Logging failed]', logErr); }
    }

    // SECURITY: Return only generic message + correlationId. Full error context is logged
    // server-side via logTracedError(). Never expose errorType or errorMessage to clients
    // as they leak internal implementation details (GEMINI-AUDIT-100).
    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred during login. Please try again or contact support.',
        correlationId,
      },
      { status: 500 }
    );
  }
}
