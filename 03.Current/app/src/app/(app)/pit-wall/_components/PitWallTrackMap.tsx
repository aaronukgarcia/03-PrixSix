// GUID: PIT_WALL_TRACK_MAP-000-v01
// [Intent] Canvas-based live track map. Renders interpolated car positions from useCarInterpolation
//          using a requestAnimationFrame loop. No static SVG circuit paths — cars only.
//          Rain intensity overlay, DRS indicators, position badges, and retired/pit-state dimming.
// [Inbound Trigger] Rendered in the Pit Wall layout. Receives live InterpolatedPosition[] from
//                   useCarInterpolation hook and TrackBounds from usePitWallData.
// [Downstream Impact] Pure canvas rendering — no state writes, no Firestore reads.

'use client';

import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { InterpolatedPosition, TrackBounds } from '../_types/pit-wall.types';

// GUID: PIT_WALL_TRACK_MAP-001-v01
// [Intent] Props for the PitWallTrackMap component.
interface PitWallTrackMapProps {
  positions: InterpolatedPosition[];
  bounds: TrackBounds | null;
  circuitLat: number | null;
  circuitLon: number | null;
  rainIntensity: number | null; // 0-255 from WeatherSnapshot
  sessionType: string | null;
  className?: string;
}

// GUID: PIT_WALL_TRACK_MAP-002-v01
// [Intent] Padding in canvas pixels between track extent and canvas edge.
const CANVAS_PADDING = 28;

// GUID: PIT_WALL_TRACK_MAP-003-v01
// [Intent] Project GPS metres to canvas pixel coordinates.
//          Inverts the Y axis because GPS y increases upward; canvas y increases downward.
function projectToCanvas(
  x: number,
  y: number,
  bounds: TrackBounds,
  canvasWidth: number,
  canvasHeight: number
): { px: number; py: number } {
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;

  const usableW = canvasWidth - CANVAS_PADDING * 2;
  const usableH = canvasHeight - CANVAS_PADDING * 2;

  const px = ((x - bounds.minX) / rangeX) * usableW + CANVAS_PADDING;
  // Invert Y
  const py = (1 - (y - bounds.minY) / rangeY) * usableH + CANVAS_PADDING;

  return { px, py };
}

// GUID: PIT_WALL_TRACK_MAP-004-v01
// [Intent] Draw a single frame onto the canvas using the latest interpolated positions.
function drawFrame(
  ctx: CanvasRenderingContext2D,
  positions: InterpolatedPosition[],
  bounds: TrackBounds | null,
  rainIntensity: number | null,
  sessionType: string | null,
  w: number,
  h: number
) {
  // ── 1. Background fill ──────────────────────────────────────────────────────
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  // ── 2. Atmosphere radial gradient ───────────────────────────────────────────
  const cx = w / 2;
  const cy = h / 2;
  const gradRadius = Math.min(w, h) * 0.55;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, gradRadius);
  gradient.addColorStop(0, 'rgba(20, 30, 60, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // ── 3. Rain overlay ──────────────────────────────────────────────────────────
  if (rainIntensity !== null && rainIntensity > 0) {
    const rainAlpha = (rainIntensity / 255) * 0.35;
    ctx.fillStyle = `rgba(30, 100, 220, ${rainAlpha})`;
    ctx.fillRect(0, 0, w, h);
  }

  // ── 4. Session type label (top-left) ────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '9px "SF Mono", "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(sessionType ?? 'SESSION', 8, 8);

  // ── 5. No data guard ────────────────────────────────────────────────────────
  if (positions.length === 0 || bounds === null) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '11px "SF Mono", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LIVE DATA', w / 2, h / 2);
    return;
  }

  // ── 6. Sort by position for Z-ordering (P1 drawn last = on top) ─────────────
  const sorted = [...positions].sort((a, b) => b.position - a.position);

  for (const pos of sorted) {
    const { px, py } = projectToCanvas(pos.x, pos.y, bounds, w, h);
    const colour = pos.teamColour.startsWith('#') ? pos.teamColour : `#${pos.teamColour}`;

    const isLeadGroup = pos.position <= 3;
    const dotRadius = isLeadGroup ? 6 : 5;

    // ── 6a. Glow for lead group ────────────────────────────────────────────────
    if (isLeadGroup) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = colour;
    } else {
      ctx.shadowBlur = 0;
    }

    // ── 6b. Alpha based on state ───────────────────────────────────────────────
    if (pos.retired) {
      ctx.globalAlpha = 0.25;
    } else if (pos.inPit) {
      ctx.globalAlpha = 0.55;
    } else {
      ctx.globalAlpha = 1.0;
    }

    // ── 6c. Pit dashed circle outline ──────────────────────────────────────────
    if (pos.inPit) {
      ctx.beginPath();
      ctx.arc(px, py, dotRadius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── 6d. Car dot ────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    // ── 6e. DRS indicator — small green wing line above car ────────────────────
    if (pos.hasDrs) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#00ff87';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // 4px wide horizontal line 6px above car centre
      ctx.moveTo(px - 4, py - dotRadius - 4);
      ctx.lineTo(px + 4, py - dotRadius - 4);
      ctx.stroke();
    }

    // Reset shadow/alpha before labels
    ctx.shadowBlur = 0;
    ctx.globalAlpha = pos.retired ? 0.25 : pos.inPit ? 0.55 : 1.0;

    // ── 6f. Driver code label (all drivers) ────────────────────────────────────
    ctx.font = 'bold 8px "SF Mono", "Courier New", monospace';
    ctx.fillStyle = colour;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pos.driverCode, px + dotRadius + 2, py + 1);

    // ── 6g. Position badge for P1-P3 ──────────────────────────────────────────
    if (isLeadGroup) {
      const badgeCx = px - dotRadius - 8;
      const badgeCy = py - dotRadius - 6;
      const badgeR = 7;

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;

      // White circle badge background
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.fill();

      // Position number inside badge
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 7px "SF Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pos.position), badgeCx, badgeCy + 0.5);
    }

    // Reset for next driver
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  }

  // Final state reset
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// GUID: PIT_WALL_TRACK_MAP-005-v01
// [Intent] Main PitWallTrackMap component — manages canvas, ResizeObserver, and RAF loop.
export function PitWallTrackMap({
  positions,
  bounds,
  rainIntensity,
  sessionType,
  className,
}: PitWallTrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Latest mutable refs so RAF callback always sees current data without re-registering
  const positionsRef = useRef(positions);
  const boundsRef = useRef(bounds);
  const rainRef = useRef(rainIntensity);
  const sessionTypeRef = useRef(sessionType);

  positionsRef.current = positions;
  boundsRef.current = bounds;
  rainRef.current = rainIntensity;
  sessionTypeRef.current = sessionType;

  // GUID: PIT_WALL_TRACK_MAP-006-v01
  // [Intent] RAF draw loop — reads from refs so it never needs to be re-registered.
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawFrame(
          ctx,
          positionsRef.current,
          boundsRef.current,
          rainRef.current,
          sessionTypeRef.current,
          canvas.width,
          canvas.height
        );
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // GUID: PIT_WALL_TRACK_MAP-007-v01
  // [Intent] ResizeObserver keeps canvas pixel dimensions in sync with its CSS container size.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          canvas.width = Math.floor(width);
          canvas.height = Math.floor(height);
        }
      }
    });

    observer.observe(container);

    // Seed initial size
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) {
      canvas.width = Math.floor(width);
      canvas.height = Math.floor(height);
    }

    return () => observer.disconnect();
  }, []);

  // GUID: PIT_WALL_TRACK_MAP-008-v01
  // [Intent] Start RAF loop on mount; cancel on unmount.
  useEffect(() => {
    startLoop();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [startLoop]);

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden bg-[#0a0e1a] rounded-lg', className)}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        aria-label="Live track map showing car positions"
      />
    </div>
  );
}
