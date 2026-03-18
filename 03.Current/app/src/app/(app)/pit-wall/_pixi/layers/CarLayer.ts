// GUID: PIXI_CAR_LAYER-000-v01
// [Intent] PixiJS v8 rendering layer — 22 pre-allocated car sprites with team-colour dots,
//          glow halos, driver code labels, position badges (P1-P3), DRS indicators,
//          pit ring overlays, and follow-mode highlight ring.
// [Inbound Trigger] update() called every frame with interpolated driver positions.
// [Downstream Impact] Pure rendering — no React state, no Firestore, no DOM.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { InterpolatedPosition, TrackBounds } from '../../_types/pit-wall.types';
import { projectToCanvas, hexToPixi } from '../utils/pixi-helpers';

const POOL_SIZE = 22; // 20 drivers + 2 spare

// GUID: PIXI_CAR_LAYER-001-v01
// [Intent] Text styles for driver labels and position badges.
const LABEL_STYLE = new TextStyle({
  fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  fontSize: 7,
  fontWeight: 'bold',
  fill: 0xffffff,
});

const BADGE_TEXT_STYLE = new TextStyle({
  fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  fontSize: 6,
  fontWeight: 'bold',
  fill: 0x000000,
});

const DOT_RADIUS = 5;
const GLOW_RADIUS = 8;
const BADGE_RADIUS = 6;
const DRS_LINE_LENGTH = 10;
const PIT_RING_RADIUS = 9;
const FOLLOW_RING_RADIUS = 12;

// GUID: PIXI_CAR_LAYER-002-v01
// [Intent] Internal pooled sprite structure — each slot holds all display objects for one car.
interface CarSprite {
  container: Container;
  dot: Graphics;
  glowDot: Graphics;
  label: Text;
  badge: Container;
  badgeCircle: Graphics;
  badgeText: Text;
  drsLine: Graphics;
  pitRing: Graphics;
  followRing: Graphics;
}

export class CarLayer {
  /** Dots and glows — intended to sit inside a bloom container */
  readonly dotContainer = new Container();
  /** Labels and badges — intended to sit above bloom effects */
  readonly labelContainer = new Container();
  private pool: CarSprite[] = [];

  constructor() {
    // GUID: PIXI_CAR_LAYER-003-v01
    // [Intent] Pre-allocate all car sprites at construction to avoid per-frame allocation.
    for (let i = 0; i < POOL_SIZE; i++) {
      const container = new Container();
      container.visible = false;

      // Glow dot — wider, faint halo behind the car dot
      const glowDot = new Graphics();
      glowDot.circle(0, 0, GLOW_RADIUS);
      glowDot.fill({ color: 0xffffff, alpha: 0.3 });

      // Main dot — solid team colour
      const dot = new Graphics();
      dot.circle(0, 0, DOT_RADIUS);
      dot.fill({ color: 0xffffff });

      // DRS indicator — short green line above the dot
      const drsLine = new Graphics();
      drsLine.setStrokeStyle({ width: 2, color: 0x00ff00, alpha: 0.8 });
      drsLine.moveTo(-DRS_LINE_LENGTH / 2, -DOT_RADIUS - 3);
      drsLine.lineTo(DRS_LINE_LENGTH / 2, -DOT_RADIUS - 3);
      drsLine.stroke();
      drsLine.visible = false;

      // Pit ring — dashed-style ring when car is in pits
      const pitRing = new Graphics();
      pitRing.setStrokeStyle({ width: 1.5, color: 0xffaa00, alpha: 0.6 });
      pitRing.circle(0, 0, PIT_RING_RADIUS);
      pitRing.stroke();
      pitRing.visible = false;

      // Follow-mode highlight ring
      const followRing = new Graphics();
      followRing.setStrokeStyle({ width: 2, color: 0x00ccff, alpha: 0.7 });
      followRing.circle(0, 0, FOLLOW_RING_RADIUS);
      followRing.stroke();
      followRing.visible = false;

      container.addChild(glowDot);
      container.addChild(dot);
      container.addChild(drsLine);
      container.addChild(pitRing);
      container.addChild(followRing);

      // Label — offset to the right of the dot
      const label = new Text({ text: '', style: LABEL_STYLE });
      label.anchor.set(0, 0.5);
      label.visible = false;

      // Position badge (P1-P3) — white circle with black text
      const badgeContainer = new Container();
      badgeContainer.visible = false;
      const badgeCircle = new Graphics();
      badgeCircle.circle(0, 0, BADGE_RADIUS);
      badgeCircle.fill({ color: 0xffffff });
      const badgeText = new Text({ text: '', style: BADGE_TEXT_STYLE });
      badgeText.anchor.set(0.5);
      badgeContainer.addChild(badgeCircle);
      badgeContainer.addChild(badgeText);

      this.dotContainer.addChild(container);
      this.labelContainer.addChild(label);
      this.labelContainer.addChild(badgeContainer);

      this.pool.push({
        container,
        dot,
        glowDot,
        label,
        badge: badgeContainer,
        badgeCircle,
        badgeText,
        drsLine,
        pitRing,
        followRing,
      });
    }
  }

  // GUID: PIXI_CAR_LAYER-004-v01
  // [Intent] Per-frame update — assigns interpolated positions to pool slots, updates
  //          colours, labels, badges, DRS/pit/follow indicators, and alpha for retired cars.
  update(
    interpolated: InterpolatedPosition[],
    bounds: TrackBounds,
    w: number,
    h: number,
    followDriver: number | null,
  ): void {
    // Sort by position descending so P1 renders on top
    const sorted = [...interpolated].sort((a, b) => b.position - a.position);

    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = this.pool[i];

      if (i >= sorted.length) {
        // Hide unused slots
        sprite.container.visible = false;
        sprite.label.visible = false;
        sprite.badge.visible = false;
        continue;
      }

      const driver = sorted[i];
      const { px, py } = projectToCanvas(driver.x, driver.y, bounds, w, h);
      const colour = hexToPixi(driver.teamColour);

      // Position the dot container
      sprite.container.visible = true;
      sprite.container.position.set(px, py);

      // Redraw dot with team colour
      sprite.dot.clear();
      sprite.dot.circle(0, 0, DOT_RADIUS);
      sprite.dot.fill({ color: colour });

      // Redraw glow with team colour
      sprite.glowDot.clear();
      sprite.glowDot.circle(0, 0, GLOW_RADIUS);
      sprite.glowDot.fill({ color: colour, alpha: 0.3 });

      // Alpha for retired / in-pit cars
      if (driver.retired) {
        sprite.container.alpha = 0.25;
      } else if (driver.inPit) {
        sprite.container.alpha = 0.55;
      } else {
        sprite.container.alpha = 1;
      }

      // Driver code label — offset right
      sprite.label.visible = true;
      sprite.label.text = driver.driverCode;
      sprite.label.position.set(px + DOT_RADIUS + 4, py);
      sprite.label.alpha = driver.retired ? 0.25 : 0.7;

      // Position badge for P1-P3
      if (driver.position >= 1 && driver.position <= 3) {
        sprite.badge.visible = true;
        sprite.badge.position.set(px - DOT_RADIUS - BADGE_RADIUS - 2, py);
        sprite.badgeText.text = `P${driver.position}`;
      } else {
        sprite.badge.visible = false;
      }

      // DRS indicator
      sprite.drsLine.visible = driver.hasDrs;

      // Pit ring
      sprite.pitRing.visible = driver.inPit;

      // Follow-mode ring
      sprite.followRing.visible = followDriver === driver.driverNumber;
    }
  }

  // GUID: PIXI_CAR_LAYER-005-v01
  // [Intent] Returns the canvas-space position of a specific driver for follow-mode camera.
  //          Returns null if the driver is not in the current interpolated set.
  getDriverPosition(
    driverNumber: number,
    interpolated: InterpolatedPosition[],
    bounds: TrackBounds,
    w: number,
    h: number,
  ): { px: number; py: number } | null {
    const d = interpolated.find(i => i.driverNumber === driverNumber);
    if (!d) return null;
    return projectToCanvas(d.x, d.y, bounds, w, h);
  }
}
