// GUID: PIXI_TRACK_LAYER-000-v01
// [Intent] PixiJS v8 rendering layer — circuit outline with 3 pastel sector colours,
//          sector boundary marks, and start/finish line. Draws the track as subtle
//          charcoal lines on the dark background, barely visible until cars give it context.
// [Inbound Trigger] rebuild() called when CircuitOutline changes; container added to stage.
// [Downstream Impact] Pure rendering — no React state, no Firestore, no DOM.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { CircuitOutline } from '../../_utils/trackSpline';
import type { TrackBounds } from '../../_types/pit-wall.types';
import { projectToCanvas } from '../utils/pixi-helpers';

// GUID: PIXI_TRACK_LAYER-006-v01
// [Intent] Track width 3x car dot diameter (3.5px radius × 2 × 3 = 21px) so side-by-side
//          cars during overtakes are visually contained within the track ribbon.
const TRACK_WIDTH = 21;
const TRACK_GLOW_WIDTH = 32;

// GUID: PIXI_TRACK_LAYER-001-v01
// [Intent] Sector stroke colours — dark muted tones that sit just above the background.
const SECTOR_STROKE_COLOURS = [
  0x4a2a35, // S1 — dark muted rose
  0x2a3a4a, // S2 — dark muted blue
  0x4a4a2a, // S3 — dark muted gold
];

// GUID: PIXI_TRACK_LAYER-002-v01
// [Intent] Sector glow fill colours — even darker, wide blur underneath the stroke.
const SECTOR_GLOW_COLOURS = [
  0x2a1a24, // S1 glow
  0x1a2a34, // S2 glow
  0x2a2a1a, // S3 glow
];

const SF_COLOUR = 0xffffff;

// GUID: PIXI_TRACK_LAYER-003-v01
// [Intent] Tiny label style for sector markers.
const LABEL_STYLE = new TextStyle({
  fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  fontSize: 9,
  fill: 0xffffff,
  fontWeight: 'bold',
});

export class TrackLayer {
  readonly container = new Container();
  private glowGraphics: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
  private sectorGraphics: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
  private sfLine = new Graphics();
  private sectorMarks = new Graphics();
  private sectorLabels: Text[] = [];
  private sfLabel: Text;

  constructor() {
    // Add glow layers first (underneath), then sector strokes, then marks
    for (const g of this.glowGraphics) this.container.addChild(g);
    for (const g of this.sectorGraphics) this.container.addChild(g);
    this.container.addChild(this.sectorMarks);
    this.container.addChild(this.sfLine);

    // Sector labels
    for (let i = 0; i < 3; i++) {
      const label = new Text({ text: `S${i + 1}`, style: LABEL_STYLE });
      label.alpha = 0.25;
      label.anchor.set(0.5);
      this.sectorLabels.push(label);
      this.container.addChild(label);
    }

    // S/F label
    this.sfLabel = new Text({ text: 'S/F', style: LABEL_STYLE });
    this.sfLabel.alpha = 0.35;
    this.sfLabel.anchor.set(0.5);
    this.container.addChild(this.sfLabel);
  }

  // GUID: PIXI_TRACK_LAYER-004-v02
  // [Intent] Rebuild all track graphics from a new circuit outline. Projects GPS points
  //          to canvas space, divides into 3 equal-arc-length sectors, draws glow + stroke
  //          per sector, perpendicular marks at sector boundaries.
  //          v02: S/F line positioned from API-provided GPS coordinate (correlated from
  //               /laps date_start + /location data) instead of circuit outline point[0]
  //               (which is wherever tracking started, often the pit lane — not S/F).
  rebuild(
    outline: CircuitOutline,
    bounds: TrackBounds,
    w: number,
    h: number,
    sfLineGps?: { x: number; y: number } | null,
  ): void {
    this.clear();

    const pts = outline.points;
    const dist = outline.distances;
    const total = outline.totalLength;
    if (pts.length < 2 || total === 0) return;

    // Project all points to canvas space
    const projected = pts.map(p => projectToCanvas(p.x, p.y, bounds, w, h));

    // Sector boundaries at 1/3 and 2/3 of total arc length
    const sectorBoundaries = [0, total / 3, (total * 2) / 3, total];

    // Assign each segment to a sector
    const sectorIndices: number[][] = [[], [], []]; // indices of points in each sector
    for (let i = 0; i < pts.length; i++) {
      const d = dist[i];
      const sector = d < sectorBoundaries[1] ? 0 : d < sectorBoundaries[2] ? 1 : 2;
      sectorIndices[sector].push(i);
    }

    // Draw each sector
    for (let s = 0; s < 3; s++) {
      const indices = sectorIndices[s];
      if (indices.length < 2) continue;

      const glow = this.glowGraphics[s];
      const stroke = this.sectorGraphics[s];

      // Glow — wider, very faint
      glow.setStrokeStyle({
        width: TRACK_GLOW_WIDTH,
        color: SECTOR_GLOW_COLOURS[s],
        alpha: 0.15,
        cap: 'round',
        join: 'round',
      });

      const firstGlow = projected[indices[0]];
      glow.moveTo(firstGlow.px, firstGlow.py);
      for (let i = 1; i < indices.length; i++) {
        const p = projected[indices[i]];
        glow.lineTo(p.px, p.py);
      }
      // Connect to next sector's first point for continuity
      const nextSectorFirstIdx = s < 2 ? sectorIndices[s + 1]?.[0] : null;
      if (nextSectorFirstIdx != null) {
        const np = projected[nextSectorFirstIdx];
        glow.lineTo(np.px, np.py);
      }
      glow.stroke();

      // Stroke — thinner, slightly brighter
      stroke.setStrokeStyle({
        width: TRACK_WIDTH,
        color: SECTOR_STROKE_COLOURS[s],
        alpha: 0.5,
        cap: 'round',
        join: 'round',
      });

      const firstStroke = projected[indices[0]];
      stroke.moveTo(firstStroke.px, firstStroke.py);
      for (let i = 1; i < indices.length; i++) {
        const p = projected[indices[i]];
        stroke.lineTo(p.px, p.py);
      }
      if (nextSectorFirstIdx != null) {
        const np = projected[nextSectorFirstIdx];
        stroke.lineTo(np.px, np.py);
      }
      stroke.stroke();

      // Sector label — placed at the midpoint of the sector arc
      const midIdx = indices[Math.floor(indices.length / 2)];
      const midPt = projected[midIdx];
      this.sectorLabels[s].position.set(midPt.px, midPt.py - 14);
    }

    // Close the loop if the outline is closed (connect S3 back to S1)
    if (outline.isClosed && projected.length > 1) {
      const lastPt = projected[projected.length - 1];
      const firstPt = projected[0];

      // Draw closing segment in S3 glow + stroke
      this.glowGraphics[2].moveTo(lastPt.px, lastPt.py);
      this.glowGraphics[2].lineTo(firstPt.px, firstPt.py);
      this.glowGraphics[2].stroke();

      this.sectorGraphics[2].moveTo(lastPt.px, lastPt.py);
      this.sectorGraphics[2].lineTo(firstPt.px, firstPt.py);
      this.sectorGraphics[2].stroke();
    }

    // Sector boundary marks — perpendicular ticks at transition points
    this.sectorMarks.clear();
    for (let b = 1; b <= 2; b++) {
      const boundaryDist = sectorBoundaries[b];
      // Find the point index closest to this distance
      let idx = 0;
      for (let i = 1; i < dist.length; i++) {
        if (Math.abs(dist[i] - boundaryDist) < Math.abs(dist[idx] - boundaryDist)) {
          idx = i;
        }
      }

      if (idx > 0 && idx < projected.length - 1) {
        const prev = projected[idx - 1];
        const curr = projected[idx];
        // Direction vector
        const dx = curr.px - prev.px;
        const dy = curr.py - prev.py;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Perpendicular
        const nx = -dy / len;
        const ny = dx / len;
        const tickLen = 8;

        this.sectorMarks.setStrokeStyle({ width: 1.5, color: 0x888888, alpha: 0.4 });
        this.sectorMarks.moveTo(curr.px - nx * tickLen, curr.py - ny * tickLen);
        this.sectorMarks.lineTo(curr.px + nx * tickLen, curr.py + ny * tickLen);
        this.sectorMarks.stroke();
      }
    }

    // S/F line — bright white perpendicular mark at the actual start/finish line position.
    // Uses API-provided GPS coordinate (from /laps date_start correlated with /location).
    // Falls back to circuit outline midpoint if no API S/F data available.
    this.sfLine.clear();
    if (sfLineGps && projected.length >= 2) {
      // Project the API-provided S/F GPS coordinate to canvas space
      const sfCanvas = projectToCanvas(sfLineGps.x, sfLineGps.y, bounds, w, h);

      // Find the nearest outline point to compute the track direction at S/F
      let nearestIdx = 0;
      let nearestDistSq = Infinity;
      for (let i = 0; i < projected.length; i++) {
        const ddx = projected[i].px - sfCanvas.px;
        const ddy = projected[i].py - sfCanvas.py;
        const dSq = ddx * ddx + ddy * ddy;
        if (dSq < nearestDistSq) {
          nearestDistSq = dSq;
          nearestIdx = i;
        }
      }

      // Compute direction from neighbouring points for the perpendicular
      const prevIdx = nearestIdx > 0 ? nearestIdx - 1 : projected.length - 1;
      const nextIdx = nearestIdx < projected.length - 1 ? nearestIdx + 1 : 0;
      const dx = projected[nextIdx].px - projected[prevIdx].px;
      const dy = projected[nextIdx].py - projected[prevIdx].py;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const sfLen = 16;

      this.sfLine.setStrokeStyle({ width: 2.5, color: SF_COLOUR, alpha: 0.7 });
      this.sfLine.moveTo(sfCanvas.px - nx * sfLen, sfCanvas.py - ny * sfLen);
      this.sfLine.lineTo(sfCanvas.px + nx * sfLen, sfCanvas.py + ny * sfLen);
      this.sfLine.stroke();

      this.sfLabel.position.set(sfCanvas.px + nx * (sfLen + 10), sfCanvas.py + ny * (sfLen + 10));
    } else if (projected.length >= 2) {
      // No API S/F data — hide S/F marker rather than show it at a wrong position
      this.sfLabel.visible = false;
    }
  }

  // GUID: PIXI_TRACK_LAYER-005-v01
  // [Intent] Clear all graphics for a full rebuild or teardown.
  clear(): void {
    for (const g of this.glowGraphics) g.clear();
    for (const g of this.sectorGraphics) g.clear();
    this.sfLine.clear();
    this.sectorMarks.clear();
  }
}
