// GUID: ADMIN_AUDITLOG-000-v03
// [Intent] Admin component for viewing the system audit log of user activity and system events.
// [Inbound Trigger] Rendered on the admin Audit Logs tab; receives allUsers and loading state as props.
// [Downstream Impact] Reads from audit_logs Firestore collection; depends on User type from firebase/provider for user lookup.

'use client';

import { useMemo } from 'react';
import { useCollection, useFirestore } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format, formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { User } from '@/firebase/provider';

// GUID: ADMIN_AUDITLOG-001-v03
// [Intent] Type definition for an audit log document from the audit_logs Firestore collection.
// [Inbound Trigger] Used to type-check audit log data fetched by the Firestore query.
// [Downstream Impact] Schema changes to the audit_logs collection must be reflected here; affects log rendering.
interface AuditLog {
    id: string;
    userId: string;
    action: string;
    correlationId: string;
    timestamp: {
        seconds: number;
        nanoseconds: number;
    };
    details: any;
}

// GUID: ADMIN_AUDITLOG-002-v03
// [Intent] Props interface for AuditLogViewer, accepting pre-fetched user data to resolve user IDs to display names.
// [Inbound Trigger] Defined as the component's input contract; parent passes allUsers and loading state.
// [Downstream Impact] If allUsers is null or loading, user names will fall back to raw user IDs in the display.
interface AuditLogViewerProps {
    allUsers: User[] | null;
    isUserLoading: boolean;
}

// GUID: ADMIN_AUDITLOG-003-v03
// [Intent] Main exported component that displays the last 100 audit log entries with user resolution, action badges, and expandable details.
// [Inbound Trigger] Mounted by the admin page when the Audit Logs tab is active.
// [Downstream Impact] Reads from audit_logs Firestore collection (last 100, desc by timestamp). Depends on allUsers prop for user name resolution.
export function AuditLogViewer({ allUsers, isUserLoading }: AuditLogViewerProps) {
    const firestore = useFirestore();

    // GUID: ADMIN_AUDITLOG-004-v03
    // [Intent] Memoised Firestore query that fetches the 100 most recent audit logs ordered by timestamp descending.
    // [Inbound Trigger] Re-created only when the firestore instance changes.
    // [Downstream Impact] Provides the raw dataset for the audit log accordion list.
    const auditLogQuery = useMemo(() => {
        if (!firestore) return null;
        const q = query(collection(firestore, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
        (q as any).__memo = true;
        return q;
    }, [firestore]);

    const { data: auditLogs, isLoading: isAuditLoading, error } = useCollection<AuditLog>(auditLogQuery);

    const isLoading = isUserLoading || isAuditLoading;

    // GUID: ADMIN_AUDITLOG-005-v03
    // [Intent] Maps audit log action types to Badge variants for consistent visual styling.
    // [Inbound Trigger] Called for each audit log entry during rendering.
    // [Downstream Impact] Adding new action types may require updating this mapping for appropriate styling.
    const getActionVariant = (action: string) => {
        switch (action) {
            case 'permission_error': return 'destructive';
            case 'logout': return 'secondary';
            case 'navigate': return 'outline';
            default: return 'default';
        }
    }

    // GUID: ADMIN_AUDITLOG-006-v03
    // [Intent] Resolves a userId to a User object from the pre-fetched allUsers list for display name lookup.
    // [Inbound Trigger] Called for each audit log entry to display the user's team name instead of raw ID.
    // [Downstream Impact] If user not found, the raw userId is displayed as a fallback.
    const findUser = (userId: string): User | undefined => {
        return allUsers?.find(u => u.id === userId);
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Audit Logs</AlertTitle>
                <AlertDescription>
                    There was a problem fetching the audit logs. Please ensure you have the correct Firestore permissions.
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>System Audit Log</CardTitle>
                <CardDescription>A real-time log of user activity and system events (last 100 entries).</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[600px] border rounded-lg">
                    <Accordion type="single" collapsible className="w-full">
                        {isLoading ? (
                            <div className="p-4 space-y-4">
                                {Array.from({ length: 10 }).map((_, i) => (
                                    <Skeleton key={i} className="h-10 w-full" />
                                ))}
                            </div>
                        ) : auditLogs && auditLogs.length > 0 ? (
                            auditLogs.map((log) => {
                                const user = findUser(log.userId);
                                return (
                                    <AccordionItem value={log.id} key={log.id}>
                                        <AccordionTrigger className="p-4 hover:no-underline">
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex-1 text-left font-medium">{user?.teamName || log.userId}</div>
                                                <div className="flex-1 text-left">
                                                    <Badge variant={getActionVariant(log.action)}>{log.action.replace(/_/g, ' ')}</Badge>
                                                </div>
                                                <div className="flex-1 text-left">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger>
                                                                <span className="text-muted-foreground text-xs">{formatDistanceToNow(new Date(log.timestamp.seconds * 1000), { addSuffix: true })}</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>{format(new Date(log.timestamp.seconds * 1000), "MMM d, yyyy, h:mm:ss.SSS a")}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </div>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <div className="p-4 border-t bg-muted/50 space-y-4">
                                                <div>
                                                    <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Correlation ID</h4>
                                                    <p className="font-mono text-xs">{log.correlationId}</p>
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Details</h4>
                                                    <pre className="p-2 bg-background rounded-md text-xs overflow-auto">
                                                        <code>{JSON.stringify(log.details, null, 2)}</code>
                                                    </pre>
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                )
                            })
                        ) : (
                            <div className="text-center text-muted-foreground p-12">
                                No audit logs found or auditing may be disabled.
                            </div>
                        )}
                    </Accordion>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
