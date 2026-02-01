
"use client";

import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth, useFirestore } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { Settings, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc, serverTimestamp } from "firebase/firestore";
import { useAuditNavigation } from "@/lib/audit";
import { SessionProvider } from "@/contexts/session-context";
import { LeagueProvider } from "@/contexts/league-context";
import { logAuditEvent } from "@/lib/audit";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { ConversionBanner } from "@/components/ConversionBanner";
import { PreSeasonBanner } from "@/components/PreSeasonBanner";
import { SplashScreen, useSplashScreen } from "@/components/ui/SplashScreen";
import { SmartLoaderProvider } from "@/components/ui/smart-loader";

function generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, isUserLoading, userError, logout, isNewOAuthUser } = useAuth();
  const router = useRouter();
  const firestore = useFirestore();
  const sessionIdRef = useRef<string | null>(null);
  const { showSplash, isChecked, handleComplete } = useSplashScreen();
  useAuditNavigation(); // Add the audit logging hook here.

  useEffect(() => {
    // Only redirect if loading is finished and there's no user AND no firebaseUser
    // (firebaseUser exists briefly before user doc is fetched)
    if (!isUserLoading && !user && !firebaseUser) {
      router.push("/login");
      return;
    }
    // New OAuth users should be on /complete-profile, not app pages
    if (!isUserLoading && isNewOAuthUser && firebaseUser && !user) {
      router.push("/complete-profile");
      return;
    }
    // If user must change PIN, redirect to profile page
    if (user?.mustChangePin) {
      router.push("/profile");
    }
  }, [user, firebaseUser, isUserLoading, isNewOAuthUser, router]);

  // Check for single user mode and force logout if not the designated admin
  // This runs in the background and doesn't block page rendering
  useEffect(() => {
    if (!firestore || !user || !firebaseUser) return;

    // Use a timeout to ensure this doesn't block initial render
    const timeoutId = setTimeout(async () => {
      try {
        const configRef = doc(firestore, "admin_configuration", "global");
        const configSnap = await getDoc(configRef);

        if (configSnap.exists()) {
          const config = configSnap.data();
          if (config.singleUserModeEnabled && config.singleUserAdminId !== user.id) {
            // Log the forced disconnect
            logAuditEvent(firestore, user.id, 'SINGLE_USER_MODE_BLOCKED', {
              blockedUser: user.teamName,
              singleUserAdminId: config.singleUserAdminId,
            });

            // Force logout
            logout();
          }
        }
      } catch (error: any) {
        // Silently ignore permission errors - these happen for non-admin users
        // if the rules haven't been deployed yet
        if (!error?.message?.includes('permission')) {
          console.error("Failed to check single user mode:", error);
        }
      }
    }, 100); // Small delay to not block render

    return () => clearTimeout(timeoutId);
  }, [firestore, user, firebaseUser, logout]);

  // Session timeout constants
  const SESSION_HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes

  useEffect(() => {
    if (firebaseUser && firestore) {
      if (!sessionIdRef.current) {
        sessionIdRef.current = generateGuid();
      }
      const sessionId = sessionIdRef.current;
      const presenceRef = doc(firestore, "presence", firebaseUser.uid);

      const handleConnection = async () => {
         await updateDoc(presenceRef, {
            online: true,
            sessions: arrayUnion(sessionId),
            // Store session timestamps in a separate map for tracking activity
            [`sessionActivity.${sessionId}`]: Date.now(),
            lastActivity: serverTimestamp(),
        }).catch(async () => {
          // If document doesn't exist, create it (first login scenario)
          const { setDoc } = await import("firebase/firestore");
          await setDoc(presenceRef, {
            online: true,
            sessions: [sessionId],
            sessionActivity: { [sessionId]: Date.now() },
            lastActivity: serverTimestamp(),
          });
        });
      };

      const handleDisconnection = async () => {
        if (sessionId) {
          const { deleteField } = await import("firebase/firestore");
          await updateDoc(presenceRef, {
            sessions: arrayRemove(sessionId),
            [`sessionActivity.${sessionId}`]: deleteField(),
          }).catch(() => {}); // Ignore errors on disconnect
        }
      };

      // Heartbeat to update lastActivity periodically
      const heartbeat = async () => {
        try {
          await updateDoc(presenceRef, {
            [`sessionActivity.${sessionId}`]: Date.now(),
            lastActivity: serverTimestamp(),
          });
        } catch (e) {
          // Ignore heartbeat errors
        }
      };

      handleConnection();

      // Start heartbeat interval
      const heartbeatInterval = setInterval(heartbeat, SESSION_HEARTBEAT_INTERVAL);

      window.addEventListener('beforeunload', handleDisconnection);

      return () => {
        handleDisconnection();
        clearInterval(heartbeatInterval);
        window.removeEventListener('beforeunload', handleDisconnection);
      };
    }
  }, [firebaseUser, firestore]);

  // If loading, show a skeleton screen. Don't proceed further.
  if (isUserLoading) {
    return (
       <div className="flex items-center justify-center min-h-screen">
          <div className="w-full max-w-md space-y-4 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
       </div>
    );
  }
  
  // If not loading and still no user (and no firebaseUser), we're about to redirect, so render nothing to avoid flicker.
  // If firebaseUser exists but user doesn't, we're still fetching the user doc - show skeleton.
  if (!user && !firebaseUser) {
    return null;
  }

  // If firebaseUser exists but user doc is still loading, show skeleton
  if (!user && firebaseUser && !userError) {
    return (
       <div className="flex items-center justify-center min-h-screen">
          <div className="w-full max-w-md space-y-4 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
       </div>
    );
  }

  // If there's an error loading user data, show error state with retry option
  if (userError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-full max-w-md p-6 space-y-4 text-center">
          <div className="flex justify-center">
            <AlertTriangle className="h-12 w-12 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold">Unable to Load Profile</h2>
          <p className="text-muted-foreground">
            {userError.message || 'There was an error loading your profile. Please try again.'}
          </p>
          <div className="flex flex-col gap-2 pt-4">
            <Button
              onClick={() => window.location.reload()}
              variant="default"
            >
              Refresh Page
            </Button>
            <Button
              onClick={() => {
                logout();
                router.push('/login');
              }}
              variant="outline"
            >
              Return to Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // If we get here, we have a user. Render the app.
  return (
    <SessionProvider sessionId={sessionIdRef.current}>
      {/* F1-style splash screen - shows once per session */}
      {isChecked && showSplash && <SplashScreen onComplete={handleComplete} />}
      <LeagueProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
                <SidebarTrigger className="md:hidden"/>
                 <div className="ml-auto">
                  <Link href="/profile">
                      <Button variant="ghost" size="icon">
                          <Settings className="h-5 w-5"/>
                          <span className="sr-only">Settings</span>
                      </Button>
                  </Link>
                </div>
            </header>
            <SmartLoaderProvider>
              <main className="flex-1 p-4 md:p-6">
                <PreSeasonBanner />
                <EmailVerificationBanner />
                <ConversionBanner />
                {children}
              </main>
            </SmartLoaderProvider>
          </SidebarInset>
        </SidebarProvider>
      </LeagueProvider>
    </SessionProvider>
  );
}
