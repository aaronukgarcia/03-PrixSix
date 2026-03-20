// GUID: PIXI_BG_LAYER-000-v01
// [Intent] PixiJS v8 rendering layer — dark background, atmosphere gradient, rain overlay,
//          and status text for the Pit Wall track map. Draws the bottom-most visual layer.
// [Inbound Trigger] Created by the PixiJS stage manager; update() called every frame.
// [Downstream Impact] Pure rendering — no React state, no Firestore, no DOM.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';

// GUID: PIXI_BG_LAYER-001-v01
// [Intent] Monospace text style for status overlay — large, very faint white.
const STATUS_STYLE = new TextStyle({
  fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  fontSize: 18,
  fontWeight: 'bold',
  fill: 0xffffff,
  align: 'center',
});

// GUID: PIXI_BG_LAYER-002-v01
// [Intent] Smaller monospace style for the sub-status line.
const SUB_STATUS_STYLE = new TextStyle({
  fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  fontSize: 12,
  fill: 0xffffff,
  align: 'center',
});

const BG_COLOUR = 0x0a0a0e;
const ATMOSPHERE_COLOUR = 0x141428;

export class BackgroundLayer {
  readonly container = new Container();
  private bg = new Graphics();
  private atmosphere = new Graphics();
  // GUID: PIXI_BG_LAYER-005-v01
  // [Intent] Subtle grid pattern — thin lines every 50px at ~3% opacity.
  //          Adds a premium telemetry-screen texture without distracting from the data.
  private grid = new Graphics();
  private rainOverlay = new Graphics();
  private statusText: Text;
  private subText: Text;

  constructor() {
    this.statusText = new Text({ text: '', style: STATUS_STYLE });
    this.statusText.alpha = 0.2;
    this.statusText.anchor.set(0.5);

    this.subText = new Text({ text: '', style: SUB_STATUS_STYLE });
    this.subText.alpha = 0.15;
    this.subText.anchor.set(0.5);

    this.rainOverlay.alpha = 0;

    this.container.addChild(this.bg);
    this.container.addChild(this.grid);
    this.container.addChild(this.atmosphere);
    this.container.addChild(this.rainOverlay);
    this.container.addChild(this.statusText);
    this.container.addChild(this.subText);
  }

  // GUID: PIXI_BG_LAYER-003-v01
  // [Intent] Redraw background and atmosphere gradient on canvas resize.
  resize(w: number, h: number): void {
    // Solid dark background
    this.bg.clear();
    this.bg.rect(0, 0, w, h);
    this.bg.fill({ color: BG_COLOUR });

    // Grid — subtle lines every 50px for premium telemetry texture
    this.grid.clear();
    const GRID_SPACING = 50;
    this.grid.setStrokeStyle({ width: 0.5, color: 0x1a1a24, alpha: 0.5 });
    for (let x = 0; x <= w; x += GRID_SPACING) {
      this.grid.moveTo(x, 0);
      this.grid.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += GRID_SPACING) {
      this.grid.moveTo(0, y);
      this.grid.lineTo(w, y);
    }
    this.grid.stroke();

    // Atmosphere — subtle radial glow in center (concentric circles, decreasing alpha)
    this.atmosphere.clear();
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.max(w, h) * 0.5;
    const steps = 5;
    for (let i = steps; i >= 1; i--) {
      const r = maxR * (i / steps);
      const a = 0.04 * (1 - i / steps); // faintest at outer edge
      this.atmosphere.circle(cx, cy, r);
      this.atmosphere.fill({ color: ATMOSPHERE_COLOUR, alpha: a });
    }

    // Rain overlay covers full canvas — alpha controlled by update()
    this.rainOverlay.clear();
    this.rainOverlay.rect(0, 0, w, h);
    this.rainOverlay.fill({ color: 0x1a2a4a });
  }

  // GUID: PIXI_BG_LAYER-004-v01
  // [Intent] Per-frame update — adjusts rain overlay intensity and status text content.
  update(opts: {
    w: number;
    h: number;
    rainIntensity: number | null;
    sessionType: string | null;
    hasLiveSession: boolean;
    positionDataAvailable: boolean;
    hasData: boolean;
    nextRaceName: string | null;
    lastMeetingName: string | null;
  }): void {
    // Rain overlay — map 0-255 intensity to 0-0.15 alpha
    if (opts.rainIntensity != null && opts.rainIntensity > 0) {
      this.rainOverlay.alpha = Math.min(0.15, opts.rainIntensity / 255 * 0.15);
    } else {
      this.rainOverlay.alpha = 0;
    }

    // Centre status text
    const cx = opts.w / 2;
    const cy = opts.h / 2;
    this.statusText.position.set(cx, cy);
    this.subText.position.set(cx, cy + 28);

    // Determine status text
    if (opts.hasData) {
      // Cars are on screen — hide status
      this.statusText.visible = false;
      this.subText.visible = false;
      return;
    }

    this.statusText.visible = true;
    this.subText.visible = true;

    if (opts.hasLiveSession && opts.positionDataAvailable) {
      this.statusText.text = 'GPS INITIALISING';
      this.subText.text = opts.sessionType
        ? `${opts.sessionType} — waiting for position data`
        : 'Waiting for position data';
    } else if (opts.hasLiveSession && !opts.positionDataAvailable) {
      this.statusText.text = 'AWAITING GPS DATA';
      this.subText.text = opts.sessionType
        ? `${opts.sessionType} — position data not yet available`
        : 'Position data not yet available from OpenF1';
    } else {
      this.statusText.text = 'BETWEEN SESSIONS';
      const detail = opts.nextRaceName
        ? `Next: ${opts.nextRaceName}`
        : opts.lastMeetingName
          ? `Last: ${opts.lastMeetingName}`
          : '';
      this.subText.text = detail;
    }
  }
}
