
"use client";

import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth, useFirestore } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { doc, updateDoc, arrayUnion, arrayRemove, getDoc } from "firebase/firestore";
import { useAuditNavigation } from "@/lib/audit";
import { SessionProvider } from "@/contexts/session-context";
import { LeagueProvider } from "@/contexts/league-context";
import { logAuditEvent } from "@/lib/audit";

function generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, isUserLoading, logout } = useAuth();
  const router = useRouter();
  const firestore = useFirestore();
  const sessionIdRef = useRef<string | null>(null);
  useAuditNavigation(); // Add the audit logging hook here.

  useEffect(() => {
    // Only redirect if loading is finished and there's no user.
    if (!isUserLoading && !user) {
      router.push("/login");
      return;
    }
    // If user must change PIN, redirect to profile page
    if (user?.mustChangePin) {
      router.push("/profile");
    }
  }, [user, isUserLoading, router]);

  // Check for single user mode and force logout if not the designated admin
  useEffect(() => {
    if (!firestore || !user || !firebaseUser) return;

    const checkSingleUserMode = async () => {
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
      } catch (error) {
        console.error("Failed to check single user mode:", error);
      }
    };

    checkSingleUserMode();
  }, [firestore, user, firebaseUser, logout]);

  useEffect(() => {
    if (firebaseUser && firestore) {
      if (!sessionIdRef.current) {
        sessionIdRef.current = generateGuid();
      }
      const sessionId = sessionIdRef.current;
      const presenceRef = doc(firestore, "presence", firebaseUser.uid);

      const handleConnection = async () => {
         await updateDoc(presenceRef, {
            online: true, // Keep for quick checks
            sessions: arrayUnion(sessionId)
        });
      };

      const handleDisconnection = async () => {
        if (sessionId) {
            await updateDoc(presenceRef, {
                sessions: arrayRemove(sessionId)
            });
        }
      };

      handleConnection();

      window.addEventListener('beforeunload', handleDisconnection);

      return () => {
        handleDisconnection(); // Clean up on component unmount
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
  
  // If not loading and still no user, we're about to redirect, so render nothing to avoid flicker.
  if (!user) {
    return null;
  }


  // If we get here, we have a user. Render the app.
  return (
    <SessionProvider sessionId={sessionIdRef.current}>
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
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  );
}
