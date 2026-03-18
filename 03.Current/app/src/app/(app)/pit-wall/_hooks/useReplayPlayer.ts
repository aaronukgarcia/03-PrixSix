// GUID: REPLAY_PLAYER_HOOK-000-v01
// [Intent] Full-transport RAF playback hook for pre-ingested GPS replay sessions.
//          Downloads HistoricalReplayData JSON from Firebase Storage (public URL),
//          exposes play/pause/seek/speed/step controls, and emits ReplayDriverState[]
//          on each frame change — drop-in replacement for live DriverRaceState[].
// [Inbound Trigger] Called by PitWallClient when isReplayMode === true.
// [Downstream Impact] replayDrivers[] flows into activeDrivers → track map + race table.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReplaySessionMetadata, ReplayPlaybackState, ReplaySpeed, UseReplayPlayerReturn } from '../_types/replay.types';
import type { HistoricalReplayData, HistoricalDriver, ReplayDriverState } from '../_types/showreel.types';
import { CLIENT_ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';

// GUID: REPLAY_PLAYER_HOOK-001-v01
// [Intent] Build a ReplayDriverState from driver metadata + position entry.
//          Identical to the same helper in useHistoricalReplay — kept local to avoid coupling.
function buildReplayDriverState(
  driver: HistoricalDriver,
  position: number,
  x: number,
  y: number,
): ReplayDriverState {
  return {
    driverNumber: driver.driverNumber,
    driverCode:   driver.driverCode,
    fullName:     driver.fullName,
    teamName:     driver.teamName,
    teamColour:   driver.teamColour,
    position,
    x,
    y,
    z:              null,
    positionChange: 0,
    gapToLeader:    null,
    intervalToAhead:null,
    currentLap:     0,
    lastLapTime:    null,
    bestLapTime:    null,
    fastestLap:     false,
    sectors: { s1: null, s2: null, s3: null, s1Status: null, s2Status: null, s3Status: null },
    tyreCompound:   'UNKNOWN',
    tyreLapAge:     0,
    pitStopCount:   0,
    onNewTyres:     false,
    inPit:          false,
    retired:        false,
    hasDrs:         false,
    speed:          null,
    throttle:       null,
    brake:          null,
    gear:           null,
    hasUnreadRadio: false,
    isMuted:        false,
    lastUpdated:    Date.now(),
  };
}

// GUID: REPLAY_PLAYER_HOOK-002-v02
// [Intent] Legacy download: fetch entire JSON replay from a public Storage URL with progress.
//          Renamed from downloadReplayData — kept for backward compatibility with monolithic JSON files.
async function downloadReplayDataLegacy(
  downloadUrl: string,
  onProgress: (fraction: number) => void,
): Promise<HistoricalReplayData> {
  const res = await fetch(downloadUrl, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching replay data`);

  const contentLength = res.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : null;

  if (!res.body || !total) {
    // No streaming progress — just parse directly
    onProgress(0.5);
    const json = await res.json() as HistoricalReplayData;
    onProgress(1);
    return json;
  }

  // Stream with progress
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }

  const allBytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { allBytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder().decode(allBytes);
  return JSON.parse(text) as HistoricalReplayData;
}

// GUID: REPLAY_PLAYER_HOOK-006-v01
// [Intent] NDJSON streaming download for instant-start playback.
//          Format: line 1 = metadata { drivers, durationMs, samplingIntervalMs },
//          lines 2+ = frame objects { virtualTimeMs, positions, radioMessages? }.
//          Calls onFramesReady after 60 frames so playback can start while streaming continues.
//          Falls back to legacy JSON path if URL does not end in .ndjson.
async function streamReplayData(
  downloadUrl: string,
  onProgress: (fraction: number) => void,
  onFramesReady: (data: HistoricalReplayData) => void,
): Promise<HistoricalReplayData> {
  // Format detection: only use NDJSON streaming for .ndjson URLs
  const isNdjson = downloadUrl.split('?')[0].endsWith('.ndjson');
  if (!isNdjson) {
    // Legacy JSON — download fully then signal ready
    const data = await downloadReplayDataLegacy(downloadUrl, onProgress);
    onFramesReady(data);
    return data;
  }

  const res = await fetch(downloadUrl, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching NDJSON replay data`);

  if (!res.body) {
    // No ReadableStream — fall back to text parse
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error('NDJSON replay has no frames');
    const meta = JSON.parse(lines[0]);
    const frames = lines.slice(1).map(l => JSON.parse(l));
    const data: HistoricalReplayData = {
      sessionKey: meta.sessionKey ?? 0,
      sessionName: meta.sessionName ?? '',
      meetingName: meta.meetingName ?? '',
      drivers: meta.drivers ?? [],
      frames,
      durationMs: meta.durationMs ?? 0,
      totalLaps: meta.totalLaps ?? null,
    };
    onFramesReady(data);
    return data;
  }

  // Streaming NDJSON via ReadableStream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let metaParsed = false;
  let readyFired = false;
  const READY_THRESHOLD = 60;

  // Mutable data object — frames array grows as lines arrive
  const data: HistoricalReplayData = {
    sessionKey: 0,
    sessionName: '',
    meetingName: '',
    drivers: [],
    frames: [],
    durationMs: 0,
    totalLaps: null,
  };

  // Estimate total frames from metadata (if available) for progress reporting
  let estimatedTotal = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;

      if (!metaParsed) {
        // First line: metadata
        const meta = JSON.parse(line);
        data.sessionKey = meta.sessionKey ?? 0;
        data.sessionName = meta.sessionName ?? '';
        data.meetingName = meta.meetingName ?? '';
        data.drivers = meta.drivers ?? [];
        data.durationMs = meta.durationMs ?? 0;
        data.totalLaps = meta.totalLaps ?? null;
        // Estimate frame count from duration and sampling interval
        const interval = meta.samplingIntervalMs ?? 500;
        estimatedTotal = interval > 0 ? Math.ceil(data.durationMs / interval) : 1000;
        metaParsed = true;
      } else {
        // Frame line — parse and append (mutate in place)
        const frame = JSON.parse(line);
        data.frames.push(frame);

        // Report progress
        onProgress(estimatedTotal > 0 ? Math.min(0.99, data.frames.length / estimatedTotal) : 0.5);

        // Fire onFramesReady once we have enough frames for instant-start playback
        if (!readyFired && data.frames.length >= READY_THRESHOLD) {
          readyFired = true;
          onFramesReady(data);
        }
      }
    }

    if (done) break;
  }

  // Process any remaining buffer content (last line without trailing newline)
  const remaining = buffer.trim();
  if (remaining.length > 0) {
    if (!metaParsed) {
      const meta = JSON.parse(remaining);
      data.sessionKey = meta.sessionKey ?? 0;
      data.sessionName = meta.sessionName ?? '';
      data.meetingName = meta.meetingName ?? '';
      data.drivers = meta.drivers ?? [];
      data.durationMs = meta.durationMs ?? 0;
      data.totalLaps = meta.totalLaps ?? null;
      metaParsed = true;
    } else {
      data.frames.push(JSON.parse(remaining));
    }
  }

  onProgress(1);

  // If we never hit the threshold (very short replay), fire now
  if (!readyFired && data.frames.length > 0) {
    onFramesReady(data);
  }

  return data;
}

// GUID: REPLAY_PLAYER_HOOK-003-v01
// [Intent] Full-transport RAF-based playback hook. Manages download, virtual time, and controls.
//          Virtual time is: virtualOffsetMs + (Date.now() - startWallMs) × speed.
//          Seek: sets virtualOffsetMs = target, resets startWallMs.
//          Pause: captures current virtualTimeMs into virtualOffsetMs, stops RAF.
//          Speed change: captures current virtualTimeMs, updates speed ref, restarts from there.
export function useReplayPlayer(
  session: ReplaySessionMetadata | null,
): UseReplayPlayerReturn {
  const [playbackState,    setPlaybackState]    = useState<ReplayPlaybackState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [progress,         setProgress]         = useState(0);
  const [elapsedMs,        setElapsedMs]         = useState(0);
  const [durationMs,       setDurationMs]        = useState(0);
  const [speed,            setSpeedState]        = useState<ReplaySpeed>(1);
  const [error,            setError]             = useState<string | null>(null);
  const [replayDrivers,    setReplayDrivers]     = useState<ReplayDriverState[]>([]);
  const [framesLoaded,     setFramesLoaded]      = useState(0);
  const [replayRadioMessages, setReplayRadioMessages] = useState<Array<{ driverNumber: number; message: string; utcTimestamp: string }>>([]);

  // Stable refs — never trigger re-renders
  const replayDataRef        = useRef<HistoricalReplayData | null>(null);
  const rafHandleRef         = useRef<number | null>(null);
  const startWallMsRef       = useRef<number>(0);
  const virtualOffsetMsRef   = useRef<number>(0);
  const speedRef             = useRef<ReplaySpeed>(1);
  const lastFrameIndexRef    = useRef<number>(-1);
  const isPlayingRef         = useRef(false);
  const playbackStateRef     = useRef<ReplayPlaybackState>('idle');

  // Keep speed ref in sync
  speedRef.current = speed;

  const updatePlaybackState = useCallback((s: ReplayPlaybackState) => {
    playbackStateRef.current = s;
    setPlaybackState(s);
  }, []);

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
    if (!data || !isPlayingRef.current) return;

    const elapsedWallMs = Date.now() - startWallMsRef.current;
    const virtualMs     = virtualOffsetMsRef.current + elapsedWallMs * speedRef.current;

    if (virtualMs >= data.durationMs) {
      // Reached end
      cancelRaf();
      isPlayingRef.current = false;
      virtualOffsetMsRef.current = data.durationMs;
      setElapsedMs(data.durationMs);
      setProgress(1);
      updatePlaybackState('complete');
      return;
    }

    // Binary search for current frame
    const frames = data.frames;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].virtualTimeMs <= virtualMs) lo = mid;
      else hi = mid - 1;
    }

    const frameIndex = lo;
    if (frameIndex !== lastFrameIndexRef.current) {
      lastFrameIndexRef.current = frameIndex;
      const frame    = frames[frameIndex];
      const driverMap = new Map(data.drivers.map(d => [d.driverNumber, d]));

      const nextDrivers = frame.positions
        .map(pos => {
          const driver = driverMap.get(pos.driverNumber);
          if (!driver) return null;
          return buildReplayDriverState(driver, pos.position, pos.x, pos.y);
        })
        .filter((d): d is ReplayDriverState => d !== null);

      setReplayDrivers(nextDrivers);
      setElapsedMs(virtualMs);
      setProgress(Math.min(1, virtualMs / data.durationMs));

      // GUID: REPLAY_PLAYER_HOOK-007-v01
      // [Intent] Emit radio messages from the current frame (if any) by prepending to state.
      if (frame.radioMessages && frame.radioMessages.length > 0) {
        setReplayRadioMessages(prev => [...frame.radioMessages!, ...prev]);
      }
    }

    rafHandleRef.current = requestAnimationFrame(tick);
  }, [cancelRaf, updatePlaybackState]);

  const startRafFrom = useCallback((virtualMs: number) => {
    cancelRaf();
    virtualOffsetMsRef.current = virtualMs;
    startWallMsRef.current     = Date.now();
    lastFrameIndexRef.current  = -1;
    isPlayingRef.current       = true;
    updatePlaybackState('playing');
    rafHandleRef.current       = requestAnimationFrame(tick);
  }, [cancelRaf, tick, updatePlaybackState]);

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  const play = useCallback(() => {
    if (!replayDataRef.current) return;
    const currentVirtual = playbackStateRef.current === 'complete'
      ? 0
      : virtualOffsetMsRef.current;
    startRafFrom(currentVirtual);
  }, [startRafFrom]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    // Capture current virtual time before stopping
    const elapsed = Date.now() - startWallMsRef.current;
    virtualOffsetMsRef.current = virtualOffsetMsRef.current + elapsed * speedRef.current;
    cancelRaf();
    isPlayingRef.current = false;
    updatePlaybackState('paused');
  }, [cancelRaf, updatePlaybackState]);

  const seek = useCallback((targetMs: number) => {
    if (!replayDataRef.current) return;
    const clamped = Math.max(0, Math.min(replayDataRef.current.durationMs, targetMs));
    virtualOffsetMsRef.current = clamped;
    setElapsedMs(clamped);
    setProgress(clamped / replayDataRef.current.durationMs);
    lastFrameIndexRef.current = -1;
    if (isPlayingRef.current) {
      // Seamlessly continue playing from new position
      startWallMsRef.current = Date.now();
    } else if (playbackStateRef.current !== 'idle' && playbackStateRef.current !== 'loading') {
      updatePlaybackState('paused');
    }
  }, [updatePlaybackState]);

  const setSpeed = useCallback((newSpeed: ReplaySpeed) => {
    if (isPlayingRef.current) {
      // Capture current virtual time then restart at new speed
      const elapsed = Date.now() - startWallMsRef.current;
      virtualOffsetMsRef.current = virtualOffsetMsRef.current + elapsed * speedRef.current;
      startWallMsRef.current = Date.now();
    }
    setSpeedState(newSpeed);
  }, []);

  const skipToStart = useCallback(() => seek(0), [seek]);
  const skipToEnd   = useCallback(() => {
    const data = replayDataRef.current;
    if (data) seek(data.durationMs);
  }, [seek]);
  const stepBack    = useCallback(() => seek(virtualOffsetMsRef.current - 30_000), [seek]);
  const stepForward = useCallback(() => seek(virtualOffsetMsRef.current + 30_000), [seek]);

  // ---------------------------------------------------------------------------
  // Visibility change — pause/resume
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (isPlayingRef.current) {
          const elapsed = Date.now() - startWallMsRef.current;
          virtualOffsetMsRef.current += elapsed * speedRef.current;
          cancelRaf();
        }
      } else {
        if (isPlayingRef.current) {
          startWallMsRef.current = Date.now();
          rafHandleRef.current   = requestAnimationFrame(tick);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [cancelRaf, tick]);

  // ---------------------------------------------------------------------------
  // Session change — download and reset
  // ---------------------------------------------------------------------------
  useEffect(() => {
    cancelRaf();
    isPlayingRef.current = false;
    replayDataRef.current = null;
    virtualOffsetMsRef.current = 0;
    lastFrameIndexRef.current  = -1;

    setReplayDrivers([]);
    setProgress(0);
    setElapsedMs(0);
    setDurationMs(0);
    setError(null);
    setDownloadProgress(0);
    setFramesLoaded(0);
    setReplayRadioMessages([]);

    if (!session) {
      updatePlaybackState('idle');
      return;
    }

    let cancelled = false;
    updatePlaybackState('loading');

    // GUID: REPLAY_PLAYER_HOOK-008-v01
    // [Intent] Use streamReplayData for instant-start playback.
    //          onFramesReady fires after 60 NDJSON frames (or immediately for legacy JSON),
    //          allowing playback to begin while the rest of the file streams in.
    streamReplayData(
      session.downloadUrl,
      fraction => { if (!cancelled) setDownloadProgress(fraction); },
      data => {
        if (cancelled) return;
        // Partial or full data ready — set ref and start playback
        replayDataRef.current = data;
        setDurationMs(data.durationMs);
        setFramesLoaded(data.frames.length);
        updatePlaybackState('ready');
        // Auto-play on load
        startRafFrom(0);
      },
    )
      .then(data => {
        if (cancelled) return;
        // Streaming complete — ensure ref points to final data and update frame count
        replayDataRef.current = data;
        setDurationMs(data.durationMs);
        setFramesLoaded(data.frames.length);
        setDownloadProgress(1);
      })
      .catch(err => {
        if (cancelled) return;
        const cid = generateClientCorrelationId();
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(
          `[useReplayPlayer] ${CLIENT_ERRORS.PIT_WALL_REPLAY_LOAD_FAILED.code} — ${msg} | cid=${cid}`,
        );
        setError(`${CLIENT_ERRORS.PIT_WALL_REPLAY_LOAD_FAILED.message} (${cid})`);
        updatePlaybackState('error');
      });

    return () => {
      cancelled = true;
      cancelRaf();
    };
  }, [session, cancelRaf, startRafFrom, updatePlaybackState]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => () => { cancelRaf(); }, [cancelRaf]);

  return {
    playbackState,
    downloadProgress,
    progress,
    elapsedMs,
    durationMs,
    speed,
    error,
    framesLoaded,
    replayDrivers,
    replayRadioMessages,
    play,
    pause,
    seek,
    setSpeed,
    skipToStart,
    skipToEnd,
    stepBack,
    stepForward,
  };
}
