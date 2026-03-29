// GUID: API_PIT_WALL_LIVE_DATA-000-v01
// [Intent] Pit Wall live data aggregation endpoint. Fans out to multiple OpenF1
//          endpoints in parallel, merges results into a single DriverRaceState[]
//          response. Any authenticated user (not admin-only) can call this.
// [Inbound Trigger] Polled by usePitWallData hook at user-configured intervals (2-60s).
// [Downstream Impact] Returns PitWallLiveDataResponse — the single source of truth
//          for all Pit Wall live data. Partial failures return what data is available.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { RaceSchedule } from '@/lib/data';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { getSecret } from '@/lib/secrets-manager';
import {
  setLiveDataCache,
  setDetailCache,
  getCachedToken, setCachedToken,
  getOrFetchCoreData, getOrFetchDetailData,
  getLiveDataJsonCache, getDetailJsonCache,
  trackRequest, untrackRequest,
  type CacheSource,
} from '@/lib/pit-wall-cache';
import type {
  DriverRaceState, RadioMessage, RaceControlMessage,
  WeatherSnapshot, PitWallLiveDataResponse, TyreCompound, SectorStatus,
  DriverDetail, PitWallDetailResponse,
} from '@/app/(app)/pit-wall/_types/pit-wall.types';

export const dynamic = 'force-dynamic';

// GUID: API_PIT_WALL_LIVE_DATA-001-v02
// [Intent] Module-level constants and shared server-side caches.
//          v02: Added liveDataCache — one OpenF1 fan-out shared across all
//               concurrent users. Auth still verified per-request; only the
//               expensive OpenF1 calls are de-duplicated.
//
//  LIVE_DATA_CACHE_TTL_MS controls freshness vs API savings:
//    10s = at most 6× reduction for users polling at 60s intervals;
//          serves concurrent users hitting within the same 10s window.
//    Between sessions the no-session response uses IDLE_CACHE_TTL_MS (60s).
const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';
const FETCH_TIMEOUT_MS = 10_000;
const LIVE_DATA_CACHE_TTL_MS = 2_000;   // active session cache — matches minimum poll interval
const IDLE_CACHE_TTL_MS       = 60_000; // no-session / between-races cache

// GUID: API_PIT_WALL_LIVE_DATA-011-v02
// [Intent] Cache variables migrated to shared module (pit-wall-cache.ts) so admin
//          health/purge endpoints can introspect and clear them. Access via get/set helpers.
//          See LIB_PITWALL_CACHE-000 for architectural notes on module-level state.
const DETAIL_CACHE_TTL_MS = 10_000;

// GUID: API_PIT_WALL_LIVE_DATA-002-v01
// [Intent] Hard-coded circuit lat/lon lookup by OpenF1 circuit_key.
//          OpenF1 location data uses projected metres, not WGS84 — this table
//          provides the geographic centroid for RainViewer tile sampling.
const CIRCUIT_COORDS: Record<number, { lat: number; lon: number }> = {
  55:  { lat: -37.8497,  lon: 144.9680  }, // Melbourne (Australian GP)
  17:  { lat: 31.3389,   lon: 121.2196  }, // Shanghai (Chinese GP)
  63:  { lat: 24.4672,   lon: 54.6031   }, // Yas Marina (Abu Dhabi)
  6:   { lat: 26.0325,   lon: 50.5106   }, // Bahrain
  73:  { lat: 43.7347,   lon: 7.4205    }, // Monaco
  13:  { lat: 51.5133,   lon: -0.2900   }, // Silverstone
  14:  { lat: 43.3665,   lon: 5.2476    }, // Paul Ricard
  23:  { lat: 47.5789,   lon: 19.2486   }, // Hungaroring
  10:  { lat: 50.4372,   lon: 5.9714    }, // Spa
  33:  { lat: 52.3888,   lon: 4.5409    }, // Zandvoort
  22:  { lat: 45.6156,   lon: 9.2811    }, // Monza
  71:  { lat: 40.3725,   lon: 49.8533   }, // Baku
  61:  { lat: 1.2914,    lon: 103.8640  }, // Singapore
  39:  { lat: 35.3717,   lon: 136.9232  }, // Suzuka
  66:  { lat: 19.4042,   lon: -99.0907  }, // Mexico City
  69:  { lat: 30.1328,   lon: -97.6411  }, // Circuit of the Americas
  18:  { lat: -23.7036,  lon: -46.6997  }, // Interlagos
  80:  { lat: 53.7878,   lon: -1.5596   }, // Imola (approximate)
  48:  { lat: 45.9916,   lon: 8.9512    }, // Imola
  76:  { lat: 37.2375,   lon: -8.6310   }, // Portimao
};

// GUID: API_PIT_WALL_LIVE_DATA-003-v01
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

// GUID: API_PIT_WALL_LIVE_DATA-004-v01
async function safeParseJson<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`[${context}] Non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
}

// GUID: API_PIT_WALL_LIVE_DATA-005-v01
async function getOpenF1Token(): Promise<string | null> {
  const cachedToken = getCachedToken();
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
    const data = await safeParseJson<{ access_token: string; expires_in: number }>(res, 'getOpenF1Token');
    const newToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    setCachedToken(newToken);
    return newToken.token;
  } catch {
    return null;
  }
}

// GUID: API_PIT_WALL_LIVE_DATA-006-v01
async function openF1Fetch<T>(path: string, token: string | null): Promise<T | null> {
  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetchWithTimeout(`${OPENF1_BASE}${path}`, { headers });
    if (!res.ok) return null;
    return await safeParseJson<T>(res, path);
  } catch {
    return null;
  }
}

// GUID: API_PIT_WALL_LIVE_DATA-007-v01
// [Intent] Map OpenF1 compound string to typed TyreCompound.
function parseTyreCompound(raw: string | undefined): TyreCompound {
  const map: Record<string, TyreCompound> = {
    SOFT: 'SOFT', MEDIUM: 'MEDIUM', HARD: 'HARD',
    INTERMEDIATE: 'INTERMEDIATE', WET: 'WET',
    INTER: 'INTERMEDIATE', // alias
  };
  return map[raw?.toUpperCase() ?? ''] ?? 'UNKNOWN';
}

// GUID: API_PIT_WALL_LIVE_DATA-008-v01
// [Intent] Format lap time seconds to "m:ss.mmm" string.
function formatLapTime(seconds: number | null | undefined): number | null {
  if (seconds == null || seconds <= 0) return null;
  return seconds;
}

// GUID: API_PIT_WALL_LIVE_DATA-009-v02
// [Intent] Get latest entry per driver via single-pass O(N) scan — no sort, no array copy.
//          v02: Replaced O(N log N) [...arr].sort() with O(N) scan. At lap 30, /location
//          returns ~189K objects — the sort blocked the event loop for 500ms-2s.
function latestPerDriver<T extends { driver_number: number; date?: string }>(arr: T[]): Map<number, T> {
  const map = new Map<number, T>();
  for (const item of arr) {
    const existing = map.get(item.driver_number);
    if (!existing || (item.date ?? '') > (existing.date ?? '')) {
      map.set(item.driver_number, item);
    }
  }
  return map;
}

// GUID: API_PIT_WALL_LIVE_DATA-015-v02
// [Intent] Detail tier handler — fetches only the slow/heavy OpenF1 endpoints
//          (laps, car_data, team_radio). Called simultaneously with the core tier
//          by usePitWallData; responds independently so slow data doesn't block
//          the race table from appearing. Returns PitWallDetailResponse.
//          v02: Uses getOrFetchDetailData for promise coalescing — concurrent
//               requests share a single in-flight fetch instead of each triggering
//               their own OpenF1 fan-out.
async function handleDetailRequest(
  token: string | null,
  correlationId: string,
): Promise<NextResponse> {
  const { data, source } = await getOrFetchDetailData(() => fetchDetailFromOpenF1(token));

  // GUID: API_PIT_WALL_LIVE_DATA-024-v01
  // [Intent] Use pre-stringified JSON for cache/coalesced responses to avoid N×JSON.stringify().
  //          slice(0, -1) removes the closing "}" so we can append cache metadata fields
  //          before re-closing. This avoids parsing and re-stringifying the entire payload.
  if (source === 'cache' || source === 'coalesced') {
    const jsonStr = getDetailJsonCache();
    if (jsonStr) {
      const augmented = jsonStr.slice(0, -1) + `,"cacheHit":${source === 'cache'},"coalesced":${source === 'coalesced'}}`;
      return new NextResponse(augmented, {
        headers: { 'Content-Type': 'application/json', 'X-PW-Cache': source },
      });
    }
  }

  // Fallback: fresh fetch — use NextResponse.json as before
  const res = NextResponse.json({ ...data, cacheHit: false, coalesced: false });
  res.headers.set('X-PW-Cache', source);
  return res;
}

// GUID: API_PIT_WALL_LIVE_DATA-022-v01
// [Intent] Extracted detail-tier OpenF1 fetch logic for promise coalescing.
//          Fetches laps, car_data, team_radio + session/driver metadata,
//          builds PitWallDetailResponse, and populates the detail cache.
async function fetchDetailFromOpenF1(token: string | null): Promise<PitWallDetailResponse> {
  // GUID: API_PIT_WALL_LIVE_DATA-025-v01
  // [Intent] 30-second time window for /laps and /car_data (same rationale as core tier).
  //          /car_data is the heaviest endpoint in the detail tier — ~4500 records/s across 20 drivers.
  //          /team_radio is left unbounded (small, needed in full for message history display).
  const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
  const detailDateSuffix = `&date>${encodeURIComponent(thirtySecondsAgo)}`;

  const [lapsRaw, carDataRaw, teamRadioRaw, sessionsRaw, driversRaw] = await Promise.all([
    openF1Fetch<any[]>('/laps?session_key=latest', token),  // unbounded — cumulative stats (best lap, sectors, lap count) need full history; ~1400 records max (20 drivers × 70 laps)
    openF1Fetch<any[]>(`/car_data?session_key=latest${detailDateSuffix}`, token),
    openF1Fetch<any[]>('/team_radio?session_key=latest', token),
    // Need session + driver info for radio messages and sessionKey for cache invalidation
    openF1Fetch<any[]>('/sessions?session_key=latest', token),
    openF1Fetch<any[]>('/drivers?session_key=latest', token),
  ]);

  const sessionKey: number | null = sessionsRaw?.[0]?.session_key ?? null;
  const driverMap = new Map<number, any>();
  (driversRaw ?? []).forEach((d: any) => driverMap.set(d.driver_number, d));

  // Lap aggregations per driver
  const bestLaps = new Map<number, number>();
  const lastLaps = new Map<number, any>();
  const lapCounts = new Map<number, number>();
  (lapsRaw ?? []).forEach((lap: any) => {
    const dn = lap.driver_number;
    const dur = lap.lap_duration;
    if (dur && dur > 0 && !lap.is_pit_out_lap) {
      if (!bestLaps.has(dn) || dur < bestLaps.get(dn)!) bestLaps.set(dn, dur);
    }
    const lapNum = lap.lap_number ?? 0;
    if (!lapCounts.has(dn) || lapNum > lapCounts.get(dn)!) {
      lapCounts.set(dn, lapNum);
      lastLaps.set(dn, lap);
    }
  });

  // Session best per sector
  let bestS1 = Infinity, bestS2 = Infinity, bestS3 = Infinity;
  const driverBestS1 = new Map<number, number>();
  const driverBestS2 = new Map<number, number>();
  const driverBestS3 = new Map<number, number>();
  (lapsRaw ?? []).forEach((lap: any) => {
    const dn = lap.driver_number;
    if (lap.duration_sector_1 && lap.duration_sector_1 < bestS1) bestS1 = lap.duration_sector_1;
    if (lap.duration_sector_2 && lap.duration_sector_2 < bestS2) bestS2 = lap.duration_sector_2;
    if (lap.duration_sector_3 && lap.duration_sector_3 < bestS3) bestS3 = lap.duration_sector_3;
    if (lap.duration_sector_1 && (!driverBestS1.has(dn) || lap.duration_sector_1 < driverBestS1.get(dn)!)) driverBestS1.set(dn, lap.duration_sector_1);
    if (lap.duration_sector_2 && (!driverBestS2.has(dn) || lap.duration_sector_2 < driverBestS2.get(dn)!)) driverBestS2.set(dn, lap.duration_sector_2);
    if (lap.duration_sector_3 && (!driverBestS3.has(dn) || lap.duration_sector_3 < driverBestS3.get(dn)!)) driverBestS3.set(dn, lap.duration_sector_3);
  });

  let fastestLapTime = Infinity, fastestLapDriver = -1;
  bestLaps.forEach((time, dn) => { if (time < fastestLapTime) { fastestLapTime = time; fastestLapDriver = dn; } });

  // Latest car data per driver
  const latestCarData = latestPerDriver(carDataRaw ?? []);

  // Stints — needed for tyre age with lap count
  const latestStints = new Map<number, any>();
  // (We don't fetch stints here — they're in core. TyreLapAge will be refined on next core poll.)

  const sectorStatus = (actual: number | null | undefined, driverBest: number | undefined, sessionBest: number): SectorStatus => {
    if (!actual) return null;
    if (actual <= sessionBest + 0.001) return 'session_best';
    if (driverBest && actual <= driverBest + 0.001) return 'personal_best';
    return 'normal';
  };

  // Find the most recent lap WITH sector data for each driver.
  // The highest-numbered lap may have no sectors yet (driver just crossed S/F line),
  // so fall back to the previous lap's sectors until new ones arrive.
  const lastSectorLaps = new Map<number, any>();
  const sortedLapsDesc = [...(lapsRaw ?? [])].sort((a: any, b: any) => (b.lap_number ?? 0) - (a.lap_number ?? 0));
  for (const lap of sortedLapsDesc) {
    const dn = lap.driver_number;
    if (!lastSectorLaps.has(dn) && (lap.duration_sector_1 || lap.duration_sector_2 || lap.duration_sector_3)) {
      lastSectorLaps.set(dn, lap);
    }
  }

  // Build DriverDetail[] for all drivers with lap data
  const allDriverNumbers = new Set<number>([...lapCounts.keys(), ...latestCarData.keys()]);
  const driverDetail: DriverDetail[] = [];
  allDriverNumbers.forEach(dn => {
    const lastLap = lastLaps.get(dn);
    const lapNum = lapCounts.get(dn) ?? 0;
    const car = latestCarData.get(dn);
    const sectorLap = lastSectorLaps.get(dn) ?? lastLap;
    const s1 = sectorLap?.duration_sector_1 ?? null;
    const s2 = sectorLap?.duration_sector_2 ?? null;
    const s3 = sectorLap?.duration_sector_3 ?? null;
    driverDetail.push({
      driverNumber: dn,
      currentLap: lapNum,
      lastLapTime: formatLapTime(lastLap?.lap_duration),
      bestLapTime: formatLapTime(bestLaps.get(dn)),
      fastestLap: dn === fastestLapDriver,
      sectors: {
        s1, s2, s3,
        s1Status: sectorStatus(s1, driverBestS1.get(dn), bestS1),
        s2Status: sectorStatus(s2, driverBestS2.get(dn), bestS2),
        s3Status: sectorStatus(s3, driverBestS3.get(dn), bestS3),
      },
      tyreCompound: 'UNKNOWN', // refined by core (stints endpoint)
      tyreLapAge: 0,           // refined by core
      pitStopCount: 0,         // refined by core
      onNewTyres: false,       // refined by core
      speed: car?.speed ?? null,
      throttle: car?.throttle ?? null,
      brake: car?.brake != null ? car.brake > 0 : null,
      gear: car?.n_gear ?? null,
    });
  });

  // Radio messages
  const radioMessages: RadioMessage[] = (teamRadioRaw ?? []).map((r: any): RadioMessage => {
    const driverInfo = driverMap.get(r.driver_number) ?? {};
    return {
      id: String(`${sessionKey}_${r.driver_number}_${r.date}`),
      driverNumber: Number(r.driver_number),
      driverCode: String(driverInfo.name_acronym ?? `D${r.driver_number}`),
      teamName: String(driverInfo.team_name ?? ''),
      teamColour: String(driverInfo.team_colour ?? '444444'),
      recordingUrl: r.recording_url ?? null,
      date: String(r.date ?? ''),
      isRead: false,
      sessionKey: sessionKey ?? 0,
    };
  });

  const detailResponse: PitWallDetailResponse = {
    sessionKey,
    driverDetail,
    radioMessages,
    fetchedAt: Date.now(),
    cacheHit: false,
  };

  setDetailCache({ sessionKey, data: detailResponse, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
  return detailResponse;
}

// GUID: API_PIT_WALL_LIVE_DATA-010-v04
// [Intent] v04: Tiered fetch with promise coalescing.
//          Core: 8 fast endpoints (sessions/drivers/position/location/intervals/stints/weather/race_control).
//          Detail: 3 slow endpoints (laps/car_data/team_radio) — separate cache, higher TTL.
//          Client fires both simultaneously; core renders the table first, detail enriches it.
//          Promise coalescing via getOrFetchCoreData/getOrFetchDetailData ensures only one
//          in-flight OpenF1 fan-out per tier — concurrent requests share the same promise.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = generateCorrelationId();

  // Auth — any signed-in user
  const authHeader = req.headers.get('Authorization');
  getFirebaseAdmin(); // ensure Admin SDK is initialised
  const authResult = await verifyAuthToken(authHeader);
  if (!authResult) {
    return NextResponse.json(
      { error: ERRORS.SESSION_INVALID.message, code: ERRORS.SESSION_INVALID.code, correlationId },
      { status: 401 },
    );
  }

  const tier = new URL(req.url).searchParams.get('tier') ?? 'core';
  const token = await getOpenF1Token();

  // GUID: API_PIT_WALL_LIVE_DATA-023-v01
  // [Intent] Track active request concurrency for admin metrics.
  //          trackRequest/untrackRequest maintain a counter + high-water mark
  //          in pit-wall-cache.ts. Always untrack in finally{} to prevent leaks.
  trackRequest();
  try {
    if (tier === 'detail') {
      return await handleDetailRequest(token, correlationId);
    }

    // GUID: API_PIT_WALL_LIVE_DATA-012-v02
    // [Intent] Core tier with promise coalescing — getOrFetchCoreData checks:
    //          1. Cache hit → return immediately (no OpenF1 calls)
    //          2. In-flight promise → coalesce (await the existing fetch)
    //          3. Cache miss → start a new fetch, store promise for others to share
    //          v02: Replaced raw cache check with getOrFetchCoreData.
    const { data, source } = await getOrFetchCoreData(() => fetchCoreFromOpenF1(token));

    // GUID: API_PIT_WALL_LIVE_DATA-025-v01
    // [Intent] Use pre-stringified JSON for cache/coalesced responses to avoid N×JSON.stringify().
    //          When 200 coalesced requests resolve simultaneously, each would call
    //          NextResponse.json() which runs JSON.stringify() on the same large object.
    //          Pre-stringified cache eliminates this CPU spike entirely.
    if (source === 'cache' || source === 'coalesced') {
      const jsonStr = getLiveDataJsonCache();
      if (jsonStr) {
        const cacheAgeMs = Date.now() - data.fetchedAt;
        const augmented = jsonStr.slice(0, -1) + `,"cacheHit":${source === 'cache'},"coalesced":${source === 'coalesced'},"cacheAgeMs":${cacheAgeMs}}`;
        return new NextResponse(augmented, {
          headers: { 'Content-Type': 'application/json', 'X-PW-Cache': source },
        });
      }
    }

    // Fallback: fresh fetch — use NextResponse.json as before
    const res = NextResponse.json({
      ...data,
      cacheHit: false,
      coalesced: false,
      cacheAgeMs: 0,
    });
    res.headers.set('X-PW-Cache', source);
    return res;
  } finally {
    untrackRequest();
  }
}

// GUID: API_PIT_WALL_LIVE_DATA-021-v01
// [Intent] Extracted core-tier OpenF1 fetch logic for promise coalescing.
//          Fans out to 8 fast endpoints, builds PitWallLiveDataResponse,
//          and populates the live data cache. Called only by getOrFetchCoreData
//          when both the cache and in-flight promise are empty.
async function fetchCoreFromOpenF1(token: string | null): Promise<PitWallLiveDataResponse> {
  // GUID: API_PIT_WALL_LIVE_DATA-024-v01
  // [Intent] 30-second time window for high-volume endpoints (/location, /position, /intervals).
  //          Without this, /location returns the ENTIRE session history (~189K objects / ~30MB by lap 30).
  //          A 30s window caps data at ~2100 records (30s × 70 samples/s) — a ~90× reduction.
  //          Small endpoints (sessions, drivers, stints, weather, race_control) are left unbounded
  //          as they don't grow significantly during a session.
  const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString();
  const dateSuffix = `&date>${encodeURIComponent(thirtySecondsAgo)}`;

  // Core tier: 8 fast endpoints — no laps/car_data/team_radio
  const [
    sessionsRaw, driversRaw, raceOrderRaw, locationsRaw, intervalsRaw,
    stintsRaw, weatherRaw, raceControlRaw,
  ] = await Promise.all([
    openF1Fetch<any[]>('/sessions?session_key=latest', token),
    openF1Fetch<any[]>('/drivers?session_key=latest', token),
    openF1Fetch<any[]>(`/position?session_key=latest${dateSuffix}`, token),   // race order (1st/2nd/…)
    openF1Fetch<any[]>(`/location?session_key=latest${dateSuffix}`, token),   // GPS x/y/z for track map
    openF1Fetch<any[]>(`/intervals?session_key=latest${dateSuffix}`, token),
    openF1Fetch<any[]>('/stints?session_key=latest', token),
    openF1Fetch<any[]>('/weather?session_key=latest', token),
    openF1Fetch<any[]>('/race_control?session_key=latest', token),
  ]);

  // Slow endpoints moved to detail tier — stub as empty so driver builder compiles cleanly
  const lapsRaw: any[] = [];
  const carDataRaw: any[] = [];
  const teamRadioRaw: any[] = [];

  // Session metadata
  const session = sessionsRaw?.[0] ?? null;
  const sessionKey: number | null = session?.session_key ?? null;
  const sessionName: string | null = session?.session_name ?? null;
  const meetingName: string | null = session?.meeting_name ?? null;
  const sessionType: string | null = session?.session_type ?? null;
  const circuitKey: number | null = session?.circuit_key ?? null;
  const circuitCoords = circuitKey ? (CIRCUIT_COORDS[circuitKey] ?? null) : null;
  const totalLaps: number | null = session?.total_laps ?? null;

  // Stale session detection — if OpenF1 returns a session >48h old, it's stale.
  // Return idle response with correct upcoming race info from RaceSchedule.
  const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;
  const sessionDateStart = session?.date_start ? new Date(session.date_start).getTime() : 0;
  const isStaleSession = sessionKey && sessionDateStart > 0 &&
    (Date.now() - sessionDateStart) > STALE_THRESHOLD_MS;

  if (!sessionKey || isStaleSession) {
    // Find the next expected race from the schedule
    const now = new Date();
    const nextRace = RaceSchedule.find(r => new Date(r.raceTime) > now)
      ?? RaceSchedule[RaceSchedule.length - 1];
    // Find circuitKey for this race by matching location against CIRCUIT_COORDS names
    // (we don't have a direct mapping, so use meetingName from the response if not stale,
    //  or leave circuitKey null for the between-races state)
    const awaitingMeetingName = isStaleSession ? nextRace.name : null;
    const idleResponse: PitWallLiveDataResponse = {
      sessionKey: null, sessionName: null,
      meetingName: awaitingMeetingName,
      circuitKey: null,
      circuitLat: null, circuitLon: null, drivers: [], raceControl: [],
      radioMessages: [], weather: null, totalLaps: null, sessionType: null,
      positionDataAvailable: false,
      sfLineX: null, sfLineY: null,
      fetchedAt: Date.now(), cacheHit: false, cacheAgeMs: 0,
    };
    setLiveDataCache({ sessionKey: null, data: idleResponse, expiresAt: Date.now() + IDLE_CACHE_TTL_MS });
    return idleResponse;
  }

  // Build lookup maps
  const driverMap = new Map<number, any>();
  (driversRaw ?? []).forEach((d: any) => driverMap.set(d.driver_number, d));

  // Race order (grid position 1st/2nd/…) — from /position
  const latestPositions = latestPerDriver(raceOrderRaw ?? []);
  // GPS coordinates (x/y/z projected metres) — from /location
  const latestLocations = latestPerDriver(locationsRaw ?? []);
  if (latestLocations.size === 0 && driversRaw && driversRaw.length > 0) {
    console.warn(`[pit-wall/live-data] Location data empty for session ${sessionKey} — track map will show no cars`);
  }
  const latestIntervals = latestPerDriver(intervalsRaw ?? []);
  const latestCarData = latestPerDriver(carDataRaw ?? []);

  // Latest stint per driver
  const latestStints = new Map<number, any>();
  (stintsRaw ?? []).sort((a: any, b: any) => (b.stint_number ?? 0) - (a.stint_number ?? 0))
    .forEach((s: any) => { if (!latestStints.has(s.driver_number)) latestStints.set(s.driver_number, s); });

  // Lap data — best lap and last lap per driver
  const bestLaps = new Map<number, number>();
  const lastLaps = new Map<number, any>();
  const lapCounts = new Map<number, number>();
  (lapsRaw ?? []).forEach((lap: any) => {
    const dn = lap.driver_number;
    const dur = lap.lap_duration;
    if (dur && dur > 0 && !lap.is_pit_out_lap) {
      if (!bestLaps.has(dn) || dur < bestLaps.get(dn)!) bestLaps.set(dn, dur);
    }
    const lapNum = lap.lap_number ?? 0;
    if (!lapCounts.has(dn) || lapNum > lapCounts.get(dn)!) {
      lapCounts.set(dn, lapNum);
      lastLaps.set(dn, lap);
    }
  });

  // GUID: API_PIT_WALL_LIVE_DATA-020-v01
  // [Intent] Compute the approximate S/F line GPS position by correlating the /laps
  //          date_start timestamp (when a driver crosses S/F) with the nearest /location
  //          GPS reading for the same driver. Uses the most recent completed non-pit-out lap.
  //          date_start is approximate (~±0.5s), and /location samples at ~3.7 Hz, so
  //          the closest GPS point is within ~135ms of the actual S/F crossing.
  let sfLineX: number | null = null;
  let sfLineY: number | null = null;
  if (lapsRaw && lapsRaw.length > 0 && locationsRaw && locationsRaw.length > 0) {
    const validLaps = (lapsRaw as any[])
      .filter((l: any) => l.date_start && !l.is_pit_out_lap && l.lap_duration && l.lap_duration > 0)
      .sort((a: any, b: any) => (b.date_start ?? '').localeCompare(a.date_start ?? ''));

    if (validLaps.length > 0) {
      const refLap = validLaps[0];
      const refDriver = refLap.driver_number;
      const refTime = new Date(refLap.date_start).getTime();

      let closestLoc: any = null;
      let closestDelta = Infinity;
      for (const loc of (locationsRaw as any[])) {
        if (loc.driver_number !== refDriver || loc.x == null || loc.y == null) continue;
        const delta = Math.abs(new Date(loc.date).getTime() - refTime);
        if (delta < closestDelta) {
          closestDelta = delta;
          closestLoc = loc;
        }
      }

      if (closestLoc && closestDelta < 2000) {
        sfLineX = closestLoc.x;
        sfLineY = closestLoc.y;
      }
    }
  }

  // Session best per sector
  let bestS1 = Infinity, bestS2 = Infinity, bestS3 = Infinity;
  (lapsRaw ?? []).forEach((lap: any) => {
    if (lap.duration_sector_1 && lap.duration_sector_1 < bestS1) bestS1 = lap.duration_sector_1;
    if (lap.duration_sector_2 && lap.duration_sector_2 < bestS2) bestS2 = lap.duration_sector_2;
    if (lap.duration_sector_3 && lap.duration_sector_3 < bestS3) bestS3 = lap.duration_sector_3;
  });

  // Per-driver best sectors
  const driverBestS1 = new Map<number, number>();
  const driverBestS2 = new Map<number, number>();
  const driverBestS3 = new Map<number, number>();
  (lapsRaw ?? []).forEach((lap: any) => {
    const dn = lap.driver_number;
    if (lap.duration_sector_1) {
      if (!driverBestS1.has(dn) || lap.duration_sector_1 < driverBestS1.get(dn)!) driverBestS1.set(dn, lap.duration_sector_1);
    }
    if (lap.duration_sector_2) {
      if (!driverBestS2.has(dn) || lap.duration_sector_2 < driverBestS2.get(dn)!) driverBestS2.set(dn, lap.duration_sector_2);
    }
    if (lap.duration_sector_3) {
      if (!driverBestS3.has(dn) || lap.duration_sector_3 < driverBestS3.get(dn)!) driverBestS3.set(dn, lap.duration_sector_3);
    }
  });

  // Fastest lap overall
  let fastestLapTime = Infinity;
  let fastestLapDriver = -1;
  bestLaps.forEach((time, dn) => {
    if (time < fastestLapTime) { fastestLapTime = time; fastestLapDriver = dn; }
  });

  // Build DriverRaceState[]
  const allDriverNumbers = new Set<number>([
    ...driverMap.keys(),
    ...latestPositions.keys(),
    ...latestLocations.keys(),
  ]);

  // Find the most recent lap WITH sector data for each driver (core tier).
  // lapsRaw is stubbed empty in core tier (moved to detail), but this keeps
  // the logic consistent if laps data is ever re-added to core.
  const lastSectorLaps = new Map<number, any>();
  const sortedLapsDesc = [...(lapsRaw ?? [])].sort((a: any, b: any) => (b.lap_number ?? 0) - (a.lap_number ?? 0));
  for (const lap of sortedLapsDesc) {
    const dn = lap.driver_number;
    if (!lastSectorLaps.has(dn) && (lap.duration_sector_1 || lap.duration_sector_2 || lap.duration_sector_3)) {
      lastSectorLaps.set(dn, lap);
    }
  }

  const drivers: DriverRaceState[] = [];

  allDriverNumbers.forEach(dn => {
    const driverInfo = driverMap.get(dn) ?? {};
    const pos = latestPositions.get(dn);   // race order
    const loc = latestLocations.get(dn);   // GPS x/y/z
    const interval = latestIntervals.get(dn);
    const car = latestCarData.get(dn);
    const stint = latestStints.get(dn);
    const lastLap = lastLaps.get(dn);
    const lapNum = lapCounts.get(dn) ?? 0;

    // Sector status
    const sectorStatus = (actual: number | null | undefined, driverBest: number | undefined, sessionBest: number): SectorStatus => {
      if (!actual) return null;
      if (actual <= sessionBest + 0.001) return 'session_best';
      if (driverBest && actual <= driverBest + 0.001) return 'personal_best';
      return 'normal';
    };

    const sectorLap = lastSectorLaps.get(dn) ?? lastLap;
    const s1 = sectorLap?.duration_sector_1 ?? null;
    const s2 = sectorLap?.duration_sector_2 ?? null;
    const s3 = sectorLap?.duration_sector_3 ?? null;

    drivers.push({
      driverNumber: dn,
      driverCode: driverInfo.name_acronym ?? `D${dn}`,
      fullName: driverInfo.full_name ?? `Driver ${dn}`,
      teamName: driverInfo.team_name ?? '',
      teamColour: driverInfo.team_colour ?? '444444',
      position: pos?.position ?? 99,
      positionChange: 0,
      gapToLeader: interval?.gap_to_leader != null ? String(interval.gap_to_leader) : null,
      intervalToAhead: interval?.interval != null ? String(interval.interval) : null,
      currentLap: lapNum,
      lastLapTime: formatLapTime(lastLap?.lap_duration),
      bestLapTime: formatLapTime(bestLaps.get(dn)),
      fastestLap: dn === fastestLapDriver,
      sectors: {
        s1, s2, s3,
        s1Status: sectorStatus(s1, driverBestS1.get(dn), bestS1),
        s2Status: sectorStatus(s2, driverBestS2.get(dn), bestS2),
        s3Status: sectorStatus(s3, driverBestS3.get(dn), bestS3),
      },
      tyreCompound: parseTyreCompound(stint?.compound),
      tyreLapAge: stint ? Math.max(0, (lapNum - (stint.lap_start ?? 0)) + (stint.tyre_age_at_start ?? 0)) : 0,
      pitStopCount: (stintsRaw ?? []).filter((s: any) => s.driver_number === dn).length - 1,
      onNewTyres: stint ? lapNum - (stint.lap_start ?? 0) <= 1 : false,
      inPit: car?.drs === 8, // rough proxy; OpenF1 doesn't have a direct inPit flag
      retired: false,
      hasDrs: car?.drs != null && [10, 12, 14].includes(car.drs),
      speed: car?.speed ?? null,
      throttle: car?.throttle ?? null,
      brake: car?.brake != null ? car.brake > 0 : null,
      gear: car?.n_gear ?? null,
      x: loc?.x ?? null,
      y: loc?.y ?? null,
      z: loc?.z ?? null,
      hasUnreadRadio: false, // set client-side
      isMuted: false,        // set client-side
      lastUpdated: Date.now(),
    });
  });

  // Sort by position
  drivers.sort((a, b) => a.position - b.position);

  // Race control messages
  const raceControl: RaceControlMessage[] = (raceControlRaw ?? [])
    .slice(-50)
    .map((m: any) => ({
      id: `${m.date}_${m.message?.slice(0, 20) ?? ''}`,
      date: m.date ?? '',
      lapNumber: m.lap_number ?? null,
      category: m.category ?? 'Other',
      flag: m.flag ?? null,
      message: m.message ?? '',
      scope: m.scope ?? null,
      sector: m.sector ?? null,
    }));

  // Radio messages
  const radioMessages: RadioMessage[] = (teamRadioRaw ?? []).map((r: any) => {
    const driverInfo = driverMap.get(r.driver_number) ?? {};
    return {
      id: `${sessionKey}_${r.driver_number}_${r.date}`,
      driverNumber: r.driver_number,
      driverCode: driverInfo.name_acronym ?? `D${r.driver_number}`,
      teamName: driverInfo.team_name ?? '',
      teamColour: driverInfo.team_colour ?? '444444',
      recordingUrl: r.recording_url ?? null,
      date: r.date ?? '',
      isRead: false, // managed client-side
      sessionKey,
    };
  });

  // Weather
  const latestWeather = weatherRaw?.sort((a: any, b: any) => (b.date ?? '').localeCompare(a.date ?? ''))?.[0] ?? null;
  const weather: WeatherSnapshot | null = latestWeather ? {
    airTemp: latestWeather.air_temperature ?? null,
    trackTemp: latestWeather.track_temperature ?? null,
    humidity: latestWeather.humidity ?? null,
    windSpeed: latestWeather.wind_speed ?? null,
    windDirection: latestWeather.wind_direction ?? null,
    rainfall: !!(latestWeather.rainfall),
    rainIntensity: null, // fetched via rainviewer-proxy client-side
    fetchedAt: Date.now(),
  } : null;

  const response: PitWallLiveDataResponse = {
    sessionKey,
    sessionName,
    meetingName,
    circuitKey,
    circuitLat: circuitCoords?.lat ?? null,
    circuitLon: circuitCoords?.lon ?? null,
    drivers,
    raceControl,
    radioMessages,
    weather,
    totalLaps,
    sessionType,
    positionDataAvailable: latestLocations.size > 0,
    sfLineX,
    sfLineY,
    fetchedAt: Date.now(),
    cacheHit: false,
    cacheAgeMs: 0,
  };

  // GUID: API_PIT_WALL_LIVE_DATA-013-v01
  // [Intent] Store fresh response in the shared cache. Any user who calls
  //          within the next LIVE_DATA_CACHE_TTL_MS will receive this data
  //          without triggering a new OpenF1 fan-out.
  //          Cache is keyed by sessionKey — if the session changes between
  //          polls the new session always gets a fresh fan-out.
  setLiveDataCache({
    sessionKey,
    data: response,
    expiresAt: Date.now() + LIVE_DATA_CACHE_TTL_MS,
  });

  return response;
}
