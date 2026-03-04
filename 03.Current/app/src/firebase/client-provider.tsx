'use client';

import React, { useMemo, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';

// GUID: FIREBASE_CLIENT_PROVIDER-000-v01
// [Intent] Props interface and client-only wrapper that calls initializeFirebase() once via useMemo, then hands all SDK instances to FirebaseProvider.
// [Inbound Trigger] Mounted at app root in layout.tsx to establish the Firebase client context tree.
// [Downstream Impact] All client-side Firebase operations (auth, Firestore, storage, functions) depend on this provider being mounted.
interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const firebaseServices = useMemo(() => {
    // Initialize Firebase on the client side, once per component mount.
    return initializeFirebase();
  }, []); // Empty dependency array ensures this runs only once on mount

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
      storage={firebaseServices.storage}
      functions={firebaseServices.functions}
    >
      {children}
    </FirebaseProvider>
  );
}
