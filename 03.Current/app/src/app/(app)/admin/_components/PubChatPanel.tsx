// GUID: PUBCHAT_PANEL-000-v08
// @UX_REDESIGN: Major UX overhaul from dropdown-heavy to F1-themed visual experience:
//   - Meeting selector: dropdown → visual cards with flags, circuits, and dates
//   - Driver selector: single dropdown → multi-select checkboxes for comparison
//   - Auto-refresh: 30s default → 10s default (user-requested rate limit)
//   - Comparison view: Side-by-side driver data for Hamilton vs Albon pit time comparisons
//   - Banter formatting: Enhanced prose typography with proper paragraph spacing
// @UX_IMPROVEMENT: Added "Pub Closed" friendly state when OpenF1 free tier is blocked during
//   active F1 sessions. Shows pub-themed overlay with desaturated background instead of scary
//   error messages. Detects "session in progress" errors and displays next available time.
// @ERROR_FIX: Added proper 4-pillar error handling to all API error responses (error code,
//   correlation ID, selectable message text). Previous version violated Golden Rule #1 by
//   showing errors without error codes or correlation IDs.
// @SECURITY_FIX: Added authentication headers to all API calls.
// [Intent] Admin panel for the PubChat tab. Renders the ThePaddockPubChat
//          animation at the top (with live or fallback timing data), provides
//          OpenF1 fetch controls (meeting + session cards, multi-select drivers, fetch button),
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
import { Beer, RefreshCw, AlertCircle, Download, Flag, Calendar, MapPin, Users, TrendingUp } from 'lucide-react';
import { useFirestore, useAuth } from '@/firebase';
import { getPubChatSettings, PubChatSettings, getPubChatTimingData, PubChatTimingData } from '@/firebase/firestore/settings';
import { Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { generateClientCorrelationId } from '@/lib/error-codes';
import { ERRORS } from '@/lib/error-registry';
import DOMPurify from 'isomorphic-dompurify';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

// ─── OpenF1 dropdown types ──────────────────────────────────────────────────
interface MeetingOption {
    meetingKey: number;
    meetingName: string;
    location: string;
    countryName: string;
    countryFlag: string;
    circuitName: string;
    dateStart: string;
    dateEnd: string;
}

interface SessionOption {
    sessionKey: number;
    sessionName: string;
    dateStart: string;
}

// GUID: PUBCHAT_PANEL-010-v02
// [Intent] Data type options for exploiting the rich OpenF1 API beyond just lap times.
// [Inbound Trigger] Used to populate the "Data Type" dropdown in the fetch controls.
// [Downstream Impact] Determines which OpenF1 endpoint to call and how to display data.
type DataTypeOption =
    | 'laps'           // Lap times and stint data
    | 'positions'      // Position changes throughout session
    | 'car_data'       // Telemetry (speed, RPM, gear, throttle, brake)
    | 'pit'            // Pit stop data
    | 'stints'         // Stint information (tire compounds, lap counts)
    | 'intervals'      // Time gaps between cars
    | 'race_control'   // Race control messages (flags, investigations)
    | 'team_radio'     // Team radio messages
    | 'weather'        // Weather data (track temp, air temp, humidity, rainfall)
    | 'location';      // GPS position data (for track maps)

interface DataTypeDescriptor {
    value: DataTypeOption;
    label: string;
    description: string;
    supportsDriverFilter: boolean;
}

// GUID: PUBCHAT_PANEL-011-v02
// [Intent] Available data types that can be fetched from OpenF1 API.
// [Inbound Trigger] Used to populate the "Data Type" dropdown.
// [Downstream Impact] Defines which data types are available and their metadata.
const DATA_TYPES: DataTypeDescriptor[] = [
    { value: 'pit', label: 'Pit Stops', description: 'Pit stop timings and durations', supportsDriverFilter: true },
    { value: 'laps', label: 'Lap Times', description: 'Driver lap times and best laps', supportsDriverFilter: true },
    { value: 'positions', label: 'Positions', description: 'Position changes throughout session', supportsDriverFilter: true },
    { value: 'car_data', label: 'Car Data', description: 'Telemetry (speed, RPM, gear, throttle)', supportsDriverFilter: true },
    { value: 'stints', label: 'Stints', description: 'Tire compound and stint data', supportsDriverFilter: true },
    { value: 'intervals', label: 'Intervals', description: 'Time gaps between cars', supportsDriverFilter: false },
    { value: 'race_control', label: 'Race Control', description: 'Flags and race director messages', supportsDriverFilter: false },
    { value: 'team_radio', label: 'Team Radio', description: 'Radio messages', supportsDriverFilter: true },
    { value: 'weather', label: 'Weather', description: 'Track and air conditions', supportsDriverFilter: false },
    { value: 'location', label: 'Track Position', description: 'GPS position data', supportsDriverFilter: true },
];

// GUID: PUBCHAT_PANEL-001-v08
// @UX_REDESIGN: Complete UI/UX overhaul for F1-themed experience with visual cards and multi-select.
// @ENHANCEMENT: Changed auto-refresh default from 30s to 10s per user request.
// @ENHANCEMENT: Added multi-select driver comparison for Hamilton vs Albon pit time analysis.
// [Intent] PubChatPanel component — centres the pub chat animation, provides OpenF1
//          fetch controls with visual meeting cards and multi-select drivers, shows newsletter HTML.
// [Inbound Trigger] Mounted by TabsContent value="pubchat" in admin/page.tsx.
// [Downstream Impact] Reads app-settings/pub-chat and app-settings/pub-chat-timing from Firestore.
//                     POSTs to /api/admin/fetch-timing-data to update timing data with selected data type.
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

    // GUID: PUBCHAT_PANEL-012-v02
    // @UX_REDESIGN: Changed driver selection from single dropdown to multi-select checkboxes.
    // [Intent] Enhanced fetch controls state for rich OpenF1 API exploitation with multi-driver comparison.
    // [Inbound Trigger] User selections in cards, checkboxes, and toggles.
    // [Downstream Impact] Determines which API endpoint to call and enables driver comparison view.
    const [selectedDataType, setSelectedDataType] = useState<DataTypeOption>('pit');
    const [availableDrivers, setAvailableDrivers] = useState<Array<{ number: number; name: string }>>([]);
    const [selectedDriverNumbers, setSelectedDriverNumbers] = useState<number[]>([]); // Multi-select
    const [loadingDrivers, setLoadingDrivers] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [refreshInterval, setRefreshInterval] = useState<number>(10); // Changed from 30s to 10s
    const [autoRefreshCountdown, setAutoRefreshCountdown] = useState<number>(0);

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

    // GUID: PUBCHAT_PANEL-003-v07
    // @UX_IMPROVEMENT: Detects "session in progress" errors and sets pubClosed state for friendly UI.
    // @ERROR_FIX: Added proper 4-pillar error handling (error code, correlation ID, selectable text).
    // @SECURITY_FIX: Added Authorization header with Firebase auth token.
    // [Intent] Fetch meeting list from OpenF1 via the proxy API route for the current year.
    // [Inbound Trigger] Component mount and authToken availability.
    // [Downstream Impact] Populates the meeting cards or sets pubClosed state.
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

    // GUID: PUBCHAT_PANEL-004-v06
    // @ERROR_FIX: Added proper 4-pillar error handling (error code, correlation ID, selectable text).
    // @SECURITY_FIX: Added Authorization header with Firebase auth token.
    // [Intent] Fetch session list from OpenF1 when a meeting is selected.
    // [Inbound Trigger] selectedMeetingKey changes to a non-empty value.
    // [Downstream Impact] Populates the session cards and resets the selected session.
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

    // GUID: PUBCHAT_PANEL-013-v02
    // [Intent] Fetch driver list when a session is selected to populate driver filter checkboxes.
    // [Inbound Trigger] selectedSessionKey changes to a non-empty value.
    // [Downstream Impact] Populates the driver filter checkboxes for multi-driver comparison.
    useEffect(() => {
        if (!selectedSessionKey || !authToken) {
            setAvailableDrivers([]);
            setSelectedDriverNumbers([]);
            return;
        }

        const fetchDrivers = async () => {
            setLoadingDrivers(true);
            try {
                const res = await fetch(`/api/admin/openf1-drivers?sessionKey=${selectedSessionKey}`, {
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                    },
                });
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    setAvailableDrivers(json.data);
                } else {
                    console.warn('[Driver Fetch]', json.error || 'Failed to load drivers');
                    // Don't show error toast - drivers are optional
                }
            } catch (err) {
                console.warn('[Driver Fetch Error]', err);
            } finally {
                setLoadingDrivers(false);
            }
        };
        fetchDrivers();
    }, [selectedSessionKey, authToken]);

    // GUID: PUBCHAT_PANEL-005-v08
    // @ENHANCEMENT: Now supports multi-driver selection for comparison view.
    // @ERROR_FIX: Added proper 4-pillar error handling (error code, correlation ID, selectable text).
    // @SECURITY_FIX: Added Authorization header with Firebase auth token.
    // [Intent] Fetch timing data from OpenF1 and write to Firestore via the API route.
    // [Inbound Trigger] Admin clicks "Fetch from OpenF1" button or auto-refresh triggers.
    // [Downstream Impact] POSTs to /api/admin/fetch-timing-data with dataType and driver filter(s),
    //                     then refreshes timing data from Firestore to update display.
    const handleFetchTimingData = useCallback(async () => {
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
                    dataType: selectedDataType,
                    driverNumbers: selectedDriverNumbers.length > 0 ? selectedDriverNumbers : undefined,
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

            const driverText = selectedDriverNumbers.length > 0
                ? `${selectedDriverNumbers.length} selected driver${selectedDriverNumbers.length > 1 ? 's' : ''}`
                : `${json.driverCount} drivers`;

            toast({
                title: 'Timing data fetched',
                description: `${driverText} loaded for ${json.sessionName}`,
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
    }, [selectedSessionKey, authToken, selectedDataType, selectedDriverNumbers, firestore, toast]);

    // GUID: PUBCHAT_PANEL-014-v02
    // @ENHANCEMENT: Changed default interval from 30s to 10s per user request (rate limit).
    // [Intent] Auto-refresh mechanism for near real-time data updates when toggle is enabled.
    // [Inbound Trigger] autoRefresh toggle enabled, selectedSessionKey present.
    // [Downstream Impact] Automatically fetches timing data at specified interval.
    useEffect(() => {
        if (!autoRefresh || !selectedSessionKey) {
            setAutoRefreshCountdown(0);
            return;
        }

        // Initial countdown
        setAutoRefreshCountdown(refreshInterval);

        // Countdown timer (every second)
        const countdownTimer = setInterval(() => {
            setAutoRefreshCountdown(prev => {
                if (prev <= 1) return refreshInterval;
                return prev - 1;
            });
        }, 1000);

        // Refresh timer (at interval)
        const refreshTimer = setInterval(() => {
            console.log('[Auto-Refresh] Fetching timing data...');
            handleFetchTimingData();
        }, refreshInterval * 1000);

        return () => {
            clearInterval(countdownTimer);
            clearInterval(refreshTimer);
        };
    }, [autoRefresh, selectedSessionKey, refreshInterval, handleFetchTimingData]);

    // GUID: PUBCHAT_PANEL-016-v01
    // [Intent] Toggle driver selection in multi-select mode for comparison view.
    // [Inbound Trigger] User clicks driver checkbox.
    // [Downstream Impact] Updates selectedDriverNumbers array for multi-driver comparison.
    const toggleDriverSelection = (driverNumber: number) => {
        setSelectedDriverNumbers(prev =>
            prev.includes(driverNumber)
                ? prev.filter(n => n !== driverNumber)
                : [...prev, driverNumber]
        );
    };

    // GUID: PUBCHAT_PANEL-017-v01
    // [Intent] Format date range for meeting cards (e.g., "Feb 18-20").
    // [Inbound Trigger] Rendering meeting cards.
    // [Downstream Impact] Visual display of meeting dates.
    const formatDateRange = (start: string, end: string): string => {
        const startDate = new Date(start);
        const endDate = new Date(end);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        if (startDate.getMonth() === endDate.getMonth()) {
            return `${monthNames[startDate.getMonth()]} ${startDate.getDate()}-${endDate.getDate()}`;
        }
        return `${monthNames[startDate.getMonth()]} ${startDate.getDate()} - ${monthNames[endDate.getMonth()]} ${endDate.getDate()}`;
    };

    // GUID: PUBCHAT_PANEL-018-v01
    // [Intent] Check if a meeting is happening now (for visual highlighting).
    // [Inbound Trigger] Rendering meeting cards.
    // [Downstream Impact] "LIVE NOW" badge on active meetings.
    const isMeetingLive = (dateStart: string, dateEnd: string): boolean => {
        const now = new Date();
        const start = new Date(dateStart);
        const end = new Date(dateEnd);
        return now >= start && now <= end;
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

            {/* GUID: PUBCHAT_PANEL-019-v01
                @UX_REDESIGN: Visual F1-themed meeting selector replacing dropdown.
                [Intent] Meeting selector as visual cards with flags, circuits, and dates.
                [Inbound Trigger] Component mount populates meetings from OpenF1 API.
                [Downstream Impact] User clicks card to select meeting and load sessions. */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Flag className="h-5 w-5" />
                        Select Meeting
                    </CardTitle>
                    <CardDescription>
                        Choose a race weekend or testing session to explore timing data
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loadingMeetings ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {[1, 2, 3, 4, 5, 6].map(i => (
                                <Skeleton key={i} className="h-32" />
                            ))}
                        </div>
                    ) : meetings.length === 0 ? (
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                No meetings available. Data may be loading or the season hasn't started yet.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-2">
                            {meetings.map(meeting => {
                                const isSelected = selectedMeetingKey === String(meeting.meetingKey);
                                const isLive = isMeetingLive(meeting.dateStart, meeting.dateEnd);

                                return (
                                    <Card
                                        key={meeting.meetingKey}
                                        className={`cursor-pointer transition-all hover:shadow-lg ${
                                            isSelected
                                                ? 'border-primary border-2 shadow-md'
                                                : 'hover:border-primary/50'
                                        }`}
                                        onClick={() => setSelectedMeetingKey(String(meeting.meetingKey))}
                                    >
                                        <CardHeader className="pb-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <img
                                                    src={meeting.countryFlag}
                                                    alt={meeting.countryName}
                                                    className="w-12 h-8 object-cover rounded shadow-sm"
                                                />
                                                {isLive && (
                                                    <Badge variant="destructive" className="text-xs animate-pulse">
                                                        LIVE NOW
                                                    </Badge>
                                                )}
                                            </div>
                                            <CardTitle className="text-base leading-tight">
                                                {meeting.meetingName}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-0 space-y-2">
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <MapPin className="h-3 w-3" />
                                                <span className="truncate">{meeting.location}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Calendar className="h-3 w-3" />
                                                <span>{formatDateRange(meeting.dateStart, meeting.dateEnd)}</span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* GUID: PUBCHAT_PANEL-020-v01
                @UX_REDESIGN: Session selector as visual cards.
                [Intent] Session cards for Practice/Qualifying/Race selection.
                [Inbound Trigger] Meeting selected, sessions fetched.
                [Downstream Impact] User clicks session card to enable data fetching. */}
            {selectedMeetingKey && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5" />
                            Select Session
                        </CardTitle>
                        <CardDescription>
                            Choose which session to analyze (Practice, Qualifying, Race)
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loadingSessions ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[1, 2, 3, 4].map(i => (
                                    <Skeleton key={i} className="h-24" />
                                ))}
                            </div>
                        ) : sessions.length === 0 ? (
                            <Alert>
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                    No sessions available for this meeting yet.
                                </AlertDescription>
                            </Alert>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {sessions.map(session => {
                                    const isSelected = selectedSessionKey === String(session.sessionKey);

                                    return (
                                        <Card
                                            key={session.sessionKey}
                                            className={`cursor-pointer transition-all hover:shadow-md ${
                                                isSelected
                                                    ? 'border-primary border-2 shadow-md bg-primary/5'
                                                    : 'hover:border-primary/50'
                                            }`}
                                            onClick={() => setSelectedSessionKey(String(session.sessionKey))}
                                        >
                                            <CardHeader className="text-center p-4">
                                                <CardTitle className="text-sm font-semibold">
                                                    {session.sessionName}
                                                </CardTitle>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {new Date(session.dateStart).toLocaleDateString(undefined, {
                                                        month: 'short',
                                                        day: 'numeric'
                                                    })}
                                                </p>
                                            </CardHeader>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* GUID: PUBCHAT_PANEL-021-v01
                @UX_REDESIGN: Data type + multi-select driver controls.
                [Intent] Enhanced fetch controls with data type selection and multi-select drivers.
                [Inbound Trigger] Session selected, shows data controls.
                [Downstream Impact] Configures API request and enables comparison view. */}
            {selectedSessionKey && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Download className="h-5 w-5" />
                            Data Controls
                        </CardTitle>
                        <CardDescription>
                            {timingData?.fetchedAt
                                ? `Last fetched: ${formatTimestamp(timingData.fetchedAt)}${timingData.fetchedBy ? ` by ${timingData.fetchedBy}` : ''}`
                                : 'Configure data type and select drivers to compare'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Data Type Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Data Type</label>
                            <Select
                                value={selectedDataType}
                                onValueChange={(value) => setSelectedDataType(value as DataTypeOption)}
                                disabled={!authToken}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select data type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATA_TYPES.map(dt => (
                                        <SelectItem key={dt.value} value={dt.value}>
                                            <div className="flex flex-col">
                                                <span>{dt.label}</span>
                                                <span className="text-xs text-muted-foreground">{dt.description}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Multi-Select Driver Checkboxes */}
                        {DATA_TYPES.find(dt => dt.value === selectedDataType)?.supportsDriverFilter && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium">
                                        <Users className="h-4 w-4 inline mr-2" />
                                        Select Drivers to Compare
                                    </label>
                                    {selectedDriverNumbers.length > 0 && (
                                        <Badge variant="secondary">
                                            {selectedDriverNumbers.length} selected
                                        </Badge>
                                    )}
                                </div>
                                {loadingDrivers ? (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {[1, 2, 3, 4, 5, 6].map(i => (
                                            <Skeleton key={i} className="h-10" />
                                        ))}
                                    </div>
                                ) : availableDrivers.length === 0 ? (
                                    <Alert>
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription className="text-sm">
                                            No driver data available yet. Try fetching data first or check back later.
                                        </AlertDescription>
                                    </Alert>
                                ) : (
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto pr-2 border rounded-lg p-3 bg-muted/20">
                                        {availableDrivers.map(driver => (
                                            <div
                                                key={driver.number}
                                                className="flex items-center space-x-2 p-2 rounded hover:bg-accent cursor-pointer"
                                                onClick={() => toggleDriverSelection(driver.number)}
                                            >
                                                <Checkbox
                                                    id={`driver-${driver.number}`}
                                                    checked={selectedDriverNumbers.includes(driver.number)}
                                                    onCheckedChange={() => toggleDriverSelection(driver.number)}
                                                />
                                                <label
                                                    htmlFor={`driver-${driver.number}`}
                                                    className="text-sm font-medium cursor-pointer flex-1"
                                                >
                                                    #{driver.number} {driver.name}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    💡 Select multiple drivers (e.g., Hamilton #44 + Albon #23) to compare pit times side-by-side
                                </p>
                            </div>
                        )}

                        {/* Auto-Refresh Controls */}
                        <div className="border-t pt-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-medium">Auto-Refresh (Rate Limited)</label>
                                    <p className="text-xs text-muted-foreground">
                                        {autoRefresh
                                            ? `Next refresh in ${autoRefreshCountdown}s`
                                            : 'Enable for near real-time updates'}
                                    </p>
                                </div>
                                <Button
                                    variant={autoRefresh ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setAutoRefresh(!autoRefresh)}
                                    disabled={!selectedSessionKey}
                                >
                                    {autoRefresh ? 'Enabled' : 'Disabled'}
                                </Button>
                            </div>

                            {autoRefresh && (
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium">Refresh Interval</label>
                                    <Select
                                        value={String(refreshInterval)}
                                        onValueChange={(value) => setRefreshInterval(Number(value))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="5">5 seconds</SelectItem>
                                            <SelectItem value="10">10 seconds (Recommended)</SelectItem>
                                            <SelectItem value="15">15 seconds</SelectItem>
                                            <SelectItem value="30">30 seconds</SelectItem>
                                            <SelectItem value="60">60 seconds</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button
                            onClick={handleFetchTimingData}
                            disabled={!authToken || !selectedSessionKey || fetching}
                            className="w-full"
                        >
                            <Download className={`h-4 w-4 mr-2 ${fetching ? 'animate-spin' : ''}`} />
                            {!authToken ? 'Authenticating...' : fetching ? 'Fetching...' : 'Fetch from OpenF1'}
                        </Button>
                    </CardFooter>
                </Card>
            )}

            {/* GUID: PUBCHAT_PANEL-022-v01
                @UX_REDESIGN: Enhanced banter formatting with better prose typography.
                [Intent] Card displaying the newsletter HTML content with improved formatting.
                [Inbound Trigger] Component mount / refresh button click.
                [Downstream Impact] Renders HTML body with proper paragraph spacing and styling. */}
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
                        <Alert>
                            <Beer className="h-4 w-4" />
                            <AlertDescription>
                                No newsletter content yet. Run the generation pipeline to populate this.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div
                            className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-6 bg-background/50 overflow-auto space-y-4"
                            style={{
                                lineHeight: '1.75',
                            }}
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
