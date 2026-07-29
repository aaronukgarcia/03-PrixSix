// ── CONTRACT ──────────────────────────────────────────────────────
// Reads:       nothing external (operates on the driver array the caller passes)
// Writes:      nothing external — all state is React-local
// Errors:      none; detection failure on a tick just yields no events for that tick
// Idempotent:  per-tick detection is pure; the hook accumulates
// Side-effects: none
// ──────────────────────────────────────────────────────────────────
// GUID: PW_RACE_EVENTS_HOOK-000-v01
// [Intent] FEAT-PW-020 — stateful shell around the pure detection in _utils/race-events.ts.
//          Consumes WHATEVER driver stream the client is showing (live, TV-sync delayed, replay,
//          showreel), diffs consecutive snapshots, and exposes:
//            events           — capped chronological event list for the ticker
//            battleDrivers    — chaser driverNumbers currently in a battle (tower pips)
//            enrichedDrivers  — the same array with positionChange ACTUALLY FED (the tower's
//                               ▲/▼ arrows and row flashes have existed since v2.x and could
//                               never fire because every data path hard-coded 0)
// [Inbound Trigger] PitWallClient, once, with the activeDrivers stream.
// [Downstream Impact] RaceEventTicker, PitWallRaceTable (arrows via enrichedDrivers, pips via
//          battleDrivers). Resets wholesale on stream identity change (session switch, replay
//          enter/exit, seek) so a mode change is never misread as forty overtakes.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DriverRaceState, CircuitPoint } from '../_types/pit-wall.types';
import {
  deriveCorners,
  diffSnapshots,
  updateBattles,
  createBattleState,
  type RaceEvent,
  type Corner,
  type PendingPass,
} from '../_utils/race-events';

const EVENT_LIST_CAP = 120;
/** A backwards jump or a gap over this between snapshots means seek/mode-change — reset, don't diff. */
const MAX_TICK_GAP_MS = 5 * 60_000;

export interface UseRaceEventsReturn {
  events: RaceEvent[];
  battleDrivers: Set<number>;
  enrichedDrivers: DriverRaceState[];
  corners: Corner[];
  clearEvents: () => void;
}

// GUID: PW_RACE_EVENTS_HOOK-001-v01
// [Intent] The hook. `streamId` names the current data stream (e.g. "live-1234", "replay-9876")
//          — any change resets all detection state. The caller passes the SAME activeDrivers
//          array it renders, so events always agree with what the user is looking at; when the
//          TV-sync delay is active, detection runs on the delayed stream and cannot spoil.
export function useRaceEvents(
  drivers: DriverRaceState[],
  circuitPath: CircuitPoint[],
  sfLineX: number | null,
  sfLineY: number | null,
  streamId: string,
): UseRaceEventsReturn {
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [battleDrivers, setBattleDrivers] = useState<Set<number>>(new Set());
  const [changes, setChanges] = useState<Map<number, number>>(new Map());

  const prevDriversRef = useRef<DriverRaceState[]>([]);
  const prevStreamIdRef = useRef(streamId);
  const prevTickAtRef = useRef(0);
  const battleStateRef = useRef(createBattleState());
  // Pass candidates awaiting next-tick confirmation (kills position-flicker false overtakes).
  const pendingPassesRef = useRef<PendingPass[]>([]);
  // driverNumber -> last time seen in the pit lane; suppresses pit-cycle "overtakes".
  const recentPitAtRef = useRef<Map<number, number>>(new Map());

  // Corners re-derive only when the outline or S/F line actually changes — the path is frozen
  // after loop closure, so in practice this runs once or twice per session.
  const corners = useMemo(
    () => deriveCorners(circuitPath, sfLineX, sfLineY),
    [circuitPath, sfLineX, sfLineY],
  );

  useEffect(() => {
    const now = Date.now();

    // Stream switched (session change, replay enter/exit) — hard reset, no diff across the seam.
    if (streamId !== prevStreamIdRef.current) {
      prevStreamIdRef.current = streamId;
      prevDriversRef.current = drivers;
      prevTickAtRef.current = now;
      battleStateRef.current = createBattleState();
      pendingPassesRef.current = [];
      recentPitAtRef.current = new Map();
      setEvents([]);
      setBattleDrivers(new Set());
      setChanges(new Map());
      return;
    }

    // Stale-tick guard: a huge wall-clock gap (tab slept, replay seek) makes the diff meaningless.
    if (prevTickAtRef.current > 0 && now - prevTickAtRef.current > MAX_TICK_GAP_MS) {
      prevDriversRef.current = drivers;
      prevTickAtRef.current = now;
      battleStateRef.current = createBattleState();
      pendingPassesRef.current = [];
      recentPitAtRef.current = new Map();
      return;
    }

    const prev = prevDriversRef.current;
    if (prev === drivers) return; // same array identity — nothing new arrived
    prevDriversRef.current = drivers;
    prevTickAtRef.current = now;
    if (prev.length === 0 || drivers.length === 0) return;

    const diff = diffSnapshots(prev, drivers, corners, now, pendingPassesRef.current, recentPitAtRef.current);
    pendingPassesRef.current = diff.pending;
    const battleEvents = updateBattles(battleStateRef.current, drivers, now);
    const fresh = [...diff.events, ...battleEvents];

    if (diff.changes.size > 0) {
      setChanges(prevChanges => {
        const merged = new Map(prevChanges);
        diff.changes.forEach((v, k) => merged.set(k, v));
        return merged;
      });
    }
    if (fresh.length > 0) {
      setEvents(prevEvents => {
        const merged = [...fresh.reverse(), ...prevEvents];
        return merged.length > EVENT_LIST_CAP ? merged.slice(0, EVENT_LIST_CAP) : merged;
      });
    }
    // The active-battle set is cheap to rebuild; new Set identity only when membership changed.
    setBattleDrivers(prevSet => {
      const nextSet = battleStateRef.current.active;
      if (prevSet.size === nextSet.size && [...prevSet].every(n => nextSet.has(n))) return prevSet;
      return new Set(nextSet);
    });
  }, [drivers, streamId, corners]);

  // GUID: PW_RACE_EVENTS_HOOK-002-v01
  // [Intent] Feed positionChange into the rendered array. Identity discipline: memoised on the
  //          incoming array + accumulated changes, and drivers without a recorded move keep
  //          their original object so downstream React.memo/Pixi diffing is undisturbed.
  const enrichedDrivers = useMemo(() => {
    if (changes.size === 0) return drivers;
    return drivers.map(d => {
      const delta = changes.get(d.driverNumber);
      return delta !== undefined && delta !== d.positionChange
        ? { ...d, positionChange: delta }
        : d;
    });
  }, [drivers, changes]);

  const clearEvents = useMemo(() => () => setEvents([]), []);

  return { events, battleDrivers, enrichedDrivers, corners, clearEvents };
}
