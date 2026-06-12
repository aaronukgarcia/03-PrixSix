// GUID: ADMIN_INTERFACE_HEALTH-000-v02
// [Intent] Admin component for real-time health monitoring of external interfaces (PubChat/OpenF1,
//          WhatsApp, Email/Graph API) AND the cumulative standings calculation. Provides RAG
//          (Red/Amber/Green) status indicators with diagnostic information to quickly identify
//          failures. The standings panel runs the same shared lib that powers /standings and the
//          results email — degraded amber catches the all-zeros pattern that broke the email
//          silently for ~6 weeks before being reported (see CHANGELOG 3.1.0).
// [Inbound Trigger] Rendered in the admin panel when the "Health" tab is selected.
// [Downstream Impact] Makes test API calls to /api/admin/health/* endpoints to verify connectivity
//                     and produced standings invariants. Read-only — no writes.
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    RefreshCw,
    Mail,
    MessageSquare,
    Radio,
    Clock,
    Wifi,
    WifiOff,
    Trophy
} from 'lucide-react';
import { useAuth } from '@/firebase';

// ─── Types ──────────────────────────────────────────────────────────────────
type HealthStatus = 'healthy' | 'degraded' | 'down' | 'checking';

interface InterfaceHealth {
    name: string;
    status: HealthStatus;
    lastChecked: Date | null;
    responseTime: number | null; // milliseconds
    error: string | null;
    details: {
        authenticated: boolean;
        endpoint: string;
        statusCode: number | null;
    };
}

// GUID: ADMIN_INTERFACE_HEALTH-006-v01
// [Intent] Extra payload returned by the standings probe — warnings list and a top-5 sample
//          for visual sanity-check. Stored separately from InterfaceHealth so the standings
//          card can render the additional detail without contaminating the other 3 cards.
// [Inbound Trigger] Populated by checkStandingsHealth from /api/admin/health/standings response.
// [Downstream Impact] Drives the warnings alert and "Top 5 sample" panel under the standings card.
interface StandingsDiagnostic {
    raceResultsCount: number;
    predictionsCount: number;
    scoresCount: number;
    warnings: string[];
    topFive: { rank: number; teamName: string; totalPoints: number }[];
}

// GUID: ADMIN_INTERFACE_HEALTH-001-v01
// [Intent] InterfaceHealthMonitor component — displays real-time health status for PubChat,
//          WhatsApp, and Email interfaces with RAG indicators and diagnostic info.
// [Inbound Trigger] Mounted in admin panel Health tab, auto-refreshes every 30 seconds.
// [Downstream Impact] Calls /api/admin/health/* endpoints to check interface connectivity.
export function InterfaceHealthMonitor() {
    const { firebaseUser } = useAuth();
    const [authToken, setAuthToken] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [lastFullCheck, setLastFullCheck] = useState<Date | null>(null);

    const [pubChatHealth, setPubChatHealth] = useState<InterfaceHealth>({
        name: 'PubChat / OpenF1',
        status: 'checking',
        lastChecked: null,
        responseTime: null,
        error: null,
        details: { authenticated: false, endpoint: '/api/admin/openf1-sessions', statusCode: null }
    });

    const [whatsappHealth, setWhatsappHealth] = useState<InterfaceHealth>({
        name: 'WhatsApp Worker',
        status: 'checking',
        lastChecked: null,
        responseTime: null,
        error: null,
        details: { authenticated: false, endpoint: '/api/admin/whatsapp/health', statusCode: null }
    });

    const [standingsHealth, setStandingsHealth] = useState<InterfaceHealth>({
        name: 'Standings Calculation',
        status: 'checking',
        lastChecked: null,
        responseTime: null,
        error: null,
        details: { authenticated: false, endpoint: '/api/admin/health/standings', statusCode: null }
    });
    const [standingsDiag, setStandingsDiag] = useState<StandingsDiagnostic | null>(null);

    const [emailHealth, setEmailHealth] = useState<InterfaceHealth>({
        name: 'Email / Graph API',
        status: 'checking',
        lastChecked: null,
        responseTime: null,
        error: null,
        details: { authenticated: false, endpoint: '/api/admin/email/health', statusCode: null }
    });

    // Fetch auth token
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

    // GUID: ADMIN_INTERFACE_HEALTH-002-v01
    // [Intent] Check PubChat/OpenF1 interface health by calling the sessions API endpoint.
    // [Inbound Trigger] Manual refresh button or auto-refresh timer.
    // [Downstream Impact] Updates pubChatHealth state with status, response time, and errors.
    const checkPubChatHealth = async (token: string): Promise<void> => {
        const startTime = performance.now();

        try {
            const res = await fetch('/api/admin/openf1-sessions?year=' + new Date().getFullYear(), {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(10000), // 10s timeout
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            if (res.status === 200) {
                const json = await res.json();
                setPubChatHealth({
                    name: 'PubChat / OpenF1',
                    status: json.success ? 'healthy' : 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.success ? null : json.error || 'Unknown error',
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/openf1-sessions',
                        statusCode: res.status
                    }
                });
            } else if (res.status === 401) {
                setPubChatHealth({
                    name: 'PubChat / OpenF1',
                    status: 'down',
                    lastChecked: new Date(),
                    responseTime,
                    error: 'Authentication failed',
                    details: {
                        authenticated: false,
                        endpoint: '/api/admin/openf1-sessions',
                        statusCode: 401
                    }
                });
            } else {
                const json = await res.json().catch(() => ({ error: 'Non-JSON response' }));
                setPubChatHealth({
                    name: 'PubChat / OpenF1',
                    status: 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.error || `HTTP ${res.status}`,
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/openf1-sessions',
                        statusCode: res.status
                    }
                });
            }
        } catch (err) {
            setPubChatHealth({
                name: 'PubChat / OpenF1',
                status: 'down',
                lastChecked: new Date(),
                responseTime: null,
                error: err instanceof Error ? err.message : 'Network error',
                details: {
                    authenticated: false,
                    endpoint: '/api/admin/openf1-sessions',
                    statusCode: null
                }
            });
        }
    };

    // GUID: ADMIN_INTERFACE_HEALTH-003-v02
    // [Intent] Check WhatsApp worker interface health by calling the health endpoint.
    // [Inbound Trigger] Manual refresh button or auto-refresh timer.
    // [Downstream Impact] Updates whatsappHealth state with status, response time, and errors.
    const checkWhatsAppHealth = async (token: string): Promise<void> => {
        const startTime = performance.now();

        try {
            const res = await fetch('/api/admin/whatsapp/health', {
                // 15s — longer than the route's own 10s worker probe so the route's "sleeping"
                // response (returned at ~10s on a cold start) arrives before this client aborts.
                headers: { 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(15000),
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            if (res.status === 200) {
                const json = await res.json();
                // @COLD_START (v3.1.19): healthy:null / state:'sleeping' means the scale-to-zero worker
                //   is asleep (not an outage) — render amber 'degraded' with a clear, non-alarming note.
                const isSleeping = json.healthy === null || json.state === 'sleeping';
                setWhatsappHealth({
                    name: 'WhatsApp Worker',
                    status: json.healthy === true ? 'healthy' : 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.healthy === true
                        ? null
                        : (isSleeping ? 'Worker asleep (scale-to-zero) — wakes on first message' : (json.error || 'Service degraded')),
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/whatsapp/health',
                        statusCode: res.status
                    }
                });
            } else if (res.status === 401) {
                setWhatsappHealth({
                    name: 'WhatsApp Worker',
                    status: 'down',
                    lastChecked: new Date(),
                    responseTime,
                    error: 'Authentication failed',
                    details: {
                        authenticated: false,
                        endpoint: '/api/admin/whatsapp/health',
                        statusCode: 401
                    }
                });
            } else if (res.status === 404) {
                setWhatsappHealth({
                    name: 'WhatsApp Worker',
                    status: 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: 'Health endpoint not implemented',
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/whatsapp/health',
                        statusCode: 404
                    }
                });
            } else {
                const json = await res.json().catch(() => ({ error: 'Non-JSON response' }));
                setWhatsappHealth({
                    name: 'WhatsApp Worker',
                    status: 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.error || `HTTP ${res.status}`,
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/whatsapp/health',
                        statusCode: res.status
                    }
                });
            }
        } catch (err) {
            setWhatsappHealth({
                name: 'WhatsApp Worker',
                status: 'down',
                lastChecked: new Date(),
                responseTime: null,
                error: err instanceof Error ? err.message : 'Network error',
                details: {
                    authenticated: false,
                    endpoint: '/api/admin/whatsapp/health',
                    statusCode: null
                }
            });
        }
    };

    // GUID: ADMIN_INTERFACE_HEALTH-004-v01
    // [Intent] Check Email/Graph API interface health by calling the health endpoint.
    // [Inbound Trigger] Manual refresh button or auto-refresh timer.
    // [Downstream Impact] Updates emailHealth state with status, response time, and errors.
    const checkEmailHealth = async (token: string): Promise<void> => {
        const startTime = performance.now();

        try {
            const res = await fetch('/api/admin/email/health', {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(10000),
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            if (res.status === 200) {
                const json = await res.json();
                setEmailHealth({
                    name: 'Email / Graph API',
                    status: json.healthy ? 'healthy' : 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.healthy ? null : json.error || 'Service degraded',
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/email/health',
                        statusCode: res.status
                    }
                });
            } else if (res.status === 401) {
                setEmailHealth({
                    name: 'Email / Graph API',
                    status: 'down',
                    lastChecked: new Date(),
                    responseTime,
                    error: 'Authentication failed',
                    details: {
                        authenticated: false,
                        endpoint: '/api/admin/email/health',
                        statusCode: 401
                    }
                });
            } else if (res.status === 404) {
                setEmailHealth({
                    name: 'Email / Graph API',
                    status: 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: 'Health endpoint not implemented',
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/email/health',
                        statusCode: 404
                    }
                });
            } else {
                const json = await res.json().catch(() => ({ error: 'Non-JSON response' }));
                setEmailHealth({
                    name: 'Email / Graph API',
                    status: 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.error || `HTTP ${res.status}`,
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/email/health',
                        statusCode: res.status
                    }
                });
            }
        } catch (err) {
            setEmailHealth({
                name: 'Email / Graph API',
                status: 'down',
                lastChecked: new Date(),
                responseTime: null,
                error: err instanceof Error ? err.message : 'Network error',
                details: {
                    authenticated: false,
                    endpoint: '/api/admin/email/health',
                    statusCode: null
                }
            });
        }
    };

    // GUID: ADMIN_INTERFACE_HEALTH-007-v01
    // [Intent] Check the cumulative standings calculation by hitting /api/admin/health/standings.
    //          The endpoint runs the same lib that powers /standings and the results email,
    //          then applies invariants ("all-zeros pattern", empty-with-data, etc). Amber means
    //          the compute completed but tripped a heuristic — admin should investigate before
    //          the next results email goes out.
    // [Inbound Trigger] runAllChecks (every 30s) and explicit "Refresh All" click.
    // [Downstream Impact] Updates standingsHealth (RAG card) and standingsDiag (warnings + top-5
    //                     sample) state. The diagnostic panel below the grid shows the sample.
    const checkStandingsHealth = async (token: string): Promise<void> => {
        const startTime = performance.now();

        try {
            const res = await fetch('/api/admin/health/standings', {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(15000), // 15s — compute can take a few seconds with full collectionGroup
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);
            const json = await res.json().catch(() => ({}));

            if (res.status === 200) {
                const apiStatus: HealthStatus = json.status === 'healthy' || json.status === 'degraded' || json.status === 'down'
                    ? json.status
                    : 'degraded';

                // First warning becomes the error message displayed on the card. Full list is
                // shown in the diagnostic panel below.
                const firstWarning: string | null = Array.isArray(json.warnings) && json.warnings.length > 0
                    ? json.warnings[0]
                    : null;

                setStandingsHealth({
                    name: 'Standings Calculation',
                    status: apiStatus,
                    lastChecked: new Date(),
                    responseTime,
                    error: apiStatus === 'healthy' ? null : (firstWarning ?? json.error ?? 'Compute degraded'),
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/health/standings',
                        statusCode: res.status,
                    },
                });

                setStandingsDiag({
                    raceResultsCount: json.raceResultsCount ?? 0,
                    predictionsCount: json.predictionsCount ?? 0,
                    scoresCount: json.scoresCount ?? 0,
                    warnings: Array.isArray(json.warnings) ? json.warnings : [],
                    topFive: Array.isArray(json.topFive) ? json.topFive : [],
                });
            } else if (res.status === 401 || res.status === 403) {
                setStandingsHealth({
                    name: 'Standings Calculation',
                    status: 'down',
                    lastChecked: new Date(),
                    responseTime,
                    error: res.status === 403 ? 'Admin access required' : 'Authentication failed',
                    details: {
                        authenticated: res.status !== 401,
                        endpoint: '/api/admin/health/standings',
                        statusCode: res.status,
                    },
                });
                setStandingsDiag(null);
            } else {
                setStandingsHealth({
                    name: 'Standings Calculation',
                    status: 'down',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.error || `HTTP ${res.status}`,
                    details: {
                        authenticated: true,
                        endpoint: '/api/admin/health/standings',
                        statusCode: res.status,
                    },
                });
                setStandingsDiag(null);
            }
        } catch (err) {
            setStandingsHealth({
                name: 'Standings Calculation',
                status: 'down',
                lastChecked: new Date(),
                responseTime: null,
                error: err instanceof Error ? err.message : 'Network error',
                details: {
                    authenticated: false,
                    endpoint: '/api/admin/health/standings',
                    statusCode: null,
                },
            });
            setStandingsDiag(null);
        }
    };

    // GUID: ADMIN_INTERFACE_HEALTH-005-v02
    // [Intent] Run all health checks in parallel and update lastFullCheck timestamp.
    // [Inbound Trigger] Component mount, manual refresh, or auto-refresh timer.
    // [Downstream Impact] Updates all four health states simultaneously.
    const runAllChecks = async () => {
        if (!authToken) {
            console.warn('No auth token available for health checks');
            return;
        }

        setChecking(true);

        await Promise.allSettled([
            checkPubChatHealth(authToken),
            checkWhatsAppHealth(authToken),
            checkEmailHealth(authToken),
            checkStandingsHealth(authToken),
        ]);

        setLastFullCheck(new Date());
        setChecking(false);
    };

    // Auto-check on mount and when auth token becomes available
    useEffect(() => {
        if (authToken) {
            runAllChecks();
        }
    }, [authToken]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        if (!authToken) return;

        const interval = setInterval(() => {
            runAllChecks();
        }, 30000);

        return () => clearInterval(interval);
    }, [authToken]);

    // Helper: Get status badge
    const getStatusBadge = (status: HealthStatus) => {
        switch (status) {
            case 'healthy':
                return (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Healthy
                    </Badge>
                );
            case 'degraded':
                return (
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Degraded
                    </Badge>
                );
            case 'down':
                return (
                    <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                        <XCircle className="h-3 w-3 mr-1" />
                        Down
                    </Badge>
                );
            case 'checking':
                return (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                        <Activity className="h-3 w-3 mr-1 animate-pulse" />
                        Checking...
                    </Badge>
                );
        }
    };

    // Helper: Get status icon
    const getStatusIcon = (status: HealthStatus) => {
        switch (status) {
            case 'healthy':
                return <Wifi className="h-5 w-5 text-green-600" />;
            case 'degraded':
                return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
            case 'down':
            case 'checking':
                return <WifiOff className="h-5 w-5 text-red-600" />;
        }
    };

    // Helper: Render interface card
    const renderInterfaceCard = (
        health: InterfaceHealth,
        icon: React.ReactNode,
        description: string
    ) => (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {icon}
                        <div>
                            <CardTitle className="text-base">{health.name}</CardTitle>
                            <CardDescription className="text-xs">{description}</CardDescription>
                        </div>
                    </div>
                    {getStatusBadge(health.status)}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {/* Status indicator */}
                <div className="flex items-center gap-2">
                    {getStatusIcon(health.status)}
                    <span className="text-sm font-medium">
                        {health.status === 'healthy' && 'All systems operational'}
                        {health.status === 'degraded' && 'Service degraded'}
                        {health.status === 'down' && 'Service unavailable'}
                        {health.status === 'checking' && 'Checking status...'}
                    </span>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-muted-foreground text-xs">Response Time</p>
                        <p className="font-mono font-medium">
                            {health.responseTime !== null ? `${health.responseTime}ms` : '—'}
                        </p>
                    </div>
                    <div>
                        <p className="text-muted-foreground text-xs">Status Code</p>
                        <p className="font-mono font-medium">
                            {health.details.statusCode !== null ? health.details.statusCode : '—'}
                        </p>
                    </div>
                </div>

                {/* Error message */}
                {health.error && (
                    <Alert variant="destructive" className="text-xs">
                        <AlertCircle className="h-3 w-3" />
                        <AlertDescription>{health.error}</AlertDescription>
                    </Alert>
                )}

                {/* Last checked */}
                {health.lastChecked && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Last checked: {health.lastChecked.toLocaleTimeString()}
                    </div>
                )}

                {/* Auth status */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {health.details.authenticated ? (
                        <>
                            <CheckCircle2 className="h-3 w-3 text-green-600" />
                            Authenticated
                        </>
                    ) : (
                        <>
                            <XCircle className="h-3 w-3 text-red-600" />
                            Not authenticated
                        </>
                    )}
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="h-5 w-5" />
                                Interface Health Monitor
                            </CardTitle>
                            <CardDescription>
                                Real-time status monitoring for external interfaces
                                {lastFullCheck && ` • Last full check: ${lastFullCheck.toLocaleTimeString()}`}
                            </CardDescription>
                        </div>
                        <Button
                            onClick={runAllChecks}
                            disabled={!authToken || checking}
                            size="sm"
                            variant="outline"
                        >
                            <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
                            {checking ? 'Checking...' : 'Refresh All'}
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            {/* Auth warning */}
            {!authToken && (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        Waiting for authentication... Health checks will start automatically once logged in.
                    </AlertDescription>
                </Alert>
            )}

            {/* Interface cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {renderInterfaceCard(
                    pubChatHealth,
                    <Radio className="h-5 w-5 text-purple-600" />,
                    'OpenF1 API connectivity'
                )}

                {renderInterfaceCard(
                    whatsappHealth,
                    <MessageSquare className="h-5 w-5 text-green-600" />,
                    'WhatsApp Worker status'
                )}

                {renderInterfaceCard(
                    emailHealth,
                    <Mail className="h-5 w-5 text-blue-600" />,
                    'Microsoft Graph API'
                )}

                {renderInterfaceCard(
                    standingsHealth,
                    <Trophy className="h-5 w-5 text-amber-600" />,
                    'Cumulative standings compute'
                )}
            </div>

            {/* GUID: ADMIN_INTERFACE_HEALTH-008-v01
                [Intent] Diagnostic detail panel under the cards. Shows the standings probe's
                  warning list (when degraded) and a top-5 sample so admins can sanity-check
                  the numbers visually without leaving the page. Hidden when no data has been
                  fetched yet (i.e. on first mount before the probe responds).
                [Inbound Trigger] standingsDiag state populated by checkStandingsHealth.
                [Downstream Impact] Pure presentational — no side effects. */}
            {standingsDiag && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Trophy className="h-4 w-4 text-amber-600" />
                            Standings Diagnostic
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Race results: {standingsDiag.raceResultsCount} ·
                            Predictions: {standingsDiag.predictionsCount} ·
                            Score rows produced: {standingsDiag.scoresCount}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {standingsDiag.warnings.length > 0 && (
                            <Alert variant="destructive" className="text-xs">
                                <AlertTriangle className="h-3 w-3" />
                                <AlertDescription>
                                    <p className="font-medium mb-1">{standingsDiag.warnings.length} invariant violation(s):</p>
                                    <ul className="list-disc list-inside space-y-1">
                                        {standingsDiag.warnings.map((w, i) => (
                                            <li key={i}>{w}</li>
                                        ))}
                                    </ul>
                                </AlertDescription>
                            </Alert>
                        )}

                        {standingsDiag.topFive.length > 0 ? (
                            <div>
                                <p className="text-xs text-muted-foreground mb-2">Top 5 sample (eyeball check):</p>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-xs text-muted-foreground border-b">
                                            <th className="text-left py-1 w-12">Rank</th>
                                            <th className="text-left py-1">Team</th>
                                            <th className="text-right py-1 w-20">Points</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {standingsDiag.topFive.map((row) => (
                                            <tr key={row.rank + '_' + row.teamName} className="border-b last:border-0">
                                                <td className="py-1 font-mono">{row.rank}</td>
                                                <td className="py-1">{row.teamName}</td>
                                                <td className="py-1 text-right font-mono">{row.totalPoints}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">No standings produced.</p>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
