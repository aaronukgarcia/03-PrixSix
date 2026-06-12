// GUID: API_ADMIN_WHATSAPP_HEALTH-000-v02
// @SECURITY_FIX: Added isAdmin Firestore check to prevent non-admin users from probing internal WhatsApp worker URL and diagnostics (GEMINI-AUDIT-124).
// [Intent] Health check endpoint for WhatsApp Worker interface. Returns connectivity status
//          and basic diagnostics without making actual WhatsApp API calls. Admin-only.
// [Inbound Trigger] GET request from InterfaceHealthMonitor component (auto-refresh every 30s).
// [Downstream Impact] Read-only health check - no state changes. Returns worker URL reachability.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId, getFirebaseAdmin } from '@/lib/firebase-admin';

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
