// GUID: LIB_FIREBASE_ADMIN-000-v03
// [Intent] Server-side Firebase Admin SDK initialisation and shared utilities for authentication verification, correlation ID generation, and centralised error logging.
// [Inbound Trigger] Imported by all server-side API routes that need Firestore access, auth verification, or error logging.
// [Downstream Impact] Every server-side API route depends on this module. Changes to initialisation logic, auth verification, or error logging affect the entire backend.

/**
 * Firebase Admin SDK initialization for server-side API routes.
 * Uses Application Default Credentials (ADC) when running on Google Cloud,
 * falls back to service account cert for local development.
 */

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

// GUID: LIB_FIREBASE_ADMIN-002-v03
// [Intent] Lazily initialises the Firebase Admin SDK (choosing between explicit service account credentials for local dev or Application Default Credentials for Google Cloud) and returns the Firestore instance, FieldValue, and Timestamp utilities.
// [Inbound Trigger] Called by every API route that needs server-side Firestore access (login, scoring, admin operations, error logging).
// [Downstream Impact] All server-side database operations depend on this function. If initialisation fails, the entire backend is non-functional. The credential selection logic must match the deployment environment.
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
        // Use explicit credentials (local development)
        console.log('[Firebase Admin] Initializing with service account credentials');
        adminApp = initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
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
      console.error('[Firebase Admin] Initialization failed:', error);
      throw new Error('Failed to initialize Firebase Admin SDK. Check credentials configuration.');
    }
  }

  adminDb = getFirestore();
  adminFieldValue = FieldValue;
  adminTimestamp = Timestamp;

  return { db: adminDb, FieldValue: adminFieldValue, Timestamp: adminTimestamp };
}

// GUID: LIB_FIREBASE_ADMIN-003-v03
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
    const { getAuth } = await import('firebase-admin/auth');
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
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
export function generateCorrelationId(): string {
  const crypto = require('crypto');
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  return `err_${timestamp}_${random}`;
}

// GUID: LIB_FIREBASE_ADMIN-005-v03
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

    console.error(`[Error ${options.correlationId}]`, errorMessage);
  } catch (logError) {
    // Don't throw if logging fails - just console log
    console.error('[Error Logging Failed]', logError);
    console.error('[Original Error]', options.error);
  }
}
