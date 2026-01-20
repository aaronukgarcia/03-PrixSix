
'use client'

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
  } from "@/components/ui/tabs";
import { ShieldCheck, Users, Trophy, SlidersHorizontal, Newspaper, Wifi, Mail, BookUser, ClipboardCheck, MessageSquare } from 'lucide-react';
import { HotNewsManager } from "./_components/HotNewsManager";
import { SiteFunctionsManager } from "./_components/SiteFunctionsManager";
import { TeamManager } from "./_components/TeamManager";
import { ResultsManager } from "./_components/ResultsManager";
import { ScoringManager } from "./_components/ScoringManager";
import { OnlineUsersManager } from "./_components/OnlineUsersManager";
import { EmailLogManager } from "./_components/EmailLogManager";
import { AuditManager } from "./_components/AuditManager";
import { AuditLogViewer } from "./_components/AuditLogViewer";
import { ConsistencyChecker } from "./_components/ConsistencyChecker";
import { WhatsAppManager } from "./_components/WhatsAppManager";
import { useAuth, useCollection, useFirestore } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { collection, query } from "firebase/firestore";
import type { User } from "@/firebase/provider";
import { logAuditEvent } from "@/lib/audit";
  
export default function AdminPage() {
    const { user, isUserLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const firestore = useFirestore();

    const allUsersQuery = useMemo(() => {
        if (!firestore || !user?.isAdmin) return null;
        const q = query(collection(firestore, 'users'));
        (q as any).__memo = true;
        return q;
    }, [firestore, user?.isAdmin]);

    const { data: allUsers, isLoading: isUsersLoading } = useCollection<User>(allUsersQuery);
    const isUserLoading = isAuthLoading || isUsersLoading;
    const accessDeniedLogged = useRef(false);

    useEffect(() => {
        // If loading is done and the user is not an admin, redirect them.
        if (!isAuthLoading && user && !user.isAdmin) {
            // Log ACCESS_DENIED audit event (only once)
            if (firestore && !accessDeniedLogged.current) {
                accessDeniedLogged.current = true;
                logAuditEvent(firestore, user.id, 'ACCESS_DENIED', {
                    attemptedResource: '/admin',
                    reason: 'User is not an admin',
                });
            }
            router.push('/dashboard');
        }
    }, [user, isAuthLoading, router, firestore]);

    // Render a loading state or nothing while checking permissions
    if (isAuthLoading || !user?.isAdmin) {
        return (
            <div className="space-y-6">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">Admin Panel</h1>
                    <p className="text-muted-foreground">Verifying access...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">Admin Panel</h1>
                <p className="text-muted-foreground">Manage the Prix Six league.</p>
            </div>
            <Tabs defaultValue="functions" className="space-y-4">
                <TabsList className="grid w-full grid-cols-5 sm:grid-cols-10">
                    <TabsTrigger value="functions"><ShieldCheck className="w-4 h-4 mr-2"/>Functions</TabsTrigger>
                    <TabsTrigger value="teams"><Users className="w-4 h-4 mr-2"/>Teams</TabsTrigger>
                    <TabsTrigger value="results"><Trophy className="w-4 h-4 mr-2"/>Enter Results</TabsTrigger>
                    <TabsTrigger value="scoring"><SlidersHorizontal className="w-4 h-4 mr-2"/>Scoring</TabsTrigger>
                    <TabsTrigger value="news"><Newspaper className="w-4 h-4 mr-2"/>Hot News</TabsTrigger>
                    <TabsTrigger value="online"><Wifi className="w-4 h-4 mr-2"/>Online</TabsTrigger>
                    <TabsTrigger value="emails"><Mail className="w-4 h-4 mr-2"/>Email Logs</TabsTrigger>
                    <TabsTrigger value="audit"><BookUser className="w-4 h-4 mr-2"/>Audit</TabsTrigger>
                    <TabsTrigger value="whatsapp"><MessageSquare className="w-4 h-4 mr-2"/>WhatsApp</TabsTrigger>
                    <TabsTrigger value="consistency"><ClipboardCheck className="w-4 h-4 mr-2"/>CC</TabsTrigger>
                </TabsList>
                <TabsContent value="functions">
                    <SiteFunctionsManager />
                </TabsContent>
                 <TabsContent value="teams">
                    <TeamManager allUsers={allUsers} isUserLoading={isUserLoading} />
                </TabsContent>
                 <TabsContent value="results">
                    <ResultsManager />
                </TabsContent>
                 <TabsContent value="scoring">
                    <ScoringManager />
                </TabsContent>
                 <TabsContent value="news">
                    <HotNewsManager />
                </TabsContent>
                <TabsContent value="online">
                    <OnlineUsersManager allUsers={allUsers} isUserLoading={isUserLoading} />
                </TabsContent>
                <TabsContent value="emails">
                    <EmailLogManager />
                </TabsContent>
                <TabsContent value="audit" className="space-y-4">
                    <AuditManager />
                    <AuditLogViewer allUsers={allUsers} isUserLoading={isUserLoading} />
                </TabsContent>
                <TabsContent value="whatsapp">
                    <WhatsAppManager />
                </TabsContent>
                <TabsContent value="consistency">
                    <ConsistencyChecker allUsers={allUsers} isUserLoading={isUserLoading} />
                </TabsContent>
            </Tabs>
      </div>
    );
  }
