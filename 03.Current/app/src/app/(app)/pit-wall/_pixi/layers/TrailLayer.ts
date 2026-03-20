// GUID: PIXI_TRAIL_LAYER-000-v02
// [Intent] PixiJS v8 rendering layer — renders fine ATC-style vapour-trail contrails behind
//          each car. Reads GPS-space trail points and projects to canvas at draw time.
//          v02: GPS-space storage eliminates trail jumping on canvas resize. Thinner lines
//               (0.5-1.5px), exponential alpha decay, smooth round caps. Configurable TTL
//               and enable/disable toggle.
// [Inbound Trigger] update() called every frame with TrailSystem state + projection params.
// [Downstream Impact] Pure rendering — no React state, no Firestore, no DOM.

import { Container, Graphics } from 'pixi.js';
import type { TrailSystem } from '../systems/TrailSystem';
import type { TrackBounds } from '../../_types/pit-wall.types';
import { projectToCanvas } from '../utils/pixi-helpers';

const MIN_TRAIL_POINTS = 2;
const BASE_LINE_WIDTH = 1.5;  // head width — fine but visible
const TIP_LINE_WIDTH = 0.5;   // tail width — hair-thin fade-out

export class TrailLayer {
  readonly container = new Container();
  private trailGraphics = new Map<number, Graphics>();

  // GUID: PIXI_TRAIL_LAYER-003-v03
  // [Intent] Per-frame draw of all active trails. Projects GPS->canvas at draw time so
  //          trails are stable across canvas resizes. Thinner lines with exponential alpha
  //          decay create a fine ATC vapour-trail effect.
  //          v03: Velocity-scaled TTL — trails stretch at high speed and compress in slow
  //               corners. Speed data already stored on each trail point by TrailSystem.
  update(
    trailSystem: TrailSystem,
    _now: number,
    bounds: TrackBounds,
    w: number,
    h: number,
    trailTtlMs: number,
    trailEnabled: boolean,
  ): void {
    if (!trailEnabled) {
      for (const [, g] of this.trailGraphics) g.clear();
      return;
    }

    const activeTrails = trailSystem.getActiveTrails(trailTtlMs);
    const activeDrivers = new Set<number>();

    for (const [driverNumber, points] of activeTrails) {
      activeDrivers.add(driverNumber);

      if (points.length < MIN_TRAIL_POINTS) {
        const existing = this.trailGraphics.get(driverNumber);
        if (existing) existing.clear();
        continue;
      }

      // Get or create Graphics for this driver
      let g = this.trailGraphics.get(driverNumber);
      if (!g) {
        g = new Graphics();
        this.trailGraphics.set(driverNumber, g);
        this.container.addChild(g);
      }

      g.clear();

      // Draw segments from oldest to newest
      const count = points.length;
      for (let i = 0; i < count - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];

        // Project GPS->canvas at draw time
        const c0 = projectToCanvas(p0.gpsX, p0.gpsY, bounds, w, h);
        const c1 = projectToCanvas(p1.gpsX, p1.gpsY, bounds, w, h);

        // Progress 0 (oldest) to 1 (newest)
        const progress = count > 2 ? i / (count - 2) : 1;

        // Fine taper: hair-thin at tail, slightly thicker at head
        const lineWidth = TIP_LINE_WIDTH + (BASE_LINE_WIDTH - TIP_LINE_WIDTH) * progress;

        // Velocity-scaled alpha — trails stretch at high speed, compress in slow corners.
        // speedScale: 0.3 (stopped/slow) to 2.5 (350+ km/h flat out).
        // Applied to the exponential decay alpha so fast segments linger longer.
        const speedScale = Math.max(0.3, Math.min(2.5, p1.speed / 200));
        const velocityAlpha = Math.exp(-3 * (1 - progress) / speedScale);
        const segAlpha = p1.alpha * velocityAlpha * (0.3 + 0.7 * progress);

        if (segAlpha < 0.02) continue; // skip invisible segments

        g.setStrokeStyle({
          width: lineWidth,
          color: p1.colour,
          alpha: segAlpha,
          cap: 'round',
          join: 'round',
        });

        g.moveTo(c0.px, c0.py);
        g.lineTo(c1.px, c1.py);
        g.stroke();
      }
    }

    // Remove graphics for drivers no longer in the system
    for (const [driverNumber, g] of this.trailGraphics) {
      if (!activeDrivers.has(driverNumber)) {
        g.clear();
        g.destroy();
        this.trailGraphics.delete(driverNumber);
        this.container.removeChild(g);
      }
    }
  }

  // GUID: PIXI_TRAIL_LAYER-004-v01
  // [Intent] Full teardown — destroy all trail graphics and clear internal state.
  clear(): void {
    for (const [, g] of this.trailGraphics) {
      g.clear();
      g.destroy();
    }
    this.trailGraphics.clear();
    this.container.removeChildren();
  }
}
