// GUID: REPLAY_TYPES-000-v01
// [Intent] TypeScript types for the GPS Replay player feature.
//          Replay data is pre-ingested into Firebase Storage (HistoricalReplayData format).
//          The replay_sessions Firestore collection catalogs available sessions.
// [Inbound Trigger] Imported by useReplayPlayer, ReplayControls, replay-sessions API route.
// [Downstream Impact] Changes here ripple to all replay hooks and components.

// GUID: REPLAY_TYPES-001-v01
// [Intent] Metadata for one available replay session — returned by /api/pit-wall/replay-sessions.
//          Stored in Firestore replay_sessions/{sessionKey}.
export interface ReplaySessionMetadata {
  sessionKey:         number;
  sessionName:        string;   // e.g. "Race"
  meetingName:        string;   // e.g. "Chinese Grand Prix"
  circuitKey:         number;
  year:               number;
  dateStart:          string;   // ISO string
  durationMs:         number;   // total replay duration
  totalDrivers:       number;
  totalFrames:        number;
  downloadUrl:        string;   // public Firebase Storage URL
  fileSizeBytesGzip:  number;
  fileSizeBytesRaw:   number;
  samplingIntervalMs: number;   // e.g. 500 = 2Hz
  // v02: Durable Firestore telemetry storage fields
  firestoreStatus?:   'none' | 'ingesting' | 'complete' | 'failed';
  totalChunks?:       number;   // number of replay_chunks docs for this session
  cacheVersion?:      number;   // v1 = legacy showreel, v2+ = full-fidelity with telemetry
}

// GUID: REPLAY_TYPES-002-v01
// [Intent] Playback state machine states for useReplayPlayer.
export type ReplayPlaybackState =
  | 'idle'       // no session selected
  | 'loading'    // downloading replay data
  | 'ready'      // data loaded, not yet started
  | 'playing'    // RAF loop running
  | 'paused'     // RAF stopped, virtual time preserved
  | 'complete'   // reached end of replay
  | 'error';     // download or parse failed

// GUID: REPLAY_TYPES-003-v01
// [Intent] Discrete playback speed multipliers for the speed selector.
export type ReplaySpeed = 0.5 | 1 | 2 | 4 | 8;

// GUID: REPLAY_TYPES-004-v02
// [Intent] Return type for the useReplayPlayer hook.
//          v02: Added framesLoaded (NDJSON streaming progress) and replayRadioMessages.
export interface UseReplayPlayerReturn {
  // State
  playbackState:    ReplayPlaybackState;
  downloadProgress: number;     // 0–1 during loading (from Content-Length if available)
  progress:         number;     // 0–1 through the replay
  elapsedMs:        number;     // virtual elapsed milliseconds
  durationMs:       number;     // total replay duration in ms
  speed:            ReplaySpeed;
  error:            string | null;
  framesLoaded:     number;     // number of frames loaded so far (for NDJSON streaming progress)
  // Driver positions emitted each frame (drop-in for DriverRaceState[])
  replayDrivers:    import('./showreel.types').ReplayDriverState[];
  // Radio messages encountered during replay playback
  replayRadioMessages: Array<{ driverNumber: number; message: string; utcTimestamp: string }>;
  // Race control messages encountered during replay playback
  replayRaceControl: Array<{ date: string; lapNumber: number | null; category: string; flag: string | null; message: string; scope: string | null; sector: number | null }>;
  // Controls
  play:             () => void;
  pause:            () => void;
  seek:             (virtualTimeMs: number) => void;
  setSpeed:         (speed: ReplaySpeed) => void;
  skipToStart:      () => void;
  skipToEnd:        () => void;
  stepBack:         () => void;   // −30 s
  stepForward:      () => void;   // +30 s
}
