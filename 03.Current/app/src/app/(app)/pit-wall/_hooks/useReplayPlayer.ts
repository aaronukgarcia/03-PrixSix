// GUID: REPLAY_PLAYER_HOOK-000-v02
// [Intent] Full-transport RAF playback hook for GPS replay sessions.
//          v02: Supports two loading paths:
//            1. Firestore mode (firestoreStatus === 'complete') — progressive chunk loading via
//               /api/pit-wall/replay-chunks. Fast start, survives deployments.
//            2. Ingest mode (first-time) — NDJSON stream from /api/pit-wall/historical-replay.
//               Streams frames while simultaneously writing to Firestore for next time.
//            3. Legacy mode — Firebase Storage download URL (backward compat for showreel).
// [Inbound Trigger] Called by PitWallClient when isReplayMode === true.
// [Downstream Impact] replayDrivers[] flows into activeDrivers → track map + race table.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReplaySessionMetadata, ReplayPlaybackState, ReplaySpeed, UseReplayPlayerReturn } from '../_types/replay.types';
import type { HistoricalReplayData, HistoricalDriver, ReplayDriverState } from '../_types/showreel.types';
import { CLIENT_ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';

// GUID: REPLAY_PLAYER_HOOK-001-v02
function buildReplayDriverState(
  driver: HistoricalDriver,
  pos: { driverNumber: number; x: number; y: number; position: number;
    speed?: number | null; throttle?: number | null; brake?: number | null;
    gear?: number | null; drs?: number | null;
    gapToLeader?: string | null; intervalToAhead?: string | null;
    lastLapTime?: number | null; bestLapTime?: number | null;
    currentLap?: number | null;
    s1?: number | null; s2?: number | null; s3?: number | null;
    tyreCompound?: string | null; tyreLapAge?: number | null;
    pitStopCount?: number | null; inPit?: boolean;
  },
): ReplayDriverState {
  // Keep gap values as strings — downstream DeltaIndicator expects string | null.
  // parseFloat was converting to number, which crashed .toUpperCase() (PX-9001).
  const parseGap = (v: string | number | null | undefined): string | null => {
    if (v == null || v === '') return null;
    return String(v);
  };
  const hasDrs = pos.drs != null && pos.drs >= 10 && pos.drs <= 14;

  return {
    driverNumber: driver.driverNumber,
    driverCode:   driver.driverCode,
    fullName:     driver.fullName,
    teamName:     driver.teamName,
    teamColour:   driver.teamColour,
    position:     pos.position,
    x:            pos.x,
    y:            pos.y,
    z:              null,
    positionChange: 0,
    gapToLeader:    parseGap(pos.gapToLeader),
    intervalToAhead:parseGap(pos.intervalToAhead),
    currentLap:     pos.currentLap ?? 0,
    lastLapTime:    pos.lastLapTime ?? null,
    bestLapTime:    pos.bestLapTime ?? null,
    fastestLap:     false,
    sectors: { s1: pos.s1 ?? null, s2: pos.s2 ?? null, s3: pos.s3 ?? null, s1Status: null, s2Status: null, s3Status: null },
    tyreCompound:   pos.tyreCompound ?? 'UNKNOWN',
    tyreLapAge:     pos.tyreLapAge ?? 0,
    pitStopCount:   pos.pitStopCount ?? 0,
    onNewTyres:     false,
    inPit:          pos.inPit ?? false,
    retired:        false,
    hasDrs,
    speed:          pos.speed ?? null,
    throttle:       pos.throttle ?? null,
    brake:          pos.brake ?? null,
    gear:           pos.gear ?? null,
    hasUnreadRadio: false,
    isMuted:        false,
    lastUpdated:    Date.now(),
  };
}

// GUID: REPLAY_PLAYER_HOOK-002-v02
async function downloadReplayDataLegacy(
  downloadUrl: string,
  onProgress: (fraction: number) => void,
): Promise<HistoricalReplayData> {
  const res = await fetch(downloadUrl, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching replay data`);

  const contentLength = res.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : null;

  if (!res.body || !total) {
    onProgress(0.5);
    const json = await res.json() as HistoricalReplayData;
    onProgress(1);
    return json;
  }

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
async function streamReplayData(
  downloadUrl: string,
  onProgress: (fraction: number) => void,
  onFramesReady: (data: HistoricalReplayData) => void,
): Promise<HistoricalReplayData> {
  const isNdjson = downloadUrl.split('?')[0].endsWith('.ndjson');
  if (!isNdjson) {
    const data = await downloadReplayDataLegacy(downloadUrl, onProgress);
    onFramesReady(data);
    return data;
  }

  const res = await fetch(downloadUrl, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching NDJSON replay data`);

  if (!res.body) {
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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let metaParsed = false;
  let readyFired = false;
  const READY_THRESHOLD = 60;

  const data: HistoricalReplayData = {
    sessionKey: 0, sessionName: '', meetingName: '', drivers: [], frames: [], durationMs: 0, totalLaps: null,
  };
  let estimatedTotal = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;

      if (!metaParsed) {
        const meta = JSON.parse(line);
        data.sessionKey = meta.sessionKey ?? 0;
        data.sessionName = meta.sessionName ?? '';
        data.meetingName = meta.meetingName ?? '';
        data.drivers = meta.drivers ?? [];
        data.durationMs = meta.durationMs ?? 0;
        data.totalLaps = meta.totalLaps ?? null;
        const interval = meta.samplingIntervalMs ?? 500;
        estimatedTotal = interval > 0 ? Math.ceil(data.durationMs / interval) : 1000;
        metaParsed = true;
      } else {
        const frame = JSON.parse(line);
        // Skip completion markers and error markers
        if (frame._complete || frame._error) continue;
        data.frames.push(frame);
        onProgress(estimatedTotal > 0 ? Math.min(0.99, data.frames.length / estimatedTotal) : 0.5);
        if (!readyFired && data.frames.length >= READY_THRESHOLD) {
          readyFired = true;
          onFramesReady(data);
        }
      }
    }

    if (done) break;
  }

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
      const parsed = JSON.parse(remaining);
      if (!parsed._complete && !parsed._error) {
        data.frames.push(parsed);
      }
    }
  }

  onProgress(1);
  if (!readyFired && data.frames.length > 0) {
    onFramesReady(data);
  }

  return data;
}

// ---------------------------------------------------------------------------
// GUID: REPLAY_PLAYER_HOOK-010-v01
// [Intent] Progressive chunk loading from Firestore via /api/pit-wall/replay-chunks.
//          Fetches chunks in groups of 3, appends frames to mutable data object,
//          fires onFramesReady after first batch for instant-start playback.
//          Then continues loading remaining chunks in background.
// ---------------------------------------------------------------------------
async function loadChunksProgressively(
  sessionKey: number,
  totalChunks: number,
  getAuthToken: () => Promise<string>,
  onProgress: (fraction: number) => void,
  onFramesReady: (data: HistoricalReplayData) => void,
): Promise<HistoricalReplayData> {
  const BATCH_SIZE = 3;
  let readyFired = false;
  const READY_THRESHOLD = 60;

  const data: HistoricalReplayData = {
    sessionKey, sessionName: '', meetingName: '', drivers: [], frames: [], durationMs: 0, totalLaps: null,
  };

  for (let from = 0; from < totalChunks; from += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, totalChunks - from);
    const token = await getAuthToken();

    const res = await fetch(
      `/api/pit-wall/replay-chunks?session_key=${sessionKey}&from=${from}&count=${count}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading replay chunks from=${from}`);
    }

    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim().length > 0);

    for (const line of lines) {
      const parsed = JSON.parse(line);

      // First line of first batch: metadata
      if (from === 0 && parsed.drivers && !parsed.virtualTimeMs) {
        data.sessionKey = parsed.sessionKey ?? sessionKey;
        data.sessionName = parsed.sessionName ?? '';
        data.meetingName = parsed.meetingName ?? '';
        data.drivers = parsed.drivers ?? [];
        data.durationMs = parsed.durationMs ?? 0;
        data.totalLaps = parsed.totalLaps ?? null;
        continue;
      }

      // Frame line
      data.frames.push(parsed);
    }

    // Report progress
    const loaded = Math.min(from + count, totalChunks);
    onProgress(loaded / totalChunks);

    // Fire onFramesReady once we have enough frames
    if (!readyFired && data.frames.length >= READY_THRESHOLD) {
      readyFired = true;
      onFramesReady(data);
    }
  }

  onProgress(1);

  // If we never hit the threshold (very short replay), fire now
  if (!readyFired && data.frames.length > 0) {
    onFramesReady(data);
  }

  return data;
}

// ---------------------------------------------------------------------------
// GUID: REPLAY_PLAYER_HOOK-011-v01
// [Intent] First-time ingest path: call /api/pit-wall/historical-replay which streams
//          NDJSON while simultaneously writing to Firestore. Uses the same NDJSON parsing
//          as streamReplayData but with auth headers and API URL.
// ---------------------------------------------------------------------------
async function streamIngestReplayData(
  sessionKey: number,
  getAuthToken: () => Promise<string>,
  onProgress: (fraction: number) => void,
  onFramesReady: (data: HistoricalReplayData) => void,
): Promise<HistoricalReplayData> {
  const token = await getAuthToken();
  const res = await fetch(
    `/api/pit-wall/historical-replay?session_key=${sessionKey}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status} from historical-replay`);
  }

  // Check if this is a Firestore redirect (JSON response, not NDJSON stream)
  const contentType = res.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await res.json();
    if (json.source === 'firestore') {
      // Redirect to chunk loading — this shouldn't normally happen here
      // because the caller checks firestoreStatus first, but handle it gracefully
      return loadChunksProgressively(sessionKey, json.totalChunks, getAuthToken, onProgress, onFramesReady);
    }
    throw new Error(json.error ?? 'Unexpected JSON response from historical-replay');
  }

  // NDJSON streaming (same pattern as streamReplayData but from API response)
  if (!res.body) {
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const data: HistoricalReplayData = {
      sessionKey, sessionName: '', meetingName: '', drivers: [], frames: [], durationMs: 0, totalLaps: null,
    };
    for (const line of lines) {
      const parsed = JSON.parse(line);
      if (parsed._complete || parsed._error) continue;
      if (parsed.drivers && !parsed.virtualTimeMs) {
        data.sessionKey = parsed.sessionKey ?? sessionKey;
        data.sessionName = parsed.sessionName ?? '';
        data.meetingName = parsed.meetingName ?? '';
        data.drivers = parsed.drivers ?? [];
        data.durationMs = parsed.durationMs ?? 0;
        data.totalLaps = parsed.totalLaps ?? null;
      } else {
        data.frames.push(parsed);
      }
    }
    onProgress(1);
    if (data.frames.length > 0) onFramesReady(data);
    return data;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let metaParsed = false;
  let readyFired = false;
  const READY_THRESHOLD = 60;

  const data: HistoricalReplayData = {
    sessionKey, sessionName: '', meetingName: '', drivers: [], frames: [], durationMs: 0, totalLaps: null,
  };
  let estimatedTotal = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;

      const parsed = JSON.parse(line);

      // Skip completion/error markers
      if (parsed._complete || parsed._error) continue;

      if (!metaParsed && parsed.drivers && !parsed.virtualTimeMs) {
        data.sessionKey = parsed.sessionKey ?? sessionKey;
        data.sessionName = parsed.sessionName ?? '';
        data.meetingName = parsed.meetingName ?? '';
        data.drivers = parsed.drivers ?? [];
        data.durationMs = parsed.durationMs ?? 0;
        data.totalLaps = parsed.totalLaps ?? null;
        const interval = parsed.samplingIntervalMs ?? 500;
        estimatedTotal = interval > 0 ? Math.ceil(data.durationMs / interval) : 1000;
        metaParsed = true;
      } else {
        data.frames.push(parsed);
        onProgress(estimatedTotal > 0 ? Math.min(0.99, data.frames.length / estimatedTotal) : 0.5);
        if (!readyFired && data.frames.length >= READY_THRESHOLD) {
          readyFired = true;
          onFramesReady(data);
        }
      }
    }

    if (done) break;
  }

  const remaining = buffer.trim();
  if (remaining.length > 0) {
    const parsed = JSON.parse(remaining);
    if (!parsed._complete && !parsed._error) {
      if (!metaParsed && parsed.drivers) {
        data.sessionKey = parsed.sessionKey ?? sessionKey;
        data.sessionName = parsed.sessionName ?? '';
        data.meetingName = parsed.meetingName ?? '';
        data.drivers = parsed.drivers ?? [];
        data.durationMs = parsed.durationMs ?? 0;
        data.totalLaps = parsed.totalLaps ?? null;
      } else {
        data.frames.push(parsed);
      }
    }
  }

  onProgress(1);
  if (!readyFired && data.frames.length > 0) {
    onFramesReady(data);
  }

  return data;
}

// ---------------------------------------------------------------------------
// GUID: REPLAY_PLAYER_HOOK-003-v02
// [Intent] Full-transport RAF-based playback hook. Manages download, virtual time, and controls.
//          v02: Accepts optional getAuthToken callback for Firestore chunk-loading mode.
//          When session.firestoreStatus === 'complete', loads chunks progressively from Firestore.
//          Otherwise, streams from historical-replay API (triggers ingest + Firestore write).
//          Falls back to legacy download URL for showreel mode.
export function useReplayPlayer(
  session: ReplaySessionMetadata | null,
  getAuthToken?: () => Promise<string>,
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

  const replayDataRef        = useRef<HistoricalReplayData | null>(null);
  const rafHandleRef         = useRef<number | null>(null);
  const startWallMsRef       = useRef<number>(0);
  const virtualOffsetMsRef   = useRef<number>(0);
  const speedRef             = useRef<ReplaySpeed>(1);
  const lastFrameIndexRef    = useRef<number>(-1);
  const isPlayingRef         = useRef(false);
  const playbackStateRef     = useRef<ReplayPlaybackState>('idle');

  speedRef.current = speed;

  // GUID: REPLAY_PLAYER_HOOK-013-v01
  // [Intent] Stabilise getAuthToken reference — prevent auth state changes from
  //          re-triggering the load effect. getAuthToken depends on firebaseUser which
  //          can change reference multiple times during auth resolution. Each change
  //          would cancel the RAF via effect cleanup, killing the playback loop before
  //          a single tick fires. Using a ref ensures the latest function is always
  //          available without appearing in any dependency arrays.
  const getAuthTokenRef = useRef(getAuthToken);
  getAuthTokenRef.current = getAuthToken;

  const updatePlaybackState = useCallback((s: ReplayPlaybackState) => {
    playbackStateRef.current = s;
    setPlaybackState(s);
  }, []);

  // ---------------------------------------------------------------------------
  // RAF loop
  // ---------------------------------------------------------------------------
  // GUID: REPLAY_PLAYER_HOOK-014-v01
  // [Intent] Cancel the replay tick timer. Uses clearTimeout because the replay loop
  //          runs on setTimeout (not RAF). RAF was unreliable — callbacks silently failed
  //          to fire in some browser contexts, causing the replay to never advance past
  //          frame 0. setTimeout at 16ms gives equivalent ~60fps timing with reliable delivery.
  const cancelRaf = useCallback(() => {
    if (rafHandleRef.current !== null) {
      clearTimeout(rafHandleRef.current);
      rafHandleRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const data = replayDataRef.current;
    if (!data || !isPlayingRef.current) return;

    const elapsedWallMs = Date.now() - startWallMsRef.current;
    const virtualMs     = virtualOffsetMsRef.current + elapsedWallMs * speedRef.current;

    if (virtualMs >= data.durationMs) {
      cancelRaf();
      isPlayingRef.current = false;
      virtualOffsetMsRef.current = data.durationMs;
      setElapsedMs(data.durationMs);
      setProgress(1);
      updatePlaybackState('complete');
      return;
    }

    const frames = data.frames;
    if (frames.length === 0) {
      rafHandleRef.current = window.setTimeout(tick, 16) as unknown as number;
      return;
    }

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

      // GUID: REPLAY_PLAYER_HOOK-015-v01
      // [Intent] Build driver states and detect frozen/broken GPS data.
      //          Some drivers in the replay have permanently frozen GPS (stuck at grid
      //          position with speed=0 in every frame — broken ingest data). After the
      //          first 30 seconds, mark them as retired so the track map hides them and
      //          the table shows them dimmed. They'd otherwise appear as static dots
      //          far from the track at the start line.
      const isBeyondFormation = virtualMs > 30_000;
      const nextDrivers = frame.positions
        .map(pos => {
          const driver = driverMap.get(pos.driverNumber);
          if (!driver) return null;
          const state = buildReplayDriverState(driver, pos);
          if (isBeyondFormation && (pos.speed === 0 || pos.speed === null) && (pos.currentLap === 0 || pos.currentLap === null)) {
            state.retired = true;
          }
          return state;
        })
        .filter((d): d is ReplayDriverState => d !== null);

      setReplayDrivers(nextDrivers);
      setElapsedMs(virtualMs);
      setProgress(Math.min(1, virtualMs / data.durationMs));

      // GUID: REPLAY_PLAYER_HOOK-007-v01
      if (frame.radioMessages && frame.radioMessages.length > 0) {
        setReplayRadioMessages(prev => [...frame.radioMessages!, ...prev]);
      }
    }

    rafHandleRef.current = window.setTimeout(tick, 16) as unknown as number;
  }, [cancelRaf, updatePlaybackState]);

  const startRafFrom = useCallback((virtualMs: number) => {
    cancelRaf();
    virtualOffsetMsRef.current = virtualMs;
    startWallMsRef.current     = Date.now();
    lastFrameIndexRef.current  = -1;
    isPlayingRef.current       = true;
    updatePlaybackState('playing');
    rafHandleRef.current       = window.setTimeout(tick, 16) as unknown as number;
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
      startWallMsRef.current = Date.now();
    } else if (playbackStateRef.current !== 'idle' && playbackStateRef.current !== 'loading') {
      updatePlaybackState('paused');
    }
  }, [updatePlaybackState]);

  // GUID: REPLAY_PLAYER_HOOK-009-v01
  const setSpeed = useCallback((newSpeed: ReplaySpeed) => {
    if (isPlayingRef.current) {
      const elapsed = Date.now() - startWallMsRef.current;
      virtualOffsetMsRef.current = virtualOffsetMsRef.current + elapsed * speedRef.current;
      startWallMsRef.current = Date.now();
    }
    speedRef.current = newSpeed;
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
          rafHandleRef.current   = window.setTimeout(tick, 16) as unknown as number;
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [cancelRaf, tick]);

  // ---------------------------------------------------------------------------
  // Session change — download/load and reset
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

    const onDataReady = (data: HistoricalReplayData) => {
      if (cancelled) return;
      replayDataRef.current = data;
      setDurationMs(data.durationMs);
      setFramesLoaded(data.frames.length);
      updatePlaybackState('ready');
      startRafFrom(0);
    };

    const onStreamComplete = (data: HistoricalReplayData) => {
      if (cancelled) return;
      replayDataRef.current = data;
      setDurationMs(data.durationMs);
      setFramesLoaded(data.frames.length);
      setDownloadProgress(1);
    };

    const onStreamError = (err: unknown) => {
      if (cancelled) return;
      const cid = generateClientCorrelationId();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(
        `[useReplayPlayer] ${CLIENT_ERRORS.PIT_WALL_REPLAY_LOAD_FAILED.code} — ${msg} | cid=${cid}`,
      );
      setError(`${CLIENT_ERRORS.PIT_WALL_REPLAY_LOAD_FAILED.message} (${cid})`);
      updatePlaybackState('error');
    };

    // GUID: REPLAY_PLAYER_HOOK-012-v02
    // [Intent] Choose loading path based on session metadata:
    //   1. firestoreStatus === 'complete' → chunk-load from Firestore (fast, durable)
    //   2. downloadUrl exists → legacy Firebase Storage download (existing sessions)
    //   3. No download URL + getAuthToken → ingest via API (first-time, streams + writes Firestore)
    //   4. Fallback → error (no data source available)
    //   v02: Fixed path priority — prefer existing downloadUrl over ingest.
    //        Ingest only triggers when no existing data source is available.
    const loadData = async () => {
      if (session.firestoreStatus === 'complete' && session.totalChunks && session.totalChunks > 0 && getAuthTokenRef.current) {
        // Path 1: Firestore chunk loading (fast, survives deployments)
        return loadChunksProgressively(
          session.sessionKey,
          session.totalChunks,
          getAuthTokenRef.current,
          fraction => { if (!cancelled) setDownloadProgress(fraction); },
          onDataReady,
        );
      } else if (session.downloadUrl) {
        // Path 2: Legacy Firebase Storage download (existing pre-ingested sessions)
        return streamReplayData(
          session.downloadUrl,
          fraction => { if (!cancelled) setDownloadProgress(fraction); },
          onDataReady,
        );
      } else if (getAuthTokenRef.current) {
        // Path 3: First-time ingest via API (no existing data — streams + writes to Firestore)
        return streamIngestReplayData(
          session.sessionKey,
          getAuthTokenRef.current,
          fraction => { if (!cancelled) setDownloadProgress(fraction); },
          onDataReady,
        );
      } else {
        throw new Error('No replay data source available');
      }
    };

    loadData()
      .then(onStreamComplete)
      .catch(onStreamError);

    return () => {
      cancelled = true;
      cancelRaf();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
