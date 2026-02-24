// GUID: LIB_TRACED_ERROR-000-v04
// [Intent] Error creation and logging utilities for the traced-error system. Creates errors from
//          registry definitions (code.json), assigns correlation IDs, and logs to Firestore (server)
//          or /api/log-client-error (client). Every traced error carries full diagnostic metadata.
// [Inbound Trigger] Imported by API routes, Cloud Functions, and client components that handle errors.
// [Downstream Impact] Changes to error shape or logging format affect error_logs queries, admin error
//                     viewer, and user-facing error displays. Correlation ID format affects support workflows.
// @SECURITY_FIX (GEMINI-AUDIT-058): Added CoreErrorInput interface so createTracedError accepts both
//   the full ErrorDefinition (server-side) and the minimal ClientErrorDefinition (client-side),
//   preventing internal metadata from being pulled into the client bundle.

import type { ErrorDefinition, TracedError } from '@/types/errors';

// GUID: LIB_TRACED_ERROR-004-v01
// @SECURITY_FIX (GEMINI-AUDIT-058): Relaxed type to accept ClientErrorDefinition.
// [Intent] Minimal common interface satisfied by BOTH ErrorDefinition (full, server-side) AND
//          ClientErrorDefinition (stripped, client-safe). createTracedError accepts this interface
//          so 'use client' components can pass CLIENT_ERRORS entries without importing the full
//          server-only error-registry which bundles internal file paths, GUIDs, and call graphs.
// [Inbound Trigger] Used as the parameter type for createTracedError.
// [Downstream Impact] Any future error definition type must satisfy this interface to be usable
//                     with createTracedError. Optional fields are gracefully handled with fallbacks.
export interface CoreErrorInput {
  key: string;
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  module?: string;
  guid?: string;
}

// GUID: LIB_TRACED_ERROR-001-v04
// @SECURITY_FIX (GEMINI-AUDIT-070): Replaced inline require('crypto') with globalThis.crypto.randomUUID()
//   which works in both browser (Web Crypto API) and Node.js (v19+ global) without a Node-only import.
//   Do NOT use `import { randomUUID } from 'crypto'` here — this file is imported by 'use client'
//   components and a Node.js-only static import would break the client bundle.
// [Intent] Generate a unique correlation ID with a module-specific prefix for error tracking.
//          Format: [prefix]_[timestamp-base36]_[random-6-chars] -- short, unique, and copyable.
// [Inbound Trigger] Called by createTracedError when no correlationId is provided, or directly by
//                   catch blocks that need a correlation ID before creating the traced error.
// [Downstream Impact] The correlation ID links user-reported errors to server-side error_logs entries.
//                     Changing the format requires updating any log queries that parse correlation IDs.
// [Security] Uses globalThis.crypto.randomUUID() for secure randomness (LIB-002 / GEMINI-AUDIT-070).
export function generateCorrelationId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = globalThis.crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  return `${prefix}_${timestamp}_${random}`;
}

// GUID: LIB_TRACED_ERROR-002-v04
// @SECURITY_FIX (GEMINI-AUDIT-058): Relaxed type to accept ClientErrorDefinition.
// [Intent] Factory function that creates a TracedError from an error definition (sourced from the
//          error registry or the client-safe registry). Attaches correlation ID, runtime context,
//          and timestamp. The resulting error object answers all four diagnostic questions when logged.
//          Accepts CoreErrorInput so both ErrorDefinition (full) and ClientErrorDefinition (stripped)
//          can be passed — enabling 'use client' components to avoid importing the server-only registry.
// [Inbound Trigger] Called in catch blocks after importing ERRORS from error-registry.ts (server) or
//                   CLIENT_ERRORS from error-registry-client.ts (client components).
// [Downstream Impact] The returned TracedError is passed to logTracedError() for persistence and
//                     to UI components for user-facing display with selectable text.
export function createTracedError(
  definition: CoreErrorInput,
  options: {
    correlationId?: string;
    context?: Record<string, unknown>;
    cause?: Error;
  } = {}
): TracedError {
  // Fallback to 'client' prefix when module is absent (ClientErrorDefinition has no module field).
  const modulePrefix = definition.module ?? 'client';
  const correlationId = options.correlationId ??
    generateCorrelationId(modulePrefix.toLowerCase());

  const error = new Error(definition.message) as TracedError;
  error.name = definition.code;
  // Cast is safe: server callers always pass the full ErrorDefinition; client callers pass
  // ClientErrorDefinition whose absent fields (file, recovery, etc.) are handled gracefully
  // in logTracedError by the missing-field-safe entry construction below.
  error.definition = definition as ErrorDefinition;
  error.correlationId = correlationId;
  error.context = options.context ?? {};
  error.timestamp = new Date().toISOString();

  if (options.cause) error.cause = options.cause;
  return error;
}

// GUID: LIB_TRACED_ERROR-003-v04
// @SECURITY_FIX (GEMINI-AUDIT-058): Gated console.error behind NODE_ENV !== 'production' to
//   prevent internal diagnostic metadata (file paths, GUIDs, recovery steps) from appearing in
//   browser console in production where any user can inspect it.
// [Intent] Logs a TracedError with full diagnostic metadata to Firestore (server-side) or to
//          /api/log-client-error (client-side). Also writes a structured console.error for local
//          debugging only (suppressed in production). The log entry answers all four diagnostic questions.
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

  // @SECURITY_FIX (GEMINI-AUDIT-058): Only log diagnostic detail (file paths, GUIDs, recovery)
  // to the console in non-production environments. In production, these details are visible to
  // any user who opens browser DevTools, leaking internal system metadata.
  if (process.env.NODE_ENV !== 'production') {
    console.error(
      `\n[${entry.code}] ${entry.message}\n` +
      `   GUID: ${entry.guid}\n` +
      `   File: ${entry.file}:${entry.functionName}\n` +
      `   Correlation: ${entry.correlationId}\n` +
      `   Recovery: ${entry.recovery}\n`
    );
  }

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
