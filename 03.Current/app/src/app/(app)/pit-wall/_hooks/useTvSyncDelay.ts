// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing external — buffers the live snapshots the caller passes in
// Writes:      nothing external
// Errors:      none — an empty buffer degrades to the oldest available snapshot
// Idempotent:  playback selection is pure over the buffer
// Side-effects: a 1s interval timer while a delay is active (cleared when LIVE)
// ──────────────────────────────────────────────────────────────────
// GUID: PW_TV_SYNC_HOOK-000-v01
// [Intent] FEAT-PW-021 — the TV-sync delay dial. The Pit Wall's data leads a TV stream by
//          30-60s, which cuts both ways: LEAD mode (delay 0) gives the pit-wall-engineer head
//          start, but a fan watching the broadcast as primary does not want every overtake
//          spoiled half a minute early. This hook buffers live snapshots in a ring and plays
//          them back at a user-chosen offset so the map matches their telly.
//          Everything downstream — track map, tower, weather, radio, the live prediction score
//          AND the Battle Engine's event detection — consumes the delayed stream, so nothing on
//          the page can spoil. Detection latency rides the delay by design: in SYNC mode the
//          "overtake into T4" row appears when the TV shows it, not before.
//          DELIBERATELY NOT PERSISTED: a delay that survived a reload would read as "the Pit
//          Wall is broken/behind" days later. Fresh page = LIVE, same philosophy as the
//          update-interval auto-reset.
// [Inbound Trigger] PitWallClient, fed from usePitWallData's live outputs only — replay and
//          showreel have their own clocks and bypass this entirely.
// [Downstream Impact] While buffering toward a newly-raised delay, the effective offset is
//          whatever the buffer can honour — the UI shows the target and 'buffering' until the
//          ring is deep enough.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DriverRaceState, RaceControlMessage, RadioMessage, WeatherSnapshot } from '../_types/pit-wall.types';

export interface LiveFeedSnapshot {
  drivers: DriverRaceState[];
  raceControl: RaceControlMessage[];
  radioMessages: RadioMessage[];
  weather: WeatherSnapshot | null;
  lastUpdated: Date | null;
}

export interface UseTvSyncDelayReturn extends LiveFeedSnapshot {
  /** Seconds the rendered feed is currently behind live (0 = LIVE). */
  effectiveDelaySeconds: number;
  /** True while the ring is still filling toward the requested delay. */
  isBuffering: boolean;
}

export const TV_SYNC_MAX_SECONDS = 90;
/** Ring capacity: max delay at the fastest poll (2s) plus margin. Entries hold references to
 *  immutable per-poll arrays, so the memory cost is pointers, not copies. */
const RING_CAP = 64;

interface RingEntry { t: number; snap: LiveFeedSnapshot }

// GUID: PW_TV_SYNC_HOOK-001-v01
// [Intent] The hook. Push one ring entry per poll (keyed on lastUpdated identity); select the
//          newest entry older than (now - delay) on a 1s cadence while delayed. Delay 0 is a
//          pure pass-through with zero timers — the LIVE path costs nothing new.
export function useTvSyncDelay(live: LiveFeedSnapshot, delaySeconds: number): UseTvSyncDelayReturn {
  const ringRef = useRef<RingEntry[]>([]);
  const lastPushedRef = useRef<Date | null>(null);
  const [playhead, setPlayhead] = useState(0); // wall-clock, advanced by the 1s timer

  // Record every distinct poll result. lastUpdated identity is the poll boundary — the reducer
  // mints a new Date per FETCH_SUCCESS.
  useEffect(() => {
    if (!live.lastUpdated || live.lastUpdated === lastPushedRef.current) return;
    lastPushedRef.current = live.lastUpdated;
    const ring = ringRef.current;
    ring.push({ t: live.lastUpdated.getTime(), snap: live });
    if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
  }, [live]);

  // The 1s playback tick — only while a delay is requested.
  useEffect(() => {
    if (delaySeconds <= 0) return;
    setPlayhead(Date.now());
    const id = setInterval(() => setPlayhead(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [delaySeconds]);

  return useMemo<UseTvSyncDelayReturn>(() => {
    if (delaySeconds <= 0) {
      return { ...live, effectiveDelaySeconds: 0, isBuffering: false };
    }
    const ring = ringRef.current;
    const target = playhead - delaySeconds * 1_000;
    // Newest entry at or before the target instant; oldest available while still buffering.
    let chosen: RingEntry | null = null;
    for (let i = ring.length - 1; i >= 0; i--) {
      if (ring[i].t <= target) { chosen = ring[i]; break; }
    }
    const buffering = chosen === null;
    const entry = chosen ?? ring[0] ?? null;
    if (!entry) {
      return { ...live, effectiveDelaySeconds: 0, isBuffering: true };
    }
    return {
      ...entry.snap,
      effectiveDelaySeconds: Math.round((playhead - entry.t) / 1000),
      isBuffering: buffering,
    };
  }, [live, delaySeconds, playhead]);
}
