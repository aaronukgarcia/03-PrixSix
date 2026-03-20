// GUID: HISTORICAL_REPLAY_HOOK-000-v01
// [Intent] RAF playback loop for historical OpenF1 telemetry.
//          Accepts compressed replay data and emits current-frame driver positions.
// [Inbound Trigger] Used by PitWallClient when pre-race mode is SHOWREEL_PLAYING.
// [Downstream Impact] replayDrivers[] replaces live DriverRaceState[] in track map and table.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  HistoricalSession,
  HistoricalReplayData,
  HistoricalDriver,
  ReplayDriverState,
  UseHistoricalReplayReturn,
} from '../_types/showreel.types';
import { CLIENT_ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';

// ---------------------------------------------------------------------------
// Helper: fetch replay data
// ---------------------------------------------------------------------------

// GUID: HISTORICAL_REPLAY_HOOK-003-v01
// [Intent] Fetch compressed historical replay data from the pit-wall replay API.
//          Returns the parsed HistoricalReplayData or throws on error.
// [Inbound Trigger] Called when session changes in useHistoricalReplay.
// [Downstream Impact] Feeds the RAF playback loop with frame data.
async function fetchReplayData(
  sessionKey: number,
  idToken: string,
): Promise<HistoricalReplayData> {
  const res = await fetch(
    `/api/pit-wall/historical-replay?session_key=${sessionKey}&mode=showreel`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<HistoricalReplayData>;
}

// ---------------------------------------------------------------------------
// Helper: build ReplayDriverState from frame
// ---------------------------------------------------------------------------

// GUID: HISTORICAL_REPLAY_HOOK-002-v01
// [Intent] Map a single frame position entry + driver metadata into a ReplayDriverState,
//          filling all stub fields with safe defaults so it is drop-in compatible
//          with DriverRaceState consumers (track map, table).
// [Inbound Trigger] Called once per driver per RAF tick when the active frame changes.
// [Downstream Impact] replayDrivers[] state array consumed by PitWallClient children.
function buildReplayDriverState(
  driver: HistoricalDriver,
  position: number,
  x: number,
  y: number,
): ReplayDriverState {
  return {
    driverNumber: driver.driverNumber,
    driverCode: driver.driverCode,
    fullName: driver.fullName,
    teamName: driver.teamName,
    teamColour: driver.teamColour,
    position,
    x,
    y,
    z: null,
    positionChange: 0,
    gapToLeader: null,
    intervalToAhead: null,
    currentLap: 0,
    lastLapTime: null,
    bestLapTime: null,
    fastestLap: false,
    sectors: {
      s1: null,
      s2: null,
      s3: null,
      s1Status: null,
      s2Status: null,
      s3Status: null,
    },
    tyreCompound: 'UNKNOWN',
    tyreLapAge: 0,
    pitStopCount: 0,
    onNewTyres: false,
    inPit: false,
    retired: false,
    hasDrs: false,
    speed: null,
    throttle: null,
    brake: null,
    gear: null,
    hasUnreadRadio: false,
    isMuted: false,
    lastUpdated: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

// GUID: HISTORICAL_REPLAY_HOOK-001-v01
// [Intent] RAF-based playback loop for a single historical OpenF1 session.
//          Fetches compressed frame data, advances virtual time using compressionFactor,
//          and emits ReplayDriverState[] on each frame change. Pauses when tab is hidden.
// [Inbound Trigger] Called by PitWallClient when usePreRaceMode.mode === 'SHOWREEL_PLAYING'.
// [Downstream Impact] replayDrivers replaces live driver data in track map and standings table.
export function useHistoricalReplay(
  session: HistoricalSession | null,
  compressionFactor: number,
  idToken: string | null,
  onComplete?: () => void,
): UseHistoricalReplayReturn {
  const [replayDrivers, setReplayDrivers] = useState<ReplayDriverState[]>([]);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for RAF timing — never trigger re-renders
  const replayDataRef = useRef<HistoricalReplayData | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const startWallTimeRef = useRef<number>(0);
  const startVirtualTimeRef = useRef<number>(0);
  const lastFrameIndexRef = useRef<number>(-1);
  const isCompleteRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const compressionRef = useRef(compressionFactor);

  // Keep callback and compression refs in sync without re-running effects
  onCompleteRef.current = onComplete;
  compressionRef.current = compressionFactor;

  // ---------------------------------------------------------------------------
  // RAF loop
  // ---------------------------------------------------------------------------

  const cancelRaf = useCallback(() => {
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const data = replayDataRef.current;
    if (!data || isCompleteRef.current) return;

    const elapsedWallMs = Date.now() - startWallTimeRef.current;
    const virtualMs =
      startVirtualTimeRef.current + elapsedWallMs * compressionRef.current;

    // Completion check
    if (virtualMs >= data.durationMs) {
      cancelRaf();
      isCompleteRef.current = true;
      setIsComplete(true);
      setProgress(1);
      setElapsedSeconds(data.durationMs / 1000);
      onCompleteRef.current?.();
      return;
    }

    // Binary search for closest frame
    const frames = data.frames;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].virtualTimeMs <= virtualMs) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const frameIndex = lo;

    // Only rebuild driver states when the frame actually changes
    if (frameIndex !== lastFrameIndexRef.current) {
      lastFrameIndexRef.current = frameIndex;
      const frame = frames[frameIndex];
      const driverMap = new Map<number, HistoricalDriver>(
        data.drivers.map((d) => [d.driverNumber, d]),
      );

      const nextDrivers: ReplayDriverState[] = frame.positions
        .map((pos) => {
          const driver = driverMap.get(pos.driverNumber);
          if (!driver) return null;
          return buildReplayDriverState(driver, pos.position, pos.x, pos.y);
        })
        .filter((d): d is ReplayDriverState => d !== null);

      setReplayDrivers(nextDrivers);

      const elapsed = virtualMs / 1000;
      const total = data.durationMs / 1000;
      setElapsedSeconds(elapsed);
      setProgress(Math.min(1, elapsed / total));
    }

    // Schedule next tick
    rafHandleRef.current = requestAnimationFrame(tick);
  }, [cancelRaf]);

  const startRaf = useCallback(() => {
    cancelRaf();
    isCompleteRef.current = false;
    lastFrameIndexRef.current = -1;
    startWallTimeRef.current = Date.now();
    startVirtualTimeRef.current = 0;
    rafHandleRef.current = requestAnimationFrame(tick);
  }, [cancelRaf, tick]);

  // ---------------------------------------------------------------------------
  // Visibility change — pause when tab hidden, resume when visible
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Freeze virtual time at current position BEFORE pausing RAF.
        // Without this, the hidden duration is included in the resume calculation,
        // causing the replay to skip forward by the time the tab was backgrounded.
        startVirtualTimeRef.current +=
          (Date.now() - startWallTimeRef.current) * compressionRef.current;
        startWallTimeRef.current = Date.now();
        cancelRaf();
      } else {
        // Resume: startVirtualTime was frozen on hide, startWallTime was reset.
        // The elapsed-since-hide is near zero, so virtual time continues correctly.
        if (replayDataRef.current && !isCompleteRef.current) {
          startWallTimeRef.current = Date.now();
          rafHandleRef.current = requestAnimationFrame(tick);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cancelRaf, tick]);

  // ---------------------------------------------------------------------------
  // Session change — fetch new data and restart playback
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Cancel any in-flight RAF from the previous session
    cancelRaf();
    replayDataRef.current = null;
    lastFrameIndexRef.current = -1;
    isCompleteRef.current = false;

    // Reset display state
    setReplayDrivers([]);
    setProgress(0);
    setElapsedSeconds(0);
    setDurationSeconds(0);
    setIsComplete(false);
    setError(null);

    if (!session || !idToken) return;

    let cancelled = false;
    setIsLoading(true);

    fetchReplayData(session.sessionKey, idToken)
      .then((data) => {
        if (cancelled) return;
        replayDataRef.current = data;
        setDurationSeconds(data.durationMs / 1000);
        setIsLoading(false);
        startRaf();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const cid = generateClientCorrelationId();
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(
          `[useHistoricalReplay] ${CLIENT_ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.code} — ` +
            `${msg} | correlationId=${cid}`,
        );
        setError(`${CLIENT_ERRORS.PIT_WALL_HISTORICAL_REPLAY_FAILED.message} (${cid})`);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      cancelRaf();
    };
  }, [session, idToken, cancelRaf, startRaf]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      cancelRaf();
    };
  }, [cancelRaf]);

  return {
    replayDrivers,
    progress,
    elapsedSeconds,
    durationSeconds,
    isComplete,
    isLoading,
    error,
  };
}
