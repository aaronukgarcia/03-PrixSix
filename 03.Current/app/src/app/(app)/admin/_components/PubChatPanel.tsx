// GUID: PUBCHAT_PANEL-000-v06
// @UX_IMPROVEMENT: Added "Pub Closed" friendly state when OpenF1 free tier is blocked during
//   active F1 sessions. Shows pub-themed overlay with desaturated background instead of scary
//   error messages. Detects "session in progress" errors and displays next available time.
// @ERROR_FIX: Added proper 4-pillar error handling to all API error responses (error code,
//   correlation ID, selectable message text). Previous version violated Golden Rule #1 by
//   showing errors without error codes or correlation IDs.
// @SECURITY_FIX: Added authentication headers to all API calls. Previous version had no auth,
//   causing all API calls to fail with 401 Unauthorized:
//   - Meeting fetch (/api/admin/openf1-sessions?year=) → 401
//   - Session fetch (/api/admin/openf1-sessions?meetingKey=) → 401
//   - Timing data fetch (/api/admin/fetch-timing-data) → 401
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

// GUID: PUBCHAT_PANEL-001-v06
// @UX_IMPROVEMENT: Added pubClosed and nextAvailableTime state for friendly "pub closed" UI.
// @ERROR_FIX: Added proper 4-pillar error handling to all toast notifications.
// @SECURITY_FIX: Added authToken state and retrieval for API authentication.
// [Intent] PubChatPanel component — centres the pub chat animation, provides OpenF1
//          fetch controls for live timing data, and shows newsletter HTML.
// [Inbound Trigger] Mounted by TabsContent value="pubchat" in admin/page.tsx.
// [Downstream Impact] Reads app-settings/pub-chat and app-settings/pub-chat-timing from Firestore.
//                     POSTs to /api/admin/fetch-timing-data to update timing data.
export function PubChatPanel() {
    const firestore = useFirestore();
    const { firebaseUser } = useAuth();
    const { toast } = useToast();

    // Authentication state
    const [authToken, setAuthToken] = useState<string | null>(null);

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

    // Pub closed state (OpenF1 session active)
    const [pubClosed, setPubClosed] = useState(false);
    const [nextAvailableTime, setNextAvailableTime] = useState<string | null>(null);

    // Fetch auth token when firebaseUser changes
    useEffect(() => {
        if (firebaseUser) {
            firebaseUser.getIdToken().then(setAuthToken).catch(err => {
                console.error('Failed to get auth token:', err);
                setAuthToken(null);
            });
        } else {
            setAuthToken(null);
        }
    }, [firebaseUser]);

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

    // GUID: PUBCHAT_PANEL-003-v06
    // @UX_IMPROVEMENT: Detects "session in progress" errors and sets pubClosed state for friendly UI.
    // @ERROR_FIX: Added proper 4-pillar error handling (error code, correlation ID, selectable text).
    // @SECURITY_FIX: Added Authorization header with Firebase auth token.
    // [Intent] Fetch meeting list from OpenF1 via the proxy API route for the current year.
    // [Inbound Trigger] Component mount and authToken availability.
    // [Downstream Impact] Populates the meeting dropdown or sets pubClosed state.
    useEffect(() => {
        if (!authToken) return;

        const fetchMeetings = async () => {
            setLoadingMeetings(true);
            try {
                const year = new Date().getFullYear();
                const res = await fetch(`/api/admin/openf1-sessions?year=${year}`, {
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                    },
                });
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    setMeetings(json.data);
                    setPubClosed(false); // Pub is open!
                } else {
                    // Check if this is a "session active" restriction (pub closed) vs real error
                    const errorMsg = json.error || 'Failed to load meetings';
                    const isSessionActive = errorMsg.toLowerCase().includes('session in progress') ||
                                           errorMsg.toLowerCase().includes('restricted to authenticated users') ||
                                           errorMsg.toLowerCase().includes('access is restricted') ||
                                           errorMsg.toLowerCase().includes('requires authentication') ||
                                           errorMsg.toLowerCase().includes('openf1_username');

                    if (isSessionActive) {
                        // Pub is closed - F1 session active, free tier blocked
                        setPubClosed(true);
                        setNextAvailableTime('after the current F1 session ends');
                        console.log('[PubChat] Pub closed - OpenF1 session active (free tier blocked)');
                        // Don't show error toast - we'll show friendly UI instead
                    } else {
                        // Real error - show 4-pillar error handling
                        const errorCode = json.errorCode || ERRORS.OPENF1_FETCH_FAILED.code;
                        const correlationId = json.correlationId || 'unknown';
                        console.error(`[Meeting Fetch Error ${errorCode}] ${correlationId}:`, errorMsg);
                        setPubClosed(false);
                        toast({
                            variant: 'destructive',
                            title: `Failed to load meetings (${errorCode})`,
                            description: `${errorMsg}\n\nRef: ${correlationId}`,
                        });
                    }
                }
            } catch (err) {
                const correlationId = generateClientCorrelationId();
                console.error(`[Network Error ${correlationId}]`, err);
                toast({
                    variant: 'destructive',
                    title: 'Network error',
                    description: `Could not load meetings. Please refresh the page.\n\nRef: ${correlationId}`,
                });
            } finally {
                setLoadingMeetings(false);
            }
        };
        fetchMeetings();
    }, [authToken, toast]);

    // GUID: PUBCHAT_PANEL-004-v05
    // @ERROR_FIX: Added proper 4-pillar error handling (error code, correlation ID, selectable text).
    // @SECURITY_FIX: Added Authorization header with Firebase auth token.
    // [Intent] Fetch session list from OpenF1 when a meeting is selected.
    // [Inbound Trigger] selectedMeetingKey changes to a non-empty value.
    // [Downstream Impact] Populates the session dropdown and resets the selected session.
    useEffect(() => {
        if (!selectedMeetingKey || !authToken) {
            setSessions([]);
            setSelectedSessionKey('');
            return;
        }
        const fetchSessions = async () => {
            setLoadingSessions(true);
            setSelectedSessionKey('');
            try {
                const res = await fetch(`/api/admin/openf1-sessions?meetingKey=${selectedMeetingKey}`, {
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                    },
                });
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    setSessions(json.data);
                } else {
                    // 4-pillar error handling: code, correlation ID, message, selectable
                    const errorCode = json.errorCode || ERRORS.OPENF1_FETCH_FAILED.code;
                    const correlationId = json.correlationId || 'unknown';
                    const errorMsg = json.error || 'Failed to load sessions';
                    console.error(`[Session Fetch Error ${errorCode}] ${correlationId}:`, errorMsg);
                    toast({
                        variant: 'destructive',
                        title: `Failed to load sessions (${errorCode})`,
                        description: `${errorMsg}\n\nRef: ${correlationId}`,
                    });
                }
            } catch (err) {
                const correlationId = generateClientCorrelationId();
                console.error(`[Network Error ${correlationId}]`, err);
                toast({
                    variant: 'destructive',
                    title: 'Network error',
                    description: `Could not load sessions. Please try again.\n\nRef: ${correlationId}`,
                });
            } finally {
                setLoadingSessions(false);
            }
        };
        fetchSessions();
    }, [selectedMeetingKey, authToken, toast]);

    // GUID: PUBCHAT_PANEL-005-v05
    // @ERROR_FIX: Added proper 4-pillar error handling (error code, correlation ID, selectable text).
    // @SECURITY_FIX: Added Authorization header with Firebase auth token. Removed unused adminUid
    //   parameter (API route uses authenticated user's UID instead).
    // [Intent] Fetch timing data from OpenF1 and write to Firestore via the API route.
    // [Inbound Trigger] Admin clicks "Fetch from OpenF1" button.
    // [Downstream Impact] POSTs to /api/admin/fetch-timing-data, then refreshes timing data
    //                     from Firestore to update the ThePaddockPubChat component.
    const handleFetchTimingData = async () => {
        if (!selectedSessionKey || !authToken) return;

        setFetching(true);
        const clientCorrelationId = generateClientCorrelationId();

        try {
            const res = await fetch('/api/admin/fetch-timing-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    sessionKey: Number(selectedSessionKey),
                }),
            });

            const json = await res.json();

            if (!json.success) {
                // 4-pillar error handling: code, correlation ID, message, selectable
                const errorCode = json.errorCode || ERRORS.OPENF1_FETCH_FAILED.code;
                const correlationId = json.correlationId || clientCorrelationId;
                const errorMsg = json.error || 'Failed to fetch timing data';
                console.error(`[Timing Fetch Error ${errorCode}] ${correlationId}:`, errorMsg);
                toast({
                    variant: 'destructive',
                    title: `Error ${errorCode}`,
                    description: `${errorMsg}\n\nRef: ${correlationId}`,
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
            console.error(`[Fetch Timing Error ${clientCorrelationId}]`, err);
            toast({
                variant: 'destructive',
                title: 'Fetch failed',
                description: `Could not fetch timing data.\n\nRef: ${clientCorrelationId}`,
            });
        } finally {
            setFetching(false);
        }
    };

    return (
        <div className="relative space-y-6">
            {/* GUID: PUBCHAT_PANEL-009-v01
                [Intent] "Pub Closed" overlay when OpenF1 free tier is blocked during active F1 sessions.
                [Inbound Trigger] pubClosed state is true (detected "session in progress" error).
                [Downstream Impact] Friendly UX - shows pub-themed message instead of scary error. */}
            {pubClosed && (
                <div className="absolute inset-0 z-10 flex items-start justify-center pt-20 bg-background/95 backdrop-blur-sm">
                    <Card className="w-full max-w-2xl border-amber-600 shadow-xl">
                        <CardHeader className="text-center pb-4">
                            <div className="flex justify-center mb-4">
                                <Beer className="h-16 w-16 text-amber-600 opacity-50" />
                            </div>
                            <CardTitle className="text-2xl text-amber-600">
                                🍺 The Paddock Pub is Closed
                            </CardTitle>
                            <CardDescription className="text-base mt-2">
                                F1 session in progress - free tier access temporarily unavailable
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 text-center">
                            <div className="bg-muted rounded-lg p-4 space-y-2">
                                <p className="text-sm text-muted-foreground">
                                    <strong className="text-foreground">Why?</strong> OpenF1 restricts free tier access during active race weekends and testing.
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    <strong className="text-foreground">When will it open?</strong> {nextAvailableTime || 'Between race weekends'}
                                </p>
                            </div>

                            <div className="pt-2 space-y-2">
                                <p className="text-sm font-medium">Want 24/7 access?</p>
                                <p className="text-xs text-muted-foreground">
                                    Sponsor OpenF1 (€9.90/month) for always-on access + live data during races
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Main content - desaturated when pub closed */}
            <div className={pubClosed ? 'opacity-30 pointer-events-none saturate-0' : ''}>
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
                                disabled={!authToken || loadingMeetings}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={!authToken ? 'Authenticating...' : loadingMeetings ? 'Loading...' : 'Select meeting'} />
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
                                disabled={!authToken || !selectedMeetingKey || loadingSessions}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={!authToken ? 'Authenticating...' : loadingSessions ? 'Loading...' : 'Select session'} />
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
                        disabled={!authToken || !selectedSessionKey || fetching}
                    >
                        <Download className={`h-4 w-4 mr-2 ${fetching ? 'animate-spin' : ''}`} />
                        {!authToken ? 'Authenticating...' : fetching ? 'Fetching...' : 'Fetch from OpenF1'}
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
            </div> {/* End desaturated wrapper */}
        </div>
    );
}
