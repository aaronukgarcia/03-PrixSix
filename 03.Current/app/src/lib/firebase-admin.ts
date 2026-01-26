/**
 * Firebase Admin SDK initialization for server-side API routes.
 * Uses Application Default Credentials (ADC) when running on Google Cloud,
 * falls back to service account cert for local development.
 */

import type { App } from 'firebase-admin/app';
import type { Firestore, FieldValue as FieldValueType, Timestamp as TimestampType } from 'firebase-admin/firestore';

let adminApp: App | null = null;
let adminDb: Firestore | null = null;
let adminFieldValue: typeof FieldValueType | null = null;
let adminTimestamp: typeof TimestampType | null = null;

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

/**
 * Generate a correlation ID for error tracking
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `err_${timestamp}_${random}`;
}

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
