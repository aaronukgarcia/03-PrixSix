// GUID: API_AUTH_LOGIN-000-v04
// [Intent] Server-side API route that authenticates users via email + 6-digit PIN, enforces account lockout after repeated failures, logs all attempts for attack detection, and returns a Firebase custom token on success.
// [Inbound Trigger] POST request from the client-side login form (LoginPage component).
// [Downstream Impact] Returns a customToken used by the client to call Firebase signInWithCustomToken(). Writes to audit_logs, login_attempts, and users collections. Lockout state affects future login attempts.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, logError } from '@/lib/firebase-admin';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { logLoginAttempt, checkForAttack } from '@/lib/attack-detection';

// Force dynamic to skip static analysis at build time
export const dynamic = 'force-dynamic';

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

// GUID: API_AUTH_LOGIN-002-v03
// [Intent] Define the brute-force protection thresholds: max allowed failed attempts and lockout window duration.
// [Inbound Trigger] Referenced by the lockout check logic and lockout trigger logic within the POST handler.
// [Downstream Impact] Changing these values directly affects when users get locked out and for how long. Alters the security posture of the entire login flow.
// Maximum login attempts before lockout
const MAX_LOGIN_ATTEMPTS = 5;

// Lockout duration in milliseconds (30 minutes)
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

// GUID: API_AUTH_LOGIN-003-v03
// [Intent] Type contract for the expected JSON body of the login request.
// [Inbound Trigger] Used to type-assert the parsed request body in the POST handler.
// [Downstream Impact] Any change to these fields requires matching changes in the client-side login form submission logic.
interface LoginRequest {
  email: string;
  pin: string;
}

// GUID: API_AUTH_LOGIN-004-v03
// [Intent] Main login POST handler. Validates input, checks lockout status, verifies credentials via Firebase Auth REST API, tracks failed/successful attempts, and returns a custom token on success.
// [Inbound Trigger] HTTP POST to /api/auth/login from the client-side login form.
// [Downstream Impact] On success: returns customToken + uid consumed by the client to establish a Firebase Auth session. On failure: increments badLoginAttempts on the users document, may trigger account lockout. All attempts are logged to audit_logs and login_attempts collections for attack detection.
export async function POST(request: NextRequest) {
  const correlationId = generateCorrelationId();
  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;

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

    // GUID: API_AUTH_LOGIN-007-v03
    // [Intent] Enforce account lockout: if the user has exceeded MAX_LOGIN_ATTEMPTS within the LOCKOUT_DURATION_MS window, reject the login and log the blocked attempt. Also auto-reset the counter once the lockout window expires.
    // [Inbound Trigger] Runs when the Firestore user document exists (email found).
    // [Downstream Impact] A locked-out user receives HTTP 429 and cannot proceed to credential verification. The lockout state persists in the users document (badLoginAttempts, lastFailedLoginAt). Attack detection is also triggered for pattern analysis.
    // SECURITY: Check if account exists and lockout status BEFORE attempting auth
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;

      // Check if account is locked
      const badAttempts = userData.badLoginAttempts || 0;
      const lastAttemptTime = userData.lastFailedLoginAt?.toMillis?.() || 0;
      const timeSinceLastAttempt = Date.now() - lastAttemptTime;

      // If locked and lockout period hasn't expired
      if (badAttempts >= MAX_LOGIN_ATTEMPTS && timeSinceLastAttempt < LOCKOUT_DURATION_MS) {
        const remainingMinutes = Math.ceil((LOCKOUT_DURATION_MS - timeSinceLastAttempt) / 60000);

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

    // GUID: API_AUTH_LOGIN-008-v04
    // [Intent] Look up the user in Firebase Auth by email to confirm the account exists in the auth system, separate from Firestore.
    // [Inbound Trigger] Runs after lockout check passes.
    // [Downstream Impact] If user not found in Firebase Auth, returns 401 with a generic message (prevents email enumeration). The retrieved firebaseUserRecord.uid is used later to generate the custom token.
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

        // Check for attacks after failed login
        await checkForAttack(db, FieldValue, clientIP, normalizedEmail);

        // Don't reveal if user exists or not - but log for debugging
        const traced = createTracedError(ERRORS.AUTH_USER_NOT_FOUND, {
          correlationId,
          context: { route: '/api/auth/login', action: 'user_lookup', requestData: { email: normalizedEmail }, ip: clientIP },
          cause: error instanceof Error ? error : undefined,
        });
        await logTracedError(traced, db);
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
      console.error('[Auth] Firebase API key not configured');
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

      // Check for attacks after failed login
      await checkForAttack(db, FieldValue, clientIP, normalizedEmail);

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

      // GUID: API_AUTH_LOGIN-013-v03
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
        console.error('[Login] Failed to record logon event:', logonError);
      }
    }

    return NextResponse.json({
      success: true,
      customToken,
      uid: firebaseUserRecord.uid,
      logonId,
    });

  // GUID: API_AUTH_LOGIN-012-v04
  // [Intent] Top-level catch-all error handler for any unhandled exception during login. Logs the error with full context (excluding the PIN) and returns a generic 500 response with the correlation ID.
  // [Inbound Trigger] Any unhandled exception thrown within the POST handler try block.
  // [Downstream Impact] Writes to error_logs collection. The correlation ID in the response allows support to trace the issue. If logTracedError itself fails, falls back to console.error to avoid masking the original error.
  } catch (error: any) {
    console.error('[Login Error]', error);

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
      console.error('[Login Error - Logging failed]', logErr);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'An error occurred during login',
        correlationId,
        // Include error type for debugging (safe - no sensitive data)
        errorType: error.code || error.name || 'UnknownError',
        errorMessage: error.message?.substring(0, 200) || 'No message',
      },
      { status: 500 }
    );
  }
}
