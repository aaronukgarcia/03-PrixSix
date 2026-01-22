
'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore, collection, serverTimestamp, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, query, where, getDocs, limit, arrayUnion } from 'firebase/firestore';
import { GLOBAL_LEAGUE_ID } from '@/lib/types/league';
import { Auth, User as FirebaseAuthUser, onAuthStateChanged, createUserWithEmailAndPassword, signInWithCustomToken, signOut, updatePassword } from 'firebase/auth';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { useRouter } from 'next/navigation';
import { addDocumentNonBlocking } from './non-blocking-updates';
import { logAuditEvent } from '@/lib/audit';

// Email notification preferences
export interface EmailPreferences {
  rankingChanges?: boolean;
  raceReminders?: boolean;
  newsFeed?: boolean;
  resultsNotifications?: boolean;
}

// AI Analysis weights for race predictions
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

// Extended user profile information
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
}

interface AuthResult {
  success: boolean;
  message: string;
  pin?: string;
}

// Combined state for the Firebase context
export interface FirebaseContextState {
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
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
}

// React Context
export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
}

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [userError, setUserError] = useState<Error | null>(null);
  
  const router = useRouter();
  
  useEffect(() => {
    setIsUserLoading(true);
    const unsubscribe = onAuthStateChanged(
      auth,
      async (fbUser) => {
        setFirebaseUser(fbUser);
        if (fbUser) {
          const userDocRef = doc(firestore, 'users', fbUser.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const userData = userDoc.data() as User;

            // Sync emailVerified status from Firebase Auth to Firestore
            if (fbUser.emailVerified && !userData.emailVerified) {
              await updateDoc(userDocRef, { emailVerified: true });
              userData.emailVerified = true;
              logAuditEvent(firestore, fbUser.uid, 'email_verified_synced', { email: fbUser.email });
            }

            setUser(userData);
             if (userData.mustChangePin) {
                router.push('/profile');
            }
          } else {
             setUser(null);
          }
        } else {
          setUser(null);
        }
        setIsUserLoading(false);
      },
      (error) => {
        console.error("FirebaseProvider: onAuthStateChanged error:", error);
        setUserError(error);
        setIsUserLoading(false);
      }
    );
    return () => unsubscribe();
  }, [auth, firestore, router]);

  const login = async (email: string, pin: string): Promise<AuthResult> => {
    setIsUserLoading(true);
    setUserError(null);

    try {
        // SECURITY: Use server-side API for brute force protection
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, pin }),
        });

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
        // Note: Don't set isUserLoading here - let onAuthStateChanged handle it
        // to avoid race condition where AppLayout sees isUserLoading=false before user is set
        await signInWithCustomToken(auth, result.customToken);

        return { success: true, message: 'Login successful' };

    } catch (signInError: any) {
         console.error("Error signing in:", signInError);
         setUserError(signInError);
         setIsUserLoading(false);
         // Generate client-side correlation ID for network/client errors
         const clientCorrelationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
         const errorMessage = `${signInError.message || 'An error occurred during login'} (Ref: ${clientCorrelationId})`;
         return { success: false, message: errorMessage };
    }
  };

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
      const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
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
      const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      console.error(`[Update User Error ${correlationId}]`, e);
      return { success: false, message: `Failed to update user. [PX-9002] (Ref: ${correlationId})` };
    }
  }

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
      const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      console.error(`[Delete User Error ${correlationId}]`, e);
      return { success: false, message: `Failed to delete user. [PX-9002] (Ref: ${correlationId})` };
    }
  }


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

  const resetPin = async (email: string): Promise<AuthResult> => {
    // Generate correlation ID upfront for error tracking
    const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

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
        console.error("PIN change error:", e);
        if (e.code === 'auth/requires-recent-login') {
            return { success: false, message: "This is a sensitive operation. Please log out and log back in before changing your PIN." };
        }
        return { success: false, message: e.message };
    }
  };

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
      console.error("Send verification email error:", e);
      return { success: false, message: e.message || "Failed to send verification email." };
    }
  };

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
      const correlationId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      console.error(`[Update Secondary Email Error ${correlationId}]`, e);
      return { success: false, message: `Failed to update secondary email. [PX-9002] (Ref: ${correlationId})` };
    }
  };

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
      console.error("Send secondary verification email error:", e);
      return { success: false, message: e.message || "Failed to send verification email." };
    }
  };

  // Computed property for email verification status
  const isEmailVerified = firebaseUser?.emailVerified ?? user?.emailVerified ?? false;

  const contextValue = useMemo((): FirebaseContextState => ({
    firebaseApp,
    firestore,
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
    sendSecondaryVerificationEmail
  }), [firebaseApp, firestore, auth, user, firebaseUser, isUserLoading, userError, isEmailVerified]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider.');
  }
  return context;
};

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
  };
};

export const useFirestore = (): Firestore => {
  const { firestore } = useFirebase();
  if (!firestore) throw new Error("Firestore not available");
  return firestore;
};

export const useFirebaseApp = (): FirebaseApp => {
  const { firebaseApp } = useFirebase();
  if (!firebaseApp) throw new Error("Firebase App not available");
  return firebaseApp;
};
