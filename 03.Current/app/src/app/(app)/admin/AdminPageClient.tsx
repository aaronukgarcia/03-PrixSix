// GUID: PAGE_ADMIN-000-v04
// @SECURITY_FIX: Added NODE_ENV guard on console.error in requestAdminLink (GEMINI-AUDIT-080).
//   In production, raw error messages are no longer exposed in browser DevTools or admin UI.
// [Intent] Admin panel page — tabbed interface providing access to all league management tools.
//          Restricted to admin users; non-admins are redirected to /dashboard with audit logging.
// [Inbound Trigger] User navigates to /admin. Admin guard checks user.isAdmin.
// [Downstream Impact] Renders 16 admin tabs (Functions, Teams, Results, Scoring, Hot News, Online,
//                     Email Logs, Audit, WhatsApp, Standing, Feedback, CC, Errors, Backups, PubChat, Leagues).
//                     Fetches all users collection for tabs that need user data.

'use client'

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
  } from "@/components/ui/tabs";
import { ShieldCheck, Users, Trophy, SlidersHorizontal, Newspaper, Wifi, Mail, BookUser, ClipboardCheck, MessageSquare, Database, Bug, AlertTriangle, HardDrive, Beer, UsersRound, FileText, Activity } from 'lucide-react';
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
import { StandingDataManager } from "./_components/StandingDataManager";
import { FeedbackManager } from "./_components/FeedbackManager";
import { ErrorLogViewer } from "./_components/ErrorLogViewer";
// GUID: BACKUP_ADMIN_TAB-001-v03
// [Intent] Import BackupHealthDashboard component for the 14th admin tab.
// [Inbound Trigger] Admin page load (admin-only route guard above).
// [Downstream Impact] Renders the backup health cards in TabsContent value="backups".
import { BackupHealthDashboard } from "./_components/BackupHealthDashboard";
// GUID: PUBCHAT_ADMIN_TAB-001-v01
// [Intent] Import PubChatPanel component for the 15th admin tab.
// [Inbound Trigger] Admin page load (admin-only route guard above).
// [Downstream Impact] Renders PubChat animation + placeholder in TabsContent value="pubchat".
import { PubChatPanel } from "./_components/PubChatPanel";
// GUID: PAGE_ADMIN-001-v03
// [Intent] Import LeaguesManager for the 16th admin tab.
// [Inbound Trigger] Admin page load.
// [Downstream Impact] Renders leagues management UI in TabsContent value="leagues".
import { LeaguesManager } from "./_components/LeaguesManager";
// GUID: PAGE_ADMIN-BOOKOFWORK-001-v01
// [Intent] Import BookOfWorkManager for the 17th admin tab.
// [Inbound Trigger] Admin page load.
// [Downstream Impact] Renders centralized book of work management UI in TabsContent value="bookofwork".
import { BookOfWorkManager } from "./_components/BookOfWorkManager";
// GUID: PAGE_ADMIN-HEALTH-001-v01
// [Intent] Import InterfaceHealthMonitor for the 18th admin tab (Health monitoring).
// [Inbound Trigger] Admin page load.
// [Downstream Impact] Renders RAG health status for PubChat, WhatsApp, and Email interfaces.
import { InterfaceHealthMonitor } from "./_components/InterfaceHealthMonitor";
// GUID: PAGE_ADMIN-002-v03
// [Intent] Import AttackMonitor component for security monitoring displayed above the tabs.
// [Inbound Trigger] Admin page load.
// [Downstream Impact] Renders rate-limiting and attack detection alerts at the top of the admin panel.
import { AttackMonitor } from "./_components/AttackMonitor";
import { useAuth, useCollection, useFirestore } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, query } from "firebase/firestore";
import type { User } from "@/firebase/provider";
import { logAuditEvent } from "@/lib/audit";
import { ERROR_CODES, generateClientCorrelationId } from "@/lib/error-codes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ShieldAlert, Loader2 } from "lucide-react";

// GUID: PAGE_ADMIN-003-v05
// [Intent] Admin panel CLIENT component — enforces admin-only access, fetches all users,
//          and renders the tabbed admin interface with 16 management panels.
//          Receives server-verified admin status as prop for security.
// [Inbound Trigger] Rendered by server component wrapper that reads httpOnly cookie.
// [Downstream Impact] Non-admin users trigger ACCESS_DENIED audit event and redirect to /dashboard.
//                     Admin users see full tabbed interface with all management tools.
interface AdminPageClientProps {
    initialVerified: boolean;
}

export default function AdminPageClient({ initialVerified }: AdminPageClientProps) {
    const { user, firebaseUser, isUserLoading: isAuthLoading } = useAuth();
    const router = useRouter();
    const firestore = useFirestore();

    // GUID: PAGE_ADMIN-HOTLINK-001-v05
    // [Intent] Admin Hot Link verification state management. Receives initial verification
    //          status from server component (secure httpOnly cookie check) as prop.
    // [Inbound Trigger] initialVerified prop from server component wrapper.
    // [Downstream Impact] Controls rendering of verification gate vs admin panel.
    //                     Resolves ADMINCOMP-003 (client-side admin bypass) via server-side check.
    const [adminVerified, setAdminVerified] = useState<boolean | null>(initialVerified);
    const [isRequestingLink, setIsRequestingLink] = useState(false);
    const [linkRequestStatus, setLinkRequestStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string>('');

    // GUID: PAGE_ADMIN-004-v03
    // [Intent] Memoised Firestore query for all users — only created when user is confirmed admin AND verified.
    // [Inbound Trigger] firestore, user.isAdmin, or adminVerified changes.
    // [Downstream Impact] Provides allUsers data to TeamManager, OnlineUsersManager, AuditLogViewer,
    //                     ConsistencyChecker, and LeaguesManager tabs.
    const allUsersQuery = useMemo(() => {
        if (!firestore || !user?.isAdmin || !adminVerified) return null;
        const q = query(collection(firestore, 'users'));
        (q as any).__memo = true;
        return q;
    }, [firestore, user?.isAdmin, adminVerified]);

    const { data: allUsers, isLoading: isUsersLoading } = useCollection<User>(allUsersQuery);
    const isUserLoading = isAuthLoading || isUsersLoading;
    const accessDeniedLogged = useRef(false);

    // GUID: PAGE_ADMIN-005-v04
    // [Intent] Admin access guard — redirects non-admin users to /dashboard and logs an
    //          ACCESS_DENIED audit event (once per session via ref flag).
    // [Inbound Trigger] Auth loading completes and user is not an admin.
    // [Downstream Impact] Writes to audit_logs collection. Navigates to /dashboard.
    //                     Updated to v04: Now runs BEFORE adminVerified check.
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

    // GUID: PAGE_ADMIN-HOTLINK-003-v04
    // @SECURITY_FIX: Added NODE_ENV guard on console.error — production no longer exposes raw
    //   error objects in browser DevTools. Also sanitizes errorMsg displayed in UI (GEMINI-AUDIT-080).
    // [Intent] Request admin hot link (magic link) from the server.
    // [Inbound Trigger] User clicks "Send Verification Link" button.
    // [Downstream Impact] Calls POST /api/auth/admin-challenge, sends email with magic link.
    const requestAdminLink = async () => {
        if (!firebaseUser) return;

        setIsRequestingLink(true);
        setLinkRequestStatus('idle');
        setErrorMessage('');

        const correlationId = generateClientCorrelationId();

        try {
            const response = await fetch('/api/auth/admin-challenge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${await firebaseUser.getIdToken()}`,
                },
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to request verification link');
            }

            setLinkRequestStatus('success');
        } catch (error) {
            // SECURITY: Only log raw error details in development (GEMINI-AUDIT-080)
            if (process.env.NODE_ENV !== 'production') {
                console.error('Failed to request admin link:', error);
            }

            // Log error to server (fire-and-forget)
            fetch('/api/log-client-error', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    correlationId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    errorCode: ERROR_CODES.AUTH_ADMIN_VERIFICATION_FAILED.code,
                    context: {
                        component: 'AdminPage',
                        function: 'requestAdminLink',
                        userId: user?.uid
                    }
                })
            }).catch(() => {}); // Silent fail on logging error

            setLinkRequestStatus('error');
            // SECURITY: In production, show generic message — not raw error internals (GEMINI-AUDIT-080)
            const errorMsg = error instanceof Error
                ? (process.env.NODE_ENV !== 'production' ? error.message : 'Please try again or contact support')
                : 'Failed to send verification link';
            setErrorMessage(`${ERROR_CODES.AUTH_ADMIN_VERIFICATION_FAILED.code}: ${errorMsg} (Ref: ${correlationId})`);
        } finally {
            setIsRequestingLink(false);
        }
    };

    // GUID: PAGE_ADMIN-006-v04
    // [Intent] Loading/access-denied guard render — shows "Verifying access..." while auth loads
    //          or if user is not admin (before redirect completes).
    // [Inbound Trigger] isAuthLoading is true or user.isAdmin is false.
    // [Downstream Impact] Prevents rendering of admin tabs until access is confirmed.
    //                     Updated to v04: Now also checks adminVerified state.
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

    // GUID: PAGE_ADMIN-HOTLINK-004-v03
    // [Intent] Admin Hot Link verification gate — shows "Verification Required" UI if admin
    //          user has not verified via magic link. Prevents ADMINCOMP-003 (client-side bypass).
    // [Inbound Trigger] User is admin but adminVerified cookie is not set.
    // [Downstream Impact] Blocks access to admin panel until magic link is clicked.
    //                     Resolves ADMINCOMP-003 by requiring server-verified token exchange.
    if (adminVerified === false) {
        return (
            <div className="space-y-6">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">Admin Panel</h1>
                    <p className="text-muted-foreground">Multi-factor verification required</p>
                </div>

                <Card className="border-amber-500/50 bg-amber-50/10">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <ShieldAlert className="w-6 h-6 text-amber-500" />
                            <CardTitle>Verification Required</CardTitle>
                        </div>
                        <CardDescription>
                            For security, admin panel access requires email verification.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {linkRequestStatus === 'idle' && (
                            <div className="space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    Click the button below to receive a verification link at <strong>{user.email}</strong>.
                                    The link will expire in 10 minutes.
                                </p>
                                <Button
                                    onClick={requestAdminLink}
                                    disabled={isRequestingLink}
                                    className="w-full sm:w-auto"
                                >
                                    {isRequestingLink ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Sending verification link...
                                        </>
                                    ) : (
                                        <>
                                            <Mail className="w-4 h-4 mr-2" />
                                            Send Verification Link
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}

                        {linkRequestStatus === 'success' && (
                            <div className="space-y-3 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-md">
                                <div className="flex items-start gap-2">
                                    <Mail className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-green-900 dark:text-green-100">
                                            Verification link sent!
                                        </p>
                                        <p className="text-sm text-green-700 dark:text-green-300">
                                            Check your email at <strong>{user.email}</strong> and click the verification link.
                                            The link will expire in 10 minutes.
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                                            This page will automatically update once you verify.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {linkRequestStatus === 'error' && (
                            <div className="space-y-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md">
                                <div className="flex items-start gap-2">
                                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-red-900 dark:text-red-100">
                                            Failed to send verification link
                                        </p>
                                        <p className="text-sm text-red-700 dark:text-red-300 select-all cursor-text font-mono">
                                            {errorMessage}
                                        </p>
                                        <Button
                                            onClick={requestAdminLink}
                                            variant="outline"
                                            size="sm"
                                            disabled={isRequestingLink}
                                        >
                                            Try again
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="text-xs text-muted-foreground border-t pt-4">
                            <p>
                                <strong>Why is this required?</strong> Admin panel access uses multi-factor
                                verification to prevent unauthorized access. You must verify via email each session.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // GUID: PAGE_ADMIN-HOTLINK-005-v03
    // [Intent] Show loading state while adminVerified state is being determined.
    // [Inbound Trigger] adminVerified is null (cookie check in progress).
    // [Downstream Impact] Prevents flash of admin panel before verification check completes.
    if (adminVerified === null) {
        return (
            <div className="space-y-6">
                <div className="space-y-1">
                    <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">Admin Panel</h1>
                    <p className="text-muted-foreground">Checking verification status...</p>
                </div>
            </div>
        );
    }

    // GUID: PAGE_ADMIN-007-v03
    // [Intent] Main admin panel render — AttackMonitor at top, then 16-tab interface covering
    //          all league management functions. Each tab mounts its manager component on activation.
    // [Inbound Trigger] User is confirmed admin and auth loading is complete.
    // [Downstream Impact] Each tab renders its respective manager component. Several tabs receive
    //                     allUsers and isUserLoading props for user-related operations.
    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-headline font-bold tracking-tight">Admin Panel</h1>
                <p className="text-muted-foreground">Manage the Prix Six league.</p>
            </div>
            <AttackMonitor />
            <Tabs defaultValue="functions" className="space-y-4">
                <TabsList className="grid w-full grid-cols-4 sm:grid-cols-8 lg:grid-cols-16">
                    <TabsTrigger value="functions" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"><ShieldCheck className="w-4 h-4 mr-2"/>Functions</TabsTrigger>
                    <TabsTrigger value="teams" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white"><Users className="w-4 h-4 mr-2"/>Teams</TabsTrigger>
                    <TabsTrigger value="results" className="data-[state=active]:bg-amber-500 data-[state=active]:text-white"><Trophy className="w-4 h-4 mr-2"/>Enter Results</TabsTrigger>
                    <TabsTrigger value="scoring" className="data-[state=active]:bg-orange-500 data-[state=active]:text-white"><SlidersHorizontal className="w-4 h-4 mr-2"/>Scoring</TabsTrigger>
                    <TabsTrigger value="news" className="data-[state=active]:bg-pink-500 data-[state=active]:text-white"><Newspaper className="w-4 h-4 mr-2"/>Hot News</TabsTrigger>
                    <TabsTrigger value="online" className="data-[state=active]:bg-cyan-500 data-[state=active]:text-white"><Wifi className="w-4 h-4 mr-2"/>Online</TabsTrigger>
                    <TabsTrigger value="emails" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white"><Mail className="w-4 h-4 mr-2"/>Email Logs</TabsTrigger>
                    <TabsTrigger value="audit" className="data-[state=active]:bg-slate-600 data-[state=active]:text-white"><BookUser className="w-4 h-4 mr-2"/>Audit</TabsTrigger>
                    <TabsTrigger value="whatsapp" className="data-[state=active]:bg-green-600 data-[state=active]:text-white"><MessageSquare className="w-4 h-4 mr-2"/>WhatsApp</TabsTrigger>
                    <TabsTrigger value="standing" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><Database className="w-4 h-4 mr-2"/>Standing</TabsTrigger>
                    <TabsTrigger value="feedback" className="data-[state=active]:bg-rose-500 data-[state=active]:text-white"><Bug className="w-4 h-4 mr-2"/>Feedback</TabsTrigger>
                    <TabsTrigger value="consistency" className="data-[state=active]:bg-teal-500 data-[state=active]:text-white"><ClipboardCheck className="w-4 h-4 mr-2"/>CC</TabsTrigger>
                    <TabsTrigger value="errors" className="data-[state=active]:bg-red-600 data-[state=active]:text-white"><AlertTriangle className="w-4 h-4 mr-2"/>Errors</TabsTrigger>
                    {/* GUID: BACKUP_ADMIN_TAB-002-v03
                        [Intent] 14th tab trigger for the Backup Health dashboard. Sky-600 colour
                                 distinguishes it from other admin tabs. HardDrive icon signals storage/backup.
                        [Inbound Trigger] User clicks the "Backups" tab in the admin TabsList.
                        [Downstream Impact] Activates TabsContent value="backups" which mounts
                                            BackupHealthDashboard (BACKUP_DASHBOARD-010). */}
                    <TabsTrigger value="backups" className="data-[state=active]:bg-sky-600 data-[state=active]:text-white"><HardDrive className="w-4 h-4 mr-2"/>Backups</TabsTrigger>
                    {/* GUID: PUBCHAT_ADMIN_TAB-002-v01
                        [Intent] 15th tab trigger for the PubChat panel. Amber-500 colour
                                 matches pub/social theme. Beer icon signals social gathering.
                        [Inbound Trigger] User clicks the "PubChat" tab in the admin TabsList.
                        [Downstream Impact] Activates TabsContent value="pubchat" which mounts
                                            PubChatPanel (PUBCHAT_PANEL-001). */}
                    <TabsTrigger value="pubchat" className="data-[state=active]:bg-amber-500 data-[state=active]:text-white"><Beer className="w-4 h-4 mr-2"/>PubChat</TabsTrigger>
                    <TabsTrigger value="leagues" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white"><UsersRound className="w-4 h-4 mr-2"/>Leagues</TabsTrigger>
                    {/* GUID: PAGE_ADMIN-BOOKOFWORK-002-v01
                        [Intent] 17th tab trigger for the Book of Work centralized issue tracker. Amber-600 colour
                                 distinguishes it as a work management tool. FileText icon signals documentation/tracking.
                        [Inbound Trigger] User clicks the "Book of Work" tab in the admin TabsList.
                        [Downstream Impact] Activates TabsContent value="bookofwork" which mounts
                                            BookOfWorkManager (ADMIN_BOOKOFWORK-000). */}
                    <TabsTrigger value="bookofwork" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white"><FileText className="w-4 h-4 mr-2"/>Book of Work</TabsTrigger>
                    {/* GUID: PAGE_ADMIN-HEALTH-002-v01
                        [Intent] 18th tab trigger for Interface Health monitoring. Green-600 colour
                                 signals health/status checking. Activity icon indicates real-time monitoring.
                        [Inbound Trigger] User clicks the "Health" tab in the admin TabsList.
                        [Downstream Impact] Activates TabsContent value="health" which mounts
                                            InterfaceHealthMonitor (ADMIN_INTERFACE_HEALTH-001). */}
                    <TabsTrigger value="health" className="data-[state=active]:bg-green-600 data-[state=active]:text-white"><Activity className="w-4 h-4 mr-2"/>Health</TabsTrigger>
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
                <TabsContent value="standing">
                    <StandingDataManager />
                </TabsContent>
                <TabsContent value="feedback">
                    <FeedbackManager />
                </TabsContent>
                <TabsContent value="consistency">
                    <ConsistencyChecker allUsers={allUsers} isUserLoading={isUserLoading} />
                </TabsContent>
                <TabsContent value="errors">
                    <ErrorLogViewer />
                </TabsContent>
                {/* GUID: BACKUP_ADMIN_TAB-003-v03
                    [Intent] Mount the BackupHealthDashboard when the Backups tab is active.
                    [Inbound Trigger] TabsTrigger value="backups" selected (BACKUP_ADMIN_TAB-002).
                    [Downstream Impact] BackupHealthDashboard subscribes to backup_status/latest
                                        via useDoc (BACKUP_DASHBOARD-011) and renders three status cards. */}
                <TabsContent value="backups">
                    <BackupHealthDashboard />
                </TabsContent>
                {/* GUID: PUBCHAT_ADMIN_TAB-003-v01
                    [Intent] Mount the PubChatPanel when the PubChat tab is active.
                    [Inbound Trigger] TabsTrigger value="pubchat" selected (PUBCHAT_ADMIN_TAB-002).
                    [Downstream Impact] PubChatPanel renders ThePaddockPubChat animation and
                                        placeholder card for future body content (PUBCHAT_PANEL-001). */}
                <TabsContent value="pubchat">
                    <PubChatPanel />
                </TabsContent>
                <TabsContent value="leagues">
                    <LeaguesManager allUsers={allUsers} isUserLoading={isUserLoading} />
                </TabsContent>
                {/* GUID: PAGE_ADMIN-BOOKOFWORK-003-v01
                    [Intent] Mount the BookOfWorkManager when the Book of Work tab is active.
                    [Inbound Trigger] TabsTrigger value="bookofwork" selected (PAGE_ADMIN-BOOKOFWORK-002).
                    [Downstream Impact] BookOfWorkManager subscribes to book_of_work collection
                                        via onSnapshot (ADMIN_BOOKOFWORK-007) and renders centralized
                                        issue tracking interface consolidating security audits, UX findings,
                                        error logs, and feedback into single management view. */}
                <TabsContent value="bookofwork">
                    <BookOfWorkManager />
                </TabsContent>
                {/* GUID: PAGE_ADMIN-HEALTH-003-v01
                    [Intent] Mount the InterfaceHealthMonitor when the Health tab is active.
                    [Inbound Trigger] TabsTrigger value="health" selected (PAGE_ADMIN-HEALTH-002).
                    [Downstream Impact] InterfaceHealthMonitor displays RAG health status for PubChat,
                                        WhatsApp, and Email interfaces (ADMIN_INTERFACE_HEALTH-001). */}
                <TabsContent value="health">
                    <InterfaceHealthMonitor />
                </TabsContent>
            </Tabs>
      </div>
    );
  }
