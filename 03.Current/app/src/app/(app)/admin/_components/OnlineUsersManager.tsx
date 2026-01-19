
'use client';

import { useMemo } from 'react';
import { useCollection, useFirestore } from '@/firebase';
import type { User } from '@/firebase/provider';
import { collection, query } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface Presence {
  id: string; // This is the Firebase Auth UID
  online: boolean;
  sessions?: string[]; // Array of unique session GUIDs
}

interface OnlineUsersManagerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

export function OnlineUsersManager({ allUsers, isUserLoading }: OnlineUsersManagerProps) {
  const firestore = useFirestore();
  
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
        // Create a row for each active session (GUID)
        return presence.sessions.map(sessionId => ({
            ...userDetail,
            sessionId: sessionId,
        }));
    });

  }, [allPresence, allUsers]);
  
  const isLoading = isUserLoading || isPresenceLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online User Sessions</CardTitle>
        <CardDescription>A real-time list of active user sessions (GUIDs).</CardDescription>
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
