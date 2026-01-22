
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
        await signInWithCustomToken(auth, result.customToken);

        setIsUserLoading(false);
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

    // If team name is being changed, check for uniqueness
    if (data.teamName) {
      const usersRef = collection(firestore, "users");
      const allUsersSnapshot = await getDocs(usersRef);
      const normalizedNewName = data.teamName.toLowerCase().trim();
      let teamNameExists = false;

      allUsersSnapshot.forEach(docSnap => {
        // Skip the user being updated
        if (docSnap.id === userId) return;

        const existingName = docSnap.data().teamName?.toLowerCase().trim();
        if (existingName === normalizedNewName) {
          teamNameExists = true;
        }
      });

      if (teamNameExists) {
        return { success: false, message: "This team name is already taken. Please choose a unique name." };
      }
    }

    try {
      const userDocRef = doc(firestore, 'users', userId);
      await updateDoc(userDocRef, data);
      logAuditEvent(firestore, user.id, 'admin_update_user', { targetUserId: userId, changes: data });

      // If updating the current user, sync the local state
      if (userId === user.id) {
        setUser(prev => prev ? { ...prev, ...data } : null);
      }

      return { success: true, message: "User updated successfully." };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  const deleteUser = async (userId: string): Promise<AuthResult> => {
    if (!user?.isAdmin) {
      return { success: false, message: "You do not have permission to perform this action." };
    }
    try {
        const batch = writeBatch(firestore);
        const userDocRef = doc(firestore, 'users', userId);
        const presenceDocRef = doc(firestore, 'presence', userId);

        batch.delete(userDocRef);
        batch.delete(presenceDocRef);

        await batch.commit();

        logAuditEvent(firestore, user.id, 'admin_delete_user', { targetUserId: userId });
        return { success: true, message: "User deleted successfully." };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }


  const addSecondaryTeam = async (teamName: string): Promise<AuthResult> => {
    if (!user) {
        return { success: false, message: "You must be logged in to add a team." };
    }

    // Check if team name already exists (case-insensitive)
    const usersRef = collection(firestore, "users");
    const allUsersSnapshot = await getDocs(usersRef);
    const normalizedNewName = teamName.toLowerCase().trim();
    let teamNameExists = false;

    allUsersSnapshot.forEach(docSnap => {
      const data = docSnap.data();
      const existingName = data.teamName?.toLowerCase().trim();
      const existingSecondary = data.secondaryTeamName?.toLowerCase().trim();
      if (existingName === normalizedNewName || existingSecondary === normalizedNewName) {
        teamNameExists = true;
      }
    });

    if (teamNameExists) {
      return { success: false, message: "This team name is already taken. Please choose a unique name." };
    }

    const userDocRef = doc(firestore, 'users', user.id);
    await updateDoc(userDocRef, { secondaryTeamName: teamName });
    setUser(prev => prev ? { ...prev, secondaryTeamName: teamName } : null);
    logAuditEvent(firestore, user.id, 'add_secondary_team', { newTeamName: teamName });
    return { success: true, message: "Team created successfully!" };
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
      const usersRef = collection(firestore, "users");
      const q = query(usersRef, where("email", "==", email.toLowerCase()), limit(1));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        return { success: false, message: `No account found with that email. [PX-1003] (Ref: ${correlationId})` };
      }
      const userDoc = querySnapshot.docs[0];
      const userDocRef = userDoc.ref;
      const userId = userDoc.id;
      const newPin = Math.floor(100000 + Math.random() * 900000).toString();

      // Update user to require PIN change
      try {
        await updateDoc(userDocRef, { mustChangePin: true });
      } catch (updateError: any) {
        console.error(`[PIN Reset Error ${correlationId}] Failed to update user:`, updateError);

        // Log via API (unauthenticated users can't write to Firestore)
        fetch('/api/log-client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            correlationId,
            errorCode: 'PX-1007',
            error: updateError?.message || 'Failed to update user document',
            stack: updateError?.stack,
            context: {
              route: 'provider/resetPin',
              action: 'updateDoc',
              email: email.toLowerCase(),
              errorType: updateError?.code || 'FirestoreUpdateError',
            },
          }),
        }).catch(() => {});

        return {
          success: false,
          message: `PIN reset failed - permission denied. Please contact support. [PX-1007] (Ref: ${correlationId})`,
        };
      }

      const mailHtml = `Hello,<br><br>A PIN reset was requested for your account. Your temporary PIN is: <strong>${newPin}</strong><br><br>You will be required to change this PIN after logging in. If you did not request this, please contact support.`;
      const mailSubject = "Your Prix Six PIN has been reset";
      addDocumentNonBlocking(collection(firestore, 'mail'), {
          to: email, message: { subject: mailSubject, html: mailHtml }
      });
      addDocumentNonBlocking(collection(firestore, 'email_logs'), {
          to: email, subject: mailSubject, html: mailHtml, pin: newPin, status: 'queued', timestamp: serverTimestamp()
      });
      logAuditEvent(firestore, userId, 'reset_pin_email_queued', { email });
      return { success: true, message: "A temporary PIN has been sent." };

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
            action: 'resetPin',
            email: email.toLowerCase(),
            errorType: error?.code || error?.name || 'Unknown',
          },
        }),
      }).catch(() => {});

      // Map permission errors specifically
      if (error?.code === 'permission-denied' || error?.message?.includes('permission')) {
        return {
          success: false,
          message: `PIN reset failed - permission denied. Please contact support. [PX-1007] (Ref: ${correlationId})`,
        };
      }

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
    refreshEmailVerificationStatus
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
