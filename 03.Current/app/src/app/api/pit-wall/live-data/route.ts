// GUID: API_PIT_WALL_LIVE_DATA-000-v01
// [Intent] Pit Wall live data aggregation endpoint. Fans out to multiple OpenF1
//          endpoints in parallel, merges results into a single DriverRaceState[]
//          response. Any authenticated user (not admin-only) can call this.
// [Inbound Trigger] Polled by usePitWallData hook at user-configured intervals (2-60s).
// [Downstream Impact] Returns PitWallLiveDataResponse — the single source of truth
//          for all Pit Wall live data. Partial failures return what data is available.

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin, generateCorrelationId, verifyAuthToken } from '@/lib/firebase-admin';
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { getSecret } from '@/lib/secrets-manager';
import type {
  DriverRaceState, RadioMessage, RaceControlMessage,
  WeatherSnapshot, PitWallLiveDataResponse, TyreCompound, SectorStatus
} from '@/app/(app)/pit-wall/_types/pit-wall.types';

export const dynamic = 'force-dynamic';

// GUID: API_PIT_WALL_LIVE_DATA-001-v01
const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_TOKEN_URL = 'https://api.openf1.org/token';
const FETCH_TIMEOUT_MS = 10_000;

let cachedToken: { token: string; expiresAt: number } | null = null;

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
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cachedToken.token;
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

// GUID: API_PIT_WALL_LIVE_DATA-009-v01
// [Intent] Get latest entry per driver from an array ordered by date desc.
function latestPerDriver<T extends { driver_number: number; date?: string }>(arr: T[]): Map<number, T> {
  const map = new Map<number, T>();
  const sorted = [...arr].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  for (const item of sorted) {
    if (!map.has(item.driver_number)) map.set(item.driver_number, item);
  }
  return map;
}

// GUID: API_PIT_WALL_LIVE_DATA-010-v01
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

  const token = await getOpenF1Token();

  // Fan out all OpenF1 endpoints in parallel
  const [
    sessionsRaw, driversRaw, positionsRaw, intervalsRaw,
    lapsRaw, stintsRaw, carDataRaw, raceControlRaw, weatherRaw, teamRadioRaw,
  ] = await Promise.all([
    openF1Fetch<any[]>('/sessions?session_key=latest', token),
    openF1Fetch<any[]>('/drivers?session_key=latest', token),
    openF1Fetch<any[]>('/position?session_key=latest', token),
    openF1Fetch<any[]>('/intervals?session_key=latest', token),
    openF1Fetch<any[]>('/laps?session_key=latest', token),
    openF1Fetch<any[]>('/stints?session_key=latest', token),
    openF1Fetch<any[]>('/car_data?session_key=latest', token),
    openF1Fetch<any[]>('/race_control?session_key=latest', token),
    openF1Fetch<any[]>('/weather?session_key=latest', token),
    openF1Fetch<any[]>('/team_radio?session_key=latest', token),
  ]);

  // Session metadata
  const session = sessionsRaw?.[0] ?? null;
  const sessionKey: number | null = session?.session_key ?? null;
  const sessionName: string | null = session?.session_name ?? null;
  const meetingName: string | null = session?.meeting_name ?? null;
  const sessionType: string | null = session?.session_type ?? null;
  const circuitKey: number | null = session?.circuit_key ?? null;
  const circuitCoords = circuitKey ? (CIRCUIT_COORDS[circuitKey] ?? null) : null;
  const totalLaps: number | null = session?.total_laps ?? null;

  if (!sessionKey) {
    return NextResponse.json({
      sessionKey: null, sessionName: null, meetingName: null, circuitKey: null,
      circuitLat: null, circuitLon: null, drivers: [], raceControl: [],
      radioMessages: [], weather: null, totalLaps: null, sessionType: null,
      fetchedAt: Date.now(),
      _warning: ERRORS.PIT_WALL_NO_SESSION?.message ?? 'No active session',
    } satisfies PitWallLiveDataResponse);
  }

  // Build lookup maps
  const driverMap = new Map<number, any>();
  (driversRaw ?? []).forEach((d: any) => driverMap.set(d.driver_number, d));

  const latestPositions = latestPerDriver(positionsRaw ?? []);
  const latestIntervals = latestPerDriver(intervalsRaw ?? []);
  const latestCarData = latestPerDriver(carDataRaw ?? []);
  const latestLocation = latestPerDriver((lapsRaw ?? []).filter((l: any) => l.x_position != null));

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
  ]);

  const drivers: DriverRaceState[] = [];

  allDriverNumbers.forEach(dn => {
    const driverInfo = driverMap.get(dn) ?? {};
    const pos = latestPositions.get(dn);
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

    const s1 = lastLap?.duration_sector_1 ?? null;
    const s2 = lastLap?.duration_sector_2 ?? null;
    const s3 = lastLap?.duration_sector_3 ?? null;

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
      x: pos?.x ?? null,
      y: pos?.y ?? null,
      z: pos?.z ?? null,
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
    fetchedAt: Date.now(),
  };

  return NextResponse.json(response);
}
