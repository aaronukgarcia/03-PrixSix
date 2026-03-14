// GUID: API_PIT_WALL_RAINVIEWER-000-v01
// [Intent] Server-side proxy for the RainViewer weather radar manifest API.
//          Returns the list of available radar tile timestamps for the client
//          to use when constructing the rain overlay on the track map.
// [Inbound Trigger] Called by WeatherStrip / PitWallTrackMap when rain overlay is needed.
// [Downstream Impact] Client uses the manifest to fetch radar tiles directly from RainViewer CDN.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, verifyAuthToken, generateCorrelationId } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';

export const dynamic = 'force-dynamic';

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedManifest: { data: any; expiresAt: number } | null = null;

// GUID: API_PIT_WALL_RAINVIEWER-001-v01
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();
  const { db } = getFirebaseAdmin();

  const authHeader = req.headers.get('Authorization');
  const authResult = await verifyAuthToken(authHeader, db);
  if (!authResult.valid) {
    return NextResponse.json(
      { error: ERRORS.SESSION_INVALID.message, code: ERRORS.SESSION_INVALID.code, correlationId },
      { status: 401 },
    );
  }

  // Return cached manifest if still fresh
  if (cachedManifest && cachedManifest.expiresAt > Date.now()) {
    return NextResponse.json(cachedManifest.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(RAINVIEWER_API, { signal: controller.signal, next: { revalidate: 0 } });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: ERRORS.PIT_WALL_RAIN_FETCH_FAILED?.message ?? 'Radar unavailable', code: 'PX-3305', correlationId },
        { status: 502 },
      );
    }

    const manifest = await res.json();
    cachedManifest = { data: manifest, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(manifest);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Radar request timed out', code: 'PX-3305', correlationId },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: ERRORS.PIT_WALL_RAIN_FETCH_FAILED?.message ?? 'Radar error', code: 'PX-3305', correlationId },
      { status: 500 },
    );
  }
}
