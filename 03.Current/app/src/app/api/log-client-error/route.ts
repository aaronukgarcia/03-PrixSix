// GUID: API_LOG_CLIENT_ERROR-000-v03
// [Intent] API route for receiving and persisting client-side errors to Firestore. Provides a server endpoint so browser-based error handlers can log errors with correlation IDs to the error_logs collection.
// [Inbound Trigger] POST request from client-side error handlers (ErrorBoundary, toast handlers, catch blocks) via fetch('/api/log-client-error', ...).
// [Downstream Impact] Writes to Firestore error_logs collection. Admin error dashboard reads these entries. Golden Rule #1: ensures client errors are captured server-side.

import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { ERRORS } from '@/lib/error-registry';

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

// GUID: API_LOG_CLIENT_ERROR-003-v05
// @SECURITY_FIX: Added input validation and size limits to prevent log injection and DoS attacks.
//   Previous version had no limits on payload size or field lengths, allowing attackers to:
//   - Flood error_logs with spam (resource exhaustion)
//   - Inject malicious payloads into admin dashboard
//   - Pollute logs with junk data
// [Intent] POST handler that validates the incoming client error payload and writes it to the Firestore
//          error_logs collection. Accepts both legacy format and new TracedError format. Designed to be
//          resilient — never returns an error that would worsen the client's already-errored state.
// [Inbound Trigger] POST /api/log-client-error with JSON body matching ClientErrorRequest or TracedErrorRequest.
// [Downstream Impact] Writes to Firestore error_logs collection with source: 'client'. The catch block
//                     intentionally returns 500 silently — the client is already in an error state.
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Limit payload size to prevent DoS (1MB limit)
    const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 413 }
      );
    }

    const body = await request.json();

    // SECURITY: Validate and sanitize string fields to prevent log injection
    const MAX_STRING_LENGTH = 10000; // 10KB per string field
    const MAX_CORRELATION_ID_LENGTH = 100;

    const sanitizeString = (str: any, maxLength: number): string => {
      if (typeof str !== 'string') return '';
      // Truncate to max length
      return str.slice(0, maxLength);
    };

    // GUID: API_LOG_CLIENT_ERROR-004-v05
    // [Intent] Detect whether the payload is a TracedError (has guid + module fields) or legacy format.
    //          Route to the appropriate persistence logic. Both formats require a correlationId.
    //          SECURITY: Added field length validation to prevent log pollution.
    // [Inbound Trigger] Every incoming POST request.
    // [Downstream Impact] Returns 400 if correlationId is missing or invalid. TracedError format writes richer metadata.
    const isTracedError = body.guid && body.module && body.code;

    if (isTracedError) {
      const traced: TracedErrorRequest = body;
      if (!traced.correlationId || traced.correlationId.length > MAX_CORRELATION_ID_LENGTH) {
        return NextResponse.json(
          { success: false, error: 'Invalid or missing correlationId' },
          { status: 400 }
        );
      }

      // GUID: API_LOG_CLIENT_ERROR-007-v04
      // [Intent] Persist a TracedError payload with full diagnostic metadata to error_logs.
      //          Stores all four diagnostic answers: where (file, functionName, guid), what (message, context),
      //          known failures (recovery, failureModes), and who triggered (calledBy, calls).
      //          SECURITY: All string fields are sanitized and truncated to prevent log injection.
      // [Inbound Trigger] Client-side logTracedError() call via fetch.
      // [Downstream Impact] Creates a richer error_logs document. Admin ErrorLogViewer can display recovery hints.
      await db.collection('error_logs').add({
        correlationId: sanitizeString(traced.correlationId, MAX_CORRELATION_ID_LENGTH),
        errorCode: sanitizeString(traced.code, 50),
        error: sanitizeString(traced.message, MAX_STRING_LENGTH),
        guid: sanitizeString(traced.guid, 100),
        module: sanitizeString(traced.module, 100),
        file: sanitizeString(traced.file, 500),
        functionName: sanitizeString(traced.functionName, 200),
        severity: sanitizeString(traced.severity, 50),
        recovery: sanitizeString(traced.recovery, MAX_STRING_LENGTH),
        failureModes: Array.isArray(traced.failureModes)
          ? traced.failureModes.slice(0, 10).map(fm => sanitizeString(fm, 1000))
          : [],
        stack: traced.stack ? sanitizeString(traced.stack, MAX_STRING_LENGTH) : null,
        calledBy: Array.isArray(traced.calledBy)
          ? traced.calledBy.slice(0, 20).map(cb => sanitizeString(cb, 200))
          : [],
        calls: Array.isArray(traced.calls)
          ? traced.calls.slice(0, 20).map(c => sanitizeString(c, 200))
          : [],
        context: {
          ...traced.context,
          source: 'client',
          additionalInfo: {
            errorCode: sanitizeString(traced.code, 50),
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

    if (!legacyBody.correlationId || !legacyBody.error ||
        legacyBody.correlationId.length > MAX_CORRELATION_ID_LENGTH) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid required fields' },
        { status: 400 }
      );
    }

    // GUID: API_LOG_CLIENT_ERROR-005-v06
    // [Intent] Persist a legacy client error payload to Firestore error_logs collection with context,
    //          defaulting errorCode to PX-9001 (unknown) if not provided.
    //          SECURITY: All string fields are sanitized and truncated to prevent log injection.
    // [Inbound Trigger] Validation passed — correlationId and error are present. No guid/module fields detected.
    // [Downstream Impact] Creates a document in error_logs with source: 'client'. Admin error dashboard reads these.
    await db.collection('error_logs').add({
      correlationId: sanitizeString(legacyBody.correlationId, MAX_CORRELATION_ID_LENGTH),
      errorCode: sanitizeString(legacyBody.errorCode || ERRORS.UNKNOWN_ERROR.code, 50),
      error: sanitizeString(legacyBody.error, MAX_STRING_LENGTH),
      stack: legacyBody.stack ? sanitizeString(legacyBody.stack, MAX_STRING_LENGTH) : null,
      digest: legacyBody.digest ? sanitizeString(legacyBody.digest, 100) : null,
      context: {
        ...legacyBody.context,
        source: 'client',
        additionalInfo: {
          errorCode: sanitizeString(legacyBody.errorCode || ERRORS.UNKNOWN_ERROR.code, 50),
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
