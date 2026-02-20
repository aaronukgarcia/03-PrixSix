
// GUID: ADMIN_ONLINE_USERS-000-v04
// @SECURITY_FIX: Replaced direct client-side Firestore writes with authenticated API calls (GEMINI-AUDIT-025, ADMINCOMP-009).
// [Intent] Admin component for monitoring online user sessions and managing Single User Mode (purge all sessions, restrict access to one admin).
// [Inbound Trigger] Rendered within the admin panel when the "Online Users" tab is selected.
// [Downstream Impact] Reads presence collection for session data. Single User Mode activation/deactivation goes through /api/admin/single-user-mode (server-side admin verification) — no longer writes directly to Firestore from client.

'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection, useFirestore, useAuth, addDocumentNonBlocking } from '@/firebase';
import type { User } from '@/firebase/provider';
import { collection, query, doc, getDoc } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { getCorrelationId } from '@/lib/audit';
import { ShieldAlert, ShieldOff } from 'lucide-react';
import { useSession } from '@/contexts/session-context';
import { usePathname } from 'next/navigation';

// GUID: ADMIN_ONLINE_USERS-001-v03
// [Intent] Defines the session timeout window; sessions inactive beyond this threshold are considered expired.
// [Inbound Trigger] Referenced by useMemo hooks that filter active sessions from presence data.
// [Downstream Impact] Must match the SESSION_TIMEOUT_MS constant in layout.tsx; mismatches will cause inconsistent online/offline display.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// GUID: ADMIN_ONLINE_USERS-002-v03
// [Intent] Type definition for a Firestore presence document, tracking a user's online status and session GUIDs.
// [Inbound Trigger] Used to type presence collection documents read via useCollection.
// [Downstream Impact] Changes to the presence document schema must be reflected here.
interface Presence {
  id: string; // This is the Firebase Auth UID
  online: boolean;
  sessions?: string[]; // Array of unique session GUIDs
  sessionActivity?: Record<string, number>; // Map of sessionId -> lastActivity timestamp
  lastActivity?: any; // Firestore Timestamp
}

// GUID: ADMIN_ONLINE_USERS-003-v03
// [Intent] Defines the props contract for OnlineUsersManager, requiring the full user list and its loading state.
// [Inbound Trigger] Passed from the parent admin page which fetches all users.
// [Downstream Impact] The component matches presence data to user details via allUsers.
interface OnlineUsersManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

// GUID: ADMIN_ONLINE_USERS-004-v03
// [Intent] Type definition for Single User Mode configuration stored in admin_configuration/global.
// [Inbound Trigger] Read from Firestore on mount and updated when Single User Mode is activated/deactivated.
// [Downstream Impact] When singleUserModeEnabled is true, all non-admin users are blocked from accessing the system.
interface SingleUserModeConfig {
  singleUserModeEnabled: boolean;
  singleUserAdminId: string | null;
  singleUserModeActivatedAt: string | null;
}

// GUID: ADMIN_ONLINE_USERS-005-v03
// [Intent] Fire-and-forget helper to log errors to the error_logs Firestore collection with full context.
// [Inbound Trigger] Called from catch blocks within Single User Mode activate/deactivate operations.
// [Downstream Impact] Writes to the error_logs collection for admin review; does not throw on failure (non-blocking).
function logErrorToFirestore(
  firestore: any,
  userId: string | undefined,
  errorType: string,
  error: any,
  context: { page?: string; action?: string; [key: string]: any }
) {
  const errorLogsRef = collection(firestore, 'error_logs');
  const errorData = {
    correlationId: getCorrelationId(),
    userId: userId || 'unknown',
    errorType,
    message: error?.message || String(error),
    code: error?.code || null,
    stack: error?.stack?.substring(0, 500) || null,
    context: {
      ...context,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : null,
      url: typeof window !== 'undefined' ? window.location.href : null,
    },
    timestamp: new Date().toISOString(),
  };
  addDocumentNonBlocking(errorLogsRef, errorData);
}

// GUID: ADMIN_ONLINE_USERS-006-v03
// [Intent] Main OnlineUsersManager component displaying active sessions in a table and providing Single User Mode controls.
// [Inbound Trigger] Rendered by the admin page when the Online Users tab is active.
// [Downstream Impact] Reads presence and admin_configuration collections. Single User Mode writes affect all users' sessions and access.
export function OnlineUsersManager({ allUsers, isUserLoading }: OnlineUsersManagerProps) {
  const firestore = useFirestore();
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const { sessionId: currentSessionId } = useSession();
  const pathname = usePathname();
  const [singleUserMode, setSingleUserMode] = useState<SingleUserModeConfig | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  // GUID: ADMIN_ONLINE_USERS-007-v03
  // [Intent] Fetches the current Single User Mode configuration from admin_configuration/global on component mount.
  // [Inbound Trigger] Runs when the firestore instance becomes available (useEffect dependency).
  // [Downstream Impact] Populates singleUserMode state which controls the activate/deactivate button display and the warning banner.
  useEffect(() => {
    if (!firestore) return;
    const fetchSingleUserMode = async () => {
      const docRef = doc(firestore, 'admin_configuration', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSingleUserMode({
          singleUserModeEnabled: data.singleUserModeEnabled || false,
          singleUserAdminId: data.singleUserAdminId || null,
          singleUserModeActivatedAt: data.singleUserModeActivatedAt || null,
        });
      } else {
        setSingleUserMode({
          singleUserModeEnabled: false,
          singleUserAdminId: null,
          singleUserModeActivatedAt: null,
        });
      }
    };
    fetchSingleUserMode();
  }, [firestore]);

  // GUID: ADMIN_ONLINE_USERS-008-v04
  // @SECURITY_FIX: Replaced direct client-side Firestore batch write with authenticated API call (GEMINI-AUDIT-025, ADMINCOMP-009).
  // [Intent] Activates Single User Mode via /api/admin/single-user-mode endpoint which performs server-side admin verification before purging presence sessions and setting the flag.
  // [Inbound Trigger] Clicking "Activate Single User Mode" in the confirmation AlertDialog.
  // [Downstream Impact] All other users are immediately disconnected (sessions purged server-side). Admin_configuration/global is updated server-side. Audit event logged server-side.
  const activateSingleUserMode = async () => {
    if (!user || !firebaseUser) return;
    setIsActivating(true);

    const correlationId = getCorrelationId();

    try {
      const idToken = await firebaseUser.getIdToken();
      if (!idToken) throw new Error('Authentication token not available');

      const response = await fetch('/api/admin/single-user-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ adminUid: firebaseUser.uid, action: 'activate', currentSessionId: currentSessionId || undefined }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to activate Single User Mode');

      setSingleUserMode({ singleUserModeEnabled: true, singleUserAdminId: user.id, singleUserModeActivatedAt: new Date().toISOString() });

      toast({ title: "Single User Mode Activated", description: `${data.purgedCount ?? 0} session(s) have been purged. All other users are now disconnected.` });

    } catch (error: any) {
      console.error('Failed to activate single user mode:', error);
      logErrorToFirestore(firestore, user.id, 'SINGLE_USER_MODE_ACTIVATION_FAILED', error, { page: pathname, action: 'activateSingleUserMode', adminSessionId: currentSessionId });
      toast({ variant: "destructive", title: "Activation Failed", description: `${error.message} (Correlation ID: ${correlationId})` });
    }

    setIsActivating(false);
  };

  // GUID: ADMIN_ONLINE_USERS-009-v04
  // @SECURITY_FIX: Replaced direct client-side Firestore setDoc with authenticated API call (GEMINI-AUDIT-025, ADMINCOMP-009).
  // [Intent] Deactivates Single User Mode via /api/admin/single-user-mode endpoint which performs server-side admin verification before clearing the flag.
  // [Inbound Trigger] Clicking "Exit Single User Mode" in the confirmation AlertDialog.
  // [Downstream Impact] Sets singleUserModeEnabled=false in admin_configuration/global server-side. Users can reconnect. Audit event logged server-side.
  const deactivateSingleUserMode = async () => {
    if (!user || !firebaseUser) return;
    setIsActivating(true);

    const correlationId = getCorrelationId();

    try {
      const idToken = await firebaseUser.getIdToken();
      if (!idToken) throw new Error('Authentication token not available');

      const response = await fetch('/api/admin/single-user-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ adminUid: firebaseUser.uid, action: 'deactivate' }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to deactivate Single User Mode');

      setSingleUserMode({ singleUserModeEnabled: false, singleUserAdminId: null, singleUserModeActivatedAt: null });

      toast({ title: "Single User Mode Deactivated", description: "Users can now connect normally." });

    } catch (error: any) {
      logErrorToFirestore(firestore, user.id, 'SINGLE_USER_MODE_DEACTIVATION_FAILED', error, {
        page: pathname,
        action: 'deactivateSingleUserMode',
      });

      toast({
        variant: "destructive",
        title: "Deactivation Failed",
        description: `${error.message} (Correlation ID: ${correlationId})`,
      });
    }

    setIsActivating(false);
  };

  // GUID: ADMIN_ONLINE_USERS-010-v03
  // [Intent] Memoised Firestore query for the entire presence collection, used by the useCollection hook.
  // [Inbound Trigger] Recomputed when the firestore instance changes.
  // [Downstream Impact] Feeds the useCollection hook which provides real-time presence data for the session table.
  const presenceQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'presence'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: allPresence, isLoading: isPresenceLoading } = useCollection<Presence>(presenceQuery);

  // GUID: ADMIN_ONLINE_USERS-011-v03
  // [Intent] Derives the list of users with active sessions by joining presence data with user details, filtering by session timeout.
  // [Inbound Trigger] Recomputed when allPresence or allUsers changes.
  // [Downstream Impact] Drives the session table rows. All active sessions are shown for every user.
  const usersWithSessions = useMemo(() => {
    if (!allPresence || !allUsers) return [];

    const now = Date.now();

    // Filter presence docs with active sessions within the timeout window
    const onlineUsers = allPresence.filter(p => {
      if (!p.sessions || p.sessions.length === 0) return false;

      // Check if any session has been active within the timeout
      if (p.sessionActivity) {
        return p.sessions.some(sessionId => {
          const lastActivity = p.sessionActivity?.[sessionId];
          return lastActivity && (now - lastActivity) < SESSION_TIMEOUT_MS;
        });
      }

      // Fallback: if no sessionActivity tracking, consider active (legacy sessions)
      return true;
    });

    return onlineUsers.flatMap(presence => {
        const userDetail = allUsers.find(u => u.id === presence.id);
        if (!userDetail || !presence.sessions || presence.sessions.length === 0) {
            return [];
        }

        // Filter to only active sessions within timeout
        const activeSessions = presence.sessions.filter(sessionId => {
          if (presence.sessionActivity) {
            const lastActivity = presence.sessionActivity[sessionId];
            return lastActivity && (now - lastActivity) < SESSION_TIMEOUT_MS;
          }
          return true; // Legacy sessions without tracking
        });

        if (activeSessions.length === 0) return [];

        // Show all active sessions for every user
        return activeSessions.map(sessionId => ({
            ...userDetail,
            sessionId: sessionId,
            lastActivity: presence.sessionActivity?.[sessionId],
        }));
    });

  }, [allPresence, allUsers]);

  const isLoading = isUserLoading || isPresenceLoading;

  // GUID: ADMIN_ONLINE_USERS-012-v03
  // [Intent] Computes the total count of active sessions across all users, only counting sessions within the timeout window.
  // [Inbound Trigger] Recomputed when allPresence changes.
  // [Downstream Impact] Displayed in the card title as the session count badge.
  const totalSessionCount = useMemo(() => {
    if (!allPresence) return 0;
    const now = Date.now();

    return allPresence
      .filter(p => p.sessions && p.sessions.length > 0)
      .reduce((acc, p) => {
        if (!p.sessions) return acc;

        // Count only sessions active within timeout window
        const activeSessions = p.sessions.filter(sessionId => {
          if (p.sessionActivity) {
            const lastActivity = p.sessionActivity[sessionId];
            return lastActivity && (now - lastActivity) < SESSION_TIMEOUT_MS;
          }
          return true; // Legacy sessions
        });

        return acc + activeSessions.length;
      }, 0);
  }, [allPresence]);

  // GUID: ADMIN_ONLINE_USERS-013-v03
  // [Intent] Resolves the team name of the admin who activated Single User Mode for display in the warning banner.
  // [Inbound Trigger] Recomputed when singleUserMode or allUsers changes.
  // [Downstream Impact] Display-only; shown in the amber warning banner when Single User Mode is active.
  const singleUserAdminName = useMemo(() => {
    if (!singleUserMode?.singleUserAdminId || !allUsers) return null;
    const admin = allUsers.find(u => u.id === singleUserMode.singleUserAdminId);
    return admin?.teamName || 'Unknown Admin';
  }, [singleUserMode, allUsers]);

  // GUID: ADMIN_ONLINE_USERS-014-v03
  // [Intent] Renders the complete Online Users UI: session table, Single User Mode controls, and status banner.
  // [Inbound Trigger] Component render cycle.
  // [Downstream Impact] Provides the visual interface for monitoring sessions and toggling Single User Mode.
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Online User Sessions ({isLoading ? '...' : totalSessionCount})</CardTitle>
            <CardDescription>A real-time list of active user sessions (GUIDs).</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {singleUserMode?.singleUserModeEnabled ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={isActivating} className="border-green-500 text-green-600 hover:bg-green-50">
                    <ShieldOff className="h-4 w-4 mr-2" />
                    {isActivating ? 'Processing...' : 'Exit Single User Mode'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Exit Single User Mode?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will allow all users to connect normally again. Are you sure you want to proceed?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deactivateSingleUserMode}>
                      Exit Single User Mode
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isActivating}>
                    <ShieldAlert className="h-4 w-4 mr-2" />
                    {isActivating ? 'Processing...' : 'Single User Mode'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Activate Single User Mode?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will immediately disconnect ALL users and purge ALL session data.
                      Only you will be able to use the system until you exit single user mode.
                      <br /><br />
                      <strong>This action cannot be undone.</strong> All users will need to log in again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={activateSingleUserMode} className="bg-destructive hover:bg-destructive/90">
                      Activate Single User Mode
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
        {singleUserMode?.singleUserModeEnabled && (
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4 inline mr-2" />
              <strong>Single User Mode Active</strong> — Only <strong>{singleUserAdminName}</strong> can access the system.
              {singleUserMode.singleUserModeActivatedAt && (
                <span className="text-muted-foreground ml-2">
                  (Activated: {new Date(singleUserMode.singleUserModeActivatedAt).toLocaleString()})
                </span>
              )}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Session GUID</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-6 w-16 ml-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : usersWithSessions.length > 0 ? (
              usersWithSessions.map((user) => {
                // Calculate time since last activity
                const lastActivity = (user as any).lastActivity;
                const minutesAgo = lastActivity ? Math.floor((Date.now() - lastActivity) / 60000) : null;
                const lastActiveText = minutesAgo === null ? 'Unknown' :
                  minutesAgo === 0 ? 'Just now' :
                  minutesAgo === 1 ? '1 min ago' :
                  `${minutesAgo} mins ago`;

                return (
                  <TableRow key={user.sessionId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={`https://picsum.photos/seed/${user.id}/100/100`} data-ai-hint="person avatar"/>
                          <AvatarFallback>{user.teamName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{user.teamName}</div>
                          <div className="text-sm text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{user.sessionId}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{lastActiveText}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className="text-green-500 border-green-500/50">
                        Online
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground h-24">
                  No active user sessions.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
