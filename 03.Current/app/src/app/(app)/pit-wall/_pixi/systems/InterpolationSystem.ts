// GUID: PIXI_INTERP_SYSTEM-000-v01
// [Intent] Extracted interpolation logic for smooth car position animation on the track map.
//          Manages prev/next position snapshots and produces per-frame interpolated positions.
//          Same Catmull-Rom / polyline snap logic as the original PitWallTrackMap RAF loop,
//          now encapsulated as a standalone system for use with the PixiJS renderer.
// [Inbound Trigger] Called by the PixiJS track map component on each animation frame.
// [Downstream Impact] Returns InterpolatedPosition[] consumed by car dot rendering.

import type { DriverRaceState, InterpolatedPosition } from '../../_types/pit-wall.types';
import { type TrackPolyline, projectOntoTrack, paramToPoint } from '../../_utils/trackSpline';

// GUID: PIXI_INTERP_SYSTEM-001-v01
// [Intent] Snap threshold squared — if a driver jumps more than 500m between updates
//          (e.g. pit exit, lap reset, data gap), snap directly instead of lerping through
//          the entire circuit. 500m is roughly 10% of a typical F1 circuit length.
const SNAP_DISTANCE_SQ = 500 * 500;

export class InterpolationSystem {
  private prevPositions = new Map<number, { x: number; y: number }>();
  private nextPositions = new Map<number, { x: number; y: number }>();
  private snapshotTimestamp = Date.now();

  // GUID: PIXI_INTERP_SYSTEM-005-v01
  // [Intent] Set of driver numbers that snapped (teleported) this frame rather than
  //          smoothly interpolating. Used by PixiTrackApp to skip trail points on snap
  //          — prevents diagonal fly-in lines across the map.
  readonly snappedThisFrame = new Set<number>();

  // GUID: PIXI_INTERP_SYSTEM-002-v01
  // [Intent] Called when new driver data arrives from the server (React prop change).
  //          Promotes current next→prev, stores incoming positions as new next,
  //          and resets the snapshot timestamp for lerp calculation.
  onDriversUpdate(drivers: DriverRaceState[]): void {
    // Promote next → prev
    this.prevPositions = new Map(this.nextPositions);

    // Store new next positions
    this.nextPositions.clear();
    for (const d of drivers) {
      if (d.x != null && d.y != null && !d.retired) {
        this.nextPositions.set(d.driverNumber, { x: d.x, y: d.y });
      }
    }

    this.snapshotTimestamp = Date.now();
  }

  // GUID: PIXI_INTERP_SYSTEM-003-v01
  // [Intent] Called every animation frame. Returns interpolated positions for all drivers
  //          by lerping between prev and next snapshots. If a TrackPolyline is available,
  //          positions are snapped to the track centreline via 1D parameter interpolation
  //          (project both endpoints onto the polyline, lerp the 1D parameter, convert back
  //          to 2D). Falls back to raw linear lerp when no polyline is present.
  interpolate(
    drivers: DriverRaceState[],
    now: number,
    updateIntervalMs: number,
    poly: TrackPolyline | null,
  ): InterpolatedPosition[] {
    this.snappedThisFrame.clear();

    const elapsed = now - this.snapshotTimestamp;
    const t = Math.min(1, updateIntervalMs > 0 ? elapsed / updateIntervalMs : 1);

    const results: InterpolatedPosition[] = [];

    for (const d of drivers) {
      if (d.retired) continue;

      const next = this.nextPositions.get(d.driverNumber);
      if (!next) continue;

      const prev = this.prevPositions.get(d.driverNumber);

      let ix: number;
      let iy: number;

      if (!prev) {
        // No previous position — snap to next
        ix = next.x;
        iy = next.y;
        this.snappedThisFrame.add(d.driverNumber);
      } else {
        // Check snap threshold — large jumps bypass lerp
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const distSq = dx * dx + dy * dy;

        if (distSq > SNAP_DISTANCE_SQ) {
          // Teleport — don't lerp across the entire circuit
          ix = next.x;
          iy = next.y;
          this.snappedThisFrame.add(d.driverNumber);
        } else if (poly) {
          // Snap-to-track interpolation via 1D parameter
          const paramPrev = projectOntoTrack(poly, prev.x, prev.y);
          const paramNext = projectOntoTrack(poly, next.x, next.y);

          // Handle wraparound — if the shorter path crosses the start/finish line,
          // adjust paramNext so the lerp goes the short way around
          let delta = paramNext - paramPrev;
          const halfLength = poly.totalLength / 2;
          if (delta > halfLength) delta -= poly.totalLength;
          if (delta < -halfLength) delta += poly.totalLength;

          const paramInterp = paramPrev + delta * t;
          const pt = paramToPoint(poly, paramInterp);
          ix = pt.x;
          iy = pt.y;
        } else {
          // Raw linear lerp — no track data available
          ix = prev.x + (next.x - prev.x) * t;
          iy = prev.y + (next.y - prev.y) * t;
        }
      }

      results.push({
        driverNumber: d.driverNumber,
        x: ix,
        y: iy,
        teamColour: d.teamColour,
        driverCode: d.driverCode,
        position: d.position,
        hasDrs: d.hasDrs,
        retired: d.retired,
        inPit: d.inPit,
      });
    }

    return results;
  }

  // GUID: PIXI_INTERP_SYSTEM-004-v01
  // [Intent] Clear all stored positions. Call when session changes or component unmounts.
  reset(): void {
    this.prevPositions.clear();
    this.nextPositions.clear();
    this.snapshotTimestamp = Date.now();
  }
}
