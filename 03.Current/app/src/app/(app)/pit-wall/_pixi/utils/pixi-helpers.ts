// GUID: PIXI_HELPERS-000-v01
// [Intent] Utility functions for PixiJS v8 WebGL track map rendering.
//          Pure math helpers — no PixiJS imports, no React, no DOM.
// [Inbound Trigger] Imported by PixiJS render systems and components in _pixi/.
// [Downstream Impact] Pure functions — no side effects.

import type { TrackBounds } from '../../_types/pit-wall.types';

// GUID: PIXI_HELPERS-001-v01
// [Intent] Convert a CSS hex colour string (with or without '#') to a PixiJS-compatible
//          0xRRGGBB number. Returns 0xFFFFFF (white) on invalid input.
export function hexToPixi(hex: string): number {
  const cleaned = hex.replace(/^#/, '');
  const parsed = parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : 0xffffff;
}

// GUID: PIXI_HELPERS-002-v01
// [Intent] Linearly interpolate between two 0xRRGGBB colours channel-by-channel.
//          t=0 returns colour a, t=1 returns colour b.
export function lerpColor(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));

  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;

  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;

  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const bl = Math.round(ab + (bb - ab) * clamped);

  return (r << 16) | (g << 8) | bl;
}

// GUID: PIXI_HELPERS-003-v01
// [Intent] Project GPS metres (x, y) to canvas pixel coordinates using the track bounding
//          box. Y axis is inverted (OpenF1 Y increases upward, canvas Y increases downward).
//          Padding shrinks the usable area to keep cars away from canvas edges.
export function projectToCanvas(
  x: number,
  y: number,
  bounds: TrackBounds,
  w: number,
  h: number,
  padding = 32,
): { px: number; py: number } {
  // Guard: bounds may be null during initial load frames before GPS data arrives
  if (!bounds) return { px: 0, py: 0 };

  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;

  const usableW = w - padding * 2;
  const usableH = h - padding * 2;

  // Uniform scale to preserve aspect ratio
  const scale = Math.min(usableW / rangeX, usableH / rangeY);

  // Centre the track within the canvas
  const offsetX = (w - rangeX * scale) / 2;
  const offsetY = (h - rangeY * scale) / 2;

  const px = (x - bounds.minX) * scale + offsetX;
  // Invert Y: OpenF1 Y grows up, canvas Y grows down
  const py = (bounds.maxY - y) * scale + offsetY;

  return { px, py };
}
