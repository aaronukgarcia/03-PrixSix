// GUID: PIT_WALL_TRACK_MAP-000-v05
// [Intent] Canvas-based live track map with proper circuit rendering, sector markings, and
//          clean single-dot car positions. No ghost canvas — eliminated in v05 to fix the
//          multiple-circle rendering artefact. Single canvas, single RAF loop.
//          v05: Complete rendering rewrite — track drawn with visible width (12px surface),
//               3 sector segments with distinct colors, sector boundary marks, start/finish
//               line, and clean car dots without ghosting. Follow-mode camera preserved.
// [Inbound Trigger] Rendered in the Pit Wall layout. Receives DriverRaceState[] directly from PitWallClient.
// [Downstream Impact] Pure canvas rendering — no state writes, no Firestore reads.

'use client';

import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { DriverRaceState, InterpolatedPosition, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';
import { buildTrackPolyline, projectOntoTrack, paramToPoint, type TrackPolyline } from '../_utils/trackSpline';

// GUID: PIT_WALL_TRACK_MAP-001-v05
// [Intent] Props for the PitWallTrackMap component.
//          v05: Unchanged from v04.
interface PitWallTrackMapProps {
  drivers: DriverRaceState[];
  updateIntervalMs: number;
  bounds: TrackBounds | null;
  circuitPath: CircuitPoint[];
  circuitLat: number | null;
  circuitLon: number | null;
  rainIntensity: number | null;
  sessionType: string | null;
  hasLiveSession: boolean;
  positionDataAvailable: boolean;
  nextRaceName: string | null;
  lastMeetingName: string | null;
  followDriver: number | null;
  className?: string;
}

// GUID: PIT_WALL_TRACK_MAP-002-v02
const CANVAS_PADDING = 32;

// GUID: PIT_WALL_TRACK_MAP-003-v01
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
  const py = (1 - (y - bounds.minY) / rangeY) * usableH + CANVAS_PADDING;
  return { px, py };
}

// GUID: PIT_WALL_TRACK_MAP-010-v01
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// GUID: PIT_WALL_TRACK_MAP-019-v01
const FOLLOW_ZOOM = 3.0;
const FOLLOW_LERP_SPEED = 0.08;

// GUID: PIT_WALL_TRACK_MAP-030-v01
// [Intent] Track rendering constants — width, sector colours, and marker sizes.
const TRACK_WIDTH = 12;          // px — visible track surface width
const TRACK_EDGE_WIDTH = 14;     // px — outer edge (slightly wider than surface for kerb effect)
const SECTOR_COLOURS = [
  '#c53030',  // S1 — red
  '#2b6cb0',  // S2 — blue
  '#d69e2e',  // S3 — yellow
];
const SECTOR_TRACK_FILLS = [
  'rgba(197, 48, 48, 0.12)',   // S1 tint
  'rgba(43, 108, 176, 0.12)',  // S2 tint
  'rgba(214, 158, 46, 0.12)',  // S3 tint
];
const SECTOR_BOUNDARY_LEN = 18; // px — perpendicular mark length either side of centre

// GUID: PIT_WALL_TRACK_MAP-014-v01
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

// GUID: PIT_WALL_TRACK_MAP-031-v01
// [Intent] Pre-compute projected polyline points in canvas pixel space.
//          Called once per bounds/canvas size change, not per frame.
interface ProjectedTrack {
  /** Canvas-space points for the full polyline */
  points: { px: number; py: number }[];
  /** Cumulative pixel distances */
  distances: number[];
  /** Total pixel arc length */
  totalLength: number;
  /** Sector boundary indices — sector i runs from sectorStarts[i] to sectorStarts[i+1] */
  sectorStarts: number[];
}

function projectTrackPolyline(
  poly: TrackPolyline,
  bounds: TrackBounds,
  w: number,
  h: number,
): ProjectedTrack {
  const points: { px: number; py: number }[] = [];
  const distances: number[] = [0];
  let total = 0;

  for (let i = 0; i < poly.points.length; i++) {
    const { px, py } = projectToCanvas(poly.points[i].x, poly.points[i].y, bounds, w, h);
    points.push({ px, py });
    if (i > 0) {
      const dx = px - points[i - 1].px;
      const dy = py - points[i - 1].py;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    distances.push(total);
  }

  // Compute 3 sector start indices (equal arc-length thirds)
  const sectorLen = total / 3;
  const sectorStarts: number[] = [0];
  let sectorIdx = 1;
  for (let i = 1; i < distances.length && sectorIdx < 3; i++) {
    if (distances[i] >= sectorLen * sectorIdx) {
      sectorStarts.push(i);
      sectorIdx++;
    }
  }
  sectorStarts.push(points.length - 1);

  return { points, distances, totalLength: total, sectorStarts };
}

// GUID: PIT_WALL_TRACK_MAP-032-v01
// [Intent] Draw the track surface with visible width, 3 sector colours, edge kerbs,
//          sector boundary marks, start/finish line, and sector labels.
//          Uses pre-projected pixel coordinates for performance.
function drawTrack(
  ctx: CanvasRenderingContext2D,
  projected: ProjectedTrack,
  w: number,
  h: number,
) {
  const { points, sectorStarts } = projected;
  if (points.length < 2) return;

  // ── 1. Track edge (dark outer line — kerb effect) ──────────────────────
  ctx.beginPath();
  ctx.moveTo(points[0].px, points[0].py);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].px, points[i].py);
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = TRACK_EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // ── 2. Track surface per sector (coloured tint) ────────────────────────
  for (let s = 0; s < 3; s++) {
    const start = sectorStarts[s] ?? 0;
    const end = sectorStarts[s + 1] ?? points.length - 1;
    if (start >= points.length || end >= points.length) continue;

    ctx.beginPath();
    ctx.moveTo(points[start].px, points[start].py);
    for (let i = start + 1; i <= end; i++) {
      ctx.lineTo(points[i].px, points[i].py);
    }
    ctx.strokeStyle = SECTOR_TRACK_FILLS[s];
    ctx.lineWidth = TRACK_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // ── 3. Track centreline (dashed) ───────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(points[0].px, points[0].py);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].px, points[i].py);
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── 4. Sector boundary marks + labels ──────────────────────────────────
  for (let s = 1; s < sectorStarts.length - 1; s++) {
    const idx = sectorStarts[s];
    if (idx <= 0 || idx >= points.length - 1) continue;

    const pt = points[idx];
    const prev = points[idx - 1];
    // Direction along track
    const dx = pt.px - prev.px;
    const dy = pt.py - prev.py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.1) continue;

    // Perpendicular
    const nx = -dy / dist;
    const ny = dx / dist;

    // Draw perpendicular marker
    ctx.beginPath();
    ctx.moveTo(pt.px + nx * SECTOR_BOUNDARY_LEN, pt.py + ny * SECTOR_BOUNDARY_LEN);
    ctx.lineTo(pt.px - nx * SECTOR_BOUNDARY_LEN, pt.py - ny * SECTOR_BOUNDARY_LEN);
    ctx.strokeStyle = SECTOR_COLOURS[s] ?? '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Sector label (on the outer side)
    ctx.fillStyle = SECTOR_COLOURS[s] ?? '#ffffff';
    ctx.font = 'bold 9px "SF Mono", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelOffset = SECTOR_BOUNDARY_LEN + 10;
    ctx.fillText(`S${s + 1}`, pt.px + nx * labelOffset, pt.py + ny * labelOffset);
  }

  // ── 5. Start/finish line ───────────────────────────────────────────────
  if (points.length > 1) {
    const sf = points[0];
    const sfNext = points[1];
    const dx = sfNext.px - sf.px;
    const dy = sfNext.py - sf.py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.1) {
      const nx = -dy / dist;
      const ny = dx / dist;

      // Chequered-style mark
      ctx.beginPath();
      ctx.moveTo(sf.px + nx * (SECTOR_BOUNDARY_LEN + 2), sf.py + ny * (SECTOR_BOUNDARY_LEN + 2));
      ctx.lineTo(sf.px - nx * (SECTOR_BOUNDARY_LEN + 2), sf.py - ny * (SECTOR_BOUNDARY_LEN + 2));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'butt';
      ctx.stroke();

      // S/F label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = 'bold 8px "SF Mono", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelOffset = SECTOR_BOUNDARY_LEN + 14;
      ctx.fillText('S/F', sf.px + nx * labelOffset, sf.py + ny * labelOffset);

      // S1 label near start
      ctx.fillStyle = SECTOR_COLOURS[0];
      ctx.fillText('S1', sf.px - nx * labelOffset, sf.py - ny * labelOffset);
    }
  }
}

// GUID: PIT_WALL_TRACK_MAP-033-v01
// [Intent] Draw background, rain overlay, session label, and no-data states.
//          Returns true if the caller should proceed to draw track + cars.
function drawBackground(
  ctx: CanvasRenderingContext2D,
  hasData: boolean,
  rainIntensity: number | null,
  sessionType: string | null,
  hasLiveSession: boolean,
  positionDataAvailable: boolean,
  nextRaceName: string | null,
  lastMeetingName: string | null,
  w: number,
  h: number,
): boolean {
  // Background
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  // Atmosphere
  const cx = w / 2;
  const cy = h / 2;
  const gradRadius = Math.min(w, h) * 0.55;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, gradRadius);
  gradient.addColorStop(0, 'rgba(20, 30, 60, 0.35)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Rain
  if (rainIntensity !== null && rainIntensity > 0) {
    const rainAlpha = (rainIntensity / 255) * 0.35;
    ctx.fillStyle = `rgba(30, 100, 220, ${rainAlpha})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Session label (top-left)
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '9px "SF Mono", "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(sessionType ?? (hasLiveSession ? 'SESSION' : 'BETWEEN SESSIONS'), 8, 8);

  if (!hasData) {
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
      ctx.fillText('timing data active \u2014 map loading', w / 2, h / 2 + 8);
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

  return true;
}

// GUID: PIT_WALL_TRACK_MAP-034-v01
// [Intent] Draw cars as clean single dots with team colour, driver code labels,
//          position badges for P1-P3, DRS indicator, and pit dashed ring.
//          No ghost canvas, no comet trails. One dot per driver.
//          Uses a short gradient tail from previous frame position for motion indication.
function drawCars(
  ctx: CanvasRenderingContext2D,
  interpolated: InterpolatedPosition[],
  bounds: TrackBounds,
  prevFramePositions: Map<number, { px: number; py: number }>,
  followNum: number | null,
  w: number,
  h: number,
) {
  // Sort by position for Z-ordering (P1 drawn last = on top)
  const sorted = [...interpolated].sort((a, b) => b.position - a.position);

  for (const pos of sorted) {
    const { px, py } = projectToCanvas(pos.x, pos.y, bounds, w, h);
    const colour = pos.teamColour.startsWith('#') ? pos.teamColour : `#${pos.teamColour}`;
    const rgb = hexToRgb(colour);
    const isLeadGroup = pos.position <= 3;
    const dotRadius = isLeadGroup ? 6 : 5;

    // Alpha based on state
    ctx.globalAlpha = pos.retired ? 0.25 : pos.inPit ? 0.55 : 1.0;

    // ── Motion tail — short gradient line from previous position ─────────
    const prevPos = prevFramePositions.get(pos.driverNumber);
    if (prevPos && !pos.inPit && !pos.retired) {
      const dx = px - prevPos.px;
      const dy = py - prevPos.py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1.5 && dist < 80) {
        const nx = dx / dist;
        const ny = dy / dist;
        const tailLen = Math.min(dist * 1.5, 20);
        const tailX = px - nx * tailLen;
        const tailY = py - ny * tailLen;

        const tailGrad = ctx.createLinearGradient(tailX, tailY, px, py);
        tailGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        tailGrad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`);

        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(px, py);
        ctx.strokeStyle = tailGrad;
        ctx.lineWidth = isLeadGroup ? 3 : 2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // ── Glow for lead group ──────────────────────────────────────────────
    if (isLeadGroup) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = colour;
    }

    // ── Pit dashed circle ────────────────────────────────────────────────
    if (pos.inPit) {
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(px, py, dotRadius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Car dot (single, clean) ──────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    // ── DRS indicator ────────────────────────────────────────────────────
    if (pos.hasDrs) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#00ff87';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 4, py - dotRadius - 4);
      ctx.lineTo(px + 4, py - dotRadius - 4);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = pos.retired ? 0.25 : pos.inPit ? 0.55 : 1.0;

    // ── Driver code label ────────────────────────────────────────────────
    ctx.font = 'bold 8px "SF Mono", "Courier New", monospace';
    ctx.fillStyle = colour;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pos.driverCode, px + dotRadius + 3, py + 1);

    // ── Position badge for P1-P3 ─────────────────────────────────────────
    if (isLeadGroup) {
      const badgeCx = px - dotRadius - 8;
      const badgeCy = py - dotRadius - 6;
      const badgeR = 7;

      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.font = 'bold 7px "SF Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pos.position), badgeCx, badgeCy + 0.5);
    }

    // ── Follow-mode tracking ring ────────────────────────────────────────
    if (followNum === pos.driverNumber) {
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Store current screen position for next frame's tail calculation
    prevFramePositions.set(pos.driverNumber, { px, py });

    // Reset
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// GUID: PIT_WALL_TRACK_MAP-005-v05
// [Intent] Main PitWallTrackMap component — single canvas, no ghost canvas.
//          v05: Complete rendering rewrite. Track drawn with visible width + 3 sectors.
//               Cars drawn as clean single dots. Ghost canvas eliminated.
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

  // GUID: PIT_WALL_TRACK_MAP-035-v01
  // [Intent] Screen-space previous frame positions for motion tail calculation.
  //          Replaces the ghost canvas fade approach.
  const prevFramePositionsRef = useRef<Map<number, { px: number; py: number }>>(new Map());

  // GUID: PIT_WALL_TRACK_MAP-036-v01
  // [Intent] Pre-computed projected track for fast per-frame drawing.
  //          Rebuilt when polyline or canvas size changes (not per frame).
  const projectedTrackRef = useRef<ProjectedTrack | null>(null);

  // Follow-mode camera state
  const followDriverRef = useRef<number | null>(null);
  const cameraZoomRef = useRef(1);
  const cameraOffsetXRef = useRef(0);
  const cameraOffsetYRef = useRef(0);

  // Mutable refs so RAF callback always sees current data
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
  const trackPolylineRef = useRef<TrackPolyline | null>(null);
  const lastPolylineLengthRef = useRef<number>(0);

  useEffect(() => {
    const pathLen = circuitPath.length;
    if (pathLen < 20) return;
    if (pathLen - lastPolylineLengthRef.current < 50 && trackPolylineRef.current) return;
    trackPolylineRef.current = buildTrackPolyline(circuitPath);
    lastPolylineLengthRef.current = pathLen;
    // Invalidate projected track so it gets rebuilt next frame
    projectedTrackRef.current = null;
  }, [circuitPath]);

  // Interpolation refs
  const prevPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const nextPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const snapshotTimestampRef = useRef<number>(Date.now());

  // GUID: PIT_WALL_TRACK_MAP-009-v01
  useEffect(() => {
    const prev = new Map<number, { x: number; y: number }>();
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
        const last = prevPositionsRef.current.get(d.driverNumber);
        if (last) next.set(d.driverNumber, last);
      }
    });
    nextPositionsRef.current = next;
    snapshotTimestampRef.current = Date.now();
  }, [drivers]);

  // Canvas size ref for projected track cache invalidation
  const canvasSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // GUID: PIT_WALL_TRACK_MAP-006-v05
  // [Intent] Single RAF draw loop — interpolates positions, draws track + cars on one canvas.
  //          v05: No ghost canvas. Full clear + redraw each frame.
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // ── Interpolate positions ──────────────────────────────────────────────
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
            const prevParam = projectOntoTrack(poly, prev.x, prev.y);
            let nextParam = projectOntoTrack(poly, next.x, next.y);

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
            x = prev ? lerp(prev.x, next.x, t) : next.x;
            y = prev ? lerp(prev.y, next.y, t) : next.y;
          }

          return {
            driverNumber: d.driverNumber,
            x, y,
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
      const hasData = interpolated.length > 0;

      // ── Follow-mode camera lerp ────────────────────────────────────────────
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
      if (Math.abs(cameraZoomRef.current - targetZoom) < 0.005) cameraZoomRef.current = targetZoom;

      const zoom = cameraZoomRef.current;
      const offX = cameraOffsetXRef.current;
      const offY = cameraOffsetYRef.current;
      const hasTransform = zoom !== 1 || offX !== 0 || offY !== 0;

      // ── Draw background (always — handles no-data states too) ──────────────
      const shouldDraw = drawBackground(
        ctx,
        hasData,
        rainRef.current,
        sessionTypeRef.current,
        hasLiveSessionRef.current,
        positionDataAvailableRef.current,
        nextRaceNameRef.current,
        lastMeetingNameRef.current,
        w, h,
      );

      if (shouldDraw && boundsRef.current) {
        // Apply camera transform
        if (hasTransform) {
          ctx.save();
          ctx.translate(offX, offY);
          ctx.scale(zoom, zoom);
        }

        // ── Rebuild projected track if invalidated ───────────────────────────
        if (
          !projectedTrackRef.current &&
          poly &&
          boundsRef.current
        ) {
          projectedTrackRef.current = projectTrackPolyline(poly, boundsRef.current, w, h);
        }

        // ── Draw track (with width + sectors) ────────────────────────────────
        if (projectedTrackRef.current) {
          drawTrack(ctx, projectedTrackRef.current, w, h);
        } else if (circuitPathRef.current.length >= 20) {
          // Fallback: raw circuit path as simple thick line (pre-polyline)
          ctx.beginPath();
          let first = true;
          for (const pt of circuitPathRef.current) {
            const { px, py } = projectToCanvas(pt.x, pt.y, boundsRef.current!, w, h);
            if (first) { ctx.moveTo(px, py); first = false; }
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = TRACK_WIDTH;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // ── Draw cars ────────────────────────────────────────────────────────
        drawCars(
          ctx,
          interpolated,
          boundsRef.current,
          prevFramePositionsRef.current,
          followNum,
          w, h,
        );

        if (hasTransform) {
          ctx.restore();
        }
      } else if (!shouldDraw) {
        // No data — clear stale frame positions
        prevFramePositionsRef.current.clear();
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // GUID: PIT_WALL_TRACK_MAP-007-v03
  // [Intent] ResizeObserver keeps canvas in sync with CSS container size.
  //          v03: No ghost canvas to resize. Invalidates projected track cache on resize.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeCanvas = (width: number, height: number) => {
      const w = Math.floor(width);
      const h = Math.floor(height);
      canvas.width = w;
      canvas.height = h;
      canvasSizeRef.current = { w, h };
      // Invalidate caches
      prevFramePositionsRef.current.clear();
      projectedTrackRef.current = null;
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) resizeCanvas(width, height);
      }
    });

    observer.observe(container);

    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) resizeCanvas(width, height);

    return () => observer.disconnect();
  }, []);

  // GUID: PIT_WALL_TRACK_MAP-008-v01
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
