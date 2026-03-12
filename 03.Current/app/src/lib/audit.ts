// GUID: LIB_AUDIT-000-v08
// @SECURITY_FIX: Permission errors now use TracedError and correlation IDs (LIB-003).
// @SECURITY_FIX: Replaced Math.random() with crypto.randomUUID() in generateGuid() (LIB-002).
// @SECURITY_FIX: logPermissionError console.error now redacts userId/path in production (GEMINI-AUDIT-047).
// @SECURITY_FIX: Removed isAuditingEnabled toggle and the admin-configurable disable mechanism (GEMINI-AUDIT-002).
//               Audit logging is now always-on and cannot be disabled at runtime. Disabling requires a code change + deploy.
// @SECURITY_FIX (LIB-003): logAuditEvent now uses ERRORS.AUDIT_LOG_FAILED (Golden Rule #7) for write failures,
//               with 4-pillar error handling (log, type/code, correlationId, selectable display).
//               addDocumentNonBlocking called with skipErrorEmit=true on audit_logs to prevent permission-error cascade.
// [Intent] Client-side audit logging module providing session correlation IDs, Firestore audit event logging, automatic navigation tracking, and permission error reporting.
// [Inbound Trigger] Imported by React components and pages that need audit trail functionality.
// [Downstream Impact] Writes to audit_logs Firestore collection. Navigation tracking depends on Next.js routing. Changes affect audit trail completeness and compliance reporting.

'use client';

import { collection, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth, useFirestore, addDocumentNonBlocking } from '@/firebase';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { FirestorePermissionError } from '@/firebase/errors';
import { createTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';

// --- Correlation ID Management ---

// GUID: LIB_AUDIT-001-v03
// [Intent] Module-level singleton storing the session correlation ID, ensuring all audit events within a single browser session share the same traceable identifier.
// [Inbound Trigger] Initialised on first call to getCorrelationId; persists for the lifetime of the browser tab/session.
// [Downstream Impact] All audit_logs entries reference this ID. If reset unexpectedly, audit trail continuity for the session is broken.
let sessionCorrelationId: string | null = null;

// GUID: LIB_AUDIT-002-v05
// @SECURITY_FIX: Replaced Math.random() with crypto.randomUUID() to prevent predictable token generation (LIB-002).
// @BUG_FIX: Added browser compatibility check for crypto.randomUUID() with fallback (v1.58.25).
// [Intent] Generates a cryptographically secure RFC 4122 v4 UUID for use as session correlation IDs.
//          Uses Web Crypto API which is available in all modern browsers, with polyfill fallback.
// [Inbound Trigger] Called by getCorrelationId when no session correlation ID exists yet.
// [Downstream Impact] Provides the unique identifier used across all audit events in a session. Now cryptographically secure, preventing token prediction attacks.
function generateGuid() {
  // Use native crypto.randomUUID() if available (modern browsers)
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: Manual UUID v4 generation using crypto.getRandomValues()
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (globalThis.crypto.getRandomValues(new Uint8Array(1))[0] % 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Last resort fallback (should never happen in any supported browser or Node.js environment)
  // SECURITY: Math.random() intentionally not used here — it is not cryptographically secure (LIB-002)
  console.warn('[Audit] crypto API not available, returning timestamp-based ID');
  return `ts-${Date.now()}-${Date.now().toString(36)}`;
}

// GUID: LIB_AUDIT-003-v03
// [Intent] Returns the current session's correlation ID, lazily generating one on first access to ensure all audit events in a session are linkable.
// [Inbound Trigger] Called by logAuditEvent before writing each audit log entry.
// [Downstream Impact] Every audit_logs document includes the returned correlationId. If this function's format changes, existing audit log queries may need updating.
/**
 * Gets the current session's correlation ID, generating one if it doesn't exist.
 * @returns The session's correlation ID.
 */
export function getCorrelationId(): string {
  if (!sessionCorrelationId) {
    sessionCorrelationId = generateGuid();
  }
  return sessionCorrelationId;
}

// --- Auditing Logic ---

// GUID: LIB_AUDIT-004-v03
// [Note] isAuditingEnabled flag removed (GEMINI-AUDIT-002). Audit logging is now unconditionally enabled.
// GUID: LIB_AUDIT-005-v06
// @SECURITY_FIX: Removed admin-configurable isAuditingEnabled toggle (GEMINI-AUDIT-002).
//               Audit logging is unconditionally enabled. No runtime toggle exists.
// @SECURITY_FIX (LIB-003): Write failures now use ERRORS.AUDIT_LOG_FAILED (Golden Rule #7) with 4-pillar
//               error handling (log, type/code, correlationId, selectable display). skipErrorEmit=true
//               prevents permission-error cascade loop on the audit_logs collection.
// @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV in logAuditEvent write-failure catch.
// [Intent] Writes an audit event to the audit_logs Firestore collection as a fire-and-forget operation, attaching user ID, action description, details, correlation ID, and server timestamp.
// [Inbound Trigger] Called by useAuditNavigation on page navigations, and available for manual calls from any client-side component needing audit logging.
// [Downstream Impact] Creates documents in audit_logs collection used for compliance and user activity tracking. Uses addDocumentNonBlocking so failures do not block the UI. Skips logging if no userId is provided.
/**
 * Logs an audit event to Firestore. Always-on — audit logging cannot be disabled at runtime.
 * This is a fire-and-forget operation.
 * @param firestore - The Firestore instance.
 * @param userId - The ID of the user performing the action.
 * @param action - A string describing the action (e.g., 'navigate', 'permission_error').
 * @param details - An object containing additional context about the event.
 */
export async function logAuditEvent(
    firestore: any,
    userId: string | undefined,
    action: string,
    details: object
) {
  if (!userId) {
    return;
  }

  const correlationId = getCorrelationId();
  const auditLogRef = collection(firestore, 'audit_logs');
  const logData = {
    userId,
    action,
    details,
    correlationId,
    timestamp: serverTimestamp(),
  };

  // skipErrorEmit=true: prevents permission-error cascade loop on audit_logs collection
  // (an audit write failure must not itself trigger another audit write via errorEmitter)
  const writePromise = addDocumentNonBlocking(auditLogRef, logData, true);

  // Fire-and-forget: stamp lastSeen on the user doc so admin can see when users were last active.
  // Non-blocking — never throws, never delays the caller.
  try {
    updateDoc(doc(firestore, 'users', userId), { lastSeen: serverTimestamp() }).catch(() => {/* non-fatal */});
  } catch {/* non-fatal */}

  // Golden Rule #7: Use ERRORS.AUDIT_LOG_FAILED (not inline strings) for write failure logging.
  // Golden Rule #1: 4-pillar error handling — log, type/code (ERRORS.AUDIT_LOG_FAILED),
  //   correlationId (from session), selectable display (structured console.error object).
  // This is non-blocking: we attach a .catch but do NOT await, so the caller is never delayed.
  if (writePromise) {
    writePromise.catch((error: unknown) => {
      const traced = createTracedError(ERRORS.AUDIT_LOG_FAILED, {
        correlationId,
        context: { userId, action },
        cause: error instanceof Error ? error : undefined,
      });
      // Console-only: do not write to Firestore (prevents cascade on audit_logs permission failure)
      // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Audit] logAuditEvent write failed:', {
          correlationId: traced.correlationId,
          errorCode: traced.definition.code,
          message: traced.message,
          action,
        });
      }
    });
  }
}

// GUID: LIB_AUDIT-006-v03
// [Intent] React hook that automatically logs page navigation events to the audit trail, distinguishing between initial page load and subsequent route changes.
// [Inbound Trigger] Mounted by layout or page components that need automatic navigation auditing. Reacts to pathname changes from Next.js router.
// [Downstream Impact] Generates 'navigate' audit events with path details. The initial_load flag on first navigation helps distinguish direct visits from in-app navigation. Depends on useAuth, useFirestore, and usePathname hooks.
/**
 * A client-side hook to automatically log page navigation events.
 */
export function useAuditNavigation() {
  const pathname = usePathname();
  const { firebaseUser } = useAuth();
  const firestore = useFirestore();
  const initialLogDone = useRef(false);

  useEffect(() => {
    // Only log if we have a user and a firestore instance.
    // The ref ensures we only log the initial page load once.
    if (firebaseUser && firestore && !initialLogDone.current) {
      logAuditEvent(firestore, firebaseUser.uid, 'navigate', { path: pathname, initial_load: true });
      initialLogDone.current = true; // Mark initial log as done
    }
  }, [firebaseUser, firestore, pathname]);

  useEffect(() => {
    // This effect logs subsequent page changes, ignoring the initial load.
    if (firebaseUser && firestore && initialLogDone.current) {
        logAuditEvent(firestore, firebaseUser.uid, 'navigate', { path: pathname });
    }
  }, [pathname, firebaseUser, firestore]);
}

// GUID: LIB_AUDIT-007-v05
// @SECURITY_FIX: Now uses TracedError and correlation IDs for consistency (LIB-003).
// @SECURITY_FIX: Production console.error redacts sensitive fields (userId, path, method) to prevent information disclosure (GEMINI-AUDIT-047).
//   Permission errors now follow Golden Rule #7 (centralized error definitions).
// [Intent] Logs Firestore permission errors to console only (not to Firestore) to avoid circular permission failures when the user lacks write access to audit_logs.
// [Inbound Trigger] Called by components that catch FirestorePermissionError exceptions during Firestore operations.
// [Downstream Impact] Console-only logging means these errors are not persisted in Firestore. In production, only correlationId and errorCode are logged to prevent Firestore path/userId disclosure. In development, full details are available for debugging.
/**
 * Logs a Firestore permission error to the audit log.
 * Note: We don't log permission errors to Firestore to avoid circular errors.
 * Instead, we use TracedError for consistency (Golden Rule #7) but only log to console.
 * @param firestore - The Firestore instance.
 * @param userId - The ID of the user who encountered the error.
 * @param error - The FirestorePermissionError object.
 */
export function logPermissionError(firestore: any, userId: string | undefined, error: FirestorePermissionError) {
    // SECURITY: Generate correlation ID and use TracedError for consistency (LIB-003 fix)
    // We use ERRORS.AUTH_PERMISSION_DENIED from the error registry rather than a plain console.error
    // This ensures permission errors follow Golden Rule #7 (centralized error definitions)
    // We only log to console to avoid circular permission errors (don't write to Firestore)
    const correlationId = generateGuid();
    const traced = createTracedError(ERRORS.AUTH_PERMISSION_DENIED, {
        correlationId,
        context: {
            module: 'audit',
            userId,
            path: error.request?.path,
            method: error.request?.method,
        },
        cause: error,
    });

    // Log the structured error to console (DO NOT write to Firestore to avoid recursion)
    // SECURITY: In production, redact sensitive fields to prevent information disclosure via DevTools
    if (process.env.NODE_ENV !== 'production') {
        console.error('Permission error:', {
            correlationId: traced.correlationId,
            errorCode: traced.definition.code,
            message: traced.message,
            userId,
            path: error.request?.path,
            method: error.request?.method,
        });
    } else {
        console.error('Permission error:', {
            correlationId: traced.correlationId,
            errorCode: traced.definition.code,
        });
    }
}
