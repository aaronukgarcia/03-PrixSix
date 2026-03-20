// GUID: PIT_WALL_CLIENT-000-v05
// [Intent] Client-side orchestrator for the Pit Wall live race data module.
//          Wires all hooks, manages layout (track map + FIA feed header, toolbar,
//          race table, radio zoom panel), and enforces the dark F1 aesthetic.
//          v02: Pre-Race Showreel integration — plays 2025 historical telemetry
//               before live sessions via usePreRaceMode + useHistoricalReplay.
//          v03: Removed useCarInterpolation — interpolation now done inside PitWallTrackMap
//               in its single RAF loop. No React state on the hot path.
//          v04: GPS Replay mode — REPLAY button downloads pre-ingested race data from
//               Firebase Storage and plays it back with full transport controls
//               (⏮⏪⏸/▶⏩⏭ + speed selector). Replay overrides live data source.
//          v05: Debounced localStorage circuit path saves (30s interval + visibilitychange
//               + beforeunload). Session-adaptive polling lowered from 10s to 5s.
// [Inbound Trigger] Rendered by page.tsx (server component) on every /pit-wall request.
// [Downstream Impact] All Pit Wall state and data flow originates here.
//                     Sub-components receive only the props they need — no prop drilling
//                     beyond one level.

'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from '@/firebase';
import { usePitWallSettings } from './_hooks/usePitWallSettings';
import { usePitWallData } from './_hooks/usePitWallData';
import { useRadioState } from './_hooks/useRadioState';
import { usePreRaceMode } from './_hooks/usePreRaceMode';
import { useHistoricalReplay } from './_hooks/useHistoricalReplay';
import { useReplayPlayer } from './_hooks/useReplayPlayer';
import { useLivePredictionScore } from './_hooks/useLivePredictionScore';
import type { TrackBounds, DriverRaceState, CircuitPoint } from './_types/pit-wall.types';
import type { ReplayDriverState } from './_types/showreel.types';
import type { ReplaySessionMetadata } from './_types/replay.types';
import { PitWallTrackMap } from './_components/PitWallTrackMap';
import { LiveScoreBanner } from './_components/LiveScoreBanner';
import { FIARaceControlFeed } from './_components/FIARaceControlFeed';
import { PitWallRaceTable } from './_components/PitWallRaceTable';
import { RadioZoomPanel } from './_components/RadioZoomPanel';
import { UpdateSpeedSlider } from './_components/UpdateSpeedSlider';
import { ColumnSelector } from './_components/ColumnSelector';
import { WeatherStrip } from './_components/WeatherStrip';
import { PreRaceWarmupBanner } from './_components/PreRaceWarmupBanner';
import { ShowreelSplash } from './_components/ShowreelSplash';
import { RaceSelector } from './_components/RaceSelector';
import { PitWallLoadingScreen } from './_components/PitWallLoadingScreen';
import { ReplayControls } from './_components/ReplayControls';
import { AlertCircle, RefreshCw, TowerControl, Film, ZoomIn, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RaceSchedule } from '@/lib/data';
import staticCircuits from '@/data/circuits.json';

// GUID: PIT_WALL_CLIENT-001-v02
// [Intent] Derive track bounds from a set of GPS points (projected metres).
//          Accepts either CircuitPoint[] (accumulated path) or DriverRaceState[].
//          Returns null when fewer than 2 valid points are available.
//          v02: Accepts generic point array so bounds can be computed from the full
//               accumulated circuit path, giving stable layout across all polling cycles.
function computeTrackBounds(
  points: { x: number | null; y: number | null }[]
): TrackBounds | null {
  const xs = points.map(p => p.x).filter((v): v is number => v !== null);
  const ys = points.map(p => p.y).filter((v): v is number => v !== null);
  if (xs.length < 2 || ys.length < 2) return null;
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// GUID: PIT_WALL_CLIENT-020-v02
// [Intent] localStorage helpers for persisting the circuit path across page loads.
//          Keyed by circuitKey so each circuit has its own cached outline.
//          Max 8000 points stored (~1 race worth of position history).
//          v02: Key bumped to v2 to invalidate stale multi-car point cloud data from v1.
//               v2 stores single-driver sequential path data which produces clean outlines.
const CIRCUIT_PATH_KEY = 'prix6_pw_circuit_path_v2';
const MAX_CIRCUIT_POINTS = 8000;

function loadCircuitPath(circuitKey: number): CircuitPoint[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${CIRCUIT_PATH_KEY}_${circuitKey}`);
    if (!raw) return [];
    return JSON.parse(raw) as CircuitPoint[];
  } catch { return []; }
}

function saveCircuitPath(circuitKey: number, path: CircuitPoint[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${CIRCUIT_PATH_KEY}_${circuitKey}`, JSON.stringify(path));
  } catch {} // Storage quota exceeded — ignore
}

// GUID: PIT_WALL_CLIENT-010-v01
// [Intent] Find the next upcoming race from the schedule that has not yet started.
//          Returns null if all races are in the past.
function findNextRaceFromSchedule(): { name: string; raceStart: Date; location: string; isSprintNext: boolean } | null {
  const now = new Date();
  for (const race of RaceSchedule) {
    // Check if sprint is upcoming before the main race
    if (race.hasSprint && race.sprintTime) {
      const sprintStart = new Date(race.sprintTime);
      const raceStart = new Date(race.raceTime);
      if (sprintStart > now) {
        return { name: `${race.name} (Sprint)`, raceStart: sprintStart, location: race.location, isSprintNext: true };
      }
      if (raceStart > now) {
        return { name: race.name, raceStart, location: race.location, isSprintNext: false };
      }
    } else {
      const raceStart = new Date(race.raceTime);
      if (raceStart > now) {
        return { name: race.name, raceStart, location: race.location, isSprintNext: false };
      }
    }
  }
  return null;
}

// GUID: PIT_WALL_CLIENT-011-v01
// [Intent] Cast ReplayDriverState[] to DriverRaceState[] for drop-in compatibility.
//          The replay type uses the same field names with identical types — cast is safe.
function castReplayToLive(replay: ReplayDriverState[]): DriverRaceState[] {
  return replay as unknown as DriverRaceState[];
}

// GUID: PIT_WALL_CLIENT-002-v04
// [Intent] Main orchestrator component — assembles the full Pit Wall layout.
//          Layout regions:
//            Showreel banner (optional, h-12): PreRaceWarmupBanner when in showreel mode
//            Header (280px): TrackMap (2/3 width) | FIA Feed (1/3 width)
//            Toolbar: UpdateSpeedSlider | ColumnSelector | RaceSelector (showreel) | session info
//            Body: PitWallRaceTable (scrollable, fills remaining height)
//            Bottom panel: RadioZoomPanel (slides up 50vh when open)
//            Full overlay: ShowreelSplash (between historical races)
//          v03: Passes drivers + updateIntervalMs directly to PitWallTrackMap;
//               interpolation handled inside TrackMap's single RAF loop.
//          v04: Circuit path accumulation + localStorage persistence. Session-adaptive
//               polling (auto 10s on session start, reset on session end). positionDataAvailable
//               threaded through for track map diagnostic state.
// [Inbound Trigger] Rendered by page.tsx.
// [Downstream Impact] All child components receive data via props — no child
//                     components fetch independently.
export default function PitWallClient() {
  const { firebaseUser } = useAuth();

  // GUID: PIT_WALL_CLIENT-012-v01
  // [Intent] Maintain a fresh Firebase ID token for showreel API calls.
  //          Refreshed when firebaseUser changes (token auto-refreshes every ~55min).
  const [idToken, setIdToken] = useState<string | null>(null);
  useEffect(() => {
    if (!firebaseUser) { setIdToken(null); return; }
    firebaseUser.getIdToken().then(setIdToken).catch(() => setIdToken(null));
  }, [firebaseUser]);

  // Settings (localStorage)
  const {
    settings,
    setUpdateInterval,
    resetIntervalToDefault,
    toggleColumn,
    setRadioZoomMode,
    isHighFrequency,
    intervalIsTemporary,
    intervalResetMinutes,
  } = usePitWallSettings();

  // Live data polling
  const {
    drivers: liveDrivers,
    raceControl,
    radioMessages,
    weather,
    sessionKey,
    sessionName,
    meetingName,
    sessionType,
    circuitKey,
    circuitLat,
    circuitLon,
    totalLaps,
    positionDataAvailable,
    sfLineX,
    sfLineY,
    isLoading,
    error,
    errorCode,
    correlationId,
    lastUpdated,
    forceRefresh,
  } = usePitWallData(settings.updateIntervalSeconds, firebaseUser);

  // Next race from schedule
  const nextRaceInfo = useMemo(() => findNextRaceFromSchedule(), []);

  // GUID: PIT_WALL_CLIENT-018-v02
  // [Intent] Accumulated circuit path — GPS points from a SINGLE driver's sequential positions.
  //          v02: Tracks only one driver (prefer P1) to produce a clean single-lap outline
  //               instead of mixing 20 drivers' positions into a jumbled point cloud.
  //               Loop closure detection freezes the outline once a full lap is traced.
  //          Seeded from localStorage on circuitKey change so the outline is immediate on load.
  const [circuitPath, setCircuitPath] = useState<CircuitPoint[]>([]);
  const lastCircuitKeyRef = useRef<number | null>(null);

  // GUID: PIT_WALL_CLIENT-031-v01
  // [Intent] Single-driver path tracker state. Tracks which driver we're following for
  //          the circuit outline and whether the loop has been closed (frozen).
  //          Stored as ref since it doesn't need to trigger React re-renders.
  const pathTrackerRef = useRef<{
    trackedDriver: number | null;
    frozen: boolean;
  }>({ trackedDriver: null, frozen: false });

  // GUID: PIT_WALL_CLIENT-052-v01
  // [Intent] Load circuit path on circuitKey change. Priority: localStorage > static circuits.json.
  //          Static data provides instant circuit outlines for known circuits (e.g. Chinese GP)
  //          even on first visit or mid-race join. localStorage persisted paths override because
  //          they may have more points from a full live session.
  useEffect(() => {
    if (!circuitKey) return;
    // New circuit — load persisted path from localStorage, fallback to static data
    if (circuitKey !== lastCircuitKeyRef.current) {
      lastCircuitKeyRef.current = circuitKey;
      const persisted = loadCircuitPath(circuitKey);
      const staticPath = (staticCircuits as Record<string, CircuitPoint[]>)[String(circuitKey)];
      const path = persisted.length > 0 ? persisted : (staticPath ?? []);
      setCircuitPath(path);
      // If we have enough points (from either source), freeze — don't re-discover
      pathTrackerRef.current = { trackedDriver: null, frozen: path.length > 100 };
    }
  }, [circuitKey]);

  // GUID: PIT_WALL_CLIENT-025-v01
  // [Intent] Ref tracking the latest circuit path for debounced saves — avoids stale
  //          closures in interval/event listeners without triggering re-registrations.
  const circuitPathRef = useRef<CircuitPoint[]>([]);

  // GUID: PIT_WALL_CLIENT-032-v01
  // [Intent] Single-driver circuit path accumulation — picks ONE driver (P1 preferred,
  //          fallback to first with GPS data) and tracks only their sequential positions.
  //          This produces a clean single racing line that traces the circuit outline.
  //          When the path loops back to within 50m of the start (after 100+ points),
  //          the outline is frozen and no more points are added.
  useEffect(() => {
    if (!circuitKey || liveDrivers.length === 0) return;
    const tracker = pathTrackerRef.current;
    if (tracker.frozen) return;

    // Pick driver to track: prefer P1, fallback to first with valid GPS
    if (tracker.trackedDriver === null) {
      const p1 = liveDrivers.find(d => d.position === 1 && d.x != null && d.y != null);
      const candidate = p1 ?? liveDrivers.find(d => d.x != null && d.y != null);
      if (!candidate) return;
      tracker.trackedDriver = candidate.driverNumber;
    }

    // Find our tracked driver in the current data
    const driver = liveDrivers.find(d => d.driverNumber === tracker.trackedDriver);
    if (!driver || driver.x == null || driver.y == null) return;

    const newPoint: CircuitPoint = { x: driver.x, y: driver.y };

    setCircuitPath(prev => {
      const combined = [...prev, newPoint];

      // Check loop closure: 100+ points and current position within 50m of first point
      if (combined.length > 100) {
        const first = combined[0];
        const dx = newPoint.x - first.x;
        const dy = newPoint.y - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < 50) {
          tracker.frozen = true;
        }
      }

      const capped = combined.length > MAX_CIRCUIT_POINTS
        ? combined.slice(-MAX_CIRCUIT_POINTS)
        : combined;
      circuitPathRef.current = capped;
      return capped;
    });
  }, [liveDrivers, circuitKey]);

  // GUID: PIT_WALL_CLIENT-026-v01
  // [Intent] Debounced localStorage save for circuit path — replaces synchronous save on
  //          every poll. Saves every 30s if path length changed, on tab hide, and on
  //          page close. Prevents main-thread blocking from 8000-point JSON serialisation.
  useEffect(() => {
    if (!circuitKey) return;
    let lastSavedLength = 0;

    const doSave = () => {
      const path = circuitPathRef.current;
      if (path.length === lastSavedLength) return;
      saveCircuitPath(circuitKey, path);
      lastSavedLength = path.length;
    };

    const intervalId = setInterval(doSave, 30_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') doSave();
    };
    const handleUnload = () => doSave();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      doSave(); // save on unmount
    };
  }, [circuitKey]);

  // GUID: PIT_WALL_CLIENT-019-v01
  // [Intent] Session-adaptive polling — automatically lowers interval to 10s when a live
  //          session is detected, resets to 60s (default) when the session ends.
  //          Only adjusts if the user has not manually set a custom interval (intervalIsTemporary).
  //          This is the primary reset path for the polling interval; the 90-min safety-net
  //          in usePitWallSettings is the fallback.
  const prevSessionKeyRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevSessionKeyRef.current;
    prevSessionKeyRef.current = sessionKey;
    if (prev === sessionKey) return; // no change

    if (sessionKey !== null && prev === null) {
      // Session just started — drop to 5s if user hasn't overridden
      // (server-side 2s cache means ~60% of polls hit cache; effective latency 3-5s)
      if (!intervalIsTemporary) setUpdateInterval(5);
    } else if (sessionKey === null && prev !== null) {
      // Session just ended — revert interval and release the auto-reset timer
      resetIntervalToDefault();
    }
  }, [sessionKey, intervalIsTemporary, setUpdateInterval, resetIntervalToDefault]);

  // GUID: PIT_WALL_CLIENT-013-v01
  // [Intent] Pre-race showreel state machine — determines when to play historical replay.
  const preRaceMode = usePreRaceMode(
    !!sessionKey,
    nextRaceInfo?.raceStart ?? null,
    nextRaceInfo?.name ?? '',
    idToken,
    nextRaceInfo?.location ?? null,
  );

  // GUID: PIT_WALL_CLIENT-014-v01
  // [Intent] Historical replay hook — RAF playback of 2025 telemetry.
  //          Active when preRaceMode.isShowreel is true.
  const historicalReplay = useHistoricalReplay(
    preRaceMode.currentItem?.session ?? preRaceMode.onDemandSession ?? null,
    preRaceMode.currentItem?.compressionFactor ?? 1.0,
    idToken,
    () => {
      // Replay of current item completed — preRaceMode ticker will advance automatically
    },
  );

  // GUID: PIT_WALL_CLIENT-021-v01
  // [Intent] GPS Replay mode state — user enters replay by clicking the REPLAY button.
  //          Replay overrides the live data source; live polling continues in the background
  //          so the user can exit replay and see current state immediately.
  //          selectedReplaySession: null until sessions are fetched and user picks one.
  const [isReplayMode,         setIsReplayMode]         = useState(false);
  const [replaySessions,       setReplaySessions]        = useState<ReplaySessionMetadata[]>([]);
  const [selectedReplaySession, setSelectedReplaySession] = useState<ReplaySessionMetadata | null>(null);
  const [replaySessionsLoading, setReplaySessionsLoading] = useState(false);

  // GUID: PIT_WALL_CLIENT-022-v01
  // [Intent] Fetch available replay sessions from Firestore when entering replay mode.
  //          Only fetched once per mount — sessions don't change during a session.
  useEffect(() => {
    if (!isReplayMode || replaySessions.length > 0 || !firebaseUser) return;
    let cancelled = false;
    setReplaySessionsLoading(true);
    firebaseUser.getIdToken()
      .then(token =>
        fetch('/api/pit-wall/replay-sessions', { headers: { Authorization: `Bearer ${token}` } })
      )
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const sessions: ReplaySessionMetadata[] = data.sessions ?? [];
        setReplaySessions(sessions);
        // Auto-select the first (most recent) session
        if (sessions.length > 0 && !selectedReplaySession) {
          setSelectedReplaySession(sessions[0]);
        }
        setReplaySessionsLoading(false);
      })
      .catch(() => { if (!cancelled) setReplaySessionsLoading(false); });
    return () => { cancelled = true; };
  }, [isReplayMode, replaySessions.length, firebaseUser, selectedReplaySession]);

  // GUID: PIT_WALL_CLIENT-050-v01
  // [Intent] Stable auth token getter for Firestore chunk-loading in useReplayPlayer.
  const getReplayAuthToken = useCallback(async () => {
    if (!firebaseUser) throw new Error('Not authenticated');
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  const replayPlayer = useReplayPlayer(
    isReplayMode ? selectedReplaySession : null,
    firebaseUser ? getReplayAuthToken : undefined,
  );

  const handleEnterReplay = useCallback(() => setIsReplayMode(true),  []);
  const handleExitReplay  = useCallback(() => {
    setIsReplayMode(false);
    setSelectedReplaySession(null);
  }, []);

  // Radio state (read/unread, mute — localStorage)
  const radioState = useRadioState(sessionKey);

  // GUID: PIT_WALL_CLIENT-027-v01
  // [Intent] Select radio messages source — in replay mode, use replay radio messages
  //          cast to RadioMessage shape; otherwise use live radio messages.
  const activeRadioMessages = useMemo(() => {
    if (isReplayMode && replayPlayer.replayRadioMessages?.length > 0) {
      return replayPlayer.replayRadioMessages as unknown as typeof radioMessages;
    }
    return radioMessages;
  }, [isReplayMode, replayPlayer.replayRadioMessages, radioMessages]);

  // GUID: PIT_WALL_CLIENT-015-v03
  // [Intent] Select data source — priority: GPS replay > showreel > live.
  //          v03: When in replay/showreel mode, never fall through to liveDrivers.
  //          Return empty array instead so the table doesn't flash stale live data
  //          or "Waiting for session data" between replay frames.
  const activeDrivers: DriverRaceState[] = useMemo(() => {
    if (isReplayMode) {
      return replayPlayer.replayDrivers.length > 0
        ? castReplayToLive(replayPlayer.replayDrivers)
        : [];
    }
    if (preRaceMode.isShowreel) {
      return historicalReplay.replayDrivers.length > 0
        ? castReplayToLive(historicalReplay.replayDrivers)
        : [];
    }
    return liveDrivers;
  }, [isReplayMode, replayPlayer.replayDrivers, preRaceMode.isShowreel, historicalReplay.replayDrivers, liveDrivers]);

  // GUID: PIT_WALL_CLIENT-053-v01
  // [Intent] Seed static circuit path for replay mode — when no live circuitKey is available,
  //          use the replay session's circuitKey to load from static circuits.json.
  //          This gives instant circuit outlines in replay without waiting for a full lap.
  useEffect(() => {
    if (circuitKey) return; // live session handles its own circuit loading
    if (!isReplayMode || !selectedReplaySession?.circuitKey) return;
    const tracker = pathTrackerRef.current;
    if (tracker.frozen) return;

    const replayCircuitKey = selectedReplaySession.circuitKey;
    const staticPath = (staticCircuits as Record<string, CircuitPoint[]>)[String(replayCircuitKey)];
    if (staticPath && staticPath.length > 50) {
      setCircuitPath(staticPath);
      circuitPathRef.current = staticPath;
      tracker.frozen = true;
    }
  }, [circuitKey, isReplayMode, selectedReplaySession]);

  // GUID: PIT_WALL_CLIENT-029-v02
  // [Intent] Accumulate circuit path from replay/showreel drivers when no live session
  //          is providing GPS data. Uses single-driver tracking (same as live mode) to
  //          produce a clean circuit outline instead of a multi-car jumble.
  //          v02: Single-driver tracking with loop closure detection.
  useEffect(() => {
    if (circuitKey) return; // live session is providing circuit path
    if (activeDrivers.length === 0) return;
    const tracker = pathTrackerRef.current;
    if (tracker.frozen) return;

    // Pick driver to track: prefer P1, fallback to first with valid GPS
    if (tracker.trackedDriver === null) {
      const p1 = activeDrivers.find(d => d.position === 1 && d.x != null && d.y != null);
      const candidate = p1 ?? activeDrivers.find(d => d.x != null && d.y != null);
      if (!candidate) return;
      tracker.trackedDriver = candidate.driverNumber;
    }

    const driver = activeDrivers.find(d => d.driverNumber === tracker.trackedDriver);
    if (!driver || driver.x == null || driver.y == null) return;

    const newPoint: CircuitPoint = { x: driver.x, y: driver.y };

    setCircuitPath(prev => {
      const combined = [...prev, newPoint];

      if (combined.length > 100) {
        const first = combined[0];
        const dx = newPoint.x - first.x;
        const dy = newPoint.y - first.y;
        if (Math.sqrt(dx * dx + dy * dy) < 50) {
          tracker.frozen = true;
        }
      }

      const capped = combined.length > MAX_CIRCUIT_POINTS
        ? combined.slice(-MAX_CIRCUIT_POINTS)
        : combined;
      circuitPathRef.current = capped;
      return capped;
    });
  }, [activeDrivers, circuitKey]);

  // Track bounds — use accumulated circuit path when available (stable full-circuit extent);
  // fall back to current driver positions only for the very first few polls before path builds up.
  const trackBounds = useMemo(
    () => computeTrackBounds(circuitPath.length >= 10 ? circuitPath : activeDrivers),
    [circuitPath, activeDrivers],
  );

  // Table sort state
  const [sortKey, setSortKey] = useState<string | null>(null);

  // GUID: PIT_WALL_CLIENT-028-v01
  // [Intent] Follow-mode camera — click a driver in the race table to zoom the track map
  //          in and track them. Click again to return to full-track overview.
  const [followDriver, setFollowDriver] = useState<number | null>(null);
  const handleDriverFollow = useCallback((driverNumber: number) => {
    setFollowDriver(prev => prev === driverNumber ? null : driverNumber);
  }, []);

  // GUID: PIT_WALL_CLIENT-051-v01
  // [Intent] Compute virtual time delta for replay mode — the elapsed virtual time since
  //          the last driver data push. In replay at 4-8x speed, wall time between frames
  //          is tiny (~60ms) but virtual time gap is large. Without this, the interpolation
  //          system's impossible-travel filter rejects every position update as a GPS spike.
  //          In live/showreel mode, undefined lets the interpolation system use wall time.
  const prevReplayElapsedMsRef = useRef<number>(0);
  const virtualTimeDeltaMs = useMemo(() => {
    if (!isReplayMode) {
      prevReplayElapsedMsRef.current = 0;
      return undefined;
    }
    const currentElapsed = replayPlayer.elapsedMs ?? 0;
    const delta = currentElapsed - prevReplayElapsedMsRef.current;
    prevReplayElapsedMsRef.current = currentElapsed;
    // Clamp to a reasonable range — 0 means paused, don't return negative
    return delta > 0 ? delta : undefined;
  }, [isReplayMode, replayPlayer.elapsedMs]);

  // GUID: PIT_WALL_CLIENT-033-v01
  // [Intent] Trail display settings — configurable from the toolbar.
  //          trailEnabled: master toggle for trail rendering (default: on).
  //          trailTtlMs: trail lifetime in milliseconds (default: 750ms).
  //          Options: 250, 500, 750, 1000, 1500ms.
  const [trailEnabled, setTrailEnabled] = useState(true);
  const [trailTtlMs, setTrailTtlMs] = useState(750);

  // GUID: PIT_WALL_CLIENT-035-v01
  // [Intent] 3-tier zoom state machine for the track map.
  //          Zoom 0: default layout (280px header, FIA feed + race table visible).
  //          Zoom 1: fullscreen track map (FIA feed, race table, radio panel hidden).
  //          Zoom 2: hyper-focus — camera locks on focusPosition (~100m radius, 8x zoom).
  //          focusPosition: race position to track in Zoom 2 (1-based, default P1).
  const [zoomLevel, setZoomLevel] = useState<0 | 1 | 2>(0);
  const [focusPosition, setFocusPosition] = useState(1);

  const handleZoomCycle = useCallback(() => {
    setZoomLevel(prev => {
      if (prev === 0) return 1;
      if (prev === 1) return 2;
      return 0;
    });
  }, []);

  const handleFocusUp = useCallback(() => {
    setFocusPosition(prev => (prev <= 1 ? 20 : prev - 1));
  }, []);

  const handleFocusDown = useCallback(() => {
    setFocusPosition(prev => (prev >= 20 ? 1 : prev + 1));
  }, []);

  // GUID: PIT_WALL_CLIENT-003-v01
  // [Intent] Radio zoom panel state — selected driver and open/close.
  const [radioZoomOpen, setRadioZoomOpen] = useState(false);
  const [selectedRadioDriver, setSelectedRadioDriver] = useState<number | null>(null);

  const handleRadioClick = (driverNumber: number) => {
    setSelectedRadioDriver(driverNumber);
    setRadioZoomOpen(true);
    setRadioZoomMode(true);
  };

  const handleRadioClose = () => {
    setRadioZoomOpen(false);
    setRadioZoomMode(false);
  };

  const handleSort = (key: string) => {
    setSortKey(prev => (prev === key ? null : key));
  };

  // GUID: PIT_WALL_CLIENT-004-v01
  // [Intent] Format last-updated timestamp for the toolbar display.
  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Session display: in showreel mode, show historical race name instead of live session
  const displayMeetingName = preRaceMode.isShowreel
    ? (preRaceMode.currentItem?.session.meetingName ?? preRaceMode.onDemandSession?.meetingName ?? meetingName)
    : meetingName;
  const displaySessionType = preRaceMode.isShowreel
    ? (preRaceMode.currentItem?.session.sessionType ?? preRaceMode.onDemandSession?.sessionType ?? sessionType)
    : sessionType;

  // GUID: PIT_WALL_CLIENT-030-v01
  // [Intent] Live prediction score — computes the logged-in user's score based on current
  //          driver positions. Uses the meeting name to find the right prediction document.
  //          Skipped during 2025 showreel replays (no matching 2026 predictions).
  const scoreMeetingName = isReplayMode
    ? selectedReplaySession?.meetingName ?? null
    : preRaceMode.isShowreel ? null   // hide during 2025 showreel
    : meetingName;
  const scoreSessionType = isReplayMode
    ? (selectedReplaySession?.sessionName ?? null)
    : sessionType;
  const liveScore = useLivePredictionScore(activeDrivers, scoreMeetingName, scoreSessionType);

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden bg-slate-950">

      {/* ── INITIAL LOAD OVERLAY ── */}
      {/* GUID: PIT_WALL_CLIENT-017-v01 */}
      {/* Only shown on first load (no drivers yet). Disappears on first successful fetch. */}
      <PitWallLoadingScreen isLoading={isLoading && liveDrivers.length === 0} />

      {/* ── SHOWREEL BETWEEN SPLASH (full overlay) ── */}
      <AnimatePresence>
        {preRaceMode.mode === 'SHOWREEL_BETWEEN' && (
          <ShowreelSplash
            upNextRaceName={
              preRaceMode.schedule?.items[preRaceMode.currentItemIndex + 1]?.session.meetingName
              ?? nextRaceInfo?.name
              ?? 'Next Race'
            }
            onComplete={() => {/* preRaceMode ticker handles the transition */}}
          />
        )}
      </AnimatePresence>

      {/* ── PRE-RACE WARMUP BANNER ── */}
      {/* GUID: PIT_WALL_CLIENT-016-v01 */}
      {preRaceMode.isShowreel && (
        <PreRaceWarmupBanner
          currentRaceName={
            `2025 ${preRaceMode.currentItem?.session.meetingName
              ?? preRaceMode.onDemandSession?.meetingName
              ?? 'Race'}`
          }
          nextRaceName={nextRaceInfo?.name ?? 'Next Race'}
          minutesToStart={preRaceMode.minutesToRaceStart}
          isCountdown={preRaceMode.mode === 'COUNTDOWN'}
        />
      )}

      {/* ── HEADER: Track Map (2/3) + FIA Feed (1/3) ── */}
      {/* GUID: PIT_WALL_CLIENT-005-v02 */}
      {/* v02: When zoomLevel >= 1, track map goes fullscreen (absolute inset-0 z-50). */}
      {/*      FIA feed hidden. Zoom/focus controls overlay the map. */}
      <div className={cn(
        'border-b border-slate-800',
        zoomLevel >= 1
          ? 'absolute inset-0 z-50'
          : 'flex shrink-0 h-[280px]',
      )}>
        {/* Track map */}
        <div className={cn(
          'min-w-0',
          zoomLevel >= 1
            ? 'w-full h-full'
            : 'flex-[2] border-r border-slate-800',
        )}>
          <PitWallTrackMap
            drivers={activeDrivers}
            updateIntervalMs={
              isReplayMode
                ? (selectedReplaySession?.samplingIntervalMs ?? 500) / replayPlayer.speed
                : preRaceMode.isShowreel ? 500
                : settings.updateIntervalSeconds * 1000
            }
            bounds={trackBounds}
            circuitPath={circuitPath}
            circuitLat={circuitLat}
            circuitLon={circuitLon}
            sfLineX={sfLineX ?? null}
            sfLineY={sfLineY ?? null}
            rainIntensity={weather?.rainIntensity ?? null}
            sessionType={isReplayMode ? 'GPS REPLAY' : displaySessionType}
            hasLiveSession={sessionKey !== null || (isReplayMode && replayPlayer.playbackState !== 'idle')}
            positionDataAvailable={positionDataAvailable || (isReplayMode && replayPlayer.replayDrivers.length > 0)}
            nextRaceName={nextRaceInfo?.name ?? null}
            lastMeetingName={meetingName}
            followDriver={zoomLevel === 2 ? null : followDriver}
            trailEnabled={trailEnabled}
            trailTtlMs={trailTtlMs}
            zoomLevel={zoomLevel}
            focusPosition={focusPosition}
            virtualTimeDeltaMs={virtualTimeDeltaMs}
            sessionKey={
              isReplayMode
                ? `replay-${selectedReplaySession?.sessionKey ?? 'none'}`
                : `live-${sessionKey ?? 'none'}`
            }
            className="w-full h-full"
          />

          {/* GUID: PIT_WALL_CLIENT-036-v01 */}
          {/* [Intent] Floating zoom controls — always visible when fullscreen (zoom >= 1). */}
          {/*          Top-right: zoom cycle button. Bottom-centre: focus position selector (zoom 2 only). */}
          {/*          Replay controls overlay bottom when in replay mode. */}
          {zoomLevel >= 1 && (
            <>
              {/* Zoom cycle button — top right */}
              <button
                onClick={handleZoomCycle}
                className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-900/80 backdrop-blur border border-slate-700/50 text-[9px] font-semibold uppercase tracking-wider text-cyan-400 hover:bg-slate-800/80 transition-colors"
              >
                <ZoomIn className="w-3 h-3" />
                {zoomLevel === 1 ? 'Zoom 2' : 'Exit'}
              </button>

              {/* Focus position selector — bottom centre (zoom 2 only) */}
              {zoomLevel === 2 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur border border-slate-700/50">
                  <button
                    onClick={handleFocusUp}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-cyan-400 tabular-nums min-w-[60px] text-center">
                    P{focusPosition}{' '}
                    <span className="text-[10px] font-normal text-slate-400">
                      {activeDrivers.find(d => d.position === focusPosition)?.driverCode ?? '---'}
                    </span>
                  </span>
                  <button
                    onClick={handleFocusDown}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Replay controls overlay — bottom of fullscreen map */}
              {isReplayMode && (
                <div className="absolute bottom-0 left-0 right-0 z-10 bg-slate-950/80 backdrop-blur border-t border-slate-800">
                  <ReplayControls
                    player={replayPlayer}
                    meetingName={selectedReplaySession?.meetingName ?? (replaySessionsLoading ? 'Loading…' : 'Select a session')}
                    sessionsLoading={replaySessionsLoading}
                  />
                </div>
              )}
            </>
          )}
        </div>
        {/* FIA race control feed — hidden when zoomed */}
        {zoomLevel === 0 && (
          <div className="flex-[1] min-w-0 min-h-0">
            <FIARaceControlFeed messages={raceControl} className="h-full" />
          </div>
        )}
      </div>

      {/* ── TOOLBAR ── */}
      {/* GUID: PIT_WALL_CLIENT-006-v02 */}
      {/* v02: Hidden when zoomLevel >= 1 (fullscreen track map). */}
      <div className={cn(
        'flex shrink-0 items-center gap-4 px-4 py-2 border-b border-slate-800 bg-slate-950',
        zoomLevel >= 1 && 'hidden',
      )}>
        {/* Session identity */}
        <div className="flex items-center gap-2 mr-2">
          <TowerControl className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest truncate max-w-[200px]">
            {displayMeetingName ?? sessionName ?? 'Pit Wall'}
          </span>
          {displaySessionType && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 uppercase tracking-wider">
              {preRaceMode.isShowreel ? '2025 REPLAY' : displaySessionType}
            </span>
          )}
        </div>

        {/* Weather strip */}
        <WeatherStrip weather={weather} className="flex-1 min-w-0" />

        {/* Showreel replay progress */}
        {preRaceMode.isShowreel && historicalReplay.durationSeconds > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-orange-400">
            <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-1000"
                style={{ width: `${(historicalReplay.progress * 100).toFixed(1)}%` }}
              />
            </div>
            <span className="tabular-nums">
              {Math.floor(historicalReplay.elapsedSeconds / 60)}:{String(Math.floor(historicalReplay.elapsedSeconds % 60)).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* High frequency warning */}
        {isHighFrequency && !preRaceMode.isShowreel && (
          <span className="text-[10px] text-orange-400 border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 rounded whitespace-nowrap">
            High data use
          </span>
        )}

        {/* Race selector (showreel mode only) */}
        {preRaceMode.isShowreel && preRaceMode.schedule && (
          <RaceSelector
            sessions={preRaceMode.schedule.items.map(i => i.session)}
            currentSession={preRaceMode.currentItem?.session ?? preRaceMode.onDemandSession ?? null}
            onSelectSession={preRaceMode.onRaceSelect}
          />
        )}

        {/* GUID: PIT_WALL_CLIENT-034-v01 */}
        {/* [Intent] Trail controls — toggle on/off and TTL selector. Minimal inline UI. */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTrailEnabled(prev => !prev)}
            className={cn(
              'text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider transition-colors',
              trailEnabled
                ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/30'
                : 'bg-slate-800 text-slate-600 border border-slate-700',
            )}
          >
            Trails
          </button>
          {trailEnabled && (
            <select
              value={trailTtlMs}
              onChange={e => setTrailTtlMs(Number(e.target.value))}
              className="text-[9px] bg-slate-800 text-slate-400 border border-slate-700 rounded px-1 py-0.5 outline-none"
            >
              <option value={250}>0.25s</option>
              <option value={500}>0.5s</option>
              <option value={750}>0.75s</option>
              <option value={1000}>1s</option>
              <option value={1500}>1.5s</option>
            </select>
          )}
        </div>

        {/* Zoom button moved to controls div (right side) for better visibility */}

        {/* Controls */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          {!preRaceMode.isShowreel && !isReplayMode && (
            <div className="flex items-center gap-1.5">
              <UpdateSpeedSlider
                value={settings.updateIntervalSeconds}
                onChange={setUpdateInterval}
              />
              {intervalIsTemporary && (
                <span
                  className="text-[9px] text-amber-400 tabular-nums whitespace-nowrap"
                  title={`Custom refresh rate resets to 60s in ${intervalResetMinutes}m`}
                >
                  ↺{intervalResetMinutes}m
                </span>
              )}
            </div>
          )}
          <ColumnSelector
            visibleColumns={settings.visibleColumns}
            onToggle={toggleColumn}
          />
          {/* GUID: PIT_WALL_CLIENT-037-v01 */}
          {/* [Intent] Zoom toggle button — cycles through 0 → 1 → 2 → 0. */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 text-[10px] font-semibold uppercase tracking-wider',
              zoomLevel > 0
                ? 'text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20'
                : 'text-slate-500 hover:text-slate-200',
            )}
            onClick={handleZoomCycle}
            title="Cycle zoom: Overview → Fullscreen → Hyper-focus"
          >
            <ZoomIn className="w-3 h-3" />
            {zoomLevel === 0 ? 'Zoom' : zoomLevel === 1 ? 'Zoom 1' : 'Zoom 2'}
          </Button>
          {/* REPLAY toggle button */}
          {/* GUID: PIT_WALL_CLIENT-023-v01 */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1.5 text-[10px] font-semibold uppercase tracking-wider',
              isReplayMode
                ? 'text-orange-400 border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20'
                : 'text-slate-500 hover:text-slate-200',
            )}
            onClick={isReplayMode ? handleExitReplay : handleEnterReplay}
            title={isReplayMode ? 'Exit replay mode' : 'Replay last race GPS'}
          >
            <Film className="w-3 h-3" />
            {isReplayMode ? 'Exit' : 'Replay'}
          </Button>
          {!preRaceMode.isShowreel && !isReplayMode && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:text-slate-200"
              onClick={forceRefresh}
              title="Refresh now"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </Button>
          )}
          {lastUpdatedLabel && !preRaceMode.isShowreel && !isReplayMode && (
            <span className="text-[9px] text-slate-600 font-mono tabular-nums whitespace-nowrap">
              {lastUpdatedLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── REPLAY CONTROLS STRIP ── */}
      {/* GUID: PIT_WALL_CLIENT-024-v02 */}
      {/* Always mounted when isReplayMode — fade/slide in to avoid layout snap */}
      {/* v02: Hidden when zoomed (replay controls appear as overlay on fullscreen map) */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          zoomLevel >= 1 && 'hidden',
        )}
        style={{ maxHeight: isReplayMode ? '60px' : '0px', opacity: isReplayMode ? 1 : 0 }}
      >
        <ReplayControls
          player={replayPlayer}
          meetingName={selectedReplaySession?.meetingName ?? (replaySessionsLoading ? 'Loading…' : 'Select a session')}
          sessionsLoading={replaySessionsLoading}
        />
      </div>

      {/* ── ERROR BANNER ── */}
      {/* GUID: PIT_WALL_CLIENT-007-v01 */}
      {error && !preRaceMode.isShowreel && zoomLevel === 0 && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-950/50 border-b border-red-900/50 text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          {errorCode && (
            <span className="font-mono text-[10px] select-all text-red-500">{errorCode}</span>
          )}
          {correlationId && (
            <span className="font-mono text-[10px] select-all text-red-600">{correlationId}</span>
          )}
        </div>
      )}

      {/* ── LIVE PREDICTION SCORE BANNER ── */}
      {/* GUID: PIT_WALL_CLIENT-031-v01 */}
      {zoomLevel === 0 && <LiveScoreBanner score={liveScore} />}

      {/* ── RACE TABLE (fills remaining height) ── */}
      {/* GUID: PIT_WALL_CLIENT-008-v02 */}
      {/* v02: Hidden when zoomed (fullscreen track map takes over). */}
      {zoomLevel === 0 && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <PitWallRaceTable
            drivers={activeDrivers}
            radioMessages={activeRadioMessages}
            visibleColumns={settings.visibleColumns}
            radioState={radioState}
            onRadioClick={handleRadioClick}
            onDriverClick={handleDriverFollow}
            followDriver={followDriver}
            sortKey={sortKey}
            onSort={handleSort}
            totalLaps={totalLaps}
            className="h-full"
          />
        </div>
      )}

      {/* ── RADIO ZOOM PANEL (slides up from bottom) ── */}
      {/* GUID: PIT_WALL_CLIENT-009-v01 */}
      {zoomLevel === 0 && (
        <RadioZoomPanel
          isOpen={radioZoomOpen}
          onClose={handleRadioClose}
          drivers={activeDrivers}
          radioMessages={activeRadioMessages}
          radioState={radioState}
          selectedDriver={selectedRadioDriver}
          onSelectDriver={setSelectedRadioDriver}
        />
      )}
    </div>
  );
}
