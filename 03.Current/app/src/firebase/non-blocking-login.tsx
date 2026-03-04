'use client';
import {
  Auth, // Import Auth type for type hinting
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  // Assume getAuth and app are initialized elsewhere
} from 'firebase/auth';

// GUID: FIREBASE_NON_BLOCKING_LOGIN-000-v01
// [Intent] Fire-and-forget anonymous sign-in — deliberately not awaited so the UI does not freeze waiting for the auth round-trip.
// [Inbound Trigger] Called in Firebase provider on mount when no session exists and anonymous access is needed.
// [Downstream Impact] Auth state change propagates via onAuthStateChanged listener rather than promise resolution.
/** Initiate anonymous sign-in (non-blocking). */
export function initiateAnonymousSignIn(authInstance: Auth): void {
  // CRITICAL: Call signInAnonymously directly. Do NOT use 'await signInAnonymously(...)'.
  signInAnonymously(authInstance);
  // Code continues immediately. Auth state change is handled by onAuthStateChanged listener.
}

// GUID: FIREBASE_NON_BLOCKING_LOGIN-001-v01
// [Intent] Fire-and-forget email/password account creation — not awaited; result arrives via onAuthStateChanged.
// [Inbound Trigger] Called from sign-up form submission handler in the login flow.
// [Downstream Impact] On success, Firebase emits an auth state change; on failure, the silent drop relies on the auth listener for feedback.
/** Initiate email/password sign-up (non-blocking). */
export function initiateEmailSignUp(authInstance: Auth, email: string, password: string): void {
  // CRITICAL: Call createUserWithEmailAndPassword directly. Do NOT use 'await createUserWithEmailAndPassword(...)'.
  createUserWithEmailAndPassword(authInstance, email, password);
  // Code continues immediately. Auth state change is handled by onAuthStateChanged listener.
}

// GUID: FIREBASE_NON_BLOCKING_LOGIN-002-v01
// [Intent] Fire-and-forget email/password sign-in — not awaited; auth state change propagates via onAuthStateChanged listener.
// [Inbound Trigger] Called from login form submission handler.
// [Downstream Impact] On success, user session is established via auth listener; on failure, the error is silent at this layer — relies on provider-level error handling.
/** Initiate email/password sign-in (non-blocking). */
export function initiateEmailSignIn(authInstance: Auth, email: string, password: string): void {
  // CRITICAL: Call signInWithEmailAndPassword directly. Do NOT use 'await signInWithEmailAndPassword(...)'.
  signInWithEmailAndPassword(authInstance, email, password);
  // Code continues immediately. Auth state change is handled by onAuthStateChanged listener.
}
