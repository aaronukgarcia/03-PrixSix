import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAuthToken, getFirebaseAdmin } from '@/lib/firebase-admin';

// Force dynamic to skip static analysis
export const dynamic = 'force-dynamic';

// Internal HTTP URL for the WhatsApp worker (not exposed to browsers)
const WHATSAPP_WORKER_INTERNAL_URL = 'http://prixsix-whatsapp.uksouth.azurecontainer.io:3000';

/**
 * Generate HMAC SHA-256 signature for worker requests
 * Worker can validate these to ensure requests come from the trusted proxy
 */
function signRequest(payload: string): string | null {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return null;
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

/**
 * Proxy requests to the WhatsApp worker
 * This allows the browser (HTTPS) to communicate with the HTTP-only worker
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
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

    // Get endpoint from query param
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || 'status';

    // Whitelist of allowed endpoints
    const allowedEndpoints = ['health', 'status', 'qr'];
    if (!allowedEndpoints.includes(endpoint)) {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    // Fetch from worker with HMAC signature
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
    console.error('[WhatsApp Proxy] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Proxy error' },
      { status: 500 }
    );
  }
}

/**
 * Proxy POST requests (for /ping endpoint)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin access
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

    // Get endpoint from query param
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || 'ping';

    // Whitelist of allowed POST endpoints
    const allowedEndpoints = ['ping', 'trigger-test'];
    if (!allowedEndpoints.includes(endpoint)) {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    // Fetch from worker with HMAC signature
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
    console.error('[WhatsApp Proxy] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Proxy error' },
      { status: 500 }
    );
  }
}
