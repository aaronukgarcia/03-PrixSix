
'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useAuth, useFirestore } from '@/firebase';
import { logPermissionError } from '@/lib/audit';

// GUID: COMPONENT_FIREBASE_ERROR_LISTENER-000-v01
// [Intent] Invisible component that subscribes to errorEmitter's 'permission-error' event; logs the error to the audit trail and then throws it into React's error boundary so Next.js global-error.tsx handles display.
// [Inbound Trigger] Mounted near the root of the authenticated layout so it is active for the full session lifetime.
// [Downstream Impact] Permission errors from useCollection/useDoc/non-blocking-writes surface as audited, user-visible error boundaries rather than silent failures.
/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It logs the error to the audit log and then throws it to be caught by Next.js's global-error.tsx.
 */
export function FirebaseErrorListener() {
  const [error, setError] = useState<FirestorePermissionError | null>(null);
  const { firebaseUser } = useAuth();
  const firestore = useFirestore();

  useEffect(() => {
    const handleError = (error: FirestorePermissionError) => {
      // Log the error to the audit log before throwing it.
      if (firestore && firebaseUser) {
        logPermissionError(firestore, firebaseUser.uid, error);
      }
      // Set error in state to trigger a re-render.
      setError(error);
    };

    errorEmitter.on('permission-error', handleError);

    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, [firestore, firebaseUser]);

  // On re-render, if an error exists in state, throw it.
  if (error) {
    throw error;
  }

  // This component renders nothing.
  return null;
}
