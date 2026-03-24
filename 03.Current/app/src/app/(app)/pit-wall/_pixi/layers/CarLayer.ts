// GUID: PIXI_CAR_LAYER-000-v01
// [Intent] PixiJS v8 rendering layer — 22 pre-allocated car sprites with team-colour dots,
//          glow halos, driver code labels, position badges (P1-P3), DRS indicators,
//          pit ring overlays, and follow-mode highlight ring.
// [Inbound Trigger] update() called every frame with interpolated driver positions.
// [Downstream Impact] Pure rendering — no React state, no Firestore, no DOM.

import { Container, Graphics, Text, TextStyle, Circle } from 'pixi.js';
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

// GUID: PIXI_CAR_LAYER-001b-v01
// [Intent] ATC-style minimal dots — smaller than v1 for a clean radar display look.
//          3.5px dots with 5px glow halos, subtle presence without clutter.
const DOT_RADIUS = 3.5;
const GLOW_RADIUS = 5;
const BADGE_RADIUS = 5;
const DRS_LINE_LENGTH = 8;
const PIT_RING_RADIUS = 7;
const FOLLOW_RING_RADIUS = 9;

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
  // GUID: PIXI_CAR_LAYER-006-v01
  // [Intent] Track which pool slot the pointer is hovering over for label reveal.
  //          -1 = no hover. Updated by pointerover/pointerout on each car container.
  private hoveredSlot = -1;

  constructor() {
    // GUID: PIXI_CAR_LAYER-003-v01
    // [Intent] Pre-allocate all car sprites at construction to avoid per-frame allocation.
    for (let i = 0; i < POOL_SIZE; i++) {
      const container = new Container();
      container.visible = false;

      // GUID: PIXI_CAR_LAYER-007-v01
      // [Intent] Make car dots interactive for hover-to-reveal driver code labels.
      //          Hit area is slightly larger than the dot for easier targeting.
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.hitArea = new Circle(0, 0, DOT_RADIUS + 4);
      const slotIndex = i;
      container.on('pointerover', () => { this.hoveredSlot = slotIndex; });
      container.on('pointerout', () => { if (this.hoveredSlot === slotIndex) this.hoveredSlot = -1; });

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

  // GUID: PIXI_CAR_LAYER-004-v03
  // [Intent] Per-frame update — assigns interpolated positions to pool slots, updates
  //          colours, labels, badges, DRS/pit/follow indicators, and alpha for retired cars.
  //          v03: Zoom 2 hyper-focus reworked — focus car is same dot size as others (no
  //               oversized circle). All nearby cars show labels+badges for context. Focus
  //               car distinguished only by a subtle cyan highlight ring and full alpha.
  update(
    interpolated: InterpolatedPosition[],
    bounds: TrackBounds,
    w: number,
    h: number,
    followDriver: number | null,
    focusDriverNumber: number | null = null,
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

      // GUID: PIXI_CAR_LAYER-008-v02
      // [Intent] Zoom 2 hyper-focus — all cars rendered at the same dot size. Focus car
      //          distinguished only by full alpha and a subtle cyan ring. Nearby cars at 0.85
      //          alpha so they're clearly visible (not dimmed to near-invisible). The camera
      //          centres on the focus car, so all visible cars are contextually relevant.
      const isFocusCar = focusDriverNumber !== null && focusDriverNumber === driver.driverNumber;
      const isZoom2 = focusDriverNumber !== null;

      // Same dot size for all cars — even the focus car
      sprite.dot.clear();
      sprite.dot.circle(0, 0, DOT_RADIUS);
      sprite.dot.fill({ color: colour });

      sprite.glowDot.clear();
      sprite.glowDot.circle(0, 0, GLOW_RADIUS);
      sprite.glowDot.fill({ color: colour, alpha: 0.3 });

      // Alpha: focus car full brightness, nearby cars slightly dimmed, retired/pit as normal
      if (driver.retired) {
        sprite.container.alpha = 0.25;
      } else if (driver.inPit) {
        sprite.container.alpha = 0.55;
      } else if (isZoom2 && !isFocusCar) {
        sprite.container.alpha = 0.85;
      } else {
        sprite.container.alpha = 1;
      }

      // GUID: PIXI_CAR_LAYER-004b-v03
      // [Intent] ATC-style minimal display — labels, badges, and DRS hidden by default.
      //          Zoom 2 hyper-focus: ALL visible cars show labels+badges (you can only see
      //          nearby cars anyway at 5x zoom, so showing them all gives race context).
      //          Focus car: subtle cyan ring only (no oversized dot).
      //          v03: Show all labels/badges at Zoom 2 for full race context.
      const isFollowed = followDriver === driver.driverNumber;
      const isHovered = this.hoveredSlot === i;

      // Driver code label — at Zoom 2, show position + code; otherwise code only
      sprite.label.visible = isZoom2 || isFollowed || isHovered;
      sprite.label.text = isZoom2 ? `P${driver.position} ${driver.driverCode}` : driver.driverCode;
      sprite.label.position.set(px + DOT_RADIUS + 3, py);
      sprite.label.alpha = driver.retired ? 0.25 : (isFocusCar ? 1 : 0.8);

      // Position badge — at Zoom 2, show all; otherwise follow/hover/P1 only
      if (isZoom2 || isFollowed || isHovered || driver.position === 1) {
        sprite.badge.visible = true;
        sprite.badge.position.set(px - DOT_RADIUS - BADGE_RADIUS - 2, py);
        sprite.badgeText.text = `P${driver.position}`;
      } else {
        sprite.badge.visible = false;
      }

      // DRS indicator — show for focus car or followed driver
      sprite.drsLine.visible = (isFollowed || isFocusCar) && driver.hasDrs;

      // Pit ring — always show (important race context)
      sprite.pitRing.visible = driver.inPit;

      // Follow-mode ring — only on focus car (subtle cyan highlight) or followed driver
      sprite.followRing.visible = isFollowed || isFocusCar;
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
