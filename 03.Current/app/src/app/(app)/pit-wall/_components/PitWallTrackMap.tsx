// GUID: PIT_WALL_TRACK_MAP-000-v04
// [Intent] Canvas-based live track map with ghost/comet trail rendering and follow-mode camera.
//          Single RAF loop lerps positions AND draws each frame, eliminating all React state from the hot path.
//          v03: Dual-canvas ghost/comet trail rendering.
//          v04: Follow-mode camera — click a driver in the race table to zoom in and track them.
//               Smooth lerp on zoom/offset for cinematic pan. White tracking ring around followed car.
// [Inbound Trigger] Rendered in the Pit Wall layout. Receives DriverRaceState[] directly from PitWallClient.
// [Downstream Impact] Pure canvas rendering — no state writes, no Firestore reads.

'use client';

import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { DriverRaceState, InterpolatedPosition, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';
import { buildTrackPolyline, projectOntoTrack, paramToPoint, type TrackPolyline } from '../_utils/trackSpline';

// GUID: PIT_WALL_TRACK_MAP-001-v04
// [Intent] Props for the PitWallTrackMap component.
//          v04: Added followDriver for follow-mode camera zoom/pan.
interface PitWallTrackMapProps {
  drivers: DriverRaceState[];        // replaces positions — interpolation done internally
  updateIntervalMs: number;          // used for lerp timing (matches data polling interval)
  bounds: TrackBounds | null;
  circuitPath: CircuitPoint[];       // accumulated GPS history — draws the circuit outline
  circuitLat: number | null;
  circuitLon: number | null;
  rainIntensity: number | null;      // 0-255 from WeatherSnapshot
  sessionType: string | null;
  hasLiveSession: boolean;           // true when sessionKey !== null
  positionDataAvailable: boolean;    // true when OpenF1 returned ≥1 position record
  nextRaceName: string | null;       // shown in between-races state
  lastMeetingName: string | null;    // shown in between-races state
  followDriver: number | null;       // driver number to zoom/pan and track, null = full track view
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

// GUID: PIT_WALL_TRACK_MAP-010-v01
// [Intent] Linear interpolation between two numbers. Clamped to [0,1].
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// GUID: PIT_WALL_TRACK_MAP-012-v01
// [Intent] Ghost trail fade alpha — controls comet tail length. Lower = longer trails.
//          0.15 gives ~6-7 frames of visible trail at 60fps.
const GHOST_ALPHA = 0.15;

// GUID: PIT_WALL_TRACK_MAP-013-v01
// [Intent] Max comet tail length in canvas pixels — prevents absurdly long tails
//          from teleporting cars or large frame-to-frame jumps.
const MAX_TAIL_LENGTH = 25;

// GUID: PIT_WALL_TRACK_MAP-019-v01
// [Intent] Follow-mode camera constants — zoom level and lerp speed.
const FOLLOW_ZOOM = 3.0;       // 3x zoom when following a driver
const FOLLOW_LERP_SPEED = 0.08; // smooth ease factor per frame (0 = no move, 1 = instant snap)

// GUID: PIT_WALL_TRACK_MAP-014-v01
// [Intent] Convert hex colour string to {r, g, b} for use in gradient stops.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

// GUID: PIT_WALL_TRACK_MAP-004-v03
// [Intent] Draw static elements (background, atmosphere, rain, labels, circuit outline,
//          no-data states) onto the main canvas. Called every frame with a full opaque clear.
//          Returns true if cars should be drawn (has interpolated positions + bounds).
function drawStaticLayer(
  ctx: CanvasRenderingContext2D,
  interpolated: InterpolatedPosition[],
  bounds: TrackBounds | null,
  circuitPath: CircuitPoint[],
  rainIntensity: number | null,
  sessionType: string | null,
  hasLiveSession: boolean,
  positionDataAvailable: boolean,
  nextRaceName: string | null,
  lastMeetingName: string | null,
  w: number,
  h: number
): boolean {
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
  ctx.fillText(sessionType ?? (hasLiveSession ? 'SESSION' : 'BETWEEN SESSIONS'), 8, 8);

  // ── 5a. Circuit outline (accumulated GPS path) ───────────────────────────────
  // GUID: PIT_WALL_TRACK_MAP-011-v01
  if (circuitPath.length >= 20 && bounds !== null) {
    ctx.beginPath();
    let first = true;
    for (const pt of circuitPath) {
      const { px, py } = projectToCanvas(pt.x, pt.y, bounds, w, h);
      if (first) { ctx.moveTo(px, py); first = false; }
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = hasLiveSession && interpolated.length > 0
      ? 'rgba(255,255,255,0.10)'
      : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── 5b. No-data states ──────────────────────────────────────────────────────
  if (interpolated.length === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (!hasLiveSession) {
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.font = 'bold 11px "SF Mono", "Courier New", monospace';
      ctx.fillText('BETWEEN SESSIONS', w / 2, h / 2 - 18);

      if (lastMeetingName) {
        ctx.font = '9px "SF Mono", "Courier New", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillText(`last: ${lastMeetingName}`, w / 2, h / 2);
      }

      if (nextRaceName) {
        ctx.font = '9px "SF Mono", "Courier New", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillText(`next: ${nextRaceName}`, w / 2, h / 2 + 14);
      }
    } else if (!positionDataAvailable) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '11px "SF Mono", "Courier New", monospace';
      ctx.fillText('GPS INITIALISING', w / 2, h / 2 - 8);
      ctx.font = '9px "SF Mono", "Courier New", monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillText('timing data active — map loading', w / 2, h / 2 + 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = '11px "SF Mono", "Courier New", monospace';
      ctx.fillText('POSITION DATA UNAVAILABLE', w / 2, h / 2 - 8);
      ctx.font = '9px "SF Mono", "Courier New", monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillText('race table showing live timing', w / 2, h / 2 + 8);
    }

    return false;
  }

  return bounds !== null;
}

// GUID: PIT_WALL_TRACK_MAP-015-v01
// [Intent] Draw cars onto the ghost canvas with semi-transparent fade for comet trails.
//          The ghost canvas is never fully cleared — instead a semi-transparent background
//          rectangle is drawn each frame, causing older car positions to fade out naturally.
//          Each car gets a gradient tail line from its current position backwards along its
//          frame-to-frame heading vector, plus the dot, labels, and badges.
function drawCarLayer(
  ghostCtx: CanvasRenderingContext2D,
  interpolated: InterpolatedPosition[],
  bounds: TrackBounds,
  prevFramePositions: Map<number, { px: number; py: number }>,
  w: number,
  h: number,
  skipFade = false,
) {
  // Semi-transparent fade — creates the ghosting/comet trail effect
  // Skipped when caller already applied fade at identity before transform
  if (!skipFade) {
    ghostCtx.fillStyle = `rgba(10, 14, 26, ${GHOST_ALPHA})`;
    ghostCtx.fillRect(0, 0, w, h);
  }

  // Sort by position for Z-ordering (P1 drawn last = on top)
  const sorted = [...interpolated].sort((a, b) => b.position - a.position);

  for (const pos of sorted) {
    const { px, py } = projectToCanvas(pos.x, pos.y, bounds, w, h);
    const colour = pos.teamColour.startsWith('#') ? pos.teamColour : `#${pos.teamColour}`;
    const rgb = hexToRgb(colour);

    const isLeadGroup = pos.position <= 3;
    const dotRadius = isLeadGroup ? 6 : 5;

    // Alpha based on state
    if (pos.retired) {
      ghostCtx.globalAlpha = 0.25;
    } else if (pos.inPit) {
      ghostCtx.globalAlpha = 0.55;
    } else {
      ghostCtx.globalAlpha = 1.0;
    }

    // ── Comet tail — gradient line from head backwards along heading ──────────
    const prevPos = prevFramePositions.get(pos.driverNumber);
    if (prevPos && !pos.inPit && !pos.retired) {
      const dx = px - prevPos.px;
      const dy = py - prevPos.py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 1) {
        // Normalise and compute tail endpoint (behind the car)
        const tailLen = Math.min(dist * 2, MAX_TAIL_LENGTH);
        const nx = dx / dist;
        const ny = dy / dist;
        const tailX = px - nx * tailLen;
        const tailY = py - ny * tailLen;

        const tailGrad = ghostCtx.createLinearGradient(tailX, tailY, px, py);
        tailGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        tailGrad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`);

        ghostCtx.beginPath();
        ghostCtx.moveTo(tailX, tailY);
        ghostCtx.lineTo(px, py);
        ghostCtx.strokeStyle = tailGrad;
        ghostCtx.lineWidth = isLeadGroup ? 3 : 2;
        ghostCtx.lineCap = 'round';
        ghostCtx.stroke();
      }
    }

    // ── Glow for lead group ──────────────────────────────────────────────────
    if (isLeadGroup) {
      ghostCtx.shadowBlur = 12;
      ghostCtx.shadowColor = colour;
    } else {
      ghostCtx.shadowBlur = 0;
    }

    // ── Pit dashed circle outline ────────────────────────────────────────────
    if (pos.inPit) {
      ghostCtx.beginPath();
      ghostCtx.arc(px, py, dotRadius + 3, 0, Math.PI * 2);
      ghostCtx.strokeStyle = colour;
      ghostCtx.lineWidth = 1;
      ghostCtx.setLineDash([2, 2]);
      ghostCtx.stroke();
      ghostCtx.setLineDash([]);
    }

    // ── Car dot ──────────────────────────────────────────────────────────────
    ghostCtx.beginPath();
    ghostCtx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ghostCtx.fillStyle = colour;
    ghostCtx.fill();

    // ── DRS indicator ────────────────────────────────────────────────────────
    if (pos.hasDrs) {
      ghostCtx.shadowBlur = 0;
      ghostCtx.strokeStyle = '#00ff87';
      ghostCtx.lineWidth = 1.5;
      ghostCtx.beginPath();
      ghostCtx.moveTo(px - 4, py - dotRadius - 4);
      ghostCtx.lineTo(px + 4, py - dotRadius - 4);
      ghostCtx.stroke();
    }

    // Reset shadow/alpha before labels
    ghostCtx.shadowBlur = 0;
    ghostCtx.globalAlpha = pos.retired ? 0.25 : pos.inPit ? 0.55 : 1.0;

    // ── Driver code label ────────────────────────────────────────────────────
    ghostCtx.font = 'bold 8px "SF Mono", "Courier New", monospace';
    ghostCtx.fillStyle = colour;
    ghostCtx.textAlign = 'left';
    ghostCtx.textBaseline = 'middle';
    ghostCtx.fillText(pos.driverCode, px + dotRadius + 2, py + 1);

    // ── Position badge for P1-P3 ─────────────────────────────────────────────
    if (isLeadGroup) {
      const badgeCx = px - dotRadius - 8;
      const badgeCy = py - dotRadius - 6;
      const badgeR = 7;

      ghostCtx.shadowBlur = 0;
      ghostCtx.globalAlpha = 1.0;

      ghostCtx.beginPath();
      ghostCtx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ghostCtx.fillStyle = 'rgba(255,255,255,0.90)';
      ghostCtx.fill();

      ghostCtx.fillStyle = '#000000';
      ghostCtx.font = 'bold 7px "SF Mono", monospace';
      ghostCtx.textAlign = 'center';
      ghostCtx.textBaseline = 'middle';
      ghostCtx.fillText(String(pos.position), badgeCx, badgeCy + 0.5);
    }

    // Update prevFramePositions for next frame's heading calculation
    prevFramePositions.set(pos.driverNumber, { px, py });

    // Reset for next driver
    ghostCtx.globalAlpha = 1.0;
    ghostCtx.shadowBlur = 0;
    ghostCtx.setLineDash([]);
  }

  // Final state reset
  ghostCtx.textAlign = 'left';
  ghostCtx.textBaseline = 'alphabetic';
}

// GUID: PIT_WALL_TRACK_MAP-005-v04
// [Intent] Main PitWallTrackMap component — manages dual canvases, ResizeObserver, and RAF loop.
//          v02: Interpolation absorbed internally.
//          v03: Circuit outline, no-data states.
//          v04: Dual-canvas ghost/comet trail rendering. Offscreen ghostCanvas accumulates
//               semi-transparent car frames; composited onto main canvas after static layer.
//               prevFramePositionsRef tracks per-car screen-space position for heading calc.
export function PitWallTrackMap({
  drivers,
  updateIntervalMs,
  bounds,
  circuitPath,
  rainIntensity,
  sessionType,
  hasLiveSession,
  positionDataAvailable,
  nextRaceName,
  lastMeetingName,
  followDriver,
  className,
}: PitWallTrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // GUID: PIT_WALL_TRACK_MAP-016-v01
  const ghostCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // GUID: PIT_WALL_TRACK_MAP-017-v01
  const prevFramePositionsRef = useRef<Map<number, { px: number; py: number }>>(new Map());

  // GUID: PIT_WALL_TRACK_MAP-020-v01
  // [Intent] Follow-mode camera state — current zoom and offset that lerp toward their
  //          targets each frame. When followDriver is null, targets are zoom=1, offset={0,0}.
  //          When following, targets are zoom=FOLLOW_ZOOM with offset centering the driver.
  const followDriverRef = useRef<number | null>(null);
  const cameraZoomRef = useRef(1);
  const cameraOffsetXRef = useRef(0);
  const cameraOffsetYRef = useRef(0);

  // Latest mutable refs so RAF callback always sees current data without re-registering
  const driversRef = useRef(drivers);
  const updateIntervalMsRef = useRef(updateIntervalMs);
  const boundsRef = useRef(bounds);
  const circuitPathRef = useRef(circuitPath);
  const rainRef = useRef(rainIntensity);
  const sessionTypeRef = useRef(sessionType);
  const hasLiveSessionRef = useRef(hasLiveSession);
  const positionDataAvailableRef = useRef(positionDataAvailable);
  const nextRaceNameRef = useRef(nextRaceName);
  const lastMeetingNameRef = useRef(lastMeetingName);

  driversRef.current = drivers;
  updateIntervalMsRef.current = updateIntervalMs;
  boundsRef.current = bounds;
  circuitPathRef.current = circuitPath;
  rainRef.current = rainIntensity;
  sessionTypeRef.current = sessionType;
  hasLiveSessionRef.current = hasLiveSession;
  positionDataAvailableRef.current = positionDataAvailable;
  nextRaceNameRef.current = nextRaceName;
  lastMeetingNameRef.current = lastMeetingName;
  followDriverRef.current = followDriver;

  // GUID: PIT_WALL_TRACK_MAP-018-v01
  // [Intent] Track polyline for snap-to-track interpolation. Rebuilt when circuit path
  //          grows significantly (> 50 new points since last build). Null until enough
  //          path data is available. When available, lerp happens in 1D track-space
  //          instead of 2D GPS-space, preventing corner cutting during interpolation.
  const trackPolylineRef = useRef<TrackPolyline | null>(null);
  const lastPolylineLengthRef = useRef<number>(0);

  useEffect(() => {
    const pathLen = circuitPath.length;
    if (pathLen < 20) return;
    if (pathLen - lastPolylineLengthRef.current < 50 && trackPolylineRef.current) return;
    trackPolylineRef.current = buildTrackPolyline(circuitPath);
    lastPolylineLengthRef.current = pathLen;
  }, [circuitPath]);

  // Interpolation refs — no React state, pure mutable slots
  const prevPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const nextPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const snapshotTimestampRef = useRef<number>(Date.now());

  // GUID: PIT_WALL_TRACK_MAP-009-v01
  // [Intent] When drivers snapshot changes, promote current next→prev and store new GPS targets.
  //          Resets snapshot timestamp so the lerp restarts from t=0 toward the new positions.
  useEffect(() => {
    const prev = new Map<number, { x: number; y: number }>();
    // Carry whatever we had in next as the new prev (smooth handoff)
    drivers.forEach(d => {
      const current = nextPositionsRef.current.get(d.driverNumber);
      if (current) {
        prev.set(d.driverNumber, current);
      } else if (d.x !== null && d.y !== null) {
        prev.set(d.driverNumber, { x: d.x, y: d.y });
      }
    });
    prevPositionsRef.current = prev;

    const next = new Map<number, { x: number; y: number }>();
    drivers.forEach(d => {
      if (d.x !== null && d.y !== null) {
        next.set(d.driverNumber, { x: d.x, y: d.y });
      } else {
        // Hold last known position if GPS dropped out
        const last = prevPositionsRef.current.get(d.driverNumber);
        if (last) next.set(d.driverNumber, last);
      }
    });
    nextPositionsRef.current = next;
    snapshotTimestampRef.current = Date.now();
  }, [drivers]);

  // GUID: PIT_WALL_TRACK_MAP-006-v03
  // [Intent] Single RAF draw loop — interpolates positions AND draws each frame.
  //          v03: Dual-canvas rendering — static layer on main canvas, car layer on ghost
  //               canvas (comet trails via semi-transparent fade), then composite.
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Lazily create offscreen ghost canvas
    if (!ghostCanvasRef.current) {
      ghostCanvasRef.current = document.createElement('canvas');
      ghostCanvasRef.current.width = canvas.width;
      ghostCanvasRef.current.height = canvas.height;
    }

    const loop = () => {
      const ctx = canvas.getContext('2d');
      const ghostCanvas = ghostCanvasRef.current;
      const ghostCtx = ghostCanvas?.getContext('2d');
      if (!ctx || !ghostCanvas || !ghostCtx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // ── Interpolate positions inline ─────────────────────────────────────────
      const now = Date.now();
      const elapsed = now - snapshotTimestampRef.current;
      const t = Math.min(1, elapsed / (updateIntervalMsRef.current || 60000));
      const currentDrivers = driversRef.current;

      const poly = trackPolylineRef.current;

      const interpolated: InterpolatedPosition[] = currentDrivers
        .filter(d => nextPositionsRef.current.has(d.driverNumber))
        .map(d => {
          const prev = prevPositionsRef.current.get(d.driverNumber);
          const next = nextPositionsRef.current.get(d.driverNumber)!;

          let x: number, y: number;

          if (poly && prev) {
            // Snap-to-track: project prev and next into 1D track-space,
            // lerp in 1D, then convert back to 2D via polyline.
            const prevParam = projectOntoTrack(poly, prev.x, prev.y);
            let nextParam = projectOntoTrack(poly, next.x, next.y);

            // Handle lap wraparound — if the gap is more than half the track,
            // the car crossed the start/finish line.
            if (prevParam - nextParam > poly.totalLength * 0.5) {
              nextParam += poly.totalLength;
            } else if (nextParam - prevParam > poly.totalLength * 0.5) {
              nextParam -= poly.totalLength;
            }

            const interpParam = lerp(prevParam, nextParam, t);
            const pt = paramToPoint(poly, interpParam);
            x = pt.x;
            y = pt.y;
          } else {
            // Fallback: raw 2D lerp when polyline not yet available
            x = prev ? lerp(prev.x, next.x, t) : next.x;
            y = prev ? lerp(prev.y, next.y, t) : next.y;
          }

          return {
            driverNumber: d.driverNumber,
            x,
            y,
            teamColour: d.teamColour,
            driverCode: d.driverCode,
            position: d.position,
            hasDrs: d.hasDrs,
            retired: d.retired,
            inPit: d.inPit,
          };
        });

      const w = canvas.width;
      const h = canvas.height;

      // ── Follow-mode camera lerp ────────────────────────────────────────────
      // GUID: PIT_WALL_TRACK_MAP-021-v01
      // Compute target zoom/offset, then lerp current camera state toward it.
      let targetZoom = 1;
      let targetOffX = 0;
      let targetOffY = 0;

      const followNum = followDriverRef.current;
      if (followNum !== null && boundsRef.current) {
        const followed = interpolated.find(p => p.driverNumber === followNum);
        if (followed) {
          const { px, py } = projectToCanvas(followed.x, followed.y, boundsRef.current, w, h);
          targetZoom = FOLLOW_ZOOM;
          targetOffX = w / 2 - px * targetZoom;
          targetOffY = h / 2 - py * targetZoom;
        }
      }

      cameraZoomRef.current    += (targetZoom  - cameraZoomRef.current)    * FOLLOW_LERP_SPEED;
      cameraOffsetXRef.current += (targetOffX  - cameraOffsetXRef.current) * FOLLOW_LERP_SPEED;
      cameraOffsetYRef.current += (targetOffY  - cameraOffsetYRef.current) * FOLLOW_LERP_SPEED;

      // Snap when very close to avoid perpetual micro-lerp
      if (Math.abs(cameraZoomRef.current - targetZoom) < 0.005) cameraZoomRef.current = targetZoom;

      const zoom = cameraZoomRef.current;
      const offX = cameraOffsetXRef.current;
      const offY = cameraOffsetYRef.current;
      const hasTransform = zoom !== 1 || offX !== 0 || offY !== 0;

      // ── Draw static layer (main canvas — full clear inside drawStaticLayer) ──
      const shouldDrawCars = drawStaticLayer(
        ctx,
        interpolated,
        boundsRef.current,
        circuitPathRef.current,
        rainRef.current,
        sessionTypeRef.current,
        hasLiveSessionRef.current,
        positionDataAvailableRef.current,
        nextRaceNameRef.current,
        lastMeetingNameRef.current,
        w,
        h
      );

      // ── Draw car layer (ghost canvas — comet trails) then composite ────────
      if (shouldDrawCars && boundsRef.current) {
        // Ghost alpha fade must happen at identity (covers full canvas) BEFORE transform
        if (hasTransform) {
          ghostCtx.fillStyle = `rgba(10, 14, 26, ${GHOST_ALPHA})`;
          ghostCtx.fillRect(0, 0, w, h);
          ghostCtx.save();
          ghostCtx.setTransform(zoom, 0, 0, zoom, offX, offY);
        }

        drawCarLayer(
          ghostCtx,
          interpolated,
          boundsRef.current,
          prevFramePositionsRef.current,
          w,
          h,
          hasTransform, // skip fade when transform is active (already applied at identity)
        );

        if (hasTransform) ghostCtx.restore();

        // GUID: PIT_WALL_TRACK_MAP-022-v01
        // [Intent] Draw tracking ring around followed driver on the ghost canvas.
        if (followNum !== null && boundsRef.current) {
          const followed = interpolated.find(p => p.driverNumber === followNum);
          if (followed) {
            const { px, py } = projectToCanvas(followed.x, followed.y, boundsRef.current, w, h);
            // Apply transform manually for the ring position
            const ringX = px * zoom + offX;
            const ringY = py * zoom + offY;
            ghostCtx.beginPath();
            ghostCtx.arc(ringX, ringY, 14 * zoom, 0, Math.PI * 2);
            ghostCtx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            ghostCtx.lineWidth = 1.5;
            ghostCtx.setLineDash([3, 3]);
            ghostCtx.stroke();
            ghostCtx.setLineDash([]);
          }
        }

        // Composite ghost canvas onto main with transform
        if (hasTransform) {
          ctx.save();
          ctx.setTransform(zoom, 0, 0, zoom, offX, offY);
        }
        ctx.drawImage(ghostCanvas, 0, 0);
        if (hasTransform) ctx.restore();
      } else {
        // No cars — clear ghost canvas so stale trails don't persist
        ghostCtx.clearRect(0, 0, w, h);
        prevFramePositionsRef.current.clear();
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // GUID: PIT_WALL_TRACK_MAP-007-v02
  // [Intent] ResizeObserver keeps both canvases in sync with CSS container size.
  //          v02: Also resizes ghost canvas and clears prevFramePositions on resize
  //               (screen-space positions are invalid after resize).
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeCanvases = (width: number, height: number) => {
      const w = Math.floor(width);
      const h = Math.floor(height);
      canvas.width = w;
      canvas.height = h;
      if (ghostCanvasRef.current) {
        ghostCanvasRef.current.width = w;
        ghostCanvasRef.current.height = h;
      }
      // Screen-space positions are stale after resize
      prevFramePositionsRef.current.clear();
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) resizeCanvases(width, height);
      }
    });

    observer.observe(container);

    // Seed initial size
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) resizeCanvases(width, height);

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
