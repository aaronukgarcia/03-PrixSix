// GUID: API_ADMIN_EMAIL_HEALTH-000-v03
// [Intent] Health check endpoint for Email/Graph API interface. Returns connectivity status
//          by making a lightweight test call to Microsoft Graph API.
// [Inbound Trigger] GET request from InterfaceHealthMonitor component (auto-refresh every 30s).
// [Downstream Impact] Read-only health check - makes GET /users/{senderEmail} call to Graph API to verify credentials.
// @FIX(v02) Added detailed error messaging from Microsoft OAuth response for better diagnostics.
// @FIX(v03) PX-BUG-001: Replaced /me probe with /users/{senderEmail} — /me requires a delegated (user) token
//           but this app uses client_credentials (app-only) flow. /me always returns HTTP 400 for app-only tokens.
//           /users/{senderEmail} is the correct probe for app-only tokens and validates the exact sender account.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GUID: API_ADMIN_EMAIL_HEALTH-001-v02
// [Intent] GET handler that checks Microsoft Graph API connectivity using /users/{senderEmail} endpoint.
// [Inbound Trigger] GET /api/admin/email/health with Authorization header.
// [Downstream Impact] Makes GET https://graph.microsoft.com/v1.0/users/{senderEmail} to verify Graph API credentials.
//                     Uses app-only endpoint (client_credentials flow) — /me is NOT valid for app-only tokens.
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
        const senderEmail = process.env.GRAPH_SENDER_EMAIL;

        if (!clientId || !clientSecret || !tenantId || !senderEmail) {
            return NextResponse.json({
                healthy: false,
                error: 'Microsoft Graph API credentials not configured',
                details: {
                    configured: false,
                    hasClientId: !!clientId,
                    hasClientSecret: !!clientSecret,
                    hasTenantId: !!tenantId,
                    hasSenderEmail: !!senderEmail,
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
                // Get error details from Microsoft's response
                let errorDetails = 'Unknown error';
                try {
                    const errorData = await tokenRes.json();
                    errorDetails = errorData.error_description || errorData.error || 'No error details provided';
                } catch {
                    errorDetails = `HTTP ${tokenRes.status} - ${tokenRes.statusText}`;
                }

                return NextResponse.json({
                    healthy: false,
                    error: `Failed to get access token: HTTP ${tokenRes.status}`,
                    details: {
                        configured: true,
                        authFailed: true,
                        microsoftError: errorDetails,
                        hint: 'Check Azure AD app registration: client secret may be expired, or credentials may be incorrect',
                    },
                });
            }

            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;

            // Test Graph API with /users/{senderEmail} — correct probe for app-only (client_credentials) tokens.
            // /me requires a delegated token (signed-in user) and always returns 400 for app-only tokens.
            // /users/{email} uses User.Read.All application permission — same auth context as Mail.Send.
            const graphRes = await fetch(
                `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}?$select=id,mail,displayName`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(5000),
                }
            );

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
                        senderEmail: userData.mail || userData.userPrincipalName,
                        senderName: userData.displayName,
                    },
                });
            } else {
                const errorBody = await graphRes.json().catch(() => ({}));
                return NextResponse.json({
                    healthy: false,
                    error: `Graph API returned HTTP ${graphRes.status}`,
                    details: {
                        configured: true,
                        authenticated: true,
                        responseTime,
                        statusCode: graphRes.status,
                        graphError: errorBody?.error?.code,
                        hint: graphRes.status === 404
                            ? 'Sender account not found — verify GRAPH_SENDER_EMAIL is correct'
                            : graphRes.status === 403
                            ? 'Missing User.Read.All application permission on Azure AD app registration'
                            : 'Unexpected Graph API error',
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
