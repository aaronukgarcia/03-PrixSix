// GUID: API_ADMIN_WHATSAPP_HEALTH-000-v01
// [Intent] Health check endpoint for WhatsApp Worker interface. Returns connectivity status
//          and basic diagnostics without making actual WhatsApp API calls.
// [Inbound Trigger] GET request from InterfaceHealthMonitor component (auto-refresh every 30s).
// [Downstream Impact] Read-only health check - no state changes. Returns worker URL reachability.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_WHATSAPP_HEALTH-001-v01
// [Intent] GET handler that checks WhatsApp worker connectivity by fetching the /health endpoint.
// [Inbound Trigger] GET /api/admin/whatsapp/health with Authorization header.
// [Downstream Impact] Returns JSON with healthy status, response time, and worker URL.
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
                signal: AbortSignal.timeout(5000), // 5s timeout
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
