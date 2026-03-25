// GUID: PIT_WALL_TYPES-000-v01
// [Intent] Core TypeScript types for the Pit Wall live race module.
// [Inbound Trigger] Imported by all pit-wall hooks, components, and API routes.
// [Downstream Impact] Changes here ripple to all pit-wall files.

export type TyreCompound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET' | 'UNKNOWN';

export type SectorStatus = 'personal_best' | 'session_best' | 'normal' | null;

// GUID: PIT_WALL_TYPES-001-v01
// [Intent] Sector times with F1-style status for colour coding.
export interface SectorTime {
  s1: number | null;
  s2: number | null;
  s3: number | null;
  s1Status: SectorStatus;
  s2Status: SectorStatus;
  s3Status: SectorStatus;
}

// GUID: PIT_WALL_TYPES-002-v01
// [Intent] Complete state for a single driver during a live race session.
//          Aggregated server-side from multiple OpenF1 endpoints.
export interface DriverRaceState {
  // Identity
  driverNumber: number;
  driverCode: string;
  fullName: string;
  teamName: string;
  teamColour: string; // hex without #

  // Race position
  position: number;
  positionChange: number; // vs race start

  // Gap strings as returned by OpenF1 (e.g. "+1.234" or "1 LAP")
  gapToLeader: string | null;
  intervalToAhead: string | null;

  // Lap data
  currentLap: number;
  lastLapTime: number | null; // seconds
  bestLapTime: number | null; // seconds
  fastestLap: boolean;

  // Sector times (last completed lap)
  sectors: SectorTime;

  // Tyre
  tyreCompound: TyreCompound;
  tyreLapAge: number;
  pitStopCount: number;
  onNewTyres: boolean;

  // Live car state
  inPit: boolean;
  retired: boolean;
  hasDrs: boolean; // 2026: maps to Overtake Mode button (formerly DRS)
  speed: number | null; // km/h
  throttle: number | null; // 0-100
  brake: boolean | null;
  gear: number | null;

  // GPS (projected metres, not WGS84)
  x: number | null;
  y: number | null;
  z: number | null;

  // Radio (populated separately)
  hasUnreadRadio: boolean;
  isMuted: boolean;

  lastUpdated: number; // Date.now() ms
}

// GUID: PIT_WALL_TYPES-003-v01
// [Intent] A single team radio message from OpenF1.
export interface RadioMessage {
  id: string; // "{sessionKey}_{driverNumber}_{date}"
  driverNumber: number;
  driverCode: string;
  teamName: string;
  teamColour: string;
  recordingUrl: string | null;
  date: string; // ISO string
  isRead: boolean;
  sessionKey: number;
}

// GUID: PIT_WALL_TYPES-004-v01
// [Intent] FIA race control message with flag and category metadata.
export interface RaceControlMessage {
  id: string;
  date: string;
  lapNumber: number | null;
  category: string;
  flag: 'GREEN' | 'YELLOW' | 'RED' | 'BLUE' | 'CHEQUERED' | 'SC' | 'VSC' | null;
  message: string;
  scope: string | null;
  sector: number | null;
}

// GUID: PIT_WALL_TYPES-005-v01
// [Intent] Weather snapshot including RainViewer-derived rain intensity.
export interface WeatherSnapshot {
  airTemp: number | null;
  trackTemp: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  rainfall: boolean;
  rainIntensity: number | null; // 0-255 sampled from RainViewer tile
  fetchedAt: number;
}

// GUID: PIT_WALL_TYPES-006-v03
// [Intent] Full live data response shape from /api/pit-wall/live-data.
//          v02: Added cacheHit + cacheAgeMs for server-side cache observability.
//          v03: Added positionDataAvailable — distinguishes "no live session" from
//               "live session active but GPS data unavailable from OpenF1".
export interface PitWallLiveDataResponse {
  sessionKey: number | null;
  sessionName: string | null;
  meetingName: string | null;
  circuitKey: number | null;
  circuitLat: number | null;
  circuitLon: number | null;
  drivers: DriverRaceState[];
  raceControl: RaceControlMessage[];
  radioMessages: RadioMessage[];
  weather: WeatherSnapshot | null;
  totalLaps: number | null;
  sessionType: string | null;
  fetchedAt: number;
  /** True when OpenF1 returned ≥1 position record for the current session. */
  positionDataAvailable: boolean;
  /** GPS X coordinate of the start/finish line (projected metres), derived from
   *  correlating /laps date_start with /location GPS data. Null if unavailable. */
  sfLineX: number | null;
  /** GPS Y coordinate of the start/finish line (projected metres). */
  sfLineY: number | null;
  /** True when the response was served from the server-side shared cache. */
  cacheHit?: boolean;
  /** How many ms old the cached data was when served (0 on a fresh fetch). */
  cacheAgeMs?: number;
}

// GUID: PIT_WALL_TYPES-010-v01
// [Intent] Per-driver enrichment returned by /api/pit-wall/live-data?tier=detail.
//          Contains the slow-to-compute fields (lap times, sectors, car telemetry, tyres)
//          that are merged into existing DriverRaceState[] after core data loads.
export interface DriverDetail {
  driverNumber: number;
  currentLap: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  fastestLap: boolean;
  sectors: {
    s1: number | null; s2: number | null; s3: number | null;
    s1Status: SectorStatus; s2Status: SectorStatus; s3Status: SectorStatus;
  };
  tyreCompound: TyreCompound;
  tyreLapAge: number;
  pitStopCount: number;
  onNewTyres: boolean;
  speed: number | null;
  throttle: number | null;
  brake: boolean | null;
  gear: number | null;
}

// GUID: PIT_WALL_TYPES-011-v01
// [Intent] Response shape for /api/pit-wall/live-data?tier=detail.
//          Carries the slow endpoints (laps, car_data, team_radio) separately
//          so they can be merged into the already-visible core data.
export interface PitWallDetailResponse {
  sessionKey: number | null;
  driverDetail: DriverDetail[];
  radioMessages: RadioMessage[];
  fetchedAt: number;
  cacheHit?: boolean;
}

// GUID: PIT_WALL_TYPES-009-v01
// [Intent] A single GPS point in projected metres (not WGS84).
//          Used to accumulate the circuit path from car position history.
export interface CircuitPoint {
  x: number;
  y: number;
}

// GUID: PIT_WALL_TYPES-007-v01
// [Intent] Track bounding box derived from GPS position data.
export interface TrackBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// GUID: PIT_WALL_TYPES-008-v01
// [Intent] Interpolated car position for smooth track map rendering.
export interface InterpolatedPosition {
  driverNumber: number;
  x: number;
  y: number;
  teamColour: string;
  driverCode: string;
  position: number;
  hasDrs: boolean; // 2026: maps to Overtake Mode button (formerly DRS)
  retired: boolean;
  inPit: boolean;
}
