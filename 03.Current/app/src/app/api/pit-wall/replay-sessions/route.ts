// GUID: API_REPLAY_SESSIONS-000-v02
// [Intent] Returns the list of GPS replay sessions — merges Firestore replay_sessions
//          (pre-ingested, ready to play) with OpenF1 completed Race + Sprint sessions
//          (may not be ingested yet). Authenticated users only (any signed-in user).
//          v02: FEAT-PW-004 — query OpenF1 for all completed 2026 Race/Sprint sessions
//               and merge with Firestore docs. Non-ingested sessions have available=false.
//               Sorted by dateStart descending (most recent first).
// [Inbound Trigger] Called by PitWallClient on entering replay mode to populate session picker.
// [Downstream Impact] Returns ReplaySessionMetadata[] for useReplayPlayer.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { getSecret } from '@/lib/secrets-manager';

export const dynamic = 'force-dynamic';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';
const FETCH_TIMEOUT_MS = 10_000;

let cachedToken: { token: string; expiresAt: number } | null = null;

// GUID: API_REPLAY_SESSIONS-002-v01
// [Intent] Fetch with AbortController timeout — reuses pattern from historical-sessions route.
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// GUID: API_REPLAY_SESSIONS-003-v01
// [Intent] Obtain an OpenF1 bearer token using stored credentials, with in-memory caching.
//          Returns null if credentials are unavailable (unauthenticated requests still work).
async function getOpenF1Token(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  let username: string, password: string;
  try {
    username = await getSecret('openf1-username', { envVarName: 'OPENF1_USERNAME' });
    password = await getSecret('openf1-password', { envVarName: 'OPENF1_PASSWORD' });
  } catch {
    return null;
  }
  try {
    const res = await fetchWithTimeout(OPENF1_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password, grant_type: 'password' }).toString(),
    }, 8_000);
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cachedToken.token;
  } catch {
    return null;
  }
}

// GUID: API_REPLAY_SESSIONS-004-v01
// [Intent] Query OpenF1 for all completed 2026 Race and Sprint sessions.
//          Returns raw session objects or empty array on failure (non-fatal — Firestore
//          sessions are still returned even if OpenF1 is down).
async function fetchOpenF1Sessions(): Promise<any[]> {
  let token: string | null = null;
  try { token = await getOpenF1Token(); } catch { /* proceed without */ }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const results: any[] = [];
  for (const sessionType of ['Race', 'Sprint']) {
    try {
      const url = `${OPENF1_BASE}/sessions?year=2026&session_type=${sessionType}`;
      const res = await fetchWithTimeout(url, { headers, next: { revalidate: 0 } });
      if (!res.ok) continue;
      const text = await res.text();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { continue; }
      if (Array.isArray(parsed)) {
        // Only include sessions that have already started (dateStart is in the past)
        const now = new Date();
        for (const s of parsed) {
          if (s.date_start && new Date(s.date_start) < now) {
            results.push(s);
          }
        }
      }
    } catch {
      // Non-fatal — continue with other session type or Firestore-only results
    }
  }
  return results;
}

// GUID: API_REPLAY_SESSIONS-001-v02
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();
  getFirebaseAdmin();

  const authResult = await verifyAuthToken(req.headers.get('Authorization'));
  if (!authResult) {
    return NextResponse.json(
      { error: ERRORS.SESSION_INVALID.message, code: ERRORS.SESSION_INVALID.code, correlationId },
      { status: 401 },
    );
  }

  try {
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();

    // Fetch Firestore replay_sessions and OpenF1 completed sessions in parallel
    const [snapshot, openF1Sessions] = await Promise.all([
      db.collection('replay_sessions')
        .where('status', '==', 'available')
        .orderBy('dateStart', 'desc')
        .limit(50)
        .get(),
      fetchOpenF1Sessions(),
    ]);

    // Build a map of Firestore sessions keyed by sessionKey for fast lookup
    const firestoreMap = new Map<number, any>();
    for (const doc of snapshot.docs) {
      const d = doc.data();
      firestoreMap.set(d.sessionKey, {
        sessionKey:         d.sessionKey,
        sessionName:        d.sessionName,
        meetingName:        d.meetingName,
        circuitKey:         d.circuitKey,
        year:               d.year,
        dateStart:          d.dateStart,
        durationMs:         d.durationMs,
        totalDrivers:       d.totalDrivers,
        totalFrames:        d.totalFrames,
        downloadUrl:        d.downloadUrl,
        fileSizeBytesGzip:  d.fileSizeBytesGzip,
        fileSizeBytesRaw:   d.fileSizeBytesRaw,
        samplingIntervalMs: d.samplingIntervalMs,
        firestoreStatus:    d.firestoreStatus ?? 'none',
        totalChunks:        d.firestoreChunkCount ?? 0,
        available:          true,
      });
    }

    // Merge OpenF1 sessions — add any that aren't already in Firestore
    for (const s of openF1Sessions) {
      const key = s.session_key;
      if (!firestoreMap.has(key)) {
        firestoreMap.set(key, {
          sessionKey:         key,
          sessionName:        s.session_name ?? s.session_type ?? 'Race',
          meetingName:        s.meeting_name ?? 'Unknown',
          circuitKey:         s.circuit_key ?? 0,
          year:               s.year ?? 2026,
          dateStart:          s.date_start ?? '',
          durationMs:         0,
          totalDrivers:       0,
          totalFrames:        0,
          downloadUrl:        '',
          fileSizeBytesGzip:  0,
          fileSizeBytesRaw:   0,
          samplingIntervalMs: 0,
          firestoreStatus:    'none',
          totalChunks:        0,
          available:          false,
        });
      }
    }

    // Sort by dateStart descending (most recent first)
    const sessions = Array.from(firestoreMap.values()).sort((a, b) => {
      const dateA = a.dateStart ? new Date(a.dateStart).getTime() : 0;
      const dateB = b.dateStart ? new Date(b.dateStart).getTime() : 0;
      return dateB - dateA;
    });

    return NextResponse.json({ sessions });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: ERRORS.PIT_WALL_REPLAY_SESSIONS_FAILED.message,
        code:  ERRORS.PIT_WALL_REPLAY_SESSIONS_FAILED.code,
        correlationId,
      },
      { status: 500 },
    );
  }
}
