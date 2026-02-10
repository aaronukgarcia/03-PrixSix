// GUID: LIB_TRACED_ERROR-000-v03
// [Intent] Error creation and logging utilities for the traced-error system. Creates errors from
//          registry definitions (code.json), assigns correlation IDs, and logs to Firestore (server)
//          or /api/log-client-error (client). Every traced error carries full diagnostic metadata.
// [Inbound Trigger] Imported by API routes, Cloud Functions, and client components that handle errors.
// [Downstream Impact] Changes to error shape or logging format affect error_logs queries, admin error
//                     viewer, and user-facing error displays. Correlation ID format affects support workflows.

import type { ErrorDefinition, TracedError } from '@/types/errors';

// GUID: LIB_TRACED_ERROR-001-v03
// [Intent] Generate a unique correlation ID with a module-specific prefix for error tracking.
//          Format: [prefix]_[timestamp-base36]_[random-6-chars] -- short, unique, and copyable.
// [Inbound Trigger] Called by createTracedError when no correlationId is provided, or directly by
//                   catch blocks that need a correlation ID before creating the traced error.
// [Downstream Impact] The correlation ID links user-reported errors to server-side error_logs entries.
//                     Changing the format requires updating any log queries that parse correlation IDs.
// [Security] Uses crypto.randomUUID() instead of Math.random() for secure randomness (LIB-002 fix).
export function generateCorrelationId(prefix: string): string {
  const crypto = require('crypto');
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  return `${prefix}_${timestamp}_${random}`;
}

// GUID: LIB_TRACED_ERROR-002-v03
// [Intent] Factory function that creates a TracedError from an ErrorDefinition (sourced from the
//          error registry). Attaches correlation ID, runtime context, and timestamp. The resulting
//          error object answers all four diagnostic questions when logged.
// [Inbound Trigger] Called in catch blocks after importing ERRORS from error-registry.ts.
// [Downstream Impact] The returned TracedError is passed to logTracedError() for persistence and
//                     to UI components for user-facing display with selectable text.
export function createTracedError(
  definition: ErrorDefinition,
  options: {
    correlationId?: string;
    context?: Record<string, unknown>;
    cause?: Error;
  } = {}
): TracedError {
  const correlationId = options.correlationId ??
    generateCorrelationId(definition.module.toLowerCase());

  const error = new Error(definition.message) as TracedError;
  error.name = definition.code;
  error.definition = definition;
  error.correlationId = correlationId;
  error.context = options.context ?? {};
  error.timestamp = new Date().toISOString();

  if (options.cause) error.cause = options.cause;
  return error;
}

// GUID: LIB_TRACED_ERROR-003-v03
// [Intent] Logs a TracedError with full diagnostic metadata to Firestore (server-side) or to
//          /api/log-client-error (client-side). Also writes a structured console.error for local
//          debugging. The log entry answers all four diagnostic questions.
// [Inbound Trigger] Called after createTracedError() in catch blocks, before returning error responses.
// [Downstream Impact] Writes to error_logs collection (server) or triggers a POST to the logging API (client).
//                     The admin ErrorLogViewer reads these entries. Console output aids local debugging.
export async function logTracedError(
  error: TracedError,
  db?: FirebaseFirestore.Firestore
): Promise<void> {
  const entry = {
    code: error.definition.code,
    guid: error.definition.guid,
    module: error.definition.module,
    file: error.definition.file,
    functionName: error.definition.functionName,
    message: error.definition.message,
    severity: error.definition.severity,
    recovery: error.definition.recovery,
    failureModes: error.definition.failureModes,
    correlationId: error.correlationId,
    context: error.context,
    timestamp: new Date(),
    stack: error.stack,
    calledBy: error.definition.calledBy,
    calls: error.definition.calls
  };

  console.error(
    `\n[${entry.code}] ${entry.message}\n` +
    `   GUID: ${entry.guid}\n` +
    `   File: ${entry.file}:${entry.functionName}\n` +
    `   Correlation: ${entry.correlationId}\n` +
    `   Recovery: ${entry.recovery}\n`
  );

  if (db) {
    await db.collection('error_logs').add(entry);
  } else if (typeof window !== 'undefined') {
    await fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  }
}
