// GUID: PIXI_TRAIL_SYSTEM-000-v01
// [Intent] Ring-buffer trail system for driver contrails on the PixiJS track map.
//          Each driver has a fixed-size circular buffer of trail points. Points age out
//          after TRAIL_TTL_MS and their alpha fades linearly. Colour is pre-computed at
//          push time based on telemetry (brake = red tint, heavy throttle = green tint,
//          otherwise team colour).
// [Inbound Trigger] TrailSystem.getOrCreate() called per-driver per-frame from renderer.
// [Downstream Impact] Trail points consumed by the PixiJS Graphics draw pass.

import { lerpColor } from '../utils/pixi-helpers';

// GUID: PIXI_TRAIL_SYSTEM-001-v01
// [Intent] Trail lifetime in milliseconds. Points older than this are skipped during
//          rendering. 2 seconds gives a visually satisfying comet tail at typical F1 speeds
//          (~80m/s) = ~160m trail length.
const TRAIL_TTL_MS = 2000;

// GUID: PIXI_TRAIL_SYSTEM-002-v01
// [Intent] Maximum trail points per driver. Ring buffer wraps at this limit.
//          120 points at ~60fps = 2 seconds of history, matching TRAIL_TTL_MS.
const MAX_TRAIL_POINTS = 120;

// Telemetry colour constants (0xRRGGBB)
const BRAKE_RED = 0xff2222;
const THROTTLE_GREEN = 0x22ff44;

export interface TrailPoint {
  px: number;        // canvas-space X
  py: number;        // canvas-space Y
  timestamp: number; // Date.now() when point was recorded
  speed: number;     // km/h
  throttle: number;  // 0-100
  brake: boolean;
  colour: number;    // pre-computed 0xRRGGBB
  alpha: number;     // pre-computed 0-1 (updated on read)
}

// GUID: PIXI_TRAIL_SYSTEM-003-v01
// [Intent] Per-driver ring buffer of trail points. Fixed allocation — no GC pressure
//          during the hot render loop. Points are written at `head` and the buffer wraps.
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
        px: 0,
        py: 0,
        timestamp: 0,
        speed: 0,
        throttle: 0,
        brake: false,
        colour: 0,
        alpha: 0,
      };
    }
  }

  // GUID: PIXI_TRAIL_SYSTEM-004-v01
  // [Intent] Push a new trail point into the ring buffer at the head position.
  //          Pre-computes the colour based on telemetry: braking blends toward red,
  //          heavy throttle with acceleration blends toward green, otherwise pure team colour.
  push(
    px: number,
    py: number,
    timestamp: number,
    speed: number,
    throttle: number,
    brake: boolean,
  ): void {
    const pt = this.points[this.head];
    pt.px = px;
    pt.py = py;
    pt.timestamp = timestamp;
    pt.speed = speed;
    pt.throttle = throttle;
    pt.brake = brake;

    // Compute colour based on telemetry state
    if (brake) {
      // Braking — blend team colour toward red (70% red)
      pt.colour = lerpColor(this.teamColour, BRAKE_RED, 0.7);
    } else if (throttle > 60 && speed > 100) {
      // Heavy throttle at speed — blend toward green (50% green)
      pt.colour = lerpColor(this.teamColour, THROTTLE_GREEN, 0.5);
    } else {
      // Coasting or slow — pure team colour
      pt.colour = this.teamColour;
    }

    pt.alpha = 1; // Full opacity when fresh — faded on read

    // Advance head with wrap
    this.head = (this.head + 1) % MAX_TRAIL_POINTS;
    if (this.count < MAX_TRAIL_POINTS) this.count++;
  }

  // GUID: PIXI_TRAIL_SYSTEM-005-v01
  // [Intent] Return active (non-expired) trail points in chronological order (oldest first).
  //          Computes alpha from age: alpha = 1 - (age / TTL). Points older than TTL are
  //          excluded. Returns a new array each call — caller should not cache across frames.
  getActivePoints(now: number): TrailPoint[] {
    const active: TrailPoint[] = [];

    // Walk the ring buffer from oldest to newest
    const start = this.count < MAX_TRAIL_POINTS ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % MAX_TRAIL_POINTS;
      const pt = this.points[idx];
      const age = now - pt.timestamp;

      if (age > TRAIL_TTL_MS || pt.timestamp === 0) continue;

      // Compute fade alpha based on age
      pt.alpha = Math.max(0, 1 - age / TRAIL_TTL_MS);
      active.push(pt);
    }

    return active;
  }
}

// GUID: PIXI_TRAIL_SYSTEM-006-v01
// [Intent] Top-level manager for all driver trails. Lazily creates DriverTrail instances
//          on first access per driver number. Provides a clear() for session resets.
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

  /** Get all active trails as a Map of driverNumber → active TrailPoint[] (oldest first).
   *  This is the interface that TrailLayer.update() expects. */
  getActiveTrails(): Map<number, TrailPoint[]> {
    const now = Date.now();
    const result = new Map<number, TrailPoint[]>();
    for (const [driverNumber, trail] of this.trails) {
      const active = trail.getActivePoints(now);
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
