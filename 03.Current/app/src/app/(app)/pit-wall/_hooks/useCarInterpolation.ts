// GUID: PIT_WALL_INTERP_HOOK-000-v01
// [Intent] Smoothly interpolates car positions between GPS data snapshots using
//          a RAF loop. Produces fluid car movement on the track map instead of
//          discrete teleportation on each data update.
// [Inbound Trigger] Called by PitWallTrackMap with current drivers and update interval.
// [Downstream Impact] Returns InterpolatedPosition[] updated at 60fps for canvas rendering.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DriverRaceState, InterpolatedPosition } from '../_types/pit-wall.types';

// GUID: PIT_WALL_INTERP_HOOK-001-v01
interface PositionSnapshot {
  x: number;
  y: number;
}

// GUID: PIT_WALL_INTERP_HOOK-002-v01
// [Intent] Linear interpolation between two numbers.
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// GUID: PIT_WALL_INTERP_HOOK-003-v01
// [Intent] RAF-based interpolation hook. On each new drivers snapshot, stores
//          prev and next positions. RAF animates t from 0→1 over updateIntervalMs.
export function useCarInterpolation(
  drivers: DriverRaceState[],
  updateIntervalMs: number,
): InterpolatedPosition[] {
  const prevPositionsRef = useRef<Map<number, PositionSnapshot>>(new Map());
  const nextPositionsRef = useRef<Map<number, PositionSnapshot>>(new Map());
  const snapshotTimestampRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);
  const [interpolated, setInterpolated] = useState<InterpolatedPosition[]>([]);

  // When drivers update, store new snapshot as target
  useEffect(() => {
    const prev = new Map<number, PositionSnapshot>();
    // Carry current interpolated positions as new prev
    drivers.forEach(d => {
      const current = nextPositionsRef.current.get(d.driverNumber);
      if (current) {
        prev.set(d.driverNumber, current);
      } else if (d.x !== null && d.y !== null) {
        prev.set(d.driverNumber, { x: d.x, y: d.y });
      }
    });
    prevPositionsRef.current = prev;

    const next = new Map<number, PositionSnapshot>();
    drivers.forEach(d => {
      if (d.x !== null && d.y !== null) {
        next.set(d.driverNumber, { x: d.x, y: d.y });
      } else {
        // Hold last known
        const last = prevPositionsRef.current.get(d.driverNumber);
        if (last) next.set(d.driverNumber, last);
      }
    });
    nextPositionsRef.current = next;
    snapshotTimestampRef.current = Date.now();
  }, [drivers]);

  // RAF loop
  const tick = useCallback(() => {
    const now = Date.now();
    const elapsed = now - snapshotTimestampRef.current;
    const t = Math.min(1, elapsed / updateIntervalMs);

    const result: InterpolatedPosition[] = drivers
      .filter(d => nextPositionsRef.current.has(d.driverNumber))
      .map(d => {
        const prev = prevPositionsRef.current.get(d.driverNumber);
        const next = nextPositionsRef.current.get(d.driverNumber)!;
        const x = prev ? lerp(prev.x, next.x, t) : next.x;
        const y = prev ? lerp(prev.y, next.y, t) : next.y;
        return {
          driverNumber: d.driverNumber,
          x,
          y,
          teamColour: d.teamColour,
          driverCode: d.driverCode,
          position: d.position,
          hasDrs: d.hasDrs,
          retired: d.retired,
          inPit: d.inPit,
        };
      });

    setInterpolated(result);
    rafRef.current = requestAnimationFrame(tick);
  }, [drivers, updateIntervalMs]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  return interpolated;
}
