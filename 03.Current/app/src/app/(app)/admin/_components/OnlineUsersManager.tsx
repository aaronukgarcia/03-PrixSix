
'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection, useFirestore, useAuth, addDocumentNonBlocking } from '@/firebase';
import type { User } from '@/firebase/provider';
import { collection, query, doc, getDoc, setDoc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { logAuditEvent, getCorrelationId } from '@/lib/audit';
import { ShieldAlert, ShieldOff } from 'lucide-react';
import { useSession } from '@/contexts/session-context';
import { usePathname } from 'next/navigation';

// Session timeout constant - must match layout.tsx
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface Presence {
  id: string; // This is the Firebase Auth UID
  online: boolean;
  sessions?: string[]; // Array of unique session GUIDs
  sessionActivity?: Record<string, number>; // Map of sessionId -> lastActivity timestamp
  lastActivity?: any; // Firestore Timestamp
}

interface OnlineUsersManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

interface SingleUserModeConfig {
  singleUserModeEnabled: boolean;
  singleUserAdminId: string | null;
  singleUserModeActivatedAt: string | null;
}

// Helper to log errors to error_logs collection
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
    timestamp: serverTimestamp(),
  };
  addDocumentNonBlocking(errorLogsRef, errorData);
}

export function OnlineUsersManager({ allUsers, isUserLoading }: OnlineUsersManagerProps) {
  const firestore = useFirestore();
  const { user } = useAuth();
  const { toast } = useToast();
  const { sessionId: currentSessionId } = useSession();
  const pathname = usePathname();
  const [singleUserMode, setSingleUserMode] = useState<SingleUserModeConfig | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  // Fetch single user mode status
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

  // Activate single user mode - purge all sessions except current admin's session
  const activateSingleUserMode = async () => {
    if (!firestore || !user) return;
    setIsActivating(true);

    const correlationId = getCorrelationId();

    try {
      // Get all presence documents
      const presenceSnapshot = await getDocs(collection(firestore, 'presence'));

      // Batch update to purge all sessions EXCEPT the current admin's session
      const batch = writeBatch(firestore);
      let purgedCount = 0;
      let preservedAdminSession = false;

      presenceSnapshot.docs.forEach((presenceDoc) => {
        const presenceData = presenceDoc.data();
        const isCurrentAdmin = presenceDoc.id === user.id;

        if (presenceData.sessions && presenceData.sessions.length > 0) {
          if (isCurrentAdmin && currentSessionId) {
            // For the current admin, preserve only their current session
            const hasCurrentSession = presenceData.sessions.includes(currentSessionId);
            if (hasCurrentSession) {
              // Keep only the current session, purge others
              const otherSessions = presenceData.sessions.filter((s: string) => s !== currentSessionId);
              purgedCount += otherSessions.length;
              batch.update(presenceDoc.ref, {
                sessions: [currentSessionId],
                online: true
              });
              preservedAdminSession = true;
            } else {
              // Current session not found, purge all (shouldn't happen)
              purgedCount += presenceData.sessions.length;
              batch.update(presenceDoc.ref, {
                sessions: [],
                online: false
              });
            }
          } else {
            // For all other users, purge all sessions
            purgedCount += presenceData.sessions.length;
            batch.update(presenceDoc.ref, {
              sessions: [],
              online: false
            });
          }
        }
      });

      // Update admin_configuration with single user mode settings
      const configRef = doc(firestore, 'admin_configuration', 'global');
      batch.set(configRef, {
        singleUserModeEnabled: true,
        singleUserAdminId: user.id,
        singleUserModeActivatedAt: new Date().toISOString(),
      }, { merge: true });

      await batch.commit();

      // Update local state
      setSingleUserMode({
        singleUserModeEnabled: true,
        singleUserAdminId: user.id,
        singleUserModeActivatedAt: new Date().toISOString(),
      });

      // Log audit event
      logAuditEvent(firestore, user.id, 'SINGLE_USER_MODE_ACTIVATED', {
        purgedSessionCount: purgedCount,
        preservedAdminSession,
        adminSessionId: currentSessionId,
        activatedBy: user.teamName,
      });

      toast({
        title: "Single User Mode Activated",
        description: `${purgedCount} session(s) have been purged. All other users are now disconnected.`,
      });

    } catch (error: any) {
      console.error('Failed to activate single user mode:', error);

      // Log error to error_logs collection
      logErrorToFirestore(firestore, user.id, 'SINGLE_USER_MODE_ACTIVATION_FAILED', error, {
        page: pathname,
        action: 'activateSingleUserMode',
        adminSessionId: currentSessionId,
      });

      toast({
        variant: "destructive",
        title: "Activation Failed",
        description: `${error.message} (Correlation ID: ${correlationId})`,
      });
    }

    setIsActivating(false);
  };

  // Deactivate single user mode
  const deactivateSingleUserMode = async () => {
    if (!firestore || !user) return;
    setIsActivating(true);

    const correlationId = getCorrelationId();

    try {
      const configRef = doc(firestore, 'admin_configuration', 'global');
      await setDoc(configRef, {
        singleUserModeEnabled: false,
        singleUserAdminId: null,
        singleUserModeActivatedAt: null,
      }, { merge: true });

      setSingleUserMode({
        singleUserModeEnabled: false,
        singleUserAdminId: null,
        singleUserModeActivatedAt: null,
      });

      logAuditEvent(firestore, user.id, 'SINGLE_USER_MODE_DEACTIVATED', {
        deactivatedBy: user.teamName,
      });

      toast({
        title: "Single User Mode Deactivated",
        description: "Users can now connect normally.",
      });

    } catch (error: any) {
      // Log error to error_logs collection
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

  // Query all presence documents and filter client-side
  const presenceQuery = useMemo(() => {
    if (!firestore) return null;
    const q = query(collection(firestore, 'presence'));
    (q as any).__memo = true;
    return q;
  }, [firestore]);

  const { data: allPresence, isLoading: isPresenceLoading } = useCollection<Presence>(presenceQuery);

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

        // For admins: show all active sessions
        // For regular users: show only the first active session
        if (userDetail.isAdmin) {
            return activeSessions.map(sessionId => ({
                ...userDetail,
                sessionId: sessionId,
                lastActivity: presence.sessionActivity?.[sessionId],
            }));
        } else {
            return [{
                ...userDetail,
                sessionId: activeSessions[0],
                lastActivity: presence.sessionActivity?.[activeSessions[0]],
            }];
        }
    });

  }, [allPresence, allUsers]);
  
  const isLoading = isUserLoading || isPresenceLoading;

  // Total active session count (for display in title) - only sessions within timeout
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

  // Find admin name for display
  const singleUserAdminName = useMemo(() => {
    if (!singleUserMode?.singleUserAdminId || !allUsers) return null;
    const admin = allUsers.find(u => u.id === singleUserMode.singleUserAdminId);
    return admin?.teamName || 'Unknown Admin';
  }, [singleUserMode, allUsers]);

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
