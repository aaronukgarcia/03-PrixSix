// GUID: PUBCHAT_PANEL-000-v02
// [Intent] Admin panel for the PubChat tab. Renders the ThePaddockPubChat
//          animation at the top, fetches newsletter HTML from Firestore, and
//          renders it in a prose container.
// [Inbound Trigger] Rendered when the admin selects the "PubChat" tab on the admin page.
// [Downstream Impact] Reads from Firestore app-settings/pub-chat. No writes.
'use client';

import { useCallback, useEffect, useState } from 'react';
import ThePaddockPubChat from '@/components/ThePaddockPubChat';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Beer, RefreshCw, AlertCircle } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { getPubChatSettings, PubChatSettings } from '@/firebase/firestore/settings';
import { Timestamp } from 'firebase/firestore';

// GUID: PUBCHAT_PANEL-001-v02
// [Intent] PubChatPanel component — centres the pub chat animation and shows
//          newsletter content fetched from Firestore below it.
// [Inbound Trigger] Mounted by TabsContent value="pubchat" in admin/page.tsx.
// [Downstream Impact] Reads app-settings/pub-chat from Firestore on mount and on refresh.
export function PubChatPanel() {
    const firestore = useFirestore();
    const [settings, setSettings] = useState<PubChatSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const fetchContent = useCallback(async (forceServer = false) => {
        try {
            setError(null);
            const data = await getPubChatSettings(firestore, forceServer);
            setSettings(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch pub chat content');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [firestore]);

    useEffect(() => {
        fetchContent();
    }, [fetchContent]);

    const handleRefresh = () => {
        setRefreshing(true);
        setRefreshKey(k => k + 1);
        fetchContent(true);
    };

    const formatTimestamp = (ts: Timestamp): string => {
        if (ts.seconds === 0) return '';
        return ts.toDate().toLocaleString();
    };

    return (
        <div className="space-y-6">
            {/* GUID: PUBCHAT_PANEL-002-v01
                [Intent] Centre the ThePaddockPubChat animation at the top of the panel.
                [Inbound Trigger] Component mount.
                [Downstream Impact] Renders the self-contained F1 pre-season animation. */}
            <div className="flex justify-center">
                <ThePaddockPubChat key={refreshKey} />
            </div>

            {/* GUID: PUBCHAT_PANEL-003-v02
                [Intent] Card displaying the newsletter HTML content fetched from Firestore.
                [Inbound Trigger] Component mount / refresh button click.
                [Downstream Impact] Renders HTML body with dangerouslySetInnerHTML. */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Beer className="h-5 w-5" />
                        The Paddock Pub Chat
                    </CardTitle>
                    <CardDescription>
                        {settings && settings.lastUpdated.seconds > 0
                            ? `Last updated: ${formatTimestamp(settings.lastUpdated)}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}`
                            : 'Newsletter content from the generation pipeline.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="space-y-3">
                            <Skeleton className="h-6 w-3/4" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-5/6" />
                            <Skeleton className="h-6 w-1/2 mt-4" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-4/5" />
                        </div>
                    ) : error ? (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : !settings?.content ? (
                        <p className="text-sm text-muted-foreground">
                            No newsletter content yet. Run the generation pipeline to populate this.
                        </p>
                    ) : (
                        <div
                            className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-4 bg-background overflow-auto"
                            dangerouslySetInnerHTML={{ __html: settings.content }}
                        />
                    )}
                </CardContent>
                <CardFooter>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                        disabled={refreshing || loading}
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh from Firestore
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
