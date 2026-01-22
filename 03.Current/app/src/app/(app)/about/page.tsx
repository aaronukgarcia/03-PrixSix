
'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Code, Server, Mail, Database, Waypoints } from "lucide-react";
import { useFirestore, useCollection } from '@/firebase';
import backendData from '@/../docs/backend.json';
import { collection, query } from 'firebase/firestore';
import { APP_VERSION } from '@/lib/version';

interface Presence {
  id: string;
  online: boolean;
  sessions?: string[];
  sessionActivity?: { [sessionId: string]: number };
}

// Sessions older than this are considered stale (matches OnlineUsersManager)
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const AboutPageClient = () => {
    const firestore = useFirestore();

    const allUsersQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'users'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: allUsers } = useCollection(allUsersQuery);
    
    // Query all presence documents
    const presenceQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'presence'));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: presenceDocs, isLoading } = useCollection<Presence>(presenceQuery);

    // Calculate total teams: primary teams + secondary teams
    const totalTeamsCount = useMemo(() => {
        if (!allUsers) return 0;
        // Count primary teams (all users) + secondary teams (users with secondaryTeamName)
        const secondaryTeamCount = allUsers.filter((u: any) => u.secondaryTeamName).length;
        return allUsers.length + secondaryTeamCount;
    }, [allUsers]);

    // Calculate total ACTIVE online sessions by checking sessionActivity timestamps.
    // Only count sessions that have been active within the timeout window.
    const onlineUserCount = useMemo(() => {
        if (!presenceDocs) return 0;
        const now = Date.now();

        return presenceDocs
            .filter(doc => doc.sessions && doc.sessions.length > 0)
            .reduce((acc, doc) => {
                if (!doc.sessions) return acc;

                // Count only sessions active within timeout window
                const activeSessions = doc.sessions.filter(sessionId => {
                    if (doc.sessionActivity) {
                        const lastActivity = doc.sessionActivity[sessionId];
                        return lastActivity && (now - lastActivity) < SESSION_TIMEOUT_MS;
                    }
                    return true; // Legacy sessions without activity tracking
                });

                return acc + activeSessions.length;
            }, 0);
    }, [presenceDocs]);

    const hld = backendData.firestore.reasoning;
    const lld = backendData.firestore.structure;

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight flex items-center gap-3">
                    About Prix Six
                    <span className="text-sm font-mono font-normal bg-primary/10 text-primary px-2 py-1 rounded-md">v{APP_VERSION}</span>
                </h1>
                <p className="text-muted-foreground">System architecture, documentation, and support.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Registered Teams</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalTeamsCount}</div>
                        <p className="text-xs text-muted-foreground">Total teams in the league (primary + secondary).</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Online Users</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : onlineUserCount}</div>
                        <p className="text-xs text-muted-foreground">Live count of active sessions.</p>
                    </CardContent>
                </Card>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Code className="h-6 w-6 text-primary"/>
                        Functional Specification
                    </CardTitle>
                    <CardDescription>A breakdown of the application architecture.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Server className="h-5 w-5 text-accent"/>High-Level Design (HLD)</h3>
                        <p className="text-muted-foreground whitespace-pre-wrap">{hld}</p>
                    </div>
                     <div>
                        <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><Database className="h-5 w-5 text-accent"/>Low-Level Design (LLD) - Firestore Structure</h3>
                        <div className="space-y-4">
                            {lld.map((item) => (
                                <div key={item.path} className="p-4 border rounded-lg">
                                    <h4 className="font-mono text-sm font-bold flex items-center gap-2"><Waypoints className="h-4 w-4"/> {item.path}</h4>
                                    <p className="text-sm text-muted-foreground mt-1 pl-6">{item.definition.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-6 w-6 text-primary"/>
                        Support
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">
                        For any questions or issues, please contact support at <a href="mailto:aaron@garcia.ltd" className="text-accent underline">aaron@garcia.ltd</a>.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
};

export default function AboutPage() {
    return <AboutPageClient />;
}
