// GUID: FIREBASE_PROVIDER-000-v04
// [Intent] Central Firebase context provider that manages authentication state, user profile data,
// and all auth-related operations (login, signup, logout, PIN management, email verification).
// This is the single source of truth for the current user's session and profile across the entire app.
// [Inbound Trigger] Mounted once at the app root by the layout; wraps all authenticated pages.
// [Downstream Impact] Every component that calls useFirebase(), useAuth(), useFirestore(), useStorage(),
// or useFunctions() depends on this provider. Removing or breaking it will break the entire application.

'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore, collection, serverTimestamp, doc, setDoc, onSnapshot as onDocSnapshot, updateDoc, deleteDoc, writeBatch, query, where, getDocs, limit, arrayUnion } from 'firebase/firestore';
import { GLOBAL_LEAGUE_ID } from '@/lib/types/league';
import { Auth, User as FirebaseAuthUser, onAuthStateChanged, createUserWithEmailAndPassword, signInWithCustomToken, signOut, updatePassword, getRedirectResult, OAuthCredential, OAuthProvider } from 'firebase/auth';
import {
  signInWithGoogle as authSignInWithGoogle,
  signInWithApple as authSignInWithApple,
  linkGoogleToAccount,
  linkAppleToAccount,
  unlinkProvider as authUnlinkProvider,
  getProviderIds,
  type OAuthSignInResult,
  type OAuthLinkResult,
} from '@/services/authService';
import { FirebaseStorage } from 'firebase/storage';
import { Functions } from 'firebase/functions';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { useRouter } from 'next/navigation';
import { addDocumentNonBlocking } from './non-blocking-updates';
import { logAuditEvent } from '@/lib/audit';
import { generateClientCorrelationId } from '@/lib/error-codes';

// GUID: FIREBASE_PROVIDER-001-v03
// [Intent] Defines the shape of user email notification preferences stored in Firestore.
// [Inbound Trigger] Referenced when reading/writing user profile email settings.
// [Downstream Impact] Used by email preference UI components and notification dispatch logic.
export interface EmailPreferences {
  rankingChanges?: boolean;
  raceReminders?: boolean;
  newsFeed?: boolean;
  resultsNotifications?: boolean;
}

// GUID: FIREBASE_PROVIDER-002-v03
// [Intent] Defines AI analysis weight sliders for race prediction assistance.
// Each field represents a factor weight (0-100) that influences AI-generated predictions.
// [Inbound Trigger] Referenced when users adjust AI analysis settings on the predictions page.
// [Downstream Impact] Stored in user profile; consumed by prediction analysis logic.
export interface AnalysisWeights {
  driverForm: number;
  trackHistory: number;
  overtakingCrashes: number;
  circuitCharacteristics: number;
  trackSurface: number;
  layoutChanges: number;
  weather: number;
  tyreStrategy: number;
  bettingOdds: number;
  jackSparrow: number; // Jack Whitehall style pundit
  rowanHornblower: number; // Bernie Collins style pundit
}

// GUID: FIREBASE_PROVIDER-003-v03
// [Intent] Extended user profile interface combining Firebase Auth identity with Firestore profile data.
// The `id` field is the Firebase Auth UID, which is also the Firestore document key in the `users` collection.
// [Inbound Trigger] Populated on auth state change from the Firestore `users/{uid}` document.
// [Downstream Impact] Consumed by every component that reads user state via useAuth() or useFirebase().
// Changes to this interface require updates across all components that destructure User properties.
export interface User {
  id: string; // This is the Firebase Auth UID
  email: string;
  teamName: string;
  isAdmin: boolean;
  secondaryTeamName?: string;
  mustChangePin?: boolean;
  badLoginAttempts?: number;
  emailPreferences?: EmailPreferences;
  emailVerified?: boolean; // Synced from Firebase Auth
  aiAnalysisWeights?: AnalysisWeights; // Persisted AI analysis slider settings
  photoUrl?: string; // User profile photo URL
  secondaryEmail?: string; // Secondary email for communications only
  secondaryEmailVerified?: boolean; // Whether secondary email is verified
  providers?: string[]; // ['password', 'google.com', 'apple.com']
  lastLogin?: any; // Timestamp of last login
}

// GUID: FIREBASE_PROVIDER-004-v03
// [Intent] Standard return type for all authentication operations (login, signup, PIN changes, etc.).
// [Inbound Trigger] Returned by every auth method in the provider.
// [Downstream Impact] UI components use success/message to display feedback; pin is optionally returned on signup.
export interface AuthResult {
  success: boolean;
  message: string;
  pin?: string;
}

// GUID: FIREBASE_PROVIDER-005-v03
// [Intent] Full type definition for the Firebase context, exposing all Firebase services, user state,
// and auth operations to consumers. This is the contract between the provider and every downstream hook.
// [Inbound Trigger] Defined at module level; used as the generic type for FirebaseContext.
// [Downstream Impact] Any addition or removal of fields here affects useFirebase(), useAuth(), and all consumers.
export interface FirebaseContextState {
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  storage: FirebaseStorage | null;
  functions: Functions | null;
  authService: Auth | null;
  user: User | null;
  firebaseUser: FirebaseAuthUser | null;
  isUserLoading: boolean;
  userError: Error | null;
  isEmailVerified: boolean;
  updateUser: (userId: string, data: Partial<User>) => Promise<AuthResult>;
  deleteUser: (userId: string) => Promise<AuthResult>;
  login: (email: string, pin: string) => Promise<AuthResult>;
  signup: (email: string, teamName: string, pin?: string) => Promise<AuthResult>;
  logout: () => void;
  addSecondaryTeam: (teamName: string) => Promise<AuthResult>;
  resetPin: (email: string) => Promise<AuthResult>;
  changePin: (email: string, newPin: string) => Promise<AuthResult>;
  sendVerificationEmail: () => Promise<AuthResult>;
  refreshEmailVerificationStatus: () => Promise<void>;
  updateSecondaryEmail: (email: string | null) => Promise<AuthResult>;
  sendSecondaryVerificationEmail: () => Promise<AuthResult>;
  signInWithGoogle: () => Promise<OAuthSignInResult>;
  signInWithApple: () => Promise<OAuthSignInResult>;
  linkGoogle: () => Promise<OAuthLinkResult>;
  linkApple: () => Promise<OAuthLinkResult>;
  unlinkProvider: (providerId: string) => Promise<AuthResult>;
  pendingOAuthCredential: OAuthCredential | null;
  clearPendingCredential: () => void;
  isNewOAuthUser: boolean;
}

// GUID: FIREBASE_PROVIDER-006-v03
// [Intent] React context instance that holds the full Firebase state and auth operations.
// [Inbound Trigger] Created once at module load; provided by FirebaseProvider, consumed by useFirebase().
// [Downstream Impact] If this context is undefined at consumption time, useFirebase() throws.
export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
  auth: Auth;
}

// GUID: FIREBASE_PROVIDER-007-v03
// [Intent] Root provider component that initialises Firebase auth listener, manages user profile
// state via real-time Firestore subscription, and exposes all auth operations to the component tree.
// [Inbound Trigger] Rendered once at the app layout level with pre-initialised Firebase service instances.
// [Downstream Impact] All authenticated UI depends on this component. Removing it breaks the entire app.
export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  storage,
  functions,
  auth,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [userError, setUserError] = useState<Error | null>(null);
  const [pendingOAuthCredential, setPendingOAuthCredential] = useState<OAuthCredential | null>(null);
  const [isNewOAuthUser, setIsNewOAuthUser] = useState(false);

  const router = useRouter();

  // GUID: FIREBASE_PROVIDER-008-v04
  // @SECURITY_RISK @AUDIT_NOTE: Auth state race condition -- between onAuthStateChanged firing and
  //   the Firestore snapshot resolving, there is a window where `firebaseUser` is set but `user` is null.
  //   Components must check `isUserLoading` before relying on `user` state. The 10s timeout mitigates
  //   indefinite loading but does not eliminate the race. A proper fix requires server-side session tokens.
  // [Intent] Sets up a two-layer real-time listener: (1) Firebase Auth state changes trigger
  // (2) a Firestore onSnapshot listener on the user's profile document. On first snapshot,
  // syncs emailVerified from Auth to Firestore if needed and redirects users who must change PIN.
  // Includes a 10-second safety timeout to prevent indefinite loading states.
  // [Inbound Trigger] Runs once on mount and whenever auth/firestore/router references change.
  // [Downstream Impact] Populates `user`, `firebaseUser`, `isUserLoading`, and `userError` state.
  // Every component reading auth state depends on this effect completing successfully.
  useEffect(() => {
    setIsUserLoading(true);
    let unsubscribeUserDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (fbUser) => {
        setFirebaseUser(fbUser);

        // Tear down any previous user-doc listener
        if (unsubscribeUserDoc) {
          unsubscribeUserDoc();
          unsubscribeUserDoc = null;
        }

        if (fbUser) {
          const userDocRef = doc(firestore, 'users', fbUser.uid);

          // Safety net: guarantee isUserLoading clears even if Firestore hangs
          const loadingTimeout = setTimeout(() => {
            console.warn("FirebaseProvider: user document fetch timed out (10 s)");
            setIsUserLoading(false);
          }, 10_000);

          let isFirstSnapshot = true;

          unsubscribeUserDoc = onDocSnapshot(
            userDocRef,
            async (snapshot) => {
              try {
                if (snapshot.exists()) {
                  const userData = snapshot.data() as User;

                  // Sync emailVerified only on initial load
                  if (isFirstSnapshot && fbUser.emailVerified && !userData.emailVerified) {
                    try {
                      await updateDoc(userDocRef, { emailVerified: true });
                      userData.emailVerified = true;
                      logAuditEvent(firestore, fbUser.uid, 'email_verified_synced', { email: fbUser.email });
                    } catch (syncError) {
                      console.warn("Failed to sync email verification status:", syncError);
                    }
                  }

                  // GUID: FIREBASE_PROVIDER-029-v04
                  // [Intent] Sync provider list from Firebase Auth to Firestore on initial load.
                  //          Also syncs photoUrl from Google/Apple if user has none set.
                  // [Inbound Trigger] First snapshot after auth state change.
                  // [Downstream Impact] Keeps Firestore providers[] in sync with Firebase Auth providerData.
                  if (isFirstSnapshot) {
                    const currentProviders = getProviderIds(fbUser);
                    const storedProviders = userData.providers || [];
                    const providersChanged = currentProviders.length !== storedProviders.length ||
                      currentProviders.some(p => !storedProviders.includes(p));

                    const updates: Record<string, any> = {};
                    if (providersChanged) {
                      updates.providers = currentProviders;
                    }
                    // Sync photoUrl from OAuth provider if user has none
                    if (!userData.photoUrl && fbUser.photoURL) {
                      updates.photoUrl = fbUser.photoURL;
                      userData.photoUrl = fbUser.photoURL;
                    }
                    if (Object.keys(updates).length > 0) {
                      try {
                        await updateDoc(userDocRef, updates);
                        if (updates.providers) {
                          userData.providers = currentProviders;
                        }
                      } catch (syncError) {
                        console.warn("Failed to sync provider/photo data:", syncError);
                      }
                    }
                  }

                  setIsNewOAuthUser(false);
                  setUser(userData);

                  if (isFirstSnapshot && userData.mustChangePin) {
                    router.push('/profile');
                  }
                } else {
                  // GUID: FIREBASE_PROVIDER-030-v04
                  // [Intent] When a Firebase Auth user exists but no Firestore doc is found,
                  //          check if this is an OAuth user (Google/Apple). If so, redirect
                  //          to /complete-profile for team name entry instead of showing an error.
                  // [Inbound Trigger] OAuth sign-in creates a Firebase Auth user but no Firestore doc.
                  // [Downstream Impact] Sets isNewOAuthUser=true, which gates access to /complete-profile.
                  const providerIds = getProviderIds(fbUser);
                  const hasOAuthProvider = providerIds.includes('google.com') || providerIds.includes('apple.com');

                  if (hasOAuthProvider) {
                    console.log("FirebaseProvider: New OAuth user detected, routing to complete-profile");
                    setIsNewOAuthUser(true);
                    setUser(null);
                    router.push('/complete-profile');
                  } else {
                    console.error("FirebaseProvider: User document not found for uid:", fbUser.uid);
                    setUser(null);
                    setUserError(new Error('User profile not found. Please contact support.'));
                  }
                }
              } catch (docError: any) {
                console.error("FirebaseProvider: Error processing user document:", docError);
                setUser(null);
                setUserError(docError);
              } finally {
                if (isFirstSnapshot) {
                  clearTimeout(loadingTimeout);
                  setIsUserLoading(false);
                  isFirstSnapshot = false;
                }
              }
            },
            (error) => {
              console.error("FirebaseProvider: user document listener error:", error);
              clearTimeout(loadingTimeout);
              setUser(null);
              setUserError(error);
              setIsUserLoading(false);
            },
          );
        } else {
          setUser(null);
          setIsUserLoading(false);
        }
      },
      (error) => {
        console.error("FirebaseProvider: onAuthStateChanged error:", error);
        setUserError(error);
        setIsUserLoading(false);
      }
    );

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, [auth, firestore, router]);

  // GUID: FIREBASE_PROVIDER-009-v04
  // @SECURITY_RISK @AUDIT_NOTE: No CSRF token is sent with the login POST. The /api/auth/login endpoint
  //   relies on SameSite cookies and CORS headers for cross-origin protection. A proper CSRF token
  //   would require server-side session infrastructure (not currently implemented).
  // @TECH_DEBT: Inline correlation ID generation replaced with generateClientCorrelationId() import.
  // [Intent] Authenticates a user via server-side PIN verification API, then signs in using the
  // returned custom token. Includes a 15-second timeout, brute-force protection (server-side),
  // and waits for onAuthStateChanged to settle before returning success.
  // [Inbound Trigger] Called from the login page when the user submits email + PIN.
  // [Downstream Impact] On success, triggers the auth state listener (FIREBASE_PROVIDER-008) which
  // loads the user profile. On failure, returns error with correlation ID for user to report.
  const login = async (email: string, pin: string): Promise<AuthResult> => {
    setIsUserLoading(true);
    setUserError(null);

    // Timeout for API call (15 seconds)
    const LOGIN_TIMEOUT = 15000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT);

    try {
        // SECURITY: Use server-side API for brute force protection
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, pin }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const result = await response.json();

        if (!result.success) {
            setIsUserLoading(false);
            // Build error message with available details
            let errorMessage = result.error || 'Login failed';
            if (result.errorType && result.errorMessage) {
                errorMessage = `${errorMessage} [${result.errorType}: ${result.errorMessage}]`;
            }
            if (result.correlationId) {
                errorMessage = `${errorMessage} (Ref: ${result.correlationId})`;
            }
            return {
                success: false,
                message: errorMessage,
            };
        }

        // Use custom token to sign in
        await signInWithCustomToken(auth, result.customToken);

        // Verify sign-in actually succeeded by checking currentUser
        if (!auth.currentUser) {
            setIsUserLoading(false);
            const clientCorrelationId = generateClientCorrelationId();
            return {
                success: false,
                message: `Sign-in verification failed. Please try again. [PX-1008] (Ref: ${clientCorrelationId})`,
            };
        }

        // Wait for onAuthStateChanged to process before returning success
        // This prevents the race condition where navigation happens before user state is set
        await new Promise<void>((resolve, reject) => {
            const maxWait = 5000; // 5 second max wait for auth state to settle
            const startTime = Date.now();

            const checkAuthState = () => {
                // Check if user state has been set (onAuthStateChanged has processed)
                if (auth.currentUser) {
                    resolve();
                } else if (Date.now() - startTime > maxWait) {
                    reject(new Error('Auth state timeout'));
                } else {
                    setTimeout(checkAuthState, 50);
                }
            };

            // Small delay to allow onAuthStateChanged to start processing
            setTimeout(checkAuthState, 100);
        });

        return { success: true, message: 'Login successful' };

    } catch (signInError: any) {
         clearTimeout(timeoutId);
         console.error("Error signing in:", signInError);
         setUserError(signInError);
         setIsUserLoading(false);

         // Generate client-side correlation ID for network/client errors
         const clientCorrelationId = generateClientCorrelationId();

         // Handle specific error cases
         if (signInError.name === 'AbortError') {
             return {
                 success: false,
                 message: `Login timed out. Please check your connection and try again. [PX-1007] (Ref: ${clientCorrelationId})`,
             };
         }

         if (signInError.message === 'Auth state timeout') {
             return {
                 success: false,
                 message: `Login verification timed out. Please refresh and try again. [PX-1009] (Ref: ${clientCorrelationId})`,
             };
         }

         return { success: false, message: `An error occurred during login. [PX-9001] (Ref: ${clientCorrelationId})` };
    }
  };

  // GUID: FIREBASE_PROVIDER-010-v04
  // [Intent] Registers a new user via server-side API (which uses Admin SDK for Firestore writes
  // and Firebase Auth user creation), then auto-signs in with the returned custom token.
  // [Inbound Trigger] Called from the signup/registration page when a new user submits their details.
  // [Downstream Impact] On success, creates a Firebase Auth user + Firestore user document, then
  // triggers auth state listener (FIREBASE_PROVIDER-008). Logs client errors with correlation IDs.
  const signup = async (email: string, teamName: string, pin?: string): Promise<AuthResult> => {
    // Use server-side API for signup (handles permission checks with Admin SDK)
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, teamName, pin }),
      });

      const result = await response.json();

      if (!result.success) {
        // Build error message with available details
        let errorMessage = result.error || 'Registration failed';
        if (result.errorCode) {
          errorMessage = `${errorMessage} [${result.errorCode}]`;
        }
        if (result.correlationId) {
          errorMessage = `${errorMessage} (Ref: ${result.correlationId})`;
        }
        return { success: false, message: errorMessage };
      }

      // Sign in with the custom token returned by the API
      if (result.customToken) {
        await signInWithCustomToken(auth, result.customToken);
      }

      return { success: true, message: result.message || 'Registration successful!' };

    } catch (error: any) {
      // Generate client-side correlation ID for network/client errors
      const correlationId = generateClientCorrelationId();
      console.error(`[Signup Error ${correlationId}]`, error);

      // Log via API
      fetch('/api/log-client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationId,
          errorCode: 'PX-9002',
          error: error?.message || 'Network error during signup',
          stack: error?.stack,
          context: {
            route: 'provider/signup',
            action: 'api_call',
            email: email?.toLowerCase(),
          },
        }),
      }).catch(() => {});

      return {
        success: false,
        message: `Registration failed - network error. Please check your connection and try again. [PX-9002] (Ref: ${correlationId})`,
      };
    }
  };

  // GUID: FIREBASE_PROVIDER-011-v04
  // [Intent] Admin-only operation to update a user's profile via server-side API. Handles both
  // Firestore document updates and Firebase Auth property changes (e.g., email, display name).
  // [Inbound Trigger] Called from the admin panel when an admin edits a user's details.
  // [Downstream Impact] Updates the target user's Firestore document and Auth record. If the
  // current admin is editing their own profile, also updates local React state.
  const updateUser = async (userId: string, data: Partial<User>): Promise<AuthResult> => {
    if (!user?.isAdmin) {
      return { success: false, message: "You do not have permission to perform this action." };
    }

    // Use server-side API to update user (handles both Firestore AND Firebase Auth)
    try {
      const response = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          adminUid: user.id,
          data,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        let errorMessage = result.error || 'Failed to update user';
        if (result.errorCode) {
          errorMessage = `${errorMessage} [${result.errorCode}]`;
        }
        if (result.correlationId) {
          errorMessage = `${errorMessage} (Ref: ${result.correlationId})`;
        }
        return { success: false, message: errorMessage };
      }

      // If updating the current user, sync the local state
      if (userId === user.id) {
        setUser(prev => prev ? { ...prev, ...data } : null);
      }

      return { success: true, message: result.message || "User updated successfully." };

    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      console.error(`[Update User Error ${correlationId}]`, e);
      return { success: false, message: `Failed to update user. [PX-9002] (Ref: ${correlationId})` };
    }
  }

  // GUID: FIREBASE_PROVIDER-012-v04
  // [Intent] Admin-only operation to delete a user via server-side API. Removes both the Firestore
  // user document and the Firebase Auth account.
  // [Inbound Trigger] Called from the admin panel when an admin deletes a user.
  // [Downstream Impact] Permanently removes user from both Auth and Firestore. The deleted user's
  // teams and predictions may become orphaned if not cleaned up by the API.
  const deleteUser = async (userId: string): Promise<AuthResult> => {
    if (!user?.isAdmin) {
      return { success: false, message: "You do not have permission to perform this action." };
    }

    // Use server-side API to delete user (handles both Firestore AND Firebase Auth)
    try {
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          adminUid: user.id,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        let errorMessage = result.error || 'Failed to delete user';
        if (result.errorCode) {
          errorMessage = `${errorMessage} [${result.errorCode}]`;
        }
        if (result.correlationId) {
          errorMessage = `${errorMessage} (Ref: ${result.correlationId})`;
        }
        return { success: false, message: errorMessage };
      }

      return { success: true, message: result.message || "User deleted successfully." };

    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      console.error(`[Delete User Error ${correlationId}]`, e);
      return { success: false, message: `Failed to delete user. [PX-9002] (Ref: ${correlationId})` };
    }
  }


  // GUID: FIREBASE_PROVIDER-013-v03
  // [Intent] Allows the current authenticated user to create a secondary team via server-side API.
  // The API validates the team name and creates the necessary Firestore records.
  // [Inbound Trigger] Called from the team management UI when a user adds a second team.
  // [Downstream Impact] Updates the user's `secondaryTeamName` in local state and Firestore.
  // The secondary team participates in league scoring independently.
  const addSecondaryTeam = async (teamName: string): Promise<AuthResult> => {
    if (!user || !firebaseUser) {
      return { success: false, message: "You must be logged in to add a team." };
    }

    try {
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch('/api/add-secondary-team', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ teamName }),
      });

      const result = await response.json();

      if (result.success) {
        // Update local user state
        setUser(prev => prev ? { ...prev, secondaryTeamName: teamName } : null);
        return { success: true, message: result.message || "Team created successfully!" };
      } else {
        return { success: false, message: result.error || "Failed to create team." };
      }
    } catch (error: any) {
      console.error('Failed to add secondary team:', error);
      return { success: false, message: "An error occurred. Please try again." };
    }
  };

  // GUID: FIREBASE_PROVIDER-014-v03
  // [Intent] Signs out the current user, clears local state, and redirects to the login page.
  // Logs an audit event before signing out so the logout is recorded against the user's UID.
  // [Inbound Trigger] Called from sidebar logout button, PIN change flow, or session expiry.
  // [Downstream Impact] Clears user/firebaseUser state, triggers onAuthStateChanged with null,
  // and navigates to /login. Other components observing auth state will reset accordingly.
  const logout = async () => {
    if (firebaseUser) {
        logAuditEvent(firestore, firebaseUser.uid, 'logout', { source: 'explicit_call' });
    }
    setIsUserLoading(true);
    await signOut(auth);
    setUser(null);
    setFirebaseUser(null);
    router.push('/login');
    setIsUserLoading(false);
  };

  // GUID: FIREBASE_PROVIDER-015-v04
  // [Intent] Initiates a server-side PIN reset for the given email address. The API generates a
  // temporary PIN and sends it via email. Works for unauthenticated users (forgotten PIN flow).
  // [Inbound Trigger] Called from the login page "Forgot PIN" flow.
  // [Downstream Impact] Server sets mustChangePin=true on the user document, so next login
  // triggers forced redirect to /profile for PIN change (FIREBASE_PROVIDER-008).
  const resetPin = async (email: string): Promise<AuthResult> => {
    // Generate correlation ID upfront for error tracking
    const correlationId = generateClientCorrelationId();

    try {
      // Use server-side API for PIN reset (Admin SDK bypasses Firestore rules)
      const response = await fetch('/api/auth/reset-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase() }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMessage = result.error || 'PIN reset failed';
        return {
          success: false,
          message: `${errorMessage} [PX-1006] (Ref: ${result.correlationId || correlationId})`,
        };
      }

      return { success: true, message: result.message || "A temporary PIN has been sent." };

    } catch (error: any) {
      console.error(`[PIN Reset Error ${correlationId}]`, error);

      // Log via API (unauthenticated users can't write to Firestore)
      fetch('/api/log-client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationId,
          errorCode: 'PX-1006',
          error: error?.message || 'Unknown error during PIN reset',
          stack: error?.stack,
          context: {
            route: 'provider/resetPin',
            action: 'api_call',
            email: email.toLowerCase(),
            errorType: error?.code || error?.name || 'Unknown',
          },
        }),
      }).catch(() => {});

      return {
        success: false,
        message: `PIN reset failed. Please try again later. [PX-1006] (Ref: ${correlationId})`,
      };
    }
  };

  // GUID: FIREBASE_PROVIDER-016-v04
  // @SECURITY_RISK: Previously returned raw e.message to UI, potentially leaking Firebase internals.
  //   Now returns generic error message with PX error code for all non-specific errors.
  // [Intent] Changes the current user's PIN (password) via Firebase Auth, clears the mustChangePin
  // flag, sends a confirmation email, logs audit events, and forces a logout so the user must
  // re-authenticate with the new PIN.
  // [Inbound Trigger] Called from the profile page PIN change form.
  // [Downstream Impact] Updates Firebase Auth password, clears mustChangePin in Firestore,
  // queues a notification email, and triggers logout (FIREBASE_PROVIDER-014).
  const changePin = async (email: string, newPin: string): Promise<AuthResult> => {
    if (!firebaseUser) return { success: false, message: "You are not logged in."};

    try {
        await updatePassword(firebaseUser, newPin);

        const userDocRef = doc(firestore, 'users', firebaseUser.uid);
        await updateDoc(userDocRef, { mustChangePin: false });

        const mailHtml = `Hello ${user?.teamName},<br><br>Your PIN for Prix Six was just changed. If you did not make this change, please contact support immediately.`;
        const mailSubject = "Your Prix Six PIN Has Changed";
        addDocumentNonBlocking(collection(firestore, 'mail'), {
            to: email, message: { subject: mailSubject, html: mailHtml }
        });
        addDocumentNonBlocking(collection(firestore, 'email_logs'), {
            to: email, subject: mailSubject, html: mailHtml, pin: "N/A", status: 'queued', timestamp: serverTimestamp()
        });

        logAuditEvent(firestore, firebaseUser.uid, 'pin_changed_email_queued', { email });
        logAuditEvent(firestore, firebaseUser.uid, 'pin_changed', {});

        await logout();

        return { success: true, message: "PIN updated successfully. You have been logged out." };

    } catch (e: any) {
        const correlationId = generateClientCorrelationId();
        console.error(`[PIN Change Error ${correlationId}]`, e);
        if (e.code === 'auth/requires-recent-login') {
            return { success: false, message: "This is a sensitive operation. Please log out and log back in before changing your PIN." };
        }
        // @SECURITY_RISK fix: return generic message instead of raw e.message which could leak Firebase internals
        return { success: false, message: `PIN change failed. Please try again. [PX-1006] (Ref: ${correlationId})` };
    }
  };

  // GUID: FIREBASE_PROVIDER-017-v04
  // @SECURITY_RISK: Sanitized error messages in catch block to prevent leaking internal details.
  // [Intent] Sends a primary email verification via the custom Graph API endpoint (not Firebase's
  // built-in email verification). Validates preconditions before sending.
  // [Inbound Trigger] Called from the EmailVerificationBanner or profile page.
  // [Downstream Impact] Queues an email via the /api/send-verification-email endpoint.
  // Logs an audit event on success. Does not change user state until verification is confirmed.
  const sendVerificationEmail = async (): Promise<AuthResult> => {
    if (!firebaseUser) {
      return { success: false, message: "You must be logged in to send a verification email." };
    }

    if (firebaseUser.emailVerified || user?.emailVerified) {
      return { success: false, message: "Your email is already verified." };
    }

    try {
      // Use our custom Graph API-based email verification
      const response = await fetch('/api/send-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          teamName: user?.teamName,
        }),
      });

      const result = await response.json();

      if (result.success) {
        logAuditEvent(firestore, firebaseUser.uid, 'verification_email_resent', { email: firebaseUser.email });
        return { success: true, message: "Verification email sent. Please check your inbox." };
      } else {
        // Check if Graph API is not configured
        if (response.status === 503) {
          return {
            success: false,
            message: "Email service not configured. Please contact an administrator. (Error PX-3001)"
          };
        }
        return { success: false, message: result.error || "Failed to send verification email." };
      }
    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      console.error(`[Verification Email Error ${correlationId}]`, e);
      return { success: false, message: `Failed to send verification email. [PX-3001] (Ref: ${correlationId})` };
    }
  };

  // GUID: FIREBASE_PROVIDER-018-v04
  // [Intent] Reloads the Firebase Auth user to check if email has been verified externally (e.g.,
  // user clicked the verification link in another tab). Syncs the verified status to Firestore.
  // [Inbound Trigger] Called when user clicks "I've verified" on the EmailVerificationBanner.
  // [Downstream Impact] Updates Firestore `emailVerified` field and local user state, which causes
  // the EmailVerificationBanner to hide itself.
  const refreshEmailVerificationStatus = async (): Promise<void> => {
    if (!firebaseUser) return;

    try {
      // Reload the Firebase user to get the latest emailVerified status
      await firebaseUser.reload();

      // Update Firestore if email is now verified
      if (firebaseUser.emailVerified && user && !user.emailVerified) {
        const userDocRef = doc(firestore, 'users', firebaseUser.uid);
        await updateDoc(userDocRef, { emailVerified: true });
        setUser(prev => prev ? { ...prev, emailVerified: true } : null);
        logAuditEvent(firestore, firebaseUser.uid, 'email_verified', { email: firebaseUser.email });
      }
    } catch (e: any) {
      console.error("Refresh email verification status error:", e);
    }
  };

  // GUID: FIREBASE_PROVIDER-019-v04
  // [Intent] Updates or removes the user's secondary email address via server-side API.
  // Passing null or empty string removes the secondary email; otherwise sets and marks unverified.
  // [Inbound Trigger] Called from the profile page secondary email form.
  // [Downstream Impact] Updates Firestore user document and local state. A new secondary email
  // starts as unverified and requires a separate verification flow.
  const updateSecondaryEmail = async (email: string | null): Promise<AuthResult> => {
    if (!firebaseUser) {
      return { success: false, message: "You must be logged in to update your secondary email." };
    }

    try {
      const response = await fetch('/api/update-secondary-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          secondaryEmail: email,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Update local state
        if (email === null || email === '') {
          setUser(prev => prev ? { ...prev, secondaryEmail: undefined, secondaryEmailVerified: undefined } : null);
        } else {
          setUser(prev => prev ? { ...prev, secondaryEmail: email.toLowerCase(), secondaryEmailVerified: false } : null);
        }
        return { success: true, message: result.message };
      } else {
        let errorMessage = result.error || 'Failed to update secondary email';
        if (result.errorCode) {
          errorMessage = `${errorMessage} [${result.errorCode}]`;
        }
        if (result.correlationId) {
          errorMessage = `${errorMessage} (Ref: ${result.correlationId})`;
        }
        return { success: false, message: errorMessage };
      }
    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      console.error(`[Update Secondary Email Error ${correlationId}]`, e);
      return { success: false, message: `Failed to update secondary email. [PX-9002] (Ref: ${correlationId})` };
    }
  };

  // GUID: FIREBASE_PROVIDER-020-v04
  // @SECURITY_RISK: Sanitized error messages in catch block to prevent leaking internal details.
  // [Intent] Sends a verification email to the user's secondary email address via the dedicated
  // server-side API endpoint. Validates preconditions (logged in, has secondary email, not yet verified).
  // [Inbound Trigger] Called from the profile page when user requests secondary email verification.
  // [Downstream Impact] Queues a verification email via /api/send-secondary-email-verification.
  // Logs an audit event. Does not change user state until verification is confirmed server-side.
  const sendSecondaryVerificationEmail = async (): Promise<AuthResult> => {
    if (!firebaseUser || !user) {
      return { success: false, message: "You must be logged in to send a verification email." };
    }

    if (!user.secondaryEmail) {
      return { success: false, message: "No secondary email address set." };
    }

    if (user.secondaryEmailVerified) {
      return { success: false, message: "Your secondary email is already verified." };
    }

    try {
      const response = await fetch('/api/send-secondary-email-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          secondaryEmail: user.secondaryEmail,
          teamName: user.teamName,
        }),
      });

      const result = await response.json();

      if (result.success) {
        logAuditEvent(firestore, firebaseUser.uid, 'secondary_verification_email_requested', { secondaryEmail: user.secondaryEmail });
        return { success: true, message: "Verification email sent to your secondary address." };
      } else {
        if (response.status === 503) {
          return {
            success: false,
            message: "Email service not configured. Please contact an administrator. (Error PX-3004)"
          };
        }
        return { success: false, message: result.error || "Failed to send verification email." };
      }
    } catch (e: any) {
      const correlationId = generateClientCorrelationId();
      console.error(`[Secondary Verification Email Error ${correlationId}]`, e);
      return { success: false, message: `Failed to send verification email. [PX-3001] (Ref: ${correlationId})` };
    }
  };

  // GUID: FIREBASE_PROVIDER-031-v04
  // [Intent] Handle redirect results from OAuth flows (mobile sign-in and linking).
  //          getRedirectResult resolves the pending credential after a redirect-based OAuth flow.
  // [Inbound Trigger] Component mounts after a redirect-based OAuth sign-in or link completes.
  // [Downstream Impact] If a redirect result is found, the user is signed in or their provider
  //                     is linked. The onAuthStateChanged listener handles the rest.
  useEffect(() => {
    getRedirectResult(auth).catch((error: any) => {
      if (error?.code === 'auth/account-exists-with-different-credential') {
        const credential = OAuthProvider.credentialFromError(error);
        if (credential) {
          setPendingOAuthCredential(credential as OAuthCredential);
        }
      } else if (error?.code !== 'auth/popup-closed-by-user') {
        console.error("FirebaseProvider: Redirect result error:", error);
      }
    });
  }, [auth]);

  // GUID: FIREBASE_PROVIDER-032-v04
  // [Intent] Wrapper functions for OAuth sign-in and provider linking that call the authService
  //          module and manage pending credential state.
  // [Inbound Trigger] Called from login/signup pages and profile/ConversionBanner components.
  // [Downstream Impact] Delegates to authService functions; on needsLinking, stores pendingCredential.
  const signInWithGoogle = async (): Promise<OAuthSignInResult> => {
    setUserError(null);
    const result = await authSignInWithGoogle(auth);
    if (result.needsLinking && result.pendingCredential) {
      setPendingOAuthCredential(result.pendingCredential);
    }
    return result;
  };

  const signInWithApple = async (): Promise<OAuthSignInResult> => {
    setUserError(null);
    const result = await authSignInWithApple(auth);
    if (result.needsLinking && result.pendingCredential) {
      setPendingOAuthCredential(result.pendingCredential);
    }
    return result;
  };

  // GUID: FIREBASE_PROVIDER-050-v04
  // [Intent] Link Google to current account and send confirmation email on success.
  // [Inbound Trigger] ConversionBanner or profile page "Link Google" button.
  // [Downstream Impact] Links provider via authService, then fires confirmation email
  //                     to primary (and secondary if verified) email. Email is fire-and-forget.
  const linkGoogle = async (): Promise<OAuthLinkResult> => {
    const result = await linkGoogleToAccount(auth);
    if (result.success && user?.email) {
      fetch('/api/send-provider-linked-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          teamName: user.teamName,
          providerId: 'google.com',
          secondaryEmail: user.secondaryEmailVerified ? user.secondaryEmail : undefined,
        }),
      }).catch(() => { /* fire-and-forget */ });
    }
    return result;
  };

  // GUID: FIREBASE_PROVIDER-051-v04
  // [Intent] Link Apple to current account and send confirmation email on success.
  // [Inbound Trigger] ConversionBanner or profile page "Link Apple" button.
  // [Downstream Impact] Same as linkGoogle — links provider, sends confirmation email.
  const linkApple = async (): Promise<OAuthLinkResult> => {
    const result = await linkAppleToAccount(auth);
    if (result.success && user?.email) {
      fetch('/api/send-provider-linked-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          teamName: user.teamName,
          providerId: 'apple.com',
          secondaryEmail: user.secondaryEmailVerified ? user.secondaryEmail : undefined,
        }),
      }).catch(() => { /* fire-and-forget */ });
    }
    return result;
  };

  const unlinkProviderFn = async (providerId: string): Promise<AuthResult> => {
    const result = await authUnlinkProvider(auth, providerId);
    return { success: result.success, message: result.message };
  };

  const clearPendingCredential = () => {
    setPendingOAuthCredential(null);
  };

  // GUID: FIREBASE_PROVIDER-021-v03
  // [Intent] Computed boolean that merges Firebase Auth and Firestore email verification status.
  // Prefers Auth (live) over Firestore (cached) for most accurate result.
  // [Inbound Trigger] Recalculated on every render when firebaseUser or user changes.
  // [Downstream Impact] Consumed by EmailVerificationBanner and any component checking isEmailVerified.
  const isEmailVerified = firebaseUser?.emailVerified ?? user?.emailVerified ?? false;

  // GUID: FIREBASE_PROVIDER-022-v03
  // [Intent] Memoised context value object that bundles all Firebase services, user state, and
  // auth operations into a single object for the React context provider.
  // [Inbound Trigger] Recalculated when any dependency (services, state, or auth functions) changes.
  // [Downstream Impact] All context consumers re-render when this value reference changes.
  // The useMemo prevents unnecessary re-renders when unrelated parent state changes.
  const contextValue = useMemo((): FirebaseContextState => ({
    firebaseApp,
    firestore,
    storage,
    functions,
    authService: auth,
    user,
    firebaseUser,
    isUserLoading,
    userError,
    isEmailVerified,
    updateUser,
    deleteUser,
    login,
    signup,
    logout,
    addSecondaryTeam,
    resetPin,
    changePin,
    sendVerificationEmail,
    refreshEmailVerificationStatus,
    updateSecondaryEmail,
    sendSecondaryVerificationEmail,
    signInWithGoogle,
    signInWithApple,
    linkGoogle,
    linkApple,
    unlinkProvider: unlinkProviderFn,
    pendingOAuthCredential,
    clearPendingCredential,
    isNewOAuthUser,
  }), [firebaseApp, firestore, storage, functions, auth, user, firebaseUser, isUserLoading, userError, isEmailVerified, pendingOAuthCredential, isNewOAuthUser]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

// GUID: FIREBASE_PROVIDER-023-v03
// [Intent] Primary hook for accessing the full Firebase context. Throws if used outside the provider.
// [Inbound Trigger] Called by any component needing Firebase services or auth state.
// [Downstream Impact] Returns the full FirebaseContextState. Most components use useAuth() instead
// for a narrower interface, but this hook is needed for direct Firestore/Storage/Functions access.
export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }
  return context;
};

// GUID: FIREBASE_PROVIDER-024-v03
// [Intent] Convenience hook that extracts only auth-related fields and operations from the context.
// Provides a narrower, more focused API for components that only need user/auth functionality.
// [Inbound Trigger] Called by login, signup, profile, sidebar, and most authenticated components.
// [Downstream Impact] Returns user state and all auth operations. Components using this hook
// re-render when any auth-related state changes.
export const useAuth = () => {
  const context = useFirebase();
  return {
    user: context.user,
    firebaseUser: context.firebaseUser,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
    isEmailVerified: context.isEmailVerified,
    login: context.login,
    signup: context.signup,
    logout: context.logout,
    addSecondaryTeam: context.addSecondaryTeam,
    resetPin: context.resetPin,
    changePin: context.changePin,
    updateUser: context.updateUser,
    deleteUser: context.deleteUser,
    sendVerificationEmail: context.sendVerificationEmail,
    refreshEmailVerificationStatus: context.refreshEmailVerificationStatus,
    updateSecondaryEmail: context.updateSecondaryEmail,
    sendSecondaryVerificationEmail: context.sendSecondaryVerificationEmail,
    signInWithGoogle: context.signInWithGoogle,
    signInWithApple: context.signInWithApple,
    linkGoogle: context.linkGoogle,
    linkApple: context.linkApple,
    unlinkProvider: context.unlinkProvider,
    pendingOAuthCredential: context.pendingOAuthCredential,
    clearPendingCredential: context.clearPendingCredential,
    isNewOAuthUser: context.isNewOAuthUser,
  };
};

// GUID: FIREBASE_PROVIDER-025-v03
// [Intent] Typed hook that returns the Firestore instance, throwing if unavailable.
// [Inbound Trigger] Called by components that need direct Firestore access for queries/writes.
// [Downstream Impact] Returns a non-null Firestore instance. Used throughout the app for
// collection queries, document reads, and real-time subscriptions.
export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  if (!firestore) throw new Error("Firestore not available");
  return firestore;
};

// GUID: FIREBASE_PROVIDER-026-v03
// [Intent] Typed hook that returns the FirebaseApp instance, throwing if unavailable.
// [Inbound Trigger] Called by components that need the raw FirebaseApp reference.
// [Downstream Impact] Rarely used directly; most components use service-specific hooks instead.
export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  if (!firebaseApp) throw new Error("Firebase App not available");
  return firebaseApp;
};

// GUID: FIREBASE_PROVIDER-027-v03
// [Intent] Typed hook that returns the Firebase Storage instance, throwing if unavailable.
// [Inbound Trigger] Called by components that upload or retrieve files (e.g., profile photos).
// [Downstream Impact] Returns a non-null FirebaseStorage instance for file operations.
export const useStorage = (): FirebaseStorage => {
  const { storage } = useFirebase();
  if (!storage) throw new Error("Firebase Storage not available");
  return storage;
};

// GUID: FIREBASE_PROVIDER-028-v03
// [Intent] Typed hook that returns the Firebase Functions instance, throwing if unavailable.
// [Inbound Trigger] Called by components that invoke Cloud Functions directly.
// [Downstream Impact] Returns a non-null Functions instance for calling server-side functions.
export const useFunctions = (): Functions => {
  const { functions } = useFirebase();
  if (!functions) throw new Error("Firebase Functions not available");
  return functions;
};
