// GUID: LIB_AUDIT-000-v05
// @SECURITY_FIX: Permission errors now use TracedError and correlation IDs (LIB-003).
// @SECURITY_FIX: Replaced Math.random() with crypto.randomUUID() in generateGuid() (LIB-002).
// [Intent] Client-side audit logging module providing session correlation IDs, Firestore audit event logging, automatic navigation tracking, and permission error reporting.
// [Inbound Trigger] Imported by React components and pages that need audit trail functionality.
// [Downstream Impact] Writes to audit_logs Firestore collection. Navigation tracking depends on Next.js routing. Changes affect audit trail completeness and compliance reporting.

'use client';

import { collection, serverTimestamp } from 'firebase/firestore';
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

// GUID: LIB_AUDIT-002-v04
// @SECURITY_FIX: Replaced Math.random() with crypto.randomUUID() to prevent predictable token generation (LIB-002).
// [Intent] Generates a cryptographically secure RFC 4122 v4 UUID for use as session correlation IDs.
//          Uses Web Crypto API which is available in all modern browsers.
// [Inbound Trigger] Called by getCorrelationId when no session correlation ID exists yet.
// [Downstream Impact] Provides the unique identifier used across all audit events in a session. Now cryptographically secure, preventing token prediction attacks.
function generateGuid() {
  return crypto.randomUUID();
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
// [Intent] Module-level flag intended to control whether audit logging is enabled, allowing future integration with a global configuration system.
// [Inbound Trigger] Currently unused (hardcoded to true in logAuditEvent); reserved for future config-driven audit toggle.
// [Downstream Impact] When implemented, toggling this flag will enable or disable all audit logging application-wide.
let isAuditingEnabled: boolean | null = null;

// GUID: LIB_AUDIT-005-v03
// [Intent] Writes an audit event to the audit_logs Firestore collection as a fire-and-forget operation, attaching user ID, action description, details, correlation ID, and server timestamp.
// [Inbound Trigger] Called by useAuditNavigation on page navigations, and available for manual calls from any client-side component needing audit logging.
// [Downstream Impact] Creates documents in audit_logs collection used for compliance and user activity tracking. Uses addDocumentNonBlocking so failures do not block the UI. Skips logging if no userId is provided.
/**
 * Logs an audit event to Firestore if auditing is enabled.
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
  // TODO (GEMINI-AUDIT-002 / Phase 4): Implement React Context to fetch auditLoggingEnabled
  //       from admin_configuration/audit_settings (see firebase/firestore/settings.ts).
  //       Admins can update via /api/admin/update-audit-settings endpoint.
  //       Current: Hardcoded to true (safe default - logging always enabled).
  const isEnabled = true;

  if (!isEnabled || !userId) {
    return;
  }

  const auditLogRef = collection(firestore, 'audit_logs');
  const logData = {
    userId,
    action,
    details,
    correlationId: getCorrelationId(),
    timestamp: serverTimestamp(),
  };

  addDocumentNonBlocking(auditLogRef, logData);
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

// GUID: LIB_AUDIT-007-v04
// @SECURITY_FIX: Now uses TracedError and correlation IDs for consistency (LIB-003).
//   Permission errors now follow Golden Rule #7 (centralized error definitions).
// [Intent] Logs Firestore permission errors to console only (not to Firestore) to avoid circular permission failures when the user lacks write access to audit_logs.
// [Inbound Trigger] Called by components that catch FirestorePermissionError exceptions during Firestore operations.
// [Downstream Impact] Console-only logging means these errors are not persisted in Firestore. Server-side log aggregation must capture console.error output to track permission issues. Now includes correlation IDs for traceability.
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
    const correlationId = crypto.randomUUID();
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
    console.error('Permission error:', {
        correlationId: traced.correlationId,
        errorCode: traced.definition.code,
        message: traced.message,
        userId,
        path: error.request?.path,
        method: error.request?.method,
    });
}
