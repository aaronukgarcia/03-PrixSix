'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { initializePerformance } from 'firebase/performance';

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (!getApps().length) {
    // Important! initializeApp() is called without any arguments because Firebase App Hosting
    // integrates with the initializeApp() function to provide the environment variables needed to
    // populate the FirebaseOptions in production. It is critical that we attempt to call initializeApp()
    // without arguments.
    let firebaseApp;
    try {
      // Attempt to initialize via Firebase App Hosting environment variables
      firebaseApp = initializeApp();
    } catch (e) {
      // Only warn in production because it's normal to use the firebaseConfig to initialize
      // during development
      if (process.env.NODE_ENV === "production") {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      firebaseApp = initializeApp(firebaseConfig);
    }

    return getSdks(firebaseApp);
  }

  // If already initialized, return the SDKs with the already initialized App
  return getSdks(getApp());
}

// GUID: FIREBASE_INDEX-000-v04
// @PERF_FIX (PERF-001): initializePerformance is called here — synchronously during
//   SDK setup, before React renders any DOM elements. This is the only reliable point
//   to disable auto-instrumentation. A useEffect in layout.tsx fires too late: by then
//   Firebase has already observed layout metrics and attempted to call putAttribute()
//   with Tailwind CSS class strings (300+ chars containing [ ] & > : / .) causing
//   FirebaseError PX-9002 on every page load.
// [Intent] Initialise all client-side Firebase SDKs from a single FirebaseApp instance
//   and return them as a typed object for consumption by the Firebase provider context.
// [Inbound Trigger] Called by initializeFirebase() on first app boot and on every
//   subsequent getSdks(getApp()) call when the app is already initialised.
// [Downstream Impact] All client-side Firebase access (auth, firestore, storage,
//   functions) flows through this return value. Performance SDK is initialised here
//   with instrumentationEnabled:false — changing this re-enables PX-9002 errors.
export function getSdks(firebaseApp: FirebaseApp) {
  // PERF-001: Disable Firebase Performance auto-instrumentation at SDK init time.
  // Must be called here, not in a useEffect — by the time useEffect runs, the SDK
  // has already captured LCP element classNames and called putAttribute(), throwing
  // FirebaseError: Performance: Attribute value ... is invalid (PX-9002).
  if (typeof window !== 'undefined') {
    try {
      initializePerformance(firebaseApp, {
        dataCollectionEnabled: true,    // retain manual trace capability
        instrumentationEnabled: false,  // disable auto Web Vitals element tracking
      });
    } catch {
      // Ignore — already initialized (HMR double-call or provider re-render)
    }
  }

  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: getFirestore(firebaseApp),
    storage: getStorage(firebaseApp),
    functions: getFunctions(firebaseApp, 'europe-west2'),
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
