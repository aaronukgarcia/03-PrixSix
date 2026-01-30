// GUID: API_WHATSAPP_PROXY-000-v03
// [Intent] HTTPS-to-HTTP proxy for the WhatsApp worker running on Azure Container Instances. Bridges the browser (HTTPS-only) to the internal HTTP-only WhatsApp worker, with admin auth, endpoint whitelisting, and HMAC request signing.
// [Inbound Trigger] GET and POST requests from the admin WhatsApp management UI component.
// [Downstream Impact] Forwards requests to the WhatsApp worker at prixsix-whatsapp.uksouth.azurecontainer.io:3000. Worker handles WhatsApp Web session management. If proxy fails, admin cannot manage WhatsApp integration.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAuthToken, getFirebaseAdmin } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis
export const dynamic = 'force-dynamic';

// GUID: API_WHATSAPP_PROXY-001-v03
// [Intent] Internal URL constant for the WhatsApp worker — HTTP-only, not exposed to browsers. Traffic flows: Browser -> this proxy (HTTPS) -> worker (HTTP).
// [Inbound Trigger] Referenced by GET and POST handlers when constructing fetch URLs.
// [Downstream Impact] Changing this URL requires the WhatsApp worker to be redeployed at the new address. Azure Container Instance DNS name.
const WHATSAPP_WORKER_INTERNAL_URL = 'http://prixsix-whatsapp.uksouth.azurecontainer.io:3000';

// GUID: API_WHATSAPP_PROXY-002-v03
// [Intent] Generate HMAC SHA-256 signature for outgoing worker requests so the worker can verify requests originate from this trusted proxy.
// [Inbound Trigger] Called by GET and POST handlers before forwarding each request.
// [Downstream Impact] If WHATSAPP_APP_SECRET is not set, returns null (signature header is omitted). Worker should validate signature when present.
function signRequest(payload: string): string | null {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return null;
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

// GUID: API_WHATSAPP_PROXY-003-v03
// [Intent] GET handler — proxies read-only requests to the WhatsApp worker. Verifies admin auth, whitelists allowed endpoints (health, status, qr), signs the request, and returns the worker's response. QR endpoint returns plain text; others return JSON.
// [Inbound Trigger] GET /api/whatsapp-proxy?endpoint=health|status|qr from the admin UI.
// [Downstream Impact] Returns worker health/status JSON or QR code text. If worker is down, returns the worker's HTTP error. Admin UI displays connection status based on these responses.
export async function GET(request: NextRequest) {
  try {
    // GUID: API_WHATSAPP_PROXY-004-v03
    // [Intent] Verify the caller has a valid Firebase Auth token and is an admin user. Two-step check: token verification then Firestore isAdmin lookup.
    // [Inbound Trigger] Every incoming GET request — auth check is mandatory.
    // [Downstream Impact] Returns 401 for missing/invalid token, 403 for non-admin users. Prevents unauthorised access to WhatsApp worker internals.
    const authResult = await verifyAuthToken(request.headers.get('Authorization'));
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(authResult.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // GUID: API_WHATSAPP_PROXY-005-v03
    // [Intent] Extract and validate the endpoint query parameter against a whitelist of allowed GET endpoints. Prevents arbitrary endpoint access on the worker.
    // [Inbound Trigger] Query parameter ?endpoint=... on the request URL.
    // [Downstream Impact] Returns 400 for disallowed endpoints. Only health, status, and qr are permitted. Adding new GET endpoints requires updating the whitelist.
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || 'status';

    // Whitelist of allowed endpoints
    const allowedEndpoints = ['health', 'status', 'qr'];
    if (!allowedEndpoints.includes(endpoint)) {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    // GUID: API_WHATSAPP_PROXY-006-v03
    // [Intent] Forward the validated GET request to the WhatsApp worker with HMAC signature. Handles QR endpoint as plain text, all others as JSON.
    // [Inbound Trigger] Endpoint validated against whitelist.
    // [Downstream Impact] Returns worker response to the admin UI. QR endpoint returns Content-Type: text/plain for QR code rendering. Network errors caught by outer try/catch.
    const signature = signRequest(endpoint);
    const workerResponse = await fetch(`${WHATSAPP_WORKER_INTERNAL_URL}/${endpoint}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain',
        ...(signature && { 'X-Hub-Signature-256': signature }),
      },
    });

    // For QR endpoint, return as text
    if (endpoint === 'qr') {
      if (!workerResponse.ok) {
        const errorData = await workerResponse.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.error || errorData.reason || `HTTP ${workerResponse.status}` },
          { status: workerResponse.status }
        );
      }
      const qrData = await workerResponse.text();
      return new NextResponse(qrData, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // For other endpoints, return JSON
    const data = await workerResponse.json();
    return NextResponse.json(data, { status: workerResponse.status });

  } catch (error: any) {
    // GUID: API_WHATSAPP_PROXY-007-v03
    // [Intent] Catch-all error handler for GET requests — logs to console and returns a generic proxy error.
    // [Inbound Trigger] Any uncaught exception (network failure, JSON parse error, etc.).
    // [Downstream Impact] Returns 500 to admin UI. Does not write to error_logs (lightweight proxy pattern).
    console.error('[WhatsApp Proxy] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Proxy error' },
      { status: 500 }
    );
  }
}

// GUID: API_WHATSAPP_PROXY-008-v03
// [Intent] POST handler — proxies write requests to the WhatsApp worker. Verifies admin auth, whitelists allowed POST endpoints (ping, trigger-test), signs the request, and returns the worker's JSON response.
// [Inbound Trigger] POST /api/whatsapp-proxy?endpoint=ping|trigger-test from the admin UI.
// [Downstream Impact] Triggers actions on the WhatsApp worker (ping to test connectivity, trigger-test to send test messages). Worker state may change as a result.
export async function POST(request: NextRequest) {
  try {
    // GUID: API_WHATSAPP_PROXY-009-v03
    // [Intent] Verify the caller has a valid Firebase Auth token and is an admin user. Same two-step check as GET handler.
    // [Inbound Trigger] Every incoming POST request — auth check is mandatory.
    // [Downstream Impact] Returns 401 for missing/invalid token, 403 for non-admin users.
    const authResult = await verifyAuthToken(request.headers.get('Authorization'));
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { db } = await getFirebaseAdmin();
    const userDoc = await db.collection('users').doc(authResult.uid).get();
    if (!userDoc.exists || !userDoc.data()?.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // GUID: API_WHATSAPP_PROXY-010-v03
    // [Intent] Extract and validate the endpoint query parameter against a whitelist of allowed POST endpoints. Prevents arbitrary write operations on the worker.
    // [Inbound Trigger] Query parameter ?endpoint=... on the request URL.
    // [Downstream Impact] Returns 400 for disallowed endpoints. Only ping and trigger-test are permitted. Adding new POST endpoints requires updating the whitelist.
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || 'ping';

    // Whitelist of allowed POST endpoints
    const allowedEndpoints = ['ping', 'trigger-test'];
    if (!allowedEndpoints.includes(endpoint)) {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    // GUID: API_WHATSAPP_PROXY-011-v03
    // [Intent] Forward the validated POST request to the WhatsApp worker with HMAC signature and return the JSON response.
    // [Inbound Trigger] Endpoint validated against whitelist.
    // [Downstream Impact] Returns worker response to the admin UI. Network errors caught by outer try/catch.
    const signature = signRequest(endpoint);
    const workerResponse = await fetch(`${WHATSAPP_WORKER_INTERNAL_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature && { 'X-Hub-Signature-256': signature }),
      },
    });

    const data = await workerResponse.json();
    return NextResponse.json(data, { status: workerResponse.status });

  } catch (error: any) {
    // GUID: API_WHATSAPP_PROXY-012-v03
    // [Intent] Catch-all error handler for POST requests — logs to console and returns a generic proxy error.
    // [Inbound Trigger] Any uncaught exception (network failure, JSON parse error, etc.).
    // [Downstream Impact] Returns 500 to admin UI. Does not write to error_logs (lightweight proxy pattern).
    console.error('[WhatsApp Proxy] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Proxy error' },
      { status: 500 }
    );
  }
}
