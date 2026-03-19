// GUID: PIXI_INTERP_SYSTEM-000-v03
// [Intent] Extracted interpolation logic for smooth car position animation on the track map.
//          v02: Snap-to-track validation, spawn protection (< 2 updates → raw GPS).
//          v03: Speed-based GPS spike filtering in onDriversUpdate — if implied speed between
//               consecutive positions exceeds 400 km/h, the new position is rejected as a GPS
//               spike and the previous position is kept. This prevents impossible-travel artifacts
//               (cars jumping to wrong positions and back) at all polling intervals.
// [Inbound Trigger] Called by the PixiJS track map component on each animation frame.
// [Downstream Impact] Returns InterpolatedPosition[] consumed by car dot rendering.

import type { DriverRaceState, InterpolatedPosition } from '../../_types/pit-wall.types';
import { type TrackPolyline, projectOntoTrack, paramToPoint } from '../../_utils/trackSpline';

// GUID: PIXI_INTERP_SYSTEM-001-v02
// [Intent] Snap threshold squared — if a driver jumps more than 500m between updates,
//          snap directly instead of lerping. Backup for any spikes the speed filter misses.
const SNAP_DISTANCE_SQ = 500 * 500;

// GUID: PIXI_INTERP_SYSTEM-006-v01
// [Intent] Maximum allowed drift between snap-to-track and raw lerp results.
const MAX_SNAP_DRIFT_SQ = 100 * 100;

// GUID: PIXI_INTERP_SYSTEM-008-v01
// [Intent] Maximum plausible speed in m/s. F1 top speed is ~370 km/h = ~103 m/s.
//          400 km/h = 111 m/s gives headroom for GPS jitter without letting spikes through.
const MAX_PLAUSIBLE_SPEED_MPS = 111;

// [Intent] GPS jitter margin in metres. Two consecutive readings can each be ±10m off,
//          so the distance between them has up to 20m of jitter even if the car hasn't moved.
const GPS_JITTER_MARGIN_M = 20;

export class InterpolationSystem {
  private prevPositions = new Map<number, { x: number; y: number }>();
  private nextPositions = new Map<number, { x: number; y: number }>();
  private snapshotTimestamp = Date.now();

  // GUID: PIXI_INTERP_SYSTEM-007-v01
  // [Intent] Per-driver update counter for spawn protection.
  private updateCount = new Map<number, number>();

  // GUID: PIXI_INTERP_SYSTEM-005-v01
  readonly snappedThisFrame = new Set<number>();

  // GUID: PIXI_INTERP_SYSTEM-002-v03
  // [Intent] Called when new driver data arrives. Validates each position against the
  //          previous position using speed-based plausibility. Positions implying travel
  //          faster than MAX_PLAUSIBLE_SPEED_MPS are rejected as GPS spikes — the previous
  //          position is kept, preventing impossible-travel fly-in/fly-back artifacts.
  onDriversUpdate(drivers: DriverRaceState[]): void {
    const now = Date.now();
    const timeDeltaS = Math.max(0.1, (now - this.snapshotTimestamp) / 1000);

    // Maximum distance a car could plausibly travel in this time delta
    const maxDist = MAX_PLAUSIBLE_SPEED_MPS * timeDeltaS + GPS_JITTER_MARGIN_M;
    const maxDistSq = maxDist * maxDist;

    // Promote next → prev
    this.prevPositions = new Map(this.nextPositions);

    // Store new next positions (with speed validation)
    this.nextPositions.clear();
    for (const d of drivers) {
      if (d.x != null && d.y != null && !d.retired) {
        const prev = this.prevPositions.get(d.driverNumber);

        if (prev) {
          const dx = d.x - prev.x;
          const dy = d.y - prev.y;
          const distSq = dx * dx + dy * dy;

          if (distSq > maxDistSq) {
            // GPS spike — impossible travel speed. Keep the previous position
            // so the car stays put rather than flying to a wrong location.
            this.nextPositions.set(d.driverNumber, { x: prev.x, y: prev.y });
            // Still increment update count — the driver exists, just had bad GPS this frame
            const count = this.updateCount.get(d.driverNumber) ?? 0;
            this.updateCount.set(d.driverNumber, count + 1);
            continue;
          }
        }

        this.nextPositions.set(d.driverNumber, { x: d.x, y: d.y });

        // Track update count for spawn protection
        const count = this.updateCount.get(d.driverNumber) ?? 0;
        this.updateCount.set(d.driverNumber, count + 1);
      }
    }

    this.snapshotTimestamp = now;
  }

  // GUID: PIXI_INTERP_SYSTEM-003-v02
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
      const driverUpdates = this.updateCount.get(d.driverNumber) ?? 0;

      let ix: number;
      let iy: number;

      if (!prev || driverUpdates < 2) {
        // No previous position OR driver just appeared — snap to raw GPS
        ix = next.x;
        iy = next.y;
        this.snappedThisFrame.add(d.driverNumber);
      } else {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const distSq = dx * dx + dy * dy;

        if (distSq > SNAP_DISTANCE_SQ) {
          ix = next.x;
          iy = next.y;
          this.snappedThisFrame.add(d.driverNumber);
        } else if (poly) {
          const paramPrev = projectOntoTrack(poly, prev.x, prev.y);
          const paramNext = projectOntoTrack(poly, next.x, next.y);

          let delta = paramNext - paramPrev;
          const halfLength = poly.totalLength / 2;
          if (delta > halfLength) delta -= poly.totalLength;
          if (delta < -halfLength) delta += poly.totalLength;

          const paramInterp = paramPrev + delta * t;
          const pt = paramToPoint(poly, paramInterp);

          // Validate snap-to-track against raw lerp
          const rawX = prev.x + (next.x - prev.x) * t;
          const rawY = prev.y + (next.y - prev.y) * t;
          const driftX = pt.x - rawX;
          const driftY = pt.y - rawY;

          if (driftX * driftX + driftY * driftY > MAX_SNAP_DRIFT_SQ) {
            ix = rawX;
            iy = rawY;
          } else {
            ix = pt.x;
            iy = pt.y;
          }
        } else {
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

  // GUID: PIXI_INTERP_SYSTEM-004-v02
  reset(): void {
    this.prevPositions.clear();
    this.nextPositions.clear();
    this.updateCount.clear();
    this.snapshotTimestamp = Date.now();
  }
}
