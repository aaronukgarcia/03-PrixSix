// GUID: SHOWREEL_TYPES-000-v01
// [Intent] TypeScript types for the Pre-Race Showreel feature.
//          Showreel plays historical 2025 OpenF1 telemetry on the Pit Wall
//          track map before live sessions, compressing to finish 5 min before race start.
// [Inbound Trigger] Imported by usePreRaceMode, useHistoricalReplay, and showreel components.
// [Downstream Impact] Changes here ripple to all showreel hooks and components.

// GUID: SHOWREEL_TYPES-001-v01
// [Intent] A historical session entry returned by the historical-sessions API.
export interface HistoricalSession {
  sessionKey: number;
  sessionName: string;       // e.g. "Race", "Sprint"
  meetingName: string;       // e.g. "Chinese Grand Prix"
  circuitKey: number;
  circuitShortName: string;  // e.g. "Shanghai"
  country: string;           // e.g. "China"
  year: number;              // e.g. 2025
  dateStart: string;         // ISO string
  dateEnd: string;           // ISO string
  durationSeconds: number;   // Estimated race duration in seconds
  sessionType: 'Race' | 'Sprint' | string;
}

// GUID: SHOWREEL_TYPES-002-v01
// [Intent] One item in the showreel schedule queue.
//          Contains the historical session to play + the wall-clock windows for playback.
export interface ShowreelQueueItem {
  session: HistoricalSession;
  /** Compression factor: historicalDurationSeconds / wallClockSlotSeconds.
   *  > 1 means replay faster than real time. On-demand mode uses 1.0. */
  compressionFactor: number;
  /** Wall-clock start time for this item's slot */
  wallClockStart: Date;
  /** Wall-clock end time for this item's slot (must be <= raceStart - 5min) */
  wallClockEnd: Date;
}

// GUID: SHOWREEL_TYPES-003-v01
// [Intent] Full showreel schedule — list of historical races to play in order,
//          timed to complete exactly 5 minutes before the next real race start.
export interface ShowreelSchedule {
  nextRaceName: string;       // e.g. "Chinese Grand Prix"
  nextRaceStart: Date;        // actual race start time
  cutoffTime: Date;           // raceStart - 5 minutes
  totalSlotSeconds: number;   // seconds available for showreel
  items: ShowreelQueueItem[];
  builtAt: Date;
}

// GUID: SHOWREEL_TYPES-004-v01
// [Intent] State machine states for pre-race mode.
export type PreRaceModeState =
  | 'LIVE'              // OpenF1 has an active session — normal live Pit Wall mode
  | 'IDLE'              // No upcoming session within 2 hours — show standby screen
  | 'SHOWREEL_QUEUED'   // Session within 2 hours — building schedule, fetching data
  | 'SHOWREEL_PLAYING'  // Playing a historical race replay
  | 'SHOWREEL_BETWEEN'  // Brief Prix Six splash between historical races
  | 'COUNTDOWN';        // < 5 minutes to race start — showreel complete, countdown only

// GUID: SHOWREEL_TYPES-005-v03
// [Intent] Compressed telemetry frame — one position snapshot per driver at a given virtual time.
//          v02: Added optional radioMessages array for team radio during replay playback.
//          v03: Added optional telemetry fields (speed, gap, interval, lap, sectors, tyre, DRS, pit)
//               so the race table populates during replay instead of showing all dashes.
export interface ReplayFrame {
  virtualTimeMs: number; // Virtual time from session start (already real-time equivalent)
  wallTimeMs: number;    // Original wall-clock time from OpenF1 date field
  positions: Array<{
    driverNumber: number;
    x: number;
    y: number;
    position: number;
    // Optional telemetry — present when replay is enriched
    speed?: number | null;
    throttle?: number | null;
    brake?: number | null;
    gear?: number | null;
    drs?: number | null;           // DRS status: 10-14 = open, else closed
    gapToLeader?: string | null;   // e.g. "+12.345" or "LAP" — from /intervals
    intervalToAhead?: string | null;
    lastLapTime?: number | null;   // seconds
    bestLapTime?: number | null;   // seconds
    currentLap?: number | null;
    s1?: number | null;            // sector time in seconds
    s2?: number | null;
    s3?: number | null;
    tyreCompound?: string | null;  // SOFT, MEDIUM, HARD, INTERMEDIATE, WET
    tyreLapAge?: number | null;
    pitStopCount?: number | null;
    inPit?: boolean;
  }>;
  radioMessages?: Array<{
    driverNumber: number;
    message: string;
    utcTimestamp: string;
  }>;
}

// GUID: SHOWREEL_TYPES-006-v01
// [Intent] Driver metadata for a historical session (from /drivers endpoint).
export interface HistoricalDriver {
  driverNumber: number;
  driverCode: string;
  fullName: string;
  teamName: string;
  teamColour: string;
}

// GUID: SHOWREEL_TYPES-007-v01
// [Intent] Full replay data package returned by the historical-replay API.
export interface HistoricalReplayData {
  sessionKey: number;
  sessionName: string;
  meetingName: string;
  drivers: HistoricalDriver[];
  frames: ReplayFrame[];       // Downsampled position frames (1 per 5s per driver)
  durationMs: number;          // Total real-time duration of this historical session
  totalLaps: number | null;
}

// GUID: SHOWREEL_TYPES-008-v01
// [Intent] Return type for useHistoricalReplay hook.
export interface UseHistoricalReplayReturn {
  /** Current synthetic DriverRaceState-compatible positions derived from the replay frame */
  replayDrivers: ReplayDriverState[];
  /** Playback progress 0-1 */
  progress: number;
  /** Virtual elapsed seconds (adjusted for compression) */
  elapsedSeconds: number;
  /** Total real-time duration seconds of this historical session */
  durationSeconds: number;
  /** Playback has completed */
  isComplete: boolean;
  /** Whether replay data is still loading */
  isLoading: boolean;
  /** Error loading replay data */
  error: string | null;
}

// GUID: SHOWREEL_TYPES-009-v02
// [Intent] Driver state emitted by replay — same field names as DriverRaceState for drop-in compatibility.
//          v02: Widened types from literal nulls to number|null so enriched replay data can populate
//               speed, throttle, brake, gear, sectors, tyre compound etc.
export interface ReplayDriverState {
  driverNumber: number;
  driverCode: string;
  fullName: string;
  teamName: string;
  teamColour: string;
  position: number;
  x: number | null;
  y: number | null;
  z: number | null;
  positionChange: number;
  gapToLeader: number | null;
  intervalToAhead: number | null;
  currentLap: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  fastestLap: boolean;
  sectors: { s1: number | null; s2: number | null; s3: number | null; s1Status: null; s2Status: null; s3Status: null };
  tyreCompound: string;
  tyreLapAge: number;
  pitStopCount: number;
  onNewTyres: boolean;
  inPit: boolean;
  retired: boolean;
  hasDrs: boolean;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  gear: number | null;
  hasUnreadRadio: boolean;
  isMuted: boolean;
  lastUpdated: number;
}

// GUID: SHOWREEL_TYPES-010-v01
// [Intent] Return type for usePreRaceMode hook.
export interface UsePreRaceModeReturn {
  mode: PreRaceModeState;
  schedule: ShowreelSchedule | null;
  currentItemIndex: number;         // Which showreel item is currently playing (-1 if none)
  currentItem: ShowreelQueueItem | null;
  minutesToRaceStart: number;       // Minutes until next real race
  isShowreel: boolean;              // true when in SHOWREEL_PLAYING or SHOWREEL_BETWEEN
  onRaceSelect: (session: HistoricalSession) => void; // on-demand race selector
  onDemandSession: HistoricalSession | null;          // user-selected on-demand session
}
