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

// GUID: API_LOG_CLIENT_ERROR-002-v04
// [Intent] TypeScript interfaces defining the expected shape of client error payloads. Supports both
//          the legacy format (correlationId + errorCode + error) and the new TracedError format from
//          logTracedError() which includes full diagnostic metadata (guid, module, file, recovery, etc.).
// [Inbound Trigger] Referenced by the POST handler when typing the parsed request body.
// [Downstream Impact] Defines the contract between client-side error reporters and this API endpoint.
//                     Both formats write to error_logs. The traced format includes richer metadata.
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

interface TracedErrorRequest {
  code: string;
  guid: string;
  module: string;
  file: string;
  functionName: string;
  message: string;
  severity: string;
  recovery: string;
  failureModes: string[];
  correlationId: string;
  context: Record<string, unknown>;
  timestamp: string;
  stack?: string;
  calledBy: string[];
  calls: string[];
}

// GUID: API_LOG_CLIENT_ERROR-003-v04
// [Intent] POST handler that validates the incoming client error payload and writes it to the Firestore
//          error_logs collection. Accepts both legacy format and new TracedError format. Designed to be
//          resilient — never returns an error that would worsen the client's already-errored state.
// [Inbound Trigger] POST /api/log-client-error with JSON body matching ClientErrorRequest or TracedErrorRequest.
// [Downstream Impact] Writes to Firestore error_logs collection with source: 'client'. The catch block
//                     intentionally returns 500 silently — the client is already in an error state.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // GUID: API_LOG_CLIENT_ERROR-004-v04
    // [Intent] Detect whether the payload is a TracedError (has guid + module fields) or legacy format.
    //          Route to the appropriate persistence logic. Both formats require a correlationId.
    // [Inbound Trigger] Every incoming POST request.
    // [Downstream Impact] Returns 400 if correlationId is missing. TracedError format writes richer metadata.
    const isTracedError = body.guid && body.module && body.code;

    if (isTracedError) {
      const traced: TracedErrorRequest = body;
      if (!traced.correlationId) {
        return NextResponse.json(
          { success: false, error: 'Missing correlationId' },
          { status: 400 }
        );
      }

      // GUID: API_LOG_CLIENT_ERROR-007-v03
      // [Intent] Persist a TracedError payload with full diagnostic metadata to error_logs.
      //          Stores all four diagnostic answers: where (file, functionName, guid), what (message, context),
      //          known failures (recovery, failureModes), and who triggered (calledBy, calls).
      // [Inbound Trigger] Client-side logTracedError() call via fetch.
      // [Downstream Impact] Creates a richer error_logs document. Admin ErrorLogViewer can display recovery hints.
      await db.collection('error_logs').add({
        correlationId: traced.correlationId,
        errorCode: traced.code,
        error: traced.message,
        guid: traced.guid,
        module: traced.module,
        file: traced.file,
        functionName: traced.functionName,
        severity: traced.severity,
        recovery: traced.recovery,
        failureModes: traced.failureModes,
        stack: traced.stack || null,
        calledBy: traced.calledBy,
        calls: traced.calls,
        context: {
          ...traced.context,
          source: 'client',
          additionalInfo: {
            errorCode: traced.code,
            errorType: 'TracedError',
          },
        },
        timestamp: traced.timestamp ? new Date(traced.timestamp) : new Date(),
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ success: true });
    }

    // Legacy format
    const legacyBody: ClientErrorRequest = body;

    if (!legacyBody.correlationId || !legacyBody.error) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // GUID: API_LOG_CLIENT_ERROR-005-v04
    // [Intent] Persist a legacy client error payload to Firestore error_logs collection with context,
    //          defaulting errorCode to PX-9001 (unknown) if not provided.
    // [Inbound Trigger] Validation passed — correlationId and error are present. No guid/module fields detected.
    // [Downstream Impact] Creates a document in error_logs with source: 'client'. Admin error dashboard reads these.
    await db.collection('error_logs').add({
      correlationId: legacyBody.correlationId,
      errorCode: legacyBody.errorCode || 'PX-9001',
      error: legacyBody.error,
      stack: legacyBody.stack || null,
      digest: legacyBody.digest || null,
      context: {
        ...legacyBody.context,
        source: 'client',
        additionalInfo: {
          errorCode: legacyBody.errorCode || 'PX-9001',
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
