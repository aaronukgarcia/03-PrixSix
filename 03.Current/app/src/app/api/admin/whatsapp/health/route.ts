// GUID: API_ADMIN_WHATSAPP_HEALTH-000-v03
// @BUGFIX HEALTH-ERRORS-001 (v03): every UNHEALTHY probe result (healthy:false — URL not
//   configured, worker HTTP error, worker unreachable) now writes a registry-shaped error_logs
//   entry via logError, awaited before the response. The amber "sleeping" cold-start state
//   (healthy:null) is degraded-by-design and does NOT log; caller 401/403 do NOT log.
//   NOTE: the app registry has no WhatsApp-specific key (PX-34xx live only in the functions
//   mirror), so NETWORK_ERROR (PX-9002, "Server unreachable") is the closest GR#7 key here.
// @SECURITY_FIX: Added isAdmin Firestore check to prevent non-admin users from probing internal WhatsApp worker URL and diagnostics (GEMINI-AUDIT-124).
// [Intent] Health check endpoint for WhatsApp Worker interface. Returns connectivity status
//          and basic diagnostics without making actual WhatsApp API calls. Admin-only.
// [Inbound Trigger] GET request from InterfaceHealthMonitor component (auto-refresh every 30s).
// [Downstream Impact] Read-only health check - no state changes. Returns worker URL reachability.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId, getFirebaseAdmin, logError } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_WHATSAPP_HEALTH-001-v04
// @SECURITY_FIX: Added isAdmin Firestore check after token verification (GEMINI-AUDIT-124).
//   Previously any authenticated user could probe the internal WhatsApp worker URL.
// [Intent] GET handler that checks WhatsApp worker connectivity by fetching the /health endpoint.
// [Inbound Trigger] GET /api/admin/whatsapp/health with Authorization header from admin user.
// [Downstream Impact] Returns JSON with healthy status, response time, and worker URL. Admin-only.
export async function GET(request: NextRequest) {
    const correlationId = generateCorrelationId();

    try {
        // Verify authentication
        const authHeader = request.headers.get('Authorization');
        const verifiedUser = await verifyAuthToken(authHeader);

        if (!verifiedUser) {
            return NextResponse.json(
                { healthy: false, error: 'Unauthorized', correlationId },
                { status: 401 }
            );
        }

        // SECURITY: Verify caller is an admin — any authenticated user can reach this route
        // without this check, exposing the internal WhatsApp worker URL to non-admins.
        const { db } = await getFirebaseAdmin();
        const adminDoc = await db.collection('users').doc(verifiedUser.uid).get();
        if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
            return NextResponse.json(
                { healthy: false, error: 'Admin access required', correlationId },
                { status: 403 }
            );
        }

        // Check if WhatsApp worker URL is configured
        const workerUrl = process.env.WHATSAPP_WORKER_URL;
        if (!workerUrl) {
            // HEALTH-ERRORS-001: unhealthy (config) — a lost env binding is exactly the
            // BUG-EMAIL-002 silent-failure class. Registry error to error_logs, once per probe.
            await logError({
                correlationId,
                error: new Error(`[${ERRORS.NETWORK_ERROR.code}] WhatsApp health probe: WHATSAPP_WORKER_URL not configured — worker unreachable by definition`),
                context: {
                    route: '/api/admin/whatsapp/health',
                    action: 'health_probe',
                    additionalInfo: { errorKey: ERRORS.NETWORK_ERROR.key, phase: 'config' },
                },
            });
            return NextResponse.json({
                healthy: false,
                error: 'WhatsApp worker URL not configured',
                details: {
                    configured: false,
                    workerUrl: null,
                },
                correlationId,
            });
        }

        // Try to reach the worker health endpoint
        const startTime = performance.now();
        try {
            const healthUrl = new URL('/health', workerUrl).toString();
            const res = await fetch(healthUrl, {
                signal: AbortSignal.timeout(10000), // 10s — worker is a scale-to-zero Azure Container App; 5s was too tight for cold starts (~3-5s), causing false "timeout" health failures
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                return NextResponse.json({
                    healthy: true,
                    details: {
                        configured: true,
                        workerUrl,
                        responseTime,
                        statusCode: res.status,
                        workerData: data,
                    },
                });
            } else {
                // HEALTH-ERRORS-001: unhealthy (worker HTTP error) — registry error to error_logs.
                await logError({
                    correlationId,
                    error: new Error(`[${ERRORS.NETWORK_ERROR.code}] WhatsApp health probe: worker returned HTTP ${res.status}`),
                    context: {
                        route: '/api/admin/whatsapp/health',
                        action: 'health_probe',
                        additionalInfo: { errorKey: ERRORS.NETWORK_ERROR.key, phase: 'worker-http', httpStatus: res.status },
                    },
                });
                return NextResponse.json({
                    healthy: false,
                    error: `Worker returned HTTP ${res.status}`,
                    details: {
                        configured: true,
                        workerUrl,
                        responseTime,
                        statusCode: res.status,
                    },
                });
            }
        } catch (fetchError) {
            // @COLD_START (v3.1.19): The worker is a scale-to-zero Azure Container App. A true cold
            //   start (container schedule + Node boot + whatsapp-web.js/puppeteer init) takes longer
            //   than the 10s probe budget, so AbortSignal.timeout throws a 'TimeoutError'. That is NOT
            //   an outage — the worker is merely asleep and the first real message will wake it.
            //   Report a distinct amber "sleeping" state (healthy: null) rather than a red failure.
            const name = (fetchError as any)?.name;
            const isTimeout = name === 'TimeoutError' || name === 'AbortError';
            if (isTimeout) {
                return NextResponse.json({
                    healthy: null,
                    state: 'sleeping',
                    error: 'Worker asleep (scale-to-zero) — first message will wake it (~15-30s)',
                    details: {
                        configured: true,
                        workerUrl,
                        reason: 'cold-start-timeout',
                        timeoutMs: 10000,
                    },
                });
            }
            // HEALTH-ERRORS-001: unhealthy (non-timeout network failure — DNS/TLS/refused).
            // The timeout path above returned "sleeping" (degraded-by-design) WITHOUT logging.
            await logError({
                correlationId,
                error: new Error(`[${ERRORS.NETWORK_ERROR.code}] WhatsApp health probe: worker unreachable: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`),
                context: {
                    route: '/api/admin/whatsapp/health',
                    action: 'health_probe',
                    additionalInfo: { errorKey: ERRORS.NETWORK_ERROR.key, phase: 'worker-network' },
                },
            });
            return NextResponse.json({
                healthy: false,
                error: fetchError instanceof Error ? fetchError.message : 'Worker unreachable',
                details: {
                    configured: true,
                    workerUrl,
                },
            });
        }

    } catch (error: any) {
        // HEALTH-ERRORS-001: the probe itself crashed — monitoring is blind; registry error.
        await logError({
            correlationId,
            error: new Error(`[${ERRORS.UNKNOWN_ERROR.code}] WhatsApp health probe crashed: ${error.message || String(error)}`),
            context: {
                route: '/api/admin/whatsapp/health',
                action: 'health_probe',
                additionalInfo: { errorKey: ERRORS.UNKNOWN_ERROR.key },
            },
        });
        return NextResponse.json(
            {
                healthy: false,
                error: error.message || 'Internal server error',
                correlationId,
            },
            { status: 500 }
        );
    }
}
