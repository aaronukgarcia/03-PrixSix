
'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore, collection, serverTimestamp, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, query, where, getDocs, limit, increment } from 'firebase/firestore';
import { Auth, User as FirebaseAuthUser, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { useRouter } from 'next/navigation';
import { addDocumentNonBlocking } from './non-blocking-updates';
import { logAuditEvent } from '@/lib/audit';

// Extended user profile information
export interface User {
  id: string; // This is the Firebase Auth UID
  email: string;
  teamName: string;
  isAdmin: boolean;
  secondaryTeamName?: string;
  mustChangePin?: boolean;
  badLoginAttempts?: number;
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
  signup: (email: string, teamName: string) => Promise<AuthResult>;
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
        const userCredential = await signInWithEmailAndPassword(auth, email, pin);
        const userDocRef = doc(firestore, 'users', userCredential.user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if(userDocSnap.exists() && (userDocSnap.data()?.badLoginAttempts || 0) > 0) {
            await updateDoc(userDocRef, { badLoginAttempts: 0 });
        }
        
        logAuditEvent(firestore, userCredential.user.uid, 'login_success', { method: 'pin' });
        setIsUserLoading(false);
        return { success: true, message: 'Login successful' };

    } catch (signInError: any) {
        const usersRef = collection(firestore, "users");
        const q = query(usersRef, where("email", "==", email.toLowerCase()), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const userDocSnap = querySnapshot.docs[0];
            const userDocData = userDocSnap.data() as User;

            if (signInError.code === 'auth/invalid-credential') {
                if ((userDocData.badLoginAttempts || 0) >= 5) {
                    logAuditEvent(firestore, userDocData.id, 'login_fail_locked', { email });
                    setIsUserLoading(false);
                    return { success: false, message: "This account is locked. Please contact an administrator." };
                }
                await updateDoc(userDocSnap.ref, { badLoginAttempts: increment(1) });
                logAuditEvent(firestore, userDocData.id, 'login_fail_pin', { email });
                setIsUserLoading(false);
                return { success: false, message: "Invalid email or PIN. Please try again." };
            }
        }
        
         console.error("Error signing in:", signInError);
         setUserError(signInError);
         setIsUserLoading(false);
         return { success: false, message: signInError.message };
    }
  };

  const signup = async (email: string, teamName: string): Promise<AuthResult> => {
    // Check if email already exists in Firestore
    const usersRef = collection(firestore, "users");
    const q = query(usersRef, where("email", "==", email.toLowerCase()), limit(1));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      return { success: false, message: "A team with this email address already exists." };
    }

    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, pin);
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

      const mailRef = collection(firestore, 'mail');
      const mailHtml = `Hello ${teamName},<br><br>Welcome to the league! Your PIN is: <strong>${pin}</strong><br><br>Good luck for the next race!`;
      const mailSubject = "Welcome to Prix Six!";
      
      const mailPayload = { to: email, message: { subject: mailSubject, html: mailHtml } };
      addDocumentNonBlocking(mailRef, mailPayload);

      const emailLogPayload = { to: email, subject: mailSubject, html: mailHtml, pin: pin, status: 'queued', timestamp: serverTimestamp() };
      addDocumentNonBlocking(collection(firestore, 'email_logs'), emailLogPayload);

      logAuditEvent(firestore, uid, 'signup_email_queued', { email, teamName });

      return { success: true, message: "Registration successful!", pin };

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
