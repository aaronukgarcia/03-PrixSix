
'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection, useFirestore, useAuth } from '@/firebase';
import type { User } from '@/firebase/provider';
import { collection, query, doc, getDoc, setDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { logAuditEvent } from '@/lib/audit';
import { ShieldAlert, ShieldOff } from 'lucide-react';

interface Presence {
  id: string; // This is the Firebase Auth UID
  online: boolean;
  sessions?: string[]; // Array of unique session GUIDs
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

export function OnlineUsersManager({ allUsers, isUserLoading }: OnlineUsersManagerProps) {
  const firestore = useFirestore();
  const { user } = useAuth();
  const { toast } = useToast();
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

  // Activate single user mode - purge all sessions except current admin
  const activateSingleUserMode = async () => {
    if (!firestore || !user) return;
    setIsActivating(true);

    try {
      // Get all presence documents
      const presenceSnapshot = await getDocs(collection(firestore, 'presence'));

      // Batch update to purge all sessions
      const batch = writeBatch(firestore);
      let purgedCount = 0;

      presenceSnapshot.docs.forEach((presenceDoc) => {
        const presenceData = presenceDoc.data();
        // Purge sessions for everyone (including the admin - their session will be re-added on next action)
        if (presenceData.sessions && presenceData.sessions.length > 0) {
          batch.update(presenceDoc.ref, {
            sessions: [],
            online: false
          });
          purgedCount += presenceData.sessions.length;
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
        activatedBy: user.teamName,
      });

      toast({
        title: "Single User Mode Activated",
        description: `${purgedCount} session(s) have been purged. All other users are now disconnected.`,
      });

    } catch (error: any) {
      console.error('Failed to activate single user mode:', error);
      toast({
        variant: "destructive",
        title: "Activation Failed",
        description: error.message,
      });
    }

    setIsActivating(false);
  };

  // Deactivate single user mode
  const deactivateSingleUserMode = async () => {
    if (!firestore || !user) return;
    setIsActivating(true);

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
      toast({
        variant: "destructive",
        title: "Deactivation Failed",
        description: error.message,
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

    // Filter presence docs with active sessions
    const onlineUsers = allPresence.filter(p => p.sessions && p.sessions.length > 0);

    return onlineUsers.flatMap(presence => {
        const userDetail = allUsers.find(u => u.id === presence.id);
        if (!userDetail || !presence.sessions || presence.sessions.length === 0) {
            return [];
        }

        // For admins: show all sessions
        // For regular users: show only the first session (one entry per user)
        if (userDetail.isAdmin) {
            return presence.sessions.map(sessionId => ({
                ...userDetail,
                sessionId: sessionId,
            }));
        } else {
            // Only show the first session for non-admin users
            return [{
                ...userDetail,
                sessionId: presence.sessions[0],
            }];
        }
    });

  }, [allPresence, allUsers]);
  
  const isLoading = isUserLoading || isPresenceLoading;

  // Total session count (for display in title)
  const totalSessionCount = useMemo(() => {
    if (!allPresence) return 0;
    return allPresence
      .filter(p => p.sessions && p.sessions.length > 0)
      .reduce((acc, p) => acc + (p.sessions?.length || 0), 0);
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
                  <TableCell className="text-right">
                    <Skeleton className="h-6 w-16 ml-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : usersWithSessions.length > 0 ? (
              usersWithSessions.map((user) => (
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
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="text-green-500 border-green-500/50">
                      Online
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
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
