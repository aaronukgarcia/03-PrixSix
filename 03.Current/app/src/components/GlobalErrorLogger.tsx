// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-000-v01
// [Intent] Comprehensive client-side error logger that captures ALL unhandled errors and
//          promise rejections, sends them to the server via /api/log-client-error.
//          Works alongside ChunkErrorHandler (which handles chunk errors separately).
// [Inbound Trigger] Mounted once in root layout. Listens to global window error events.
// [Downstream Impact] Ensures all client-side errors are logged to error_logs collection
//                     for debugging and monitoring. Critical for production error tracking.

'use client';

import { useEffect } from 'react';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-001-v01
// [Intent] Check if error is a chunk load error (already handled by ChunkErrorHandler).
// [Inbound Trigger] Called by error listeners to avoid duplicate logging.
// [Downstream Impact] Returns true for chunk errors (skip logging), false for all others.
function isChunkLoadError(error: any): boolean {
  const message = error?.message || error?.toString() || '';
  const name = error?.name || '';

  return (
    name === 'ChunkLoadError' ||
    message.includes('ChunkLoadError') ||
    message.includes('Loading chunk') ||
    message.includes('Failed to fetch dynamically imported module') ||
    /chunk.*failed/i.test(message)
  );
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-002-v01
// [Intent] Send error details to server for persistent logging in error_logs collection.
// [Inbound Trigger] Called by both error and unhandledrejection listeners.
// [Downstream Impact] Creates server-side error log entry with correlation ID, stack trace,
//                     and context. Fails silently if logging endpoint unavailable.
async function logErrorToServer(
  error: Error | any,
  type: 'error' | 'unhandledrejection',
  context: Record<string, any> = {}
) {
  try {
    const correlationId = generateClientCorrelationId();
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    const stack = error?.stack || null;

    console.error(`[GlobalErrorLogger ${correlationId}] ${type}:`, errorMessage, {
      stack,
      context,
      error,
    });

    // Send to server (fire and forget - don't await)
    fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationId,
        errorCode: ERRORS.NETWORK_ERROR.code,
        error: errorMessage,
        stack,
        context: {
          type,
          route: typeof window !== 'undefined' ? window.location.pathname : 'unknown',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          timestamp: new Date().toISOString(),
          ...context,
        },
      }),
    }).catch((fetchError) => {
      // Silently fail - don't cascade errors from error logging
      console.warn('[GlobalErrorLogger] Failed to send error to server:', fetchError);
    });
  } catch (loggingError) {
    // Absolutely prevent error logging from crashing the app
    console.warn('[GlobalErrorLogger] Failed to log error:', loggingError);
  }
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-003-v01
// [Intent] Main component that sets up global error and promise rejection listeners.
//          Captures all client-side errors except chunk load errors (handled separately).
// [Inbound Trigger] Rendered once in root layout (app/layout.tsx).
// [Downstream Impact] Runs for the entire app session. Logs all unhandled errors to server.
export function GlobalErrorLogger() {
  useEffect(() => {
    // GUID: COMPONENT_GLOBAL_ERROR_LOGGER-004-v01
    // [Intent] Handle window-level unhandled errors (runtime errors, syntax errors, etc.).
    // [Inbound Trigger] Fires on any unhandled error in the browser context.
    // [Downstream Impact] Sends error to server unless it's a chunk load error.
    const handleError = (event: ErrorEvent) => {
      // Skip chunk errors (handled by ChunkErrorHandler)
      if (isChunkLoadError(event.error || event)) {
        return;
      }

      // Log all other errors to server
      logErrorToServer(event.error || new Error(event.message), 'error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        message: event.message,
      });
    };

    // GUID: COMPONENT_GLOBAL_ERROR_LOGGER-005-v01
    // [Intent] Handle unhandled promise rejections (async errors, failed fetches, etc.).
    // [Inbound Trigger] Fires when a Promise is rejected without a .catch() handler.
    // [Downstream Impact] Sends rejection to server unless it's a chunk load error.
    const handleRejection = (event: PromiseRejectionEvent) => {
      // Skip chunk errors (handled by ChunkErrorHandler)
      if (isChunkLoadError(event.reason)) {
        return;
      }

      // Log all other rejections to server
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(event.reason?.toString() || 'Unhandled promise rejection');

      logErrorToServer(error, 'unhandledrejection', {
        reason: event.reason,
      });
    };

    // Register global listeners
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    console.log('[GlobalErrorLogger] Initialized - all client errors will be logged to server');

    // Cleanup on unmount (should never happen in root layout, but good practice)
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null; // This component doesn't render anything
}
