// GUID: ADMIN_INTERFACE_HEALTH-000-v01
// [Intent] Admin component for real-time health monitoring of external interfaces (PubChat/OpenF1,
//          WhatsApp, Email/Graph API). Provides RAG (Red/Amber/Green) status indicators with
//          diagnostic information to quickly identify interface failures.
// [Inbound Trigger] Rendered in the admin panel when the "Health" tab is selected.
// [Downstream Impact] Makes test API calls to /api/admin/health/* endpoints to verify connectivity.
//                     No writes - read-only health checks.
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
    WifiOff
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

    // GUID: ADMIN_INTERFACE_HEALTH-003-v01
    // [Intent] Check WhatsApp worker interface health by calling the health endpoint.
    // [Inbound Trigger] Manual refresh button or auto-refresh timer.
    // [Downstream Impact] Updates whatsappHealth state with status, response time, and errors.
    const checkWhatsAppHealth = async (token: string): Promise<void> => {
        const startTime = performance.now();

        try {
            const res = await fetch('/api/admin/whatsapp/health', {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: AbortSignal.timeout(10000),
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            if (res.status === 200) {
                const json = await res.json();
                setWhatsappHealth({
                    name: 'WhatsApp Worker',
                    status: json.healthy ? 'healthy' : 'degraded',
                    lastChecked: new Date(),
                    responseTime,
                    error: json.healthy ? null : json.error || 'Service degraded',
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

    // GUID: ADMIN_INTERFACE_HEALTH-005-v01
    // [Intent] Run all health checks in parallel and update lastFullCheck timestamp.
    // [Inbound Trigger] Component mount, manual refresh, or auto-refresh timer.
    // [Downstream Impact] Updates all three health states simultaneously.
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            </div>
        </div>
    );
}
