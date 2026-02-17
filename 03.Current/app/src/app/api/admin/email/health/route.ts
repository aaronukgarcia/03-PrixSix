// GUID: API_ADMIN_EMAIL_HEALTH-000-v01
// [Intent] Health check endpoint for Email/Graph API interface. Returns connectivity status
//          by making a lightweight test call to Microsoft Graph API.
// [Inbound Trigger] GET request from InterfaceHealthMonitor component (auto-refresh every 30s).
// [Downstream Impact] Read-only health check - makes GET /me call to Graph API to verify credentials.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_EMAIL_HEALTH-001-v01
// [Intent] GET handler that checks Microsoft Graph API connectivity using /me endpoint.
// [Inbound Trigger] GET /api/admin/email/health with Authorization header.
// [Downstream Impact] Makes GET https://graph.microsoft.com/v1.0/me to verify Graph API credentials.
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

        // Check if Graph API credentials are configured
        const clientId = process.env.GRAPH_CLIENT_ID;
        const clientSecret = process.env.GRAPH_CLIENT_SECRET;
        const tenantId = process.env.GRAPH_TENANT_ID;

        if (!clientId || !clientSecret || !tenantId) {
            return NextResponse.json({
                healthy: false,
                error: 'Microsoft Graph API credentials not configured',
                details: {
                    configured: false,
                    hasClientId: !!clientId,
                    hasClientSecret: !!clientSecret,
                    hasTenantId: !!tenantId,
                },
                correlationId,
            });
        }

        // Get access token from Microsoft
        const startTime = performance.now();
        try {
            const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
            const tokenRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    scope: 'https://graph.microsoft.com/.default',
                    grant_type: 'client_credentials',
                }),
                signal: AbortSignal.timeout(5000),
            });

            if (!tokenRes.ok) {
                return NextResponse.json({
                    healthy: false,
                    error: `Failed to get access token: HTTP ${tokenRes.status}`,
                    details: {
                        configured: true,
                        authFailed: true,
                    },
                });
            }

            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;

            // Test Graph API with /me endpoint
            const graphRes = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(5000),
            });

            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            if (graphRes.ok) {
                const userData = await graphRes.json();
                return NextResponse.json({
                    healthy: true,
                    details: {
                        configured: true,
                        authenticated: true,
                        responseTime,
                        statusCode: graphRes.status,
                        userEmail: userData.mail || userData.userPrincipalName,
                    },
                });
            } else {
                return NextResponse.json({
                    healthy: false,
                    error: `Graph API returned HTTP ${graphRes.status}`,
                    details: {
                        configured: true,
                        authenticated: true,
                        responseTime,
                        statusCode: graphRes.status,
                    },
                });
            }

        } catch (fetchError) {
            return NextResponse.json({
                healthy: false,
                error: fetchError instanceof Error ? fetchError.message : 'Network error',
                details: {
                    configured: true,
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
