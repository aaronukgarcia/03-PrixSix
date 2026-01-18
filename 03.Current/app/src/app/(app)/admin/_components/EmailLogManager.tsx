
'use client';

import { useMemo } from 'react';
import { useCollection, useFirestore, useAuth } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Mail } from 'lucide-react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { ScrollArea } from '@/components/ui/scroll-area';

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

export function EmailLogManager() {
    const firestore = useFirestore();
    const { user } = useAuth();

    const emailLogQuery = useMemo(() => {
        if (!firestore || !user?.isAdmin) return null;
        const q = query(collection(firestore, 'email_logs'), orderBy('timestamp', 'desc'));
        (q as any).__memo = true;
        return q;
    }, [firestore, user]);

    const { data: emailLogs, isLoading, error } = useCollection<EmailLog>(emailLogQuery);

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
    );
}
