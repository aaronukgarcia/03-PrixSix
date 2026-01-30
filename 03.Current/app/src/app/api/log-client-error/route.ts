// GUID: API_LOG_CLIENT_ERROR-000-v03
// [Intent] API route for receiving and persisting client-side errors to Firestore. Provides a server endpoint so browser-based error handlers can log errors with correlation IDs to the error_logs collection.
// [Inbound Trigger] POST request from client-side error handlers (ErrorBoundary, toast handlers, catch blocks) via fetch('/api/log-client-error', ...).
// [Downstream Impact] Writes to Firestore error_logs collection. Admin error dashboard reads these entries. Golden Rule #1: ensures client errors are captured server-side.

import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';

// GUID: API_LOG_CLIENT_ERROR-001-v03
// [Intent] Initialise Firebase Admin SDK if not already done. Supports both production (Application Default Credentials) and local development (service account file).
// [Inbound Trigger] Module load — runs once when the route is first imported.
// [Downstream Impact] Provides the Firestore db instance used by the POST handler. If initialisation fails, all subsequent requests to this route will fail.
let app: App;
if (!getApps().length) {
  // In production (Firebase App Hosting), use default credentials
  // Locally, use service account from env
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    app = initializeApp({
      credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'studio-6033436327-281b1',
    });
  } else {
    app = initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'studio-6033436327-281b1',
    });
  }
} else {
  app = getApps()[0];
}

const db = getFirestore(app);

// Force dynamic
export const dynamic = 'force-dynamic';

// GUID: API_LOG_CLIENT_ERROR-002-v03
// [Intent] TypeScript interface defining the expected shape of client error payloads. Ensures type safety for the request body.
// [Inbound Trigger] Referenced by the POST handler when typing the parsed request body.
// [Downstream Impact] Defines the contract between client-side error reporters and this API endpoint. Changes here require updating all client-side callers.
interface ClientErrorRequest {
  correlationId: string;
  errorCode?: string;
  error: string;
  stack?: string;
  digest?: string;
  context?: {
    route?: string;
    action?: string;
    userAgent?: string;
    [key: string]: any;
  };
}

// GUID: API_LOG_CLIENT_ERROR-003-v03
// [Intent] POST handler that validates the incoming client error payload and writes it to the Firestore error_logs collection. Designed to be resilient — never returns an error that would worsen the client's already-errored state.
// [Inbound Trigger] POST /api/log-client-error with JSON body matching ClientErrorRequest interface.
// [Downstream Impact] Writes to Firestore error_logs collection with source: 'client'. The catch block intentionally returns 500 silently — the client is already in an error state and additional error handling would be counterproductive.
export async function POST(request: NextRequest) {
  try {
    const body: ClientErrorRequest = await request.json();

    // GUID: API_LOG_CLIENT_ERROR-004-v03
    // [Intent] Basic validation — ensures the minimum required fields (correlationId and error message) are present.
    // [Inbound Trigger] Every incoming POST request.
    // [Downstream Impact] Returns 400 if missing fields. Prevents empty or meaningless error log entries.
    if (!body.correlationId || !body.error) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Rate limiting - simple check based on IP (optional enhancement)
    // For now, just log it

    // GUID: API_LOG_CLIENT_ERROR-005-v03
    // [Intent] Persist the client error to Firestore error_logs collection with full context, defaulting errorCode to PX-9001 (unknown) if not provided.
    // [Inbound Trigger] Validation passed — correlationId and error are present.
    // [Downstream Impact] Creates a new document in error_logs. Includes source: 'client' to distinguish from server-side errors. Admin error dashboard reads these entries.
    await db.collection('error_logs').add({
      correlationId: body.correlationId,
      errorCode: body.errorCode || 'PX-9001',
      error: body.error,
      stack: body.stack || null,
      digest: body.digest || null,
      context: {
        ...body.context,
        source: 'client',
        additionalInfo: {
          errorCode: body.errorCode || 'PX-9001',
          errorType: 'ClientSideError',
        },
      },
      timestamp: new Date(),
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    // GUID: API_LOG_CLIENT_ERROR-006-v03
    // [Intent] Catch-all error handler — logs to console but returns a simple 500. Intentionally does NOT call logError() to avoid recursive error logging. The client is already in an error state.
    // [Inbound Trigger] Any uncaught exception within the POST handler (e.g., Firestore write failure).
    // [Downstream Impact] Returns 500 to client. Console log only — no Firestore write to avoid cascade if Firestore itself is the problem.
    console.error('[Log Client Error API]', error);
    // Don't fail - client is already in error state
    return NextResponse.json(
      { success: false, error: 'Failed to log error' },
      { status: 500 }
    );
  }
}
