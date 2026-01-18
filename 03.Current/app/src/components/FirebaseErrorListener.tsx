
'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useAuth, useFirestore } from '@/firebase';
import { logPermissionError } from '@/lib/audit';

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
