// GUID: PIXI_TRAIL_SYSTEM-000-v02
// [Intent] Ring-buffer trail system for driver contrails on the PixiJS track map.
//          Each driver has a fixed-size circular buffer of trail points. Points age out
//          after a configurable TTL and their alpha fades exponentially. Colour is pre-computed
//          at push time based on telemetry (brake = red tint, heavy throttle = green tint,
//          otherwise team colour).
//          v02: Trail points stored in GPS-space (projected metres) instead of canvas-space.
//               Projected to canvas at draw time by TrailLayer for stability across resizes.
//               TTL is configurable. Alpha uses exponential decay for vapour-trail effect.
// [Inbound Trigger] TrailSystem.getOrCreate() called per-driver per-frame from renderer.
// [Downstream Impact] Trail points consumed by TrailLayer which projects GPS->canvas at draw time.

import { lerpColor } from '../utils/pixi-helpers';

// GUID: PIXI_TRAIL_SYSTEM-001-v02
// [Intent] Default trail lifetime in milliseconds. Configurable via TrailSystem.getActiveTrails().
//          750ms at ~80m/s = ~60m trail = fine, short vapour trail.
export const DEFAULT_TRAIL_TTL_MS = 750;

// GUID: PIXI_TRAIL_SYSTEM-002-v01
// [Intent] Maximum trail points per driver. Ring buffer wraps at this limit.
//          120 points at ~60fps = 2 seconds of history, more than enough for any TTL setting.
const MAX_TRAIL_POINTS = 120;

// Telemetry colour constants (0xRRGGBB)
const BRAKE_RED = 0xff2222;
const THROTTLE_GREEN = 0x22ff44;

export interface TrailPoint {
  gpsX: number;        // GPS-space X (projected metres from OpenF1)
  gpsY: number;        // GPS-space Y (projected metres from OpenF1)
  timestamp: number;   // Date.now() when point was recorded
  speed: number;       // km/h
  throttle: number;    // 0-100
  brake: boolean;
  colour: number;      // pre-computed 0xRRGGBB
  alpha: number;       // computed on read via exponential decay
}

// GUID: PIXI_TRAIL_SYSTEM-003-v02
// [Intent] Per-driver ring buffer of trail points. Fixed allocation — no GC pressure
//          during the hot render loop. Points are written at `head` and the buffer wraps.
//          v02: Stores GPS-space coordinates instead of canvas-space.
export class DriverTrail {
  points: TrailPoint[];
  head = 0;
  count = 0;
  teamColour: number;

  constructor(teamColour: number) {
    this.teamColour = teamColour;
    this.points = new Array(MAX_TRAIL_POINTS);
    for (let i = 0; i < MAX_TRAIL_POINTS; i++) {
      this.points[i] = {
        gpsX: 0,
        gpsY: 0,
        timestamp: 0,
        speed: 0,
        throttle: 0,
        brake: false,
        colour: 0,
        alpha: 0,
      };
    }
  }

  // GUID: PIXI_TRAIL_SYSTEM-004-v02
  // [Intent] Push a new trail point into the ring buffer in GPS-space coordinates.
  //          Pre-computes the colour based on telemetry: braking blends toward red,
  //          heavy throttle with acceleration blends toward green, otherwise pure team colour.
  push(
    gpsX: number,
    gpsY: number,
    timestamp: number,
    speed: number,
    throttle: number,
    brake: boolean,
  ): void {
    const pt = this.points[this.head];
    pt.gpsX = gpsX;
    pt.gpsY = gpsY;
    pt.timestamp = timestamp;
    pt.speed = speed;
    pt.throttle = throttle;
    pt.brake = brake;

    // Compute colour based on telemetry state
    if (brake) {
      pt.colour = lerpColor(this.teamColour, BRAKE_RED, 0.7);
    } else if (throttle > 60 && speed > 100) {
      pt.colour = lerpColor(this.teamColour, THROTTLE_GREEN, 0.5);
    } else {
      pt.colour = this.teamColour;
    }

    pt.alpha = 1; // Full opacity when fresh — faded on read

    // Advance head with wrap
    this.head = (this.head + 1) % MAX_TRAIL_POINTS;
    if (this.count < MAX_TRAIL_POINTS) this.count++;
  }

  // GUID: PIXI_TRAIL_SYSTEM-005-v02
  // [Intent] Return active (non-expired) trail points in chronological order (oldest first).
  //          v02: Accepts configurable TTL. Uses exponential decay (alpha = e^(-3*age/ttl))
  //          for a natural vapour-trail dissipation effect instead of linear fade.
  getActivePoints(now: number, ttlMs: number = DEFAULT_TRAIL_TTL_MS): TrailPoint[] {
    const active: TrailPoint[] = [];

    // Walk the ring buffer from oldest to newest
    const start = this.count < MAX_TRAIL_POINTS ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % MAX_TRAIL_POINTS;
      const pt = this.points[idx];
      const age = now - pt.timestamp;

      if (age > ttlMs || pt.timestamp === 0) continue;

      // Exponential decay: fast initial fade with a natural tail
      pt.alpha = Math.exp(-3 * age / ttlMs);
      active.push(pt);
    }

    return active;
  }
}

// GUID: PIXI_TRAIL_SYSTEM-006-v02
// [Intent] Top-level manager for all driver trails. Lazily creates DriverTrail instances
//          on first access per driver number. Provides a clear() for session resets.
//          v02: getActiveTrails accepts configurable TTL.
export class TrailSystem {
  private trails = new Map<number, DriverTrail>();

  getOrCreate(driverNumber: number, teamColour: number): DriverTrail {
    let trail = this.trails.get(driverNumber);
    if (!trail) {
      trail = new DriverTrail(teamColour);
      this.trails.set(driverNumber, trail);
    }
    return trail;
  }

  /** Get all active trails as a Map of driverNumber -> active TrailPoint[] (oldest first).
   *  This is the interface that TrailLayer.update() expects. */
  getActiveTrails(ttlMs: number = DEFAULT_TRAIL_TTL_MS): Map<number, TrailPoint[]> {
    const now = Date.now();
    const result = new Map<number, TrailPoint[]>();
    for (const [driverNumber, trail] of this.trails) {
      const active = trail.getActivePoints(now, ttlMs);
      if (active.length > 0) {
        result.set(driverNumber, active);
      }
    }
    return result;
  }

  clear(): void {
    this.trails.clear();
  }
}
