// GUID: PRE_RACE_MODE_HOOK-000-v01
// [Intent] State machine hook for Pit Wall pre-race showreel mode.
//          Determines when to show live data, historical replay, or idle/countdown screens.
// [Inbound Trigger] Used by PitWallClient to select data source (live vs replay).
// [Downstream Impact] Controls which components are rendered and what data source is used.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PreRaceModeState,
  ShowreelSchedule,
  ShowreelQueueItem,
  HistoricalSession,
  UsePreRaceModeReturn,
} from '../_types/showreel.types';
import { buildShowreelSchedule, validateScheduleTiming } from '../_utils/showreel-scheduler';
import { CLIENT_ERRORS } from '@/lib/error-registry-client';
import { generateClientCorrelationId } from '@/lib/error-codes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often the playback ticker evaluates item transitions (ms) */
const TICKER_INTERVAL_MS = 5_000;

/** How long to stay in SHOWREEL_BETWEEN before advancing to next item (ms) */
const BETWEEN_DURATION_MS = 2_000;

/** Showreel window: race within this many minutes triggers schedule fetch */
const SHOWREEL_WINDOW_MINUTES = 120;

/** Countdown window: race within this many minutes skips to COUNTDOWN */
const COUNTDOWN_WINDOW_MINUTES = 5;

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

// GUID: PRE_RACE_MODE_HOOK-001-v01
// [Intent] State machine hook determining the current Pit Wall operating mode.
//          Transitions: IDLE → SHOWREEL_QUEUED → SHOWREEL_PLAYING ↔ SHOWREEL_BETWEEN → COUNTDOWN → LIVE.
//          Handles schedule fetching, item advancement, and on-demand session overrides.
// [Inbound Trigger] Called once by PitWallClient; re-evaluates on every ticker tick.
// [Downstream Impact] mode drives which data source and UI layer PitWallClient renders.
export function usePreRaceMode(
  hasLiveSession: boolean,
  nextRaceStart: Date | null,
  nextRaceName: string,
  idToken: string | null,
  circuitShortName: string | null = null,
): UsePreRaceModeReturn {
  const [mode, setMode] = useState<PreRaceModeState>('IDLE');
  const [schedule, setSchedule] = useState<ShowreelSchedule | null>(null);
  const [currentItemIndex, setCurrentItemIndex] = useState<number>(-1);
  const [onDemandSession, setOnDemandSession] = useState<HistoricalSession | null>(null);

  // Refs used by the ticker so we don't need them in the dependency array
  const modeRef = useRef<PreRaceModeState>('IDLE');
  const scheduleRef = useRef<ShowreelSchedule | null>(null);
  const currentItemIndexRef = useRef<number>(-1);
  const onDemandRef = useRef<HistoricalSession | null>(null);
  const isFetchingRef = useRef(false);
  const betweenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync with state
  modeRef.current = mode;
  scheduleRef.current = schedule;
  currentItemIndexRef.current = currentItemIndex;
  onDemandRef.current = onDemandSession;

  // ---------------------------------------------------------------------------
  // Derived helpers
  // ---------------------------------------------------------------------------

  const getMinutesToRaceStart = useCallback((): number => {
    if (!nextRaceStart) return Infinity;
    return (nextRaceStart.getTime() - Date.now()) / 60_000;
  }, [nextRaceStart]);

  const getCurrentItem = useCallback((): ShowreelQueueItem | null => {
    const sched = scheduleRef.current;
    const idx = currentItemIndexRef.current;
    if (!sched || idx < 0 || idx >= sched.items.length) return null;
    return sched.items[idx];
  }, []);

  // ---------------------------------------------------------------------------
  // Schedule fetching
  // ---------------------------------------------------------------------------

  // GUID: PRE_RACE_MODE_HOOK-002-v01
  // [Intent] AbortController ref — aborts in-flight schedule fetch when circuitShortName
  //          changes or component unmounts, preventing stale responses from winning.
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchSchedule = useCallback(async () => {
    if (isFetchingRef.current || !idToken || !nextRaceStart) return;
    isFetchingRef.current = true;

    // Abort any previous in-flight fetch
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      const params = new URLSearchParams();
      if (circuitShortName) {
        params.set('circuit_short_name', circuitShortName);
      }
      const res = await fetch(`/api/pit-wall/historical-sessions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const cid = generateClientCorrelationId();
        console.error(
          `[usePreRaceMode] ${CLIENT_ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code} — ` +
            `${body?.error || `HTTP ${res.status}`} | correlationId=${cid}`,
        );
        isFetchingRef.current = false;
        return;
      }

      const body = await res.json() as { sessions?: HistoricalSession[] } | HistoricalSession[];
      const sessions: HistoricalSession[] = Array.isArray(body) ? body : (body.sessions ?? []);
      const built = buildShowreelSchedule(sessions, nextRaceStart, nextRaceName);

      if (built && built.items.length > 0) {
        setSchedule(built);
        setCurrentItemIndex(0);
        setMode('SHOWREEL_PLAYING');
      } else {
        // No viable schedule — fall through to COUNTDOWN or IDLE
        setMode(getMinutesToRaceStart() <= COUNTDOWN_WINDOW_MINUTES ? 'COUNTDOWN' : 'IDLE');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // intentional abort
      const cid = generateClientCorrelationId();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(
        `[usePreRaceMode] ${CLIENT_ERRORS.PIT_WALL_HISTORICAL_LOOKUP_FAILED.code} — ` +
          `${msg} | correlationId=${cid}`,
      );
    } finally {
      isFetchingRef.current = false;
    }
  }, [idToken, nextRaceStart, nextRaceName, circuitShortName, getMinutesToRaceStart]);

  // ---------------------------------------------------------------------------
  // Item advancement
  // ---------------------------------------------------------------------------

  const advanceToNextItem = useCallback(() => {
    const sched = scheduleRef.current;
    const idx = currentItemIndexRef.current;

    if (!sched) return;

    const nextIndex = idx + 1;

    if (nextIndex >= sched.items.length) {
      // No more items — go to COUNTDOWN
      setCurrentItemIndex(-1);
      setMode('COUNTDOWN');
      return;
    }

    // Brief splash between items
    setMode('SHOWREEL_BETWEEN');

    if (betweenTimerRef.current) clearTimeout(betweenTimerRef.current);
    betweenTimerRef.current = setTimeout(() => {
      setCurrentItemIndex(nextIndex);
      setMode('SHOWREEL_PLAYING');
    }, BETWEEN_DURATION_MS);
  }, []);

  // ---------------------------------------------------------------------------
  // Ticker — evaluates state every TICKER_INTERVAL_MS
  // ---------------------------------------------------------------------------

  const runTick = useCallback(() => {
    const minutes = getMinutesToRaceStart();

    // --- Live always wins ---
    if (hasLiveSession) {
      if (modeRef.current !== 'LIVE') setMode('LIVE');
      return;
    }

    // --- No race scheduled ---
    if (nextRaceStart === null) {
      if (modeRef.current !== 'IDLE') setMode('IDLE');
      return;
    }

    // --- Race started but no live session yet ---
    if (minutes < 0) {
      if (modeRef.current !== 'LIVE') setMode('LIVE');
      return;
    }

    // --- Countdown window ---
    if (minutes < COUNTDOWN_WINDOW_MINUTES) {
      if (modeRef.current !== 'COUNTDOWN') setMode('COUNTDOWN');
      return;
    }

    // --- Showreel window ---
    if (minutes <= SHOWREEL_WINDOW_MINUTES) {
      const currentMode = modeRef.current;

      // If we're already playing or between, advance if the current item's wall slot is done
      if (currentMode === 'SHOWREEL_PLAYING' || currentMode === 'SHOWREEL_BETWEEN') {
        // Validate schedule is still temporally consistent
        const sched = scheduleRef.current;
        if (sched) {
          const validation = validateScheduleTiming(sched, new Date());
          if (!validation.valid) {
            // Schedule expired — transition to COUNTDOWN
            setMode('COUNTDOWN');
            return;
          }
        }

        // On-demand session takes priority — no auto-advance
        if (onDemandRef.current) return;

        if (currentMode === 'SHOWREEL_PLAYING') {
          const item = getCurrentItem();
          if (item && Date.now() >= item.wallClockEnd.getTime()) {
            advanceToNextItem();
          }
        }
        return;
      }

      // If we're QUEUED (or idle and entering window), trigger schedule fetch
      if (currentMode !== 'SHOWREEL_QUEUED') {
        setMode('SHOWREEL_QUEUED');
      }
      // Kick off fetch (guard prevents duplicate calls)
      fetchSchedule();
      return;
    }

    // --- Outside showreel window ---
    if (modeRef.current !== 'IDLE') setMode('IDLE');
  }, [
    hasLiveSession,
    nextRaceStart,
    getMinutesToRaceStart,
    getCurrentItem,
    advanceToNextItem,
    fetchSchedule,
  ]);

  // ---------------------------------------------------------------------------
  // Ticker lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Immediate evaluation on mount / prop changes
    runTick();

    if (tickerRef.current) clearInterval(tickerRef.current);
    tickerRef.current = setInterval(runTick, TICKER_INTERVAL_MS);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      if (betweenTimerRef.current) clearTimeout(betweenTimerRef.current);
      fetchAbortRef.current?.abort();
    };
  }, [runTick]);

  // ---------------------------------------------------------------------------
  // On-demand race selector
  // ---------------------------------------------------------------------------

  const onRaceSelect = useCallback((session: HistoricalSession) => {
    setOnDemandSession(session);
    setMode('SHOWREEL_PLAYING');
  }, []);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const minutesToRaceStart = nextRaceStart
    ? Math.max(0, (nextRaceStart.getTime() - Date.now()) / 60_000)
    : 0;

  const isShowreel = mode === 'SHOWREEL_PLAYING' || mode === 'SHOWREEL_BETWEEN';

  const currentItem =
    schedule && currentItemIndex >= 0 && currentItemIndex < schedule.items.length
      ? schedule.items[currentItemIndex]
      : null;

  return {
    mode,
    schedule,
    currentItemIndex,
    currentItem,
    minutesToRaceStart,
    isShowreel,
    onRaceSelect,
    onDemandSession,
  };
}
