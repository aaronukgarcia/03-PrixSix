// GUID: LIB_FIREBASE_ADMIN-000-v05
// [Intent] Server-side Firebase Admin SDK initialisation and shared utilities for authentication verification, correlation ID generation, and centralised error logging.
// [Inbound Trigger] Imported by all server-side API routes that need Firestore access, auth verification, or error logging.
// [Downstream Impact] Every server-side API route depends on this module. Changes to initialisation logic, auth verification, or error logging affect the entire backend.
// @SECURITY_FIX (GEMINI-AUDIT-059): The initialization error catch block previously logged the
//   raw error object via console.error. If cert() fails (e.g. malformed private key), the error
//   may contain the credential values in its message or stack trace, leaking FIREBASE_PRIVATE_KEY
//   to server logs. Fixed to log only a sanitised message (error.code + error.message) without
//   the credential object or stack. Private key presence is validated before cert() is called.

/**
 * Firebase Admin SDK initialization for server-side API routes.
 * Uses Application Default Credentials (ADC) when running on Google Cloud,
 * falls back to service account cert for local development.
 */

import { randomUUID } from 'crypto';
import type { App } from 'firebase-admin/app';
import type { Firestore, FieldValue as FieldValueType, Timestamp as TimestampType } from 'firebase-admin/firestore';

// GUID: LIB_FIREBASE_ADMIN-001-v03
// [Intent] Module-level singleton cache for the Firebase Admin SDK app, Firestore instance, FieldValue, and Timestamp to avoid re-initialisation on every request.
// [Inbound Trigger] Populated on first call to getFirebaseAdmin; reused on subsequent calls.
// [Downstream Impact] If these become stale or corrupted, all server-side Firestore operations fail. The singleton pattern means credentials are loaded once per process lifetime.
let adminApp: App | null = null;
let adminDb: Firestore | null = null;
let adminFieldValue: typeof FieldValueType | null = null;
let adminTimestamp: typeof TimestampType | null = null;

// GUID: LIB_FIREBASE_ADMIN-002-v04
// [Intent] Lazily initialises the Firebase Admin SDK (choosing between explicit service account credentials for local dev or Application Default Credentials for Google Cloud) and returns the Firestore instance, FieldValue, and Timestamp utilities.
// [Inbound Trigger] Called by every API route that needs server-side Firestore access (login, scoring, admin operations, error logging).
// [Downstream Impact] All server-side database operations depend on this function. If initialisation fails, the entire backend is non-functional. The credential selection logic must match the deployment environment.
// @SECURITY_FIX (GEMINI-AUDIT-059): Private key is validated for presence before being passed to
//   cert(). The catch block now logs only error.code and error.message (sanitised strings) instead
//   of the raw error object, preventing FIREBASE_PRIVATE_KEY from appearing in server logs via
//   error stack traces or formatted error objects from the Firebase Admin SDK.
export async function getFirebaseAdmin(): Promise<{
  db: Firestore;
  FieldValue: typeof FieldValueType;
  Timestamp: typeof TimestampType;
}> {
  if (adminDb && adminFieldValue && adminTimestamp) {
    return { db: adminDb, FieldValue: adminFieldValue, Timestamp: adminTimestamp };
  }

  const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    // Try Application Default Credentials first (works on Google Cloud/Firebase App Hosting)
    // Falls back to service account cert if env vars are provided
    try {
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        // SECURITY (GEMINI-AUDIT-059): Validate that the private key env var is non-empty before
        // passing it to cert(). An empty or whitespace-only value would cause cert() to throw an
        // error whose message may echo the (empty) key value. Fail fast with a safe message.
        const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
        if (!rawPrivateKey.trim()) {
          throw new Error('Firebase Admin SDK configuration error: FIREBASE_PRIVATE_KEY is empty');
        }
        // Use explicit credentials (local development)
        console.log('[Firebase Admin] Initializing with service account credentials');
        adminApp = initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Replace escaped newlines from env var serialisation
            privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
          }),
        });
      } else {
        // Use Application Default Credentials (Google Cloud environment)
        console.log('[Firebase Admin] Initializing with Application Default Credentials');
        adminApp = initializeApp({
          credential: applicationDefault(),
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
        });
      }
    } catch (error) {
      // SECURITY (GEMINI-AUDIT-059): Log only the sanitised error code and message — never the
      // raw error object. cert() errors may include credential field values in their stack trace
      // or formatted output, which would expose FIREBASE_PRIVATE_KEY in server logs.
      const safeMessage = error instanceof Error ? `${(error as any).code ?? 'unknown'}: ${error.message}` : String(error);
      console.error('[Firebase Admin] Initialization failed:', safeMessage);
      throw new Error('Firebase Admin SDK configuration error. Check server logs for details.');
    }
  }

  adminDb = getFirestore();
  adminFieldValue = FieldValue;
  adminTimestamp = Timestamp;

  return { db: adminDb, FieldValue: adminFieldValue, Timestamp: adminTimestamp };
}

// GUID: LIB_FIREBASE_ADMIN-003-v05
// @SECURITY_FIX: Wave 2 RT carryover — verifyAuthToken catch now logs only sanitized error message/code, not full error object.
// @FIX (BUG-AUTH-001): Call getFirebaseAdmin() first to ensure the Admin SDK is initialised before
//   getAuth() is called. On a cold-start Cloud Run instance, adminApp is null; getAuth() would throw
//   "No Firebase app" which was silently caught and returned as null → HTTP 401. Calling
//   getFirebaseAdmin() first guarantees the default app exists for all subsequent getAuth() calls.
// [Intent] Verifies a Firebase ID token from an Authorization header and returns the decoded user identity (uid and email), or null if invalid/missing.
// [Inbound Trigger] Called by protected API routes to authenticate incoming requests via the Bearer token in the Authorization header.
// [Downstream Impact] All protected API endpoints depend on this for authentication. Returning null causes the caller to reject the request as unauthorised. Changes to token verification logic affect the entire auth boundary.
/**
 * Verify a Firebase ID token and return the decoded token
 * SECURITY: Use this to verify that API requests are from authenticated users
 */
export async function verifyAuthToken(authHeader: string | null): Promise<{
  uid: string;
  email?: string;
} | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    // Ensure the Firebase Admin app is initialised before calling getAuth().
    // On a cold-start Cloud Run instance the default app does not yet exist;
    // getAuth() would throw and verifyIdToken would never be reached.
    await getFirebaseAdmin();
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };
  } catch (error) {
    // SECURITY: Log only safe fields — not the full error object which may contain token fragments or SDK internals.
    const safeMsg = error instanceof Error ? error.message : String((error as any)?.code ?? 'unknown');
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Auth] Token verification failed:', error);
    } else {
      console.error('[Auth] Token verification failed:', safeMsg);
    }
    return null;
  }
}

// GUID: LIB_FIREBASE_ADMIN-004-v03
// [Intent] Generates a unique correlation ID for error tracking, combining a base-36 timestamp with a random suffix to ensure uniqueness.
// [Inbound Trigger] Called at the start of API route error handling to create a traceable reference for each error instance.
// [Downstream Impact] The generated ID is stored in error_logs and displayed to users (Golden Rule #1). Format changes affect error log querying and user-reported error references.
/**
 * Generate a correlation ID for error tracking using crypto.randomUUID()
 * for cryptographically secure randomness (LIB-002 fix)
 */
// @SECURITY_FIX (GEMINI-AUDIT-060): Moved inline require('crypto') to top-level import.
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomUUID().replace(/-/g, '').substring(0, 8);
  return `err_${timestamp}_${random}`;
}

// GUID: LIB_FIREBASE_ADMIN-005-v04
// [Intent] Persists error details (message, stack trace, context, correlation ID) to the error_logs Firestore collection for centralised error tracking and debugging.
// [Inbound Trigger] Called by API route catch blocks after generating a correlation ID (Golden Rule #1 compliance).
// [Downstream Impact] Writes to error_logs collection used by admin error monitoring. Silently catches its own failures to avoid cascading errors. If this function fails, errors are only logged to console.
/**
 * Log an error to Firestore with correlation ID and context
 */
export async function logError(options: {
  correlationId: string;
  error: Error | string;
  context: {
    route?: string;
    action?: string;
    userId?: string;
    requestData?: any;
    userAgent?: string;
    ip?: string;
    additionalInfo?: Record<string, any>;
  };
}): Promise<void> {
  try {
    const { db, FieldValue } = await getFirebaseAdmin();

    const errorMessage = options.error instanceof Error ? options.error.message : options.error;
    const errorStack = options.error instanceof Error ? options.error.stack : undefined;

    await db.collection('error_logs').add({
      correlationId: options.correlationId,
      error: errorMessage,
      stack: errorStack,
      context: options.context,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: new Date().toISOString(),
    });

    // @SECURITY_FIX (Wave 10): NODE_ENV gate — errorMessage is message-only (low risk) but gated for consistency
    if (process.env.NODE_ENV !== 'production') { console.error(`[Error ${options.correlationId}]`, errorMessage); }
  } catch (logError) {
    // Don't throw if logging fails - just console log
    // @SECURITY_FIX (Wave 10): NODE_ENV gate — full error objects in logError fallback path
    if (process.env.NODE_ENV !== 'production') { console.error('[Error Logging Failed]', logError); }
    if (process.env.NODE_ENV !== 'production') { console.error('[Original Error]', options.error); }
  }
}
