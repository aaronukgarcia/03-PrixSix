// GUID: PUBCHAT_PANEL-000-v03
// [Intent] Admin panel for the PubChat tab. Renders the ThePaddockPubChat
//          animation at the top (with live or fallback timing data), provides
//          OpenF1 fetch controls (meeting + session dropdowns, fetch button),
//          and renders newsletter HTML from Firestore below.
// [Inbound Trigger] Rendered when the admin selects the "PubChat" tab on the admin page.
// [Downstream Impact] Reads from Firestore app-settings/pub-chat and app-settings/pub-chat-timing.
//                     Writes to app-settings/pub-chat-timing via /api/admin/fetch-timing-data.
'use client';

import { useCallback, useEffect, useState } from 'react';
import ThePaddockPubChat from '@/components/ThePaddockPubChat';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Beer, RefreshCw, AlertCircle, Download } from 'lucide-react';
import { useFirestore, useAuth } from '@/firebase';
import { getPubChatSettings, PubChatSettings, getPubChatTimingData, PubChatTimingData } from '@/firebase/firestore/settings';
import { Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';
import DOMPurify from 'isomorphic-dompurify';

// ─── OpenF1 dropdown types ──────────────────────────────────────────────────
interface MeetingOption {
    meetingKey: number;
    meetingName: string;
    location: string;
    countryName: string;
    circuitName: string;
    dateStart: string;
}

interface SessionOption {
    sessionKey: number;
    sessionName: string;
    dateStart: string;
}

// GUID: PUBCHAT_PANEL-001-v03
// [Intent] PubChatPanel component — centres the pub chat animation, provides OpenF1
//          fetch controls for live timing data, and shows newsletter HTML.
// [Inbound Trigger] Mounted by TabsContent value="pubchat" in admin/page.tsx.
// [Downstream Impact] Reads app-settings/pub-chat and app-settings/pub-chat-timing from Firestore.
//                     POSTs to /api/admin/fetch-timing-data to update timing data.
export function PubChatPanel() {
    const firestore = useFirestore();
    const { firebaseUser } = useAuth();
    const { toast } = useToast();

    // Newsletter state
    const [settings, setSettings] = useState<PubChatSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    // Timing data state
    const [timingData, setTimingData] = useState<PubChatTimingData | null>(null);

    // OpenF1 fetch controls state
    const [meetings, setMeetings] = useState<MeetingOption[]>([]);
    const [sessions, setSessions] = useState<SessionOption[]>([]);
    const [selectedMeetingKey, setSelectedMeetingKey] = useState<string>('');
    const [selectedSessionKey, setSelectedSessionKey] = useState<string>('');
    const [loadingMeetings, setLoadingMeetings] = useState(false);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [fetching, setFetching] = useState(false);

    // GUID: PUBCHAT_PANEL-002-v03
    // [Intent] Fetch newsletter content and timing data from Firestore on mount / refresh.
    // [Inbound Trigger] Component mount and refresh button clicks.
    // [Downstream Impact] Populates settings (newsletter HTML) and timingData (live timing).
    const fetchContent = useCallback(async (forceServer = false) => {
        try {
            setError(null);
            const [data, timing] = await Promise.all([
                getPubChatSettings(firestore, forceServer),
                getPubChatTimingData(firestore, forceServer),
            ]);
            setSettings(data);
            setTimingData(timing);
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

    // GUID: PUBCHAT_PANEL-003-v03
    // [Intent] Fetch meeting list from OpenF1 via the proxy API route for the current year.
    // [Inbound Trigger] Component mount.
    // [Downstream Impact] Populates the meeting dropdown.
    useEffect(() => {
        const fetchMeetings = async () => {
            setLoadingMeetings(true);
            try {
                const year = new Date().getFullYear();
                const res = await fetch(`/api/admin/openf1-sessions?year=${year}`);
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    setMeetings(json.data);
                }
            } catch (err) {
                console.error('Failed to fetch meetings:', err);
            } finally {
                setLoadingMeetings(false);
            }
        };
        fetchMeetings();
    }, []);

    // GUID: PUBCHAT_PANEL-004-v03
    // [Intent] Fetch session list from OpenF1 when a meeting is selected.
    // [Inbound Trigger] selectedMeetingKey changes to a non-empty value.
    // [Downstream Impact] Populates the session dropdown and resets the selected session.
    useEffect(() => {
        if (!selectedMeetingKey) {
            setSessions([]);
            setSelectedSessionKey('');
            return;
        }
        const fetchSessions = async () => {
            setLoadingSessions(true);
            setSelectedSessionKey('');
            try {
                const res = await fetch(`/api/admin/openf1-sessions?meetingKey=${selectedMeetingKey}`);
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    setSessions(json.data);
                }
            } catch (err) {
                console.error('Failed to fetch sessions:', err);
            } finally {
                setLoadingSessions(false);
            }
        };
        fetchSessions();
    }, [selectedMeetingKey]);

    // GUID: PUBCHAT_PANEL-005-v03
    // [Intent] Fetch timing data from OpenF1 and write to Firestore via the API route.
    // [Inbound Trigger] Admin clicks "Fetch from OpenF1" button.
    // [Downstream Impact] POSTs to /api/admin/fetch-timing-data, then refreshes timing data
    //                     from Firestore to update the ThePaddockPubChat component.
    const handleFetchTimingData = async () => {
        if (!selectedSessionKey || !firebaseUser?.uid) return;

        setFetching(true);
        const correlationId = generateClientCorrelationId();

        try {
            const res = await fetch('/api/admin/fetch-timing-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionKey: Number(selectedSessionKey),
                    adminUid: firebaseUser.uid,
                }),
            });

            const json = await res.json();

            if (!json.success) {
                toast({
                    variant: 'destructive',
                    title: `Error ${json.errorCode || ERRORS.OPENF1_FETCH_FAILED.code}`,
                    description: json.error || 'Failed to fetch timing data',
                });
                return;
            }

            toast({
                title: 'Timing data fetched',
                description: `${json.driverCount} drivers loaded for ${json.sessionName}`,
            });

            // Refresh timing data from Firestore
            const updatedTiming = await getPubChatTimingData(firestore, true);
            setTimingData(updatedTiming);
            setRefreshKey(k => k + 1);

        } catch (err) {
            console.error(`[Fetch Timing Error ${correlationId}]`, err);
            toast({
                variant: 'destructive',
                title: 'Fetch failed',
                description: `Could not fetch timing data. Ref: ${correlationId}`,
            });
        } finally {
            setFetching(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* GUID: PUBCHAT_PANEL-006-v03
                [Intent] Centre the ThePaddockPubChat animation at the top of the panel,
                         passing live timing data when available.
                [Inbound Trigger] Component mount / timing data update.
                [Downstream Impact] Renders the F1 timing animation with live or fallback data. */}
            <div className="flex justify-center">
                <ThePaddockPubChat key={refreshKey} timingData={timingData} />
            </div>

            {/* GUID: PUBCHAT_PANEL-007-v03
                [Intent] OpenF1 fetch controls — meeting/session dropdowns and fetch button.
                [Inbound Trigger] Component mount populates meetings; meeting selection populates sessions.
                [Downstream Impact] Fetch button triggers timing data write to Firestore. */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Download className="h-5 w-5" />
                        OpenF1 Timing Data
                    </CardTitle>
                    <CardDescription>
                        {timingData?.fetchedAt
                            ? `Last fetched: ${formatTimestamp(timingData.fetchedAt)}${timingData.fetchedBy ? ` by ${timingData.fetchedBy}` : ''}`
                            : 'Select a meeting and session, then fetch live timing data from OpenF1.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Meeting dropdown */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium">Meeting</label>
                            <Select
                                value={selectedMeetingKey}
                                onValueChange={setSelectedMeetingKey}
                                disabled={loadingMeetings}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={loadingMeetings ? 'Loading...' : 'Select meeting'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {meetings.map(m => (
                                        <SelectItem key={m.meetingKey} value={String(m.meetingKey)}>
                                            {m.meetingName} — {m.location}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Session dropdown */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium">Session</label>
                            <Select
                                value={selectedSessionKey}
                                onValueChange={setSelectedSessionKey}
                                disabled={!selectedMeetingKey || loadingSessions}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={loadingSessions ? 'Loading...' : 'Select session'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {sessions.map(s => (
                                        <SelectItem key={s.sessionKey} value={String(s.sessionKey)}>
                                            {s.sessionName}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
                <CardFooter>
                    <Button
                        onClick={handleFetchTimingData}
                        disabled={!selectedSessionKey || fetching}
                    >
                        <Download className={`h-4 w-4 mr-2 ${fetching ? 'animate-spin' : ''}`} />
                        {fetching ? 'Fetching...' : 'Fetch from OpenF1'}
                    </Button>
                </CardFooter>
            </Card>

            {/* GUID: PUBCHAT_PANEL-008-v03
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
                            dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(settings.content, {
                                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre'],
                                    ALLOWED_ATTR: ['href', 'target', 'rel']
                                })
                            }}
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
