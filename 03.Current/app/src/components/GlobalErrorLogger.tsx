// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-000-v03
// @SECURITY_FIX: GEMINI-AUDIT-044 — console.error now redacts stack/context/error object in production.
//   Previously: full error object, stack trace, and context logged unconditionally → visible in
//   any user's DevTools. Fixed: development logs full details; production logs correlationId + message only.
//   Also: console.log init message now suppressed in production.
// @FIX(v03): Added isBotCrawler() filter (BUG-ERR-002). Bots executing JS without auth sessions
//   produce unactionable error noise (bingbot "Failed to fetch", 403s, etc.). Suppressed at source.
// [Intent] Comprehensive client-side error logger that captures ALL unhandled errors and
//          promise rejections, sends them to the server via /api/log-client-error.
//          Works alongside ChunkErrorHandler (which handles chunk errors separately).
// [Inbound Trigger] Mounted once in root layout. Listens to global window error events.
// [Downstream Impact] Ensures all client-side errors are logged to error_logs collection
//                     for debugging and monitoring. Critical for production error tracking.

'use client';

import { useEffect } from 'react';
import { generateClientCorrelationId } from '@/lib/error-codes';
// @SECURITY_FIX: GEMINI-AUDIT-058 — Import from client-safe registry (no internal metadata).
import { CLIENT_ERRORS as ERRORS } from '@/lib/error-registry-client';

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-008-v01
// [Intent] Simple in-memory deduplication map — prevents flooding error_logs with the same
//          error many times in quick succession (e.g. IndexedDB disconnect fires ~1/sec on
//          Safari iOS). Key = errorMessage|route; value = last-logged timestamp.
//          TTL: 60 seconds — same error on the same route within 60s is suppressed.
// [Inbound Trigger] Checked inside logErrorToServer before every Firestore write.
// [Downstream Impact] Max one log entry per unique error+route per 60 seconds.
const recentErrors = new Map<string, number>();
const DEDUP_TTL_MS = 60_000;

function isDuplicate(message: string, route: string): boolean {
  const key = `${message}|${route}`;
  const last = recentErrors.get(key);
  const now = Date.now();
  if (last && now - last < DEDUP_TTL_MS) return true;
  recentErrors.set(key, now);
  // Prune stale keys to prevent unbounded growth
  if (recentErrors.size > 50) {
    for (const [k, t] of recentErrors) {
      if (now - t >= DEDUP_TTL_MS) recentErrors.delete(k);
    }
  }
  return false;
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-009-v01
// [Intent] Detect Safari/iOS IndexedDB disconnection errors from the Firebase SDK.
//          "Connection to Indexed Database server lost" fires as an unhandledrejection
//          with reason:{} — it is a browser environment issue (private browsing, low
//          memory, OS-level IDB reset) and is entirely unactionable at the app level.
//          Suppressing it keeps error_logs clean (BUG-ERR-003).
// [Inbound Trigger] Called by rejection handler before deciding whether to log.
// [Downstream Impact] Returns true → skip logging. IndexedDB errors are not sent to server.
function isIndexedDBError(error: any): boolean {
  const message = error?.message || error?.toString() || '';
  return (
    message.includes('Connection to Indexed Database server lost') ||
    message.includes('IDBDatabase') ||
    message.includes('indexed database')
  );
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-001-v02
// [Intent] Check if error is a chunk load error (already handled by ChunkErrorHandler).
//          Includes Safari/iOS pattern: dynamic import failures surface as TypeError "Load failed"
//          with no chunk-specific message — caught as unhandledrejection.
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
    /chunk.*failed/i.test(message) ||
    // iOS Safari reports dynamic import (chunk) failures as TypeError: "Load failed"
    (name === 'TypeError' && message === 'Load failed')
  );
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-006-v02
// [Intent] Detect Firebase Performance attribute errors caused by Tailwind CSS class strings
//          being passed to putAttribute() by auto-instrumentation (PERF-001). These are SDK-level
//          noise — not actionable errors — and must be suppressed to keep error_logs clean.
// [Inbound Trigger] Called by error/rejection handlers before deciding whether to log.
// [Downstream Impact] Returns true for performance/invalid attribute value errors (skip logging).
//                     Primary fix is initializePerformance({ instrumentationEnabled: false }) in
//                     layout.tsx (APP_LAYOUT-001-v02). This is belt-and-suspenders. (v1.58.68)
function isFirebasePerformanceError(error: any): boolean {
  const message = error?.message || error?.toString() || '';
  return message.includes('performance/invalid attribute value');
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-007-v01
// [Intent] Detect known web crawler / bot user-agents and suppress error logging for them.
//          Bots (Bingbot, Googlebot, etc.) execute JavaScript and make authenticated Firebase
//          API calls which fail — these are not real user errors and pollute error_logs with
//          noise (BUG-ERR-002). Bot errors are unactionable: the app cannot serve bots correctly
//          because they have no auth session.
// [Inbound Trigger] Called by error/rejection handlers before deciding whether to log.
// [Downstream Impact] Returns true if the current user-agent is a known crawler (skip logging).
function isBotCrawler(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /bot|crawl|spider|slurp|facebookexternalhit|ia_archiver/i.test(navigator.userAgent);
}

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-002-v02
// @SECURITY_FIX: GEMINI-AUDIT-044 — Production console.error now omits stack/context/error object.
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
    const route = typeof window !== 'undefined' ? window.location.pathname : 'unknown';

    // Deduplicate — same error on same route within 60s logs once only (COMPONENT_GLOBAL_ERROR_LOGGER-008)
    if (isDuplicate(errorMessage, route)) return;
    const stack = error?.stack || null;

    // In production: log only the correlation ID to prevent stack trace/context disclosure in DevTools.
    // Full details are sent to the server (error_logs collection) regardless of environment.
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[GlobalErrorLogger ${correlationId}] ${type}:`, errorMessage, {
        stack,
        context,
        error,
      });
    } else {
      console.error(`[GlobalErrorLogger ${correlationId}] ${type}: ${errorMessage}`);
    }

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

// GUID: COMPONENT_GLOBAL_ERROR_LOGGER-003-v02
// [Intent] Main component that sets up global error and promise rejection listeners.
//          Captures all client-side errors except chunk load errors (handled separately).
// [Inbound Trigger] Rendered once in root layout (app/layout.tsx).
// [Downstream Impact] Runs for the entire app session. Logs all unhandled errors to server.
export function GlobalErrorLogger() {
  useEffect(() => {
    // GUID: COMPONENT_GLOBAL_ERROR_LOGGER-004-v03
    // [Intent] Handle window-level unhandled errors (runtime errors, syntax errors, etc.).
    // [Inbound Trigger] Fires on any unhandled error in the browser context.
    // [Downstream Impact] Sends error to server unless it's a chunk load error, Firebase
    //                     Performance attribute noise (PERF-001, v1.58.68), or a bot crawler.
    const handleError = (event: ErrorEvent) => {
      // Skip bot crawlers — they execute JS without auth sessions, all their errors are noise
      if (isBotCrawler()) return;
      // Skip chunk errors (handled by ChunkErrorHandler)
      if (isChunkLoadError(event.error || event)) {
        return;
      }
      // Skip Firebase Performance attribute errors (PERF-001: Tailwind class strings in putAttribute)
      if (isFirebasePerformanceError(event.error || event)) {
        return;
      }
      // Skip Safari/iOS IndexedDB disconnects — browser environment issue, unactionable (BUG-ERR-003)
      if (isIndexedDBError(event.error || event)) {
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

    // GUID: COMPONENT_GLOBAL_ERROR_LOGGER-005-v03
    // [Intent] Handle unhandled promise rejections (async errors, failed fetches, etc.).
    // [Inbound Trigger] Fires when a Promise is rejected without a .catch() handler.
    // [Downstream Impact] Sends rejection to server unless it's a chunk load error, Firebase
    //                     Performance attribute noise (PERF-001, v1.58.68), or a bot crawler.
    const handleRejection = (event: PromiseRejectionEvent) => {
      // Skip bot crawlers — they execute JS without auth sessions, all their errors are noise
      if (isBotCrawler()) return;
      // Skip chunk errors (handled by ChunkErrorHandler)
      if (isChunkLoadError(event.reason)) {
        return;
      }
      // Skip Firebase Performance attribute errors (PERF-001: Tailwind class strings in putAttribute)
      if (isFirebasePerformanceError(event.reason)) {
        return;
      }
      // Skip Safari/iOS IndexedDB disconnects — browser environment issue, unactionable (BUG-ERR-003)
      if (isIndexedDBError(event.reason)) {
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

    // Suppress init message in production — no useful info for end users and reduces noise
    if (process.env.NODE_ENV !== 'production') {
      console.log('[GlobalErrorLogger] Initialized - all client errors will be logged to server');
    }

    // Cleanup on unmount (should never happen in root layout, but good practice)
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null; // This component doesn't render anything
}
