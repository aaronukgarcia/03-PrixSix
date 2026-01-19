
'use client';

import { collection, serverTimestamp } from 'firebase/firestore';
import { useAuth, useFirestore, addDocumentNonBlocking } from '@/firebase';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { FirestorePermissionError } from '@/firebase/errors';

// --- Correlation ID Management ---

let sessionCorrelationId: string | null = null;

function generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

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

let isAuditingEnabled: boolean | null = null;

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
  // TODO: Implement fetching the auditLoggingEnabled flag from a global config/context
  const isEnabled = true; // For now, assume it's enabled.
  
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

/**
 * Logs a Firestore permission error to the audit log.
 * Note: We don't log permission errors to Firestore to avoid circular errors.
 * Instead, we just log to console.
 * @param firestore - The Firestore instance.
 * @param userId - The ID of the user who encountered the error.
 * @param error - The FirestorePermissionError object.
 */
export function logPermissionError(firestore: any, userId: string | undefined, error: FirestorePermissionError) {
    // Only log to console to avoid circular permission errors
    console.error('Permission error:', {
        userId,
        message: error.message,
        path: error.request?.path,
        method: error.request?.method,
    });
}
