// GUID: PIXI_TRAIL_LAYER-000-v01
// [Intent] PixiJS v8 rendering layer — renders comet contrails behind each car as Graphics
//          line segments. Reads from a TrailSystem data structure (Map of driver trails).
//          Uses per-segment colour and alpha for a smooth fade-out effect.
// [Inbound Trigger] update() called every frame with the current TrailSystem state.
// [Downstream Impact] Pure rendering — no React state, no Firestore, no DOM.

import { Container, Graphics } from 'pixi.js';
import type { TrailPoint, TrailSystem } from '../systems/TrailSystem';

const MIN_TRAIL_POINTS = 2;
const BASE_LINE_WIDTH = 2.5;
const TIP_LINE_WIDTH = 1.0;

export class TrailLayer {
  readonly container = new Container();
  private trailGraphics = new Map<number, Graphics>();

  // GUID: PIXI_TRAIL_LAYER-003-v01
  // [Intent] Per-frame draw of all active trails. Clears and redraws each driver's trail
  //          as a series of line segments with per-segment colour, alpha, and width that
  //          taper from thick (newest) to thin (oldest) for a comet tail effect.
  update(trailSystem: TrailSystem, _now: number): void {
    const activeTrails = trailSystem.getActiveTrails();
    const activeDrivers = new Set<number>();

    for (const [driverNumber, points] of activeTrails) {
      activeDrivers.add(driverNumber);

      if (points.length < MIN_TRAIL_POINTS) {
        // Not enough points to draw — hide if exists
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

        // Progress 0 (oldest) to 1 (newest)
        const progress = count > 2 ? i / (count - 2) : 1;

        // Line width tapers: thin at tail, thicker at head
        const lineWidth = TIP_LINE_WIDTH + (BASE_LINE_WIDTH - TIP_LINE_WIDTH) * progress;

        // Alpha: use the newer point's alpha (it fades with age in TrailSystem)
        const segAlpha = p1.alpha * progress;

        if (segAlpha < 0.01) continue; // skip invisible segments

        g.setStrokeStyle({
          width: lineWidth,
          color: p1.colour,
          alpha: segAlpha,
          cap: 'round',
          join: 'round',
        });

        g.moveTo(p0.px, p0.py);
        g.lineTo(p1.px, p1.py);
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
