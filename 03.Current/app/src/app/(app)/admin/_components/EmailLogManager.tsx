// GUID: ADMIN_EMAILLOG-000-v03
// [Intent] Admin component for managing the email queue (push, resend, delete) and viewing historical email send logs.
// [Inbound Trigger] Rendered on the admin Email Logs tab.
// [Downstream Impact] Reads from email_logs and email_queue Firestore collections via API; sends/deletes queued emails via /api/email-queue.

'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useCollection, useFirestore, useAuth } from '@/firebase';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Mail, Send, Trash2, RefreshCw, RotateCcw, Clock, XCircle } from 'lucide-react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// GUID: ADMIN_EMAILLOG-001-v03
// [Intent] Type definition for a historical email log document from the email_logs Firestore collection.
// [Inbound Trigger] Used to type-check email log data in the email send log list.
// [Downstream Impact] Schema changes to email_logs collection must be reflected here; affects log rendering.
interface EmailLog {
    id: string;
    to: string;
    subject: string;
    html: string;
    pin: string;
    status: 'queued' | 'sent' | 'failed' | 'pin_used' | 'pin_unused';
    timestamp: {
        seconds: number;
        nanoseconds: number;
    };
}

// GUID: ADMIN_EMAILLOG-002-v03
// [Intent] Type definition for a queued email document from the email_queue collection, including retry state.
// [Inbound Trigger] Used to type-check queued email data fetched via the /api/email-queue endpoint.
// [Downstream Impact] Schema changes to the email_queue collection or API response must be reflected here.
interface QueuedEmail {
    id: string;
    toEmail: string;
    subject: string;
    htmlContent: string;
    type: string;
    teamName?: string;
    status: 'pending' | 'sent' | 'failed';
    reason: string;
    queuedAt?: any;
    retryCount?: number;
    nextRetryAt?: { seconds: number; nanoseconds: number } | null;
    lastError?: string;
}

// GUID: ADMIN_EMAILLOG-003-v03
// [Intent] Main exported component providing email queue management (push/resend/delete) and historical email log viewing.
// [Inbound Trigger] Mounted by the admin page when the Email Logs tab is active; requires admin user.
// [Downstream Impact] Calls /api/email-queue for queue operations; reads email_logs collection for history. Queue actions trigger actual email sends via Microsoft Graph.
export function EmailLogManager() {
    const firestore = useFirestore();
    const { user } = useAuth();
    const { toast } = useToast();
    const [queuedEmails, setQueuedEmails] = useState<QueuedEmail[]>([]);
    const [isLoadingQueue, setIsLoadingQueue] = useState(false);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    const [isProcessingAll, setIsProcessingAll] = useState(false);
    const [isDeletingAll, setIsDeletingAll] = useState(false);
    const [isResendingAll, setIsResendingAll] = useState(false);

    // GUID: ADMIN_EMAILLOG-004-v03
    // [Intent] Fetches all queued emails (including failed) from the /api/email-queue endpoint.
    // [Inbound Trigger] Called on component mount (if admin), after each queue action, and on manual refresh.
    // [Downstream Impact] Populates the queuedEmails state that drives the queue management table.
    // Fetch all emails including failed ones
    const fetchQueuedEmails = useCallback(async () => {
        setIsLoadingQueue(true);
        try {
            const response = await fetch('/api/email-queue?includeAll=true');
            const data = await response.json();
            if (data.success) {
                setQueuedEmails(data.emails);
            }
        } catch (error) {
            console.error('Error fetching email queue:', error);
        } finally {
            setIsLoadingQueue(false);
        }
    }, []);

    // GUID: ADMIN_EMAILLOG-005-v03
    // [Intent] Triggers the initial fetch of queued emails when the admin user is confirmed.
    // [Inbound Trigger] Runs when user.isAdmin becomes true or fetchQueuedEmails reference changes.
    // [Downstream Impact] Without this effect, the queue table would remain empty on first load.
    useEffect(() => {
        if (user?.isAdmin) {
            fetchQueuedEmails();
        }
    }, [user?.isAdmin, fetchQueuedEmails]);

    // GUID: ADMIN_EMAILLOG-006-v03
    // [Intent] Sends a single queued email immediately via the /api/email-queue push action.
    // [Inbound Trigger] Called when the admin clicks the send button on a pending queued email row.
    // [Downstream Impact] Triggers email delivery via Microsoft Graph; refreshes the queue list on completion.
    const handlePushEmail = async (emailId: string) => {
        setProcessingIds(prev => new Set(prev).add(emailId));
        try {
            const response = await fetch('/api/email-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'push', emailIds: [emailId] }),
            });
            const data = await response.json();
            if (data.success) {
                toast({ title: 'Email Sent', description: 'The queued email has been sent.' });
                fetchQueuedEmails();
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: data.error });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(emailId);
                return next;
            });
        }
    };

    // GUID: ADMIN_EMAILLOG-007-v03
    // [Intent] Re-queues a single failed email for another round of retry attempts.
    // [Inbound Trigger] Called when the admin clicks the resend button on a failed email row.
    // [Downstream Impact] Resets the email's status to pending in the queue; it will be retried up to 3 times.
    const handleResendEmail = async (emailId: string) => {
        setProcessingIds(prev => new Set(prev).add(emailId));
        try {
            const response = await fetch('/api/email-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'resend', emailIds: [emailId] }),
            });
            const data = await response.json();
            if (data.success) {
                toast({ title: 'Email Re-queued', description: 'The failed email has been re-queued for sending.' });
                fetchQueuedEmails();
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: data.error });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(emailId);
                return next;
            });
        }
    };

    // GUID: ADMIN_EMAILLOG-008-v03
    // [Intent] Deletes a single queued email from the queue, discarding it permanently.
    // [Inbound Trigger] Called when the admin clicks the delete button on a queued email row.
    // [Downstream Impact] Removes the email document from the email_queue collection; email will never be sent.
    const handleDeleteEmail = async (emailId: string) => {
        setProcessingIds(prev => new Set(prev).add(emailId));
        try {
            const response = await fetch('/api/email-queue', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailIds: [emailId] }),
            });
            const data = await response.json();
            if (data.success) {
                toast({ title: 'Email Deleted', description: 'The queued email has been removed.' });
                fetchQueuedEmails();
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: data.error });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(emailId);
                return next;
            });
        }
    };

    // GUID: ADMIN_EMAILLOG-009-v03
    // [Intent] Pushes all pending queued emails for immediate sending in a single batch operation.
    // [Inbound Trigger] Called when the admin clicks the "Push All" button.
    // [Downstream Impact] Triggers email delivery for all pending emails; may result in multiple Microsoft Graph API calls.
    const handlePushAll = async () => {
        setIsProcessingAll(true);
        try {
            const response = await fetch('/api/email-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'push' }),
            });
            const data = await response.json();
            if (data.success) {
                toast({ title: 'Emails Sent', description: data.message });
                fetchQueuedEmails();
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: data.error });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsProcessingAll(false);
        }
    };

    // GUID: ADMIN_EMAILLOG-010-v03
    // [Intent] Re-queues all failed emails for another round of retry attempts in a single batch operation.
    // [Inbound Trigger] Called when the admin clicks the "Resend Failed" button.
    // [Downstream Impact] Resets all failed emails to pending status; each will be retried up to 3 times.
    const handleResendAllFailed = async () => {
        const failedIds = queuedEmails.filter(e => e.status === 'failed').map(e => e.id);
        if (failedIds.length === 0) return;

        setIsResendingAll(true);
        try {
            const response = await fetch('/api/email-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'resend', emailIds: failedIds }),
            });
            const data = await response.json();
            if (data.success) {
                toast({ title: 'Emails Re-queued', description: data.message });
                fetchQueuedEmails();
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: data.error });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsResendingAll(false);
        }
    };

    // GUID: ADMIN_EMAILLOG-011-v03
    // [Intent] Deletes all emails from the queue, clearing it entirely.
    // [Inbound Trigger] Called when the admin clicks the "Delete All" button.
    // [Downstream Impact] Permanently removes all email_queue documents; no queued emails will be sent.
    const handleDeleteAll = async () => {
        setIsDeletingAll(true);
        try {
            const response = await fetch('/api/email-queue', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (data.success) {
                toast({ title: 'Queue Cleared', description: data.message });
                fetchQueuedEmails();
            } else {
                toast({ variant: 'destructive', title: 'Failed', description: data.error });
            }
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsDeletingAll(false);
        }
    };

    // GUID: ADMIN_EMAILLOG-012-v03
    // [Intent] Memoised Firestore query for historical email send logs ordered by timestamp descending.
    // [Inbound Trigger] Re-created when firestore or user changes; only active when user is admin.
    // [Downstream Impact] Provides the dataset for the "Email Send Logs" card below the queue management section.
    const emailLogQuery = useMemo(() => {
        if (!firestore || !user?.isAdmin) return null;
        const q = query(collection(firestore, 'email_logs'), orderBy('timestamp', 'desc'));
        (q as any).__memo = true;
        return q;
    }, [firestore, user]);

    const { data: emailLogs, isLoading, error } = useCollection<EmailLog>(emailLogQuery);

    // GUID: ADMIN_EMAILLOG-013-v03
    // [Intent] Maps an email log status to a Badge variant for consistent visual status representation.
    // [Inbound Trigger] Called for each email log row to determine badge styling.
    // [Downstream Impact] Adding new email statuses requires updating this mapping.
    const getStatusVariant = (status: EmailLog['status']) => {
        switch (status) {
            case 'sent':
            case 'pin_used':
                return 'default';
            case 'queued':
                return 'secondary';
            case 'failed':
            case 'pin_unused':
                return 'destructive';
            default:
                return 'outline';
        }
    }

    // GUID: ADMIN_EMAILLOG-014-v03
    // [Intent] Renders a status badge for a queued email, showing failed state, retry count, or pending.
    // [Inbound Trigger] Called for each row in the email queue table.
    // [Downstream Impact] Visual-only; no downstream logic depends on this output.
    const getQueueStatusBadge = (email: QueuedEmail) => {
        if (email.status === 'failed') {
            return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Failed</Badge>;
        }
        if (email.status === 'pending' && email.retryCount && email.retryCount > 0) {
            return (
                <Badge variant="secondary" className="gap-1">
                    <Clock className="h-3 w-3" />
                    Retry {email.retryCount}/3
                </Badge>
            );
        }
        return <Badge variant="outline">Pending</Badge>;
    };

    // GUID: ADMIN_EMAILLOG-015-v03
    // [Intent] Computes counts of pending and failed emails for display in the header and button labels.
    // [Inbound Trigger] Recalculated on every render when queuedEmails state changes.
    // [Downstream Impact] Drives the pending/failed counts shown in the card title and on the Push All / Resend Failed buttons.
    // Count emails by status
    const pendingCount = queuedEmails.filter(e => e.status === 'pending').length;
    const failedCount = queuedEmails.filter(e => e.status === 'failed').length;

    if (!user?.isAdmin) {
        return (
             <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Access Denied</AlertTitle>
                <AlertDescription>
                    You do not have permission to view email logs.
                </AlertDescription>
            </Alert>
        )
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Email Logs</AlertTitle>
                <AlertDescription>
                    There was a problem fetching the email logs. Please ensure you have the correct Firestore permissions.
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <TooltipProvider>
        <div className="space-y-6">
            {/* Email Queue Management */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Mail className="h-5 w-5" />
                                Email Queue
                                {(pendingCount > 0 || failedCount > 0) && (
                                    <span className="text-sm font-normal text-muted-foreground">
                                        ({pendingCount} pending, {failedCount} failed)
                                    </span>
                                )}
                            </CardTitle>
                            <CardDescription>
                                Manage emails waiting to be sent. Failed emails can be re-queued for another 3 attempts.
                            </CardDescription>
                        </div>
                        <div className="flex gap-2 flex-wrap justify-end">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchQueuedEmails}
                                disabled={isLoadingQueue}
                            >
                                <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingQueue ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                            <Button
                                variant="default"
                                size="sm"
                                onClick={handlePushAll}
                                disabled={isProcessingAll || pendingCount === 0}
                            >
                                <Send className="h-4 w-4 mr-1" />
                                {isProcessingAll ? 'Sending...' : `Push All (${pendingCount})`}
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleResendAllFailed}
                                disabled={isResendingAll || failedCount === 0}
                            >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                {isResendingAll ? 'Re-queuing...' : `Resend Failed (${failedCount})`}
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleDeleteAll}
                                disabled={isDeletingAll || queuedEmails.length === 0}
                            >
                                <Trash2 className="h-4 w-4 mr-1" />
                                {isDeletingAll ? 'Deleting...' : 'Delete All'}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Status</TableHead>
                                <TableHead>Recipient</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Team</TableHead>
                                <TableHead>Error / Reason</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingQueue ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                                        <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                                    </TableRow>
                                ))
                            ) : queuedEmails.length > 0 ? (
                                queuedEmails.map((email) => (
                                    <TableRow key={email.id} className={email.status === 'failed' ? 'bg-destructive/5' : ''}>
                                        <TableCell>{getQueueStatusBadge(email)}</TableCell>
                                        <TableCell className="font-mono text-sm">{email.toEmail}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{email.type}</Badge>
                                        </TableCell>
                                        <TableCell>{email.teamName || '-'}</TableCell>
                                        <TableCell className="text-muted-foreground text-sm max-w-[200px]">
                                            {email.status === 'failed' && email.lastError ? (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="text-destructive truncate block cursor-help">
                                                            {email.lastError}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="max-w-sm">
                                                        <p>{email.lastError}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            ) : (
                                                <span className="truncate block">{email.reason}</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                {email.status === 'failed' ? (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleResendEmail(email.id)}
                                                                disabled={processingIds.has(email.id)}
                                                                className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                            >
                                                                <RotateCcw className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Re-queue for sending</TooltipContent>
                                                    </Tooltip>
                                                ) : (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handlePushEmail(email.id)}
                                                                disabled={processingIds.has(email.id)}
                                                                className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                            >
                                                                <Send className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Send now</TooltipContent>
                                                    </Tooltip>
                                                )}
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleDeleteEmail(email.id)}
                                                            disabled={processingIds.has(email.id)}
                                                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Delete</TooltipContent>
                                                </Tooltip>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                        No emails in queue.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Email Logs */}
            <Card>
                <CardHeader>
                    <CardTitle>Email Send Logs</CardTitle>
                    <CardDescription>A real-time log of all transactional emails sent by the system.</CardDescription>
                </CardHeader>
            <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                    <Mail className="h-4 w-4" />
                    <span>Total Emails Logged: {isLoading ? '...' : emailLogs?.length ?? 0}</span>
                </div>
                <ScrollArea className="h-[600px] border rounded-lg">
                    <Accordion type="single" collapsible className="w-full">
                        {isLoading ? (
                            <div className="p-4 space-y-4">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} className="h-10 w-full" />
                                ))}
                            </div>
                        ) : emailLogs && emailLogs.length > 0 ? (
                            emailLogs.map((log) => (
                                <AccordionItem value={log.id} key={log.id}>
                                    <AccordionTrigger className="p-4 hover:no-underline text-left">
                                        <div className="grid grid-cols-5 gap-4 w-full">
                                            <div className="col-span-2 truncate">
                                                <span className="font-semibold">To:</span> {log.to}
                                            </div>
                                            <div className="truncate">
                                                <span className="font-semibold">PIN:</span> <span className="font-mono">{log.pin}</span>
                                            </div>
                                            <div>
                                                <Badge variant={getStatusVariant(log.status)}>{log.status.replace('_', ' ')}</Badge>
                                            </div>
                                            <div className="text-muted-foreground text-xs truncate">
                                                {format(new Date(log.timestamp.seconds * 1000), "MMM d, h:mm a")}
                                            </div>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                        <div className="p-4 border-t bg-muted/50 space-y-4">
                                            <div>
                                                <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Subject</h4>
                                                <p>{log.subject}</p>
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-1">Email Body Preview</h4>
                                                <div
                                                    className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-4 bg-background overflow-auto"
                                                    dangerouslySetInnerHTML={{ __html: log.html }}
                                                />
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            ))
                        ) : (
                            <div className="text-center text-muted-foreground p-12">
                                No email logs found.
                            </div>
                        )}
                    </Accordion>
                </ScrollArea>
            </CardContent>
            </Card>
        </div>
        </TooltipProvider>
    );
}
