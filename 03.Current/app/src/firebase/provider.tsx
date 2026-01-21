
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
  updateUser: (userId: string, data: Partial<User>) => Promise<AuthResult>;
  deleteUser: (userId: string) => Promise<AuthResult>;
  login: (email: string, pin: string) => Promise<AuthResult>;
  signup: (email: string, teamName: string, pin?: string) => Promise<AuthResult>;
  logout: () => void;
  addSecondaryTeam: (teamName: string) => Promise<AuthResult>;
  resetPin: (email: string) => Promise<AuthResult>;
  changePin: (email: string, newPin: string) => Promise<AuthResult>;
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
         return { success: false, message: signInError.message || 'An error occurred during login' };
    }
  };

  const signup = async (email: string, teamName: string, pin?: string): Promise<AuthResult> => {
    // Check if new user signups are enabled
    try {
      const settingsRef = doc(firestore, 'admin_configuration', 'site_settings');
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        const settings = settingsSnap.data();
        if (settings.newUserSignupEnabled === false) {
          return { success: false, message: "New user registration is currently disabled." };
        }
      }
    } catch (e) {
      console.error("Failed to check signup settings:", e);
      // Continue with signup if settings check fails
    }

    const usersRef = collection(firestore, "users");

    // Check if email already exists in Firestore
    const emailQuery = query(usersRef, where("email", "==", email.toLowerCase()), limit(1));
    const emailSnapshot = await getDocs(emailQuery);

    if (!emailSnapshot.empty) {
      return { success: false, message: "A team with this email address already exists." };
    }

    // Check if team name already exists (case-insensitive)
    const allUsersSnapshot = await getDocs(usersRef);
    const normalizedNewName = teamName.toLowerCase().trim();
    let teamNameExists = false;

    allUsersSnapshot.forEach(doc => {
      const existingName = doc.data().teamName?.toLowerCase().trim();
      if (existingName === normalizedNewName) {
        teamNameExists = true;
      }
    });

    if (teamNameExists) {
      return { success: false, message: "This team name is already taken. Please choose a unique name." };
    }

    // Use provided PIN or generate random one (for backward compatibility)
    const userPin = pin || Math.floor(100000 + Math.random() * 900000).toString();

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, userPin);
      const { uid } = userCredential.user;

      const newUser: User = {
        id: uid,
        email,
        teamName,
        isAdmin: false, // Default new users to not be admin
        mustChangePin: false,
        badLoginAttempts: 0,
      };
      await setDoc(doc(firestore, 'users', uid), newUser);
      await setDoc(doc(firestore, "presence", uid), { online: false, sessions: [] });

      // Add user to global league
      try {
        await updateDoc(doc(firestore, 'leagues', GLOBAL_LEAGUE_ID), {
          memberUserIds: arrayUnion(uid),
          updatedAt: serverTimestamp()
        });
      } catch (leagueError: any) {
        // Don't fail signup if global league doesn't exist yet (will be added by migration)
        console.warn('Could not add user to global league:', leagueError.message);
      }

      // Send welcome email via Microsoft Graph API
      try {
        const emailResponse = await fetch('/api/send-welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toEmail: email, teamName, pin: userPin })
        });
        const emailResult = await emailResponse.json();

        // Log to email_logs collection for audit trail
        const emailLogPayload = {
          to: email,
          subject: "Welcome to Prix Six - Your Account is Ready!",
          pin: "[user-created]",
          status: emailResult.success ? 'sent' : 'failed',
          emailGuid: emailResult.emailGuid || null,
          error: emailResult.error || null,
          timestamp: serverTimestamp()
        };
        addDocumentNonBlocking(collection(firestore, 'email_logs'), emailLogPayload);

        logAuditEvent(firestore, uid, 'signup_email_sent', {
          email,
          teamName,
          emailGuid: emailResult.emailGuid,
          success: emailResult.success
        });
      } catch (emailError: any) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail signup if email fails - log the error
        addDocumentNonBlocking(collection(firestore, 'email_logs'), {
          to: email,
          subject: "Welcome to Prix Six",
          status: 'error',
          error: emailError.message,
          timestamp: serverTimestamp()
        });
      }

      // Log USER_REGISTERED audit event
      logAuditEvent(firestore, uid, 'USER_REGISTERED', {
        email,
        teamName,
        registeredAt: new Date().toISOString(),
      });

      return { success: true, message: "Registration successful!" };

    } catch (error: any) {
        if (error.code === 'auth/email-already-in-use') {
            return { success: false, message: "A team with this email address already exists." };
        }
        console.error("Signup error:", error);
        return { success: false, message: error.message || "An unknown error occurred during signup." };
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
    const usersRef = collection(firestore, "users");
    const q = query(usersRef, where("email", "==", email.toLowerCase()), limit(1));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return { success: false, message: "No account found with that email." };
    }
    const userDocRef = querySnapshot.docs[0].ref;
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();

    // This is not secure. A Cloud Function should be used to update the Auth user's password.
    // This is a simulation for the demo.
    await updateDoc(userDocRef, { mustChangePin: true });

    const mailHtml = `Hello,<br><br>A PIN reset was requested for your account. Your temporary PIN is: <strong>${newPin}</strong><br><br>You will be required to change this PIN after logging in. If you did not request this, please contact support.`;
    const mailSubject = "Your Prix Six PIN has been reset";
    addDocumentNonBlocking(collection(firestore, 'mail'), {
        to: email, message: { subject: mailSubject, html: mailHtml }
    });
    addDocumentNonBlocking(collection(firestore, 'email_logs'), {
        to: email, subject: mailSubject, html: mailHtml, pin: newPin, status: 'queued', timestamp: serverTimestamp()
    });
    logAuditEvent(firestore, querySnapshot.docs[0].id, 'reset_pin_email_queued', { email });
    return { success: true, message: "A temporary PIN has been sent." };
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

  const contextValue = useMemo((): FirebaseContextState => ({
    firebaseApp,
    firestore,
    authService: auth,
    user,
    firebaseUser,
    isUserLoading,
    userError,
    updateUser,
    deleteUser,
    login,
    signup,
    logout,
    addSecondaryTeam,
    resetPin,
    changePin
  }), [firebaseApp, firestore, auth, user, firebaseUser, isUserLoading, userError]);

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
    login: context.login,
    signup: context.signup,
    logout: context.logout,
    addSecondaryTeam: context.addSecondaryTeam,
    resetPin: context.resetPin,
    changePin: context.changePin,
    updateUser: context.updateUser,
    deleteUser: context.deleteUser,
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
