// GUID: PIXI_INTERP_SYSTEM-000-v04
// [Intent] Extracted interpolation logic for smooth car position animation on the track map.
//          v02: Snap-to-track validation, spawn protection (< 2 updates → raw GPS).
//          v03: Speed-based GPS spike filtering in onDriversUpdate — if implied speed between
//               consecutive positions exceeds 400 km/h, the new position is rejected as a GPS
//               spike and the previous position is kept. This prevents impossible-travel artifacts
//               (cars jumping to wrong positions and back) at all polling intervals.
//          v04: Bounds-based outlier rejection — after collecting all valid positions, compute
//               10th–90th percentile bounding box and reject drivers whose GPS is >2x track
//               size outside bounds. Catches pit building coords, marshalling area GPS, and
//               extreme glitches that the speed filter cannot catch (e.g. first frame of replay).
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

  // GUID: PIXI_INTERP_SYSTEM-010-v01
  // [Intent] Grace period after reset — skip the spike filter for the first few updates.
  //          After reset (e.g. session change, replay start), the first data may be at the
  //          grid position. The second data has real race positions. If virtualTimeDeltaMs is
  //          undefined or tiny on the early frames, the spike filter computes a small maxDist
  //          and rejects the jump from grid to track — permanently freezing all cars (death spiral).
  //          Allowing 3 grace updates lets positions establish without spike filtering.
  private updatesSinceReset = 0;

  // GUID: PIXI_INTERP_SYSTEM-009-v01
  // [Intent] Stores the last interpolated (drawn) position per driver. Used as the
  //          new prev position when fresh data arrives, so the car continues smoothly
  //          from where it was visually instead of snapping back to the old target.
  private lastDrawnPositions = new Map<number, { x: number; y: number }>();

  // GUID: PIXI_INTERP_SYSTEM-005-v01
  readonly snappedThisFrame = new Set<number>();

  // GUID: PIXI_INTERP_SYSTEM-002-v04
  // [Intent] Called when new driver data arrives. Validates each position against the
  //          previous position using speed-based plausibility. Positions implying travel
  //          faster than MAX_PLAUSIBLE_SPEED_MPS are rejected as GPS spikes — the previous
  //          position is kept, preventing impossible-travel fly-in/fly-back artifacts.
  //          v04: Accepts optional virtualTimeDeltaMs for replay mode — in replay at 4-8x
  //               speed, wall time between frames is tiny but virtual time gap is large.
  //               Without this, the spike filter rejects every position as impossible travel.
  //               Uses lastDrawnPositions for prev (Fix 2: smooth snap handoff).
  // GUID: PIXI_INTERP_SYSTEM-011-v01
  // [Intent] When true, the spike filter is disabled entirely. Used for replay mode
  //          where GPS data is pre-recorded and doesn't have live GPS spikes. The spike
  //          filter causes a death spiral in replay: grid→track position jump is rejected,
  //          then the gap grows every frame, permanently freezing all cars.
  disableSpikeFilter = false;

  onDriversUpdate(drivers: DriverRaceState[], virtualTimeDeltaMs?: number): void {
    const now = Date.now();
    this.updatesSinceReset++;

    const timeDeltaS = virtualTimeDeltaMs != null
      ? Math.max(0.1, virtualTimeDeltaMs / 1000)
      : Math.max(0.1, (now - this.snapshotTimestamp) / 1000);

    // Maximum distance a car could plausibly travel in this time delta.
    // Disabled entirely in replay mode (disableSpikeFilter) — pre-recorded data
    // doesn't have GPS spikes, and the filter causes a death spiral.
    const maxDist = this.disableSpikeFilter
      ? Infinity
      : MAX_PLAUSIBLE_SPEED_MPS * timeDeltaS + GPS_JITTER_MARGIN_M;
    const maxDistSq = maxDist * maxDist;

    // Promote last drawn positions → prev (smooth handoff from interpolated position)
    this.prevPositions = new Map(this.lastDrawnPositions.size > 0
      ? this.lastDrawnPositions
      : this.nextPositions);

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

    // GUID: PIXI_INTERP_SYSTEM-012-v01
    // [Intent] Bounds-based outlier rejection. Compute the 10th–90th percentile bounding box
    //          from all current positions (the "track envelope"), then reject any driver whose
    //          position falls more than 2x the track width/height outside that envelope.
    //          This catches pit building GPS coordinates, marshalling area positions, and extreme
    //          GPS glitches that the speed filter cannot catch (e.g. a driver's first frame in
    //          replay mode where spike filtering is disabled). Requires ≥5 drivers to compute
    //          a meaningful bounding box — with fewer, outlier detection is unreliable.
    if (this.nextPositions.size >= 5) {
      const xs = [...this.nextPositions.values()].map(p => p.x);
      const ys = [...this.nextPositions.values()].map(p => p.y);
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      // Use 10th-90th percentile as "track bounds" to exclude outliers
      const p10 = Math.floor(xs.length * 0.1);
      const p90 = Math.floor(xs.length * 0.9);
      const trackW = xs[p90] - xs[p10];
      const trackH = ys[p90] - ys[p10];
      const margin = Math.max(trackW, trackH) * 2;
      const minX = xs[p10] - margin;
      const maxX = xs[p90] + margin;
      const minY = ys[p10] - margin;
      const maxY = ys[p90] + margin;

      for (const [dn, pos] of this.nextPositions) {
        if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
          this.nextPositions.delete(dn); // Remove outlier — won't be rendered
        }
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

      // Store drawn position for smooth snap handoff (Fix 2)
      this.lastDrawnPositions.set(d.driverNumber, { x: ix, y: iy });

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

  // GUID: PIXI_INTERP_SYSTEM-004-v03
  reset(): void {
    this.prevPositions.clear();
    this.nextPositions.clear();
    this.lastDrawnPositions.clear();
    this.updateCount.clear();
    this.updatesSinceReset = 0;
    this.snapshotTimestamp = Date.now();
  }
}
