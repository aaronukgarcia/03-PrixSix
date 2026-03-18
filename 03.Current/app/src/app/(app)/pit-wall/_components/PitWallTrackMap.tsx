// GUID: PIT_WALL_TRACK_MAP-000-v06
// [Intent] Canvas-based live track map with clean circuit outline, pastel sector colours,
//          S/F line, and single-dot car rendering. No ghost canvas.
//          v06: Circuit outline built from deduplicated + nearest-neighbor sorted point cloud
//               via buildCircuitOutline(). Track drawn with visible width in 3 pastel sector
//               colours. Cars rendered as clean dots on top.
// [Inbound Trigger] Rendered in the Pit Wall layout. Receives DriverRaceState[] directly from PitWallClient.
// [Downstream Impact] Pure canvas rendering — no state writes, no Firestore reads.

'use client';

import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { DriverRaceState, InterpolatedPosition, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';
import {
  buildTrackPolyline,
  buildCircuitOutline,
  projectOntoTrack,
  paramToPoint,
  type TrackPolyline,
  type CircuitOutline,
} from '../_utils/trackSpline';

// GUID: PIT_WALL_TRACK_MAP-001-v06
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

// ── Constants ────────────────────────────────────────────────────────────────

const CANVAS_PADDING = 32;
const FOLLOW_ZOOM = 3.0;
const FOLLOW_LERP_SPEED = 0.08;

// GUID: PIT_WALL_TRACK_MAP-040-v01
// [Intent] Pastel sector colours for the track surface — soft enough for a dark background,
//          distinct enough to tell sectors apart at a glance.
const SECTOR_STROKE = [
  '#b87070',  // S1 — pastel rose
  '#7090b8',  // S2 — pastel blue
  '#b8a870',  // S3 — pastel gold
];
const SECTOR_LABEL_COLOUR = [
  '#d49090',  // S1 label
  '#90b0d4',  // S2 label
  '#d4c890',  // S3 label
];
const TRACK_WIDTH = 10;
const TRACK_EDGE_ALPHA = 0.06;

// ── Helpers ──────────────────────────────────────────────────────────────────

function projectToCanvas(
  x: number, y: number,
  bounds: TrackBounds, w: number, h: number,
): { px: number; py: number } {
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const usableW = w - CANVAS_PADDING * 2;
  const usableH = h - CANVAS_PADDING * 2;
  return {
    px: ((x - bounds.minX) / rangeX) * usableW + CANVAS_PADDING,
    py: (1 - (y - bounds.minY) / rangeY) * usableH + CANVAS_PADDING,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

// ── Projected outline (canvas-space cache) ───────────────────────────────────

// GUID: PIT_WALL_TRACK_MAP-041-v01
// [Intent] Canvas-space projected circuit outline with sector boundary indices.
//          Rebuilt when outline or canvas size changes — NOT per frame.
interface ProjectedOutline {
  points: { px: number; py: number }[];
  sectorStarts: number[];  // 4 entries: [0, s2Start, s3Start, lastIdx]
  isClosed: boolean;
}

function projectOutline(
  outline: CircuitOutline,
  bounds: TrackBounds,
  w: number, h: number,
): ProjectedOutline {
  const points = outline.points.map(p => projectToCanvas(p.x, p.y, bounds, w, h));

  // Divide into 3 equal-length sectors
  const sectorLen = outline.totalLength / 3;
  const sectorStarts: number[] = [0];
  let sectorIdx = 1;
  for (let i = 1; i < outline.distances.length && sectorIdx < 3; i++) {
    if (outline.distances[i] >= sectorLen * sectorIdx) {
      sectorStarts.push(i);
      sectorIdx++;
    }
  }
  sectorStarts.push(points.length - 1);

  return { points, sectorStarts, isClosed: outline.isClosed };
}

// ── Track drawing ────────────────────────────────────────────────────────────

// GUID: PIT_WALL_TRACK_MAP-042-v01
// [Intent] Draw the circuit as a visible-width track with 3 pastel sector colours,
//          sector boundary marks, sector labels, and a start/finish line.
//          Track is drawn FIRST (before cars) on a fully cleared canvas.
function drawTrack(
  ctx: CanvasRenderingContext2D,
  proj: ProjectedOutline,
) {
  const { points, sectorStarts, isClosed } = proj;
  if (points.length < 2) return;

  // ── 1. Track edge glow (slightly wider, very faint) ────────────────────
  ctx.beginPath();
  ctx.moveTo(points[0].px, points[0].py);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].px, points[i].py);
  }
  if (isClosed) ctx.closePath();
  ctx.strokeStyle = `rgba(255, 255, 255, ${TRACK_EDGE_ALPHA})`;
  ctx.lineWidth = TRACK_WIDTH + 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // ── 2. Track surface per sector (pastel colours) ───────────────────────
  for (let s = 0; s < 3; s++) {
    const start = sectorStarts[s] ?? 0;
    const end = sectorStarts[s + 1] ?? points.length - 1;
    if (start >= points.length) continue;

    ctx.beginPath();
    ctx.moveTo(points[start].px, points[start].py);
    for (let i = start + 1; i <= Math.min(end, points.length - 1); i++) {
      ctx.lineTo(points[i].px, points[i].py);
    }
    // Close the final sector back to start if circuit is closed
    if (s === 2 && isClosed) {
      ctx.lineTo(points[0].px, points[0].py);
    }
    ctx.strokeStyle = SECTOR_STROKE[s];
    ctx.lineWidth = TRACK_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // ── 3. Sector boundary marks + labels ──────────────────────────────────
  for (let s = 1; s < sectorStarts.length - 1; s++) {
    const idx = sectorStarts[s];
    if (idx <= 0 || idx >= points.length - 1) continue;

    const pt = points[idx];
    const prev = points[idx - 1];
    const dx = pt.px - prev.px;
    const dy = pt.py - prev.py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) continue;

    // Perpendicular direction
    const nx = -dy / dist;
    const ny = dx / dist;
    const markLen = 14;

    // White perpendicular tick
    ctx.beginPath();
    ctx.moveTo(pt.px + nx * markLen, pt.py + ny * markLen);
    ctx.lineTo(pt.px - nx * markLen, pt.py - ny * markLen);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Sector label
    ctx.fillStyle = SECTOR_LABEL_COLOUR[s] ?? '#ffffff';
    ctx.font = 'bold 9px "SF Mono", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`S${s + 1}`, pt.px + nx * (markLen + 10), pt.py + ny * (markLen + 10));
  }

  // ── 4. Start / Finish line ─────────────────────────────────────────────
  if (points.length > 2) {
    const sf = points[0];
    const sfNext = points[1];
    const dx = sfNext.px - sf.px;
    const dy = sfNext.py - sf.py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.5) {
      const nx = -dy / dist;
      const ny = dx / dist;
      const sfLen = 16;

      // Chequered-style white bar
      ctx.beginPath();
      ctx.moveTo(sf.px + nx * sfLen, sf.py + ny * sfLen);
      ctx.lineTo(sf.px - nx * sfLen, sf.py - ny * sfLen);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'butt';
      ctx.stroke();

      // S/F label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = 'bold 8px "SF Mono", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S/F', sf.px + nx * (sfLen + 10), sf.py + ny * (sfLen + 10));

      // S1 label on the other side
      ctx.fillStyle = SECTOR_LABEL_COLOUR[0];
      ctx.fillText('S1', sf.px - nx * (sfLen + 10), sf.py - ny * (sfLen + 10));
    }
  }
}

// ── Background drawing ───────────────────────────────────────────────────────

// GUID: PIT_WALL_TRACK_MAP-033-v01
function drawBackground(
  ctx: CanvasRenderingContext2D,
  hasData: boolean,
  rainIntensity: number | null,
  sessionType: string | null,
  hasLiveSession: boolean,
  positionDataAvailable: boolean,
  nextRaceName: string | null,
  lastMeetingName: string | null,
  w: number, h: number,
): boolean {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, w, h);

  // Atmosphere
  const cx = w / 2, cy = h / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.55);
  grad.addColorStop(0, 'rgba(20, 30, 60, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (rainIntensity !== null && rainIntensity > 0) {
    ctx.fillStyle = `rgba(30, 100, 220, ${(rainIntensity / 255) * 0.3})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Session label
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
    }
    return false;
  }
  return true;
}

// ── Car drawing ──────────────────────────────────────────────────────────────

// GUID: PIT_WALL_TRACK_MAP-034-v01
function drawCars(
  ctx: CanvasRenderingContext2D,
  interpolated: InterpolatedPosition[],
  bounds: TrackBounds,
  prevFramePositions: Map<number, { px: number; py: number }>,
  followNum: number | null,
  w: number, h: number,
) {
  const sorted = [...interpolated].sort((a, b) => b.position - a.position);

  for (const pos of sorted) {
    const { px, py } = projectToCanvas(pos.x, pos.y, bounds, w, h);
    const colour = pos.teamColour.startsWith('#') ? pos.teamColour : `#${pos.teamColour}`;
    const rgb = hexToRgb(colour);
    const isLeadGroup = pos.position <= 3;
    const dotRadius = isLeadGroup ? 5.5 : 4.5;

    ctx.globalAlpha = pos.retired ? 0.25 : pos.inPit ? 0.55 : 1.0;

    // ── Motion tail ──────────────────────────────────────────────────────
    const prevPos = prevFramePositions.get(pos.driverNumber);
    if (prevPos && !pos.inPit && !pos.retired) {
      const dx = px - prevPos.px;
      const dy = py - prevPos.py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1.5 && dist < 60) {
        const nx = dx / dist;
        const ny = dy / dist;
        const tailLen = Math.min(dist * 1.2, 16);
        const tailGrad = ctx.createLinearGradient(
          px - nx * tailLen, py - ny * tailLen, px, py,
        );
        tailGrad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        tailGrad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
        ctx.beginPath();
        ctx.moveTo(px - nx * tailLen, py - ny * tailLen);
        ctx.lineTo(px, py);
        ctx.strokeStyle = tailGrad;
        ctx.lineWidth = isLeadGroup ? 2.5 : 2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // ── Glow ─────────────────────────────────────────────────────────────
    if (isLeadGroup) { ctx.shadowBlur = 8; ctx.shadowColor = colour; }

    // ── Pit ring ─────────────────────────────────────────────────────────
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

    // ── Car dot ──────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    // ── DRS ──────────────────────────────────────────────────────────────
    if (pos.hasDrs) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#00ff87';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 3.5, py - dotRadius - 3.5);
      ctx.lineTo(px + 3.5, py - dotRadius - 3.5);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = pos.retired ? 0.25 : pos.inPit ? 0.55 : 1.0;

    // ── Driver code ──────────────────────────────────────────────────────
    ctx.font = 'bold 7px "SF Mono", "Courier New", monospace';
    ctx.fillStyle = colour;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pos.driverCode, px + dotRadius + 3, py + 1);

    // ── P1-P3 badge ──────────────────────────────────────────────────────
    if (isLeadGroup) {
      const bx = px - dotRadius - 7, by = py - dotRadius - 5;
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 6.5px "SF Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pos.position), bx, by + 0.5);
    }

    // ── Follow ring ──────────────────────────────────────────────────────
    if (followNum === pos.driverNumber) {
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    prevFramePositions.set(pos.driverNumber, { px, py });
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ── Main component ───────────────────────────────────────────────────────────

// GUID: PIT_WALL_TRACK_MAP-005-v06
export function PitWallTrackMap({
  drivers, updateIntervalMs, bounds, circuitPath,
  rainIntensity, sessionType, hasLiveSession, positionDataAvailable,
  nextRaceName, lastMeetingName, followDriver, className,
}: PitWallTrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const prevFramePositionsRef = useRef<Map<number, { px: number; py: number }>>(new Map());

  // Follow-mode camera
  const followDriverRef = useRef<number | null>(null);
  const cameraZoomRef = useRef(1);
  const cameraOffsetXRef = useRef(0);
  const cameraOffsetYRef = useRef(0);

  // Mutable refs
  const driversRef = useRef(drivers);
  const updateIntervalMsRef = useRef(updateIntervalMs);
  const boundsRef = useRef(bounds);
  const circuitPathRef = useRef(circuitPath);
  const rainRef = useRef(rainIntensity);
  const sessionTypeRef = useRef(sessionType);
  const hasLiveSessionRef = useRef(hasLiveSession);
  const posDataRef = useRef(positionDataAvailable);
  const nextRaceRef = useRef(nextRaceName);
  const lastMeetingRef = useRef(lastMeetingName);

  driversRef.current = drivers;
  updateIntervalMsRef.current = updateIntervalMs;
  boundsRef.current = bounds;
  circuitPathRef.current = circuitPath;
  rainRef.current = rainIntensity;
  sessionTypeRef.current = sessionType;
  hasLiveSessionRef.current = hasLiveSession;
  posDataRef.current = positionDataAvailable;
  nextRaceRef.current = nextRaceName;
  lastMeetingRef.current = lastMeetingName;
  followDriverRef.current = followDriver;

  // GUID: PIT_WALL_TRACK_MAP-018-v02
  // [Intent] Track polyline for snap-to-track interpolation (kept from v04).
  const trackPolylineRef = useRef<TrackPolyline | null>(null);
  const lastPolylineLenRef = useRef(0);

  // GUID: PIT_WALL_TRACK_MAP-043-v01
  // [Intent] Circuit outline for visual rendering — built from deduplicated + sorted points.
  //          Separate from the interpolation polyline because it uses a different algorithm
  //          (nearest-neighbor sort vs raw sequential downsample).
  const circuitOutlineRef = useRef<CircuitOutline | null>(null);
  const lastOutlineLenRef = useRef(0);
  const projectedOutlineRef = useRef<ProjectedOutline | null>(null);

  useEffect(() => {
    const pathLen = circuitPath.length;
    if (pathLen < 30) return;

    // Rebuild polyline (for interpolation)
    if (pathLen - lastPolylineLenRef.current >= 50 || !trackPolylineRef.current) {
      trackPolylineRef.current = buildTrackPolyline(circuitPath);
      lastPolylineLenRef.current = pathLen;
    }

    // Rebuild circuit outline (for rendering) — less frequently
    if (pathLen - lastOutlineLenRef.current >= 80 || !circuitOutlineRef.current) {
      circuitOutlineRef.current = buildCircuitOutline(circuitPath);
      lastOutlineLenRef.current = pathLen;
      projectedOutlineRef.current = null; // invalidate projected cache
    }
  }, [circuitPath]);

  // Interpolation refs
  const prevPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const nextPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const snapshotTimestampRef = useRef<number>(Date.now());

  useEffect(() => {
    const prev = new Map<number, { x: number; y: number }>();
    drivers.forEach(d => {
      const current = nextPositionsRef.current.get(d.driverNumber);
      if (current) prev.set(d.driverNumber, current);
      else if (d.x !== null && d.y !== null) prev.set(d.driverNumber, { x: d.x, y: d.y });
    });
    prevPositionsRef.current = prev;

    const next = new Map<number, { x: number; y: number }>();
    drivers.forEach(d => {
      if (d.x !== null && d.y !== null) next.set(d.driverNumber, { x: d.x, y: d.y });
      else {
        const last = prevPositionsRef.current.get(d.driverNumber);
        if (last) next.set(d.driverNumber, last);
      }
    });
    nextPositionsRef.current = next;
    snapshotTimestampRef.current = Date.now();
  }, [drivers]);

  // GUID: PIT_WALL_TRACK_MAP-006-v06
  // [Intent] Single RAF draw loop. Order: background → track → cars.
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

      const now = Date.now();
      const elapsed = now - snapshotTimestampRef.current;
      const t = Math.min(1, elapsed / (updateIntervalMsRef.current || 60000));
      const currentDrivers = driversRef.current;
      const poly = trackPolylineRef.current;

      // Interpolate positions
      // GUID: PIT_WALL_TRACK_MAP-044-v01
      // [Intent] Snap threshold — if prev and next positions are more than 500m apart,
      //          snap directly to next instead of lerping. Prevents the fly-in bug where
      //          a car appears at a stale position and visually flies across the track.
      const SNAP_DISTANCE_SQ = 500 * 500; // 500m squared

      const interpolated: InterpolatedPosition[] = currentDrivers
        .filter(d => nextPositionsRef.current.has(d.driverNumber))
        .map(d => {
          const prev = prevPositionsRef.current.get(d.driverNumber);
          const next = nextPositionsRef.current.get(d.driverNumber)!;
          let x: number, y: number;

          // Check if prev→next distance is too large (stale position, seek, or first appearance)
          const shouldSnap = !prev || (() => {
            const dx = next.x - prev.x;
            const dy = next.y - prev.y;
            return dx * dx + dy * dy > SNAP_DISTANCE_SQ;
          })();

          if (shouldSnap) {
            x = next.x;
            y = next.y;
          } else if (poly) {
            const prevParam = projectOntoTrack(poly, prev!.x, prev!.y);
            let nextParam = projectOntoTrack(poly, next.x, next.y);
            if (prevParam - nextParam > poly.totalLength * 0.5) nextParam += poly.totalLength;
            else if (nextParam - prevParam > poly.totalLength * 0.5) nextParam -= poly.totalLength;
            const pt = paramToPoint(poly, lerp(prevParam, nextParam, t));
            x = pt.x; y = pt.y;
          } else {
            x = lerp(prev!.x, next.x, t);
            y = lerp(prev!.y, next.y, t);
          }

          return {
            driverNumber: d.driverNumber, x, y,
            teamColour: d.teamColour, driverCode: d.driverCode,
            position: d.position, hasDrs: d.hasDrs,
            retired: d.retired, inPit: d.inPit,
          };
        });

      const w = canvas.width, h = canvas.height;
      const hasData = interpolated.length > 0;

      // Camera
      let targetZoom = 1, targetOffX = 0, targetOffY = 0;
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
      cameraZoomRef.current += (targetZoom - cameraZoomRef.current) * FOLLOW_LERP_SPEED;
      cameraOffsetXRef.current += (targetOffX - cameraOffsetXRef.current) * FOLLOW_LERP_SPEED;
      cameraOffsetYRef.current += (targetOffY - cameraOffsetYRef.current) * FOLLOW_LERP_SPEED;
      if (Math.abs(cameraZoomRef.current - targetZoom) < 0.005) cameraZoomRef.current = targetZoom;

      const zoom = cameraZoomRef.current;
      const offX = cameraOffsetXRef.current;
      const offY = cameraOffsetYRef.current;
      const hasTransform = zoom !== 1 || offX !== 0 || offY !== 0;

      // ── 1. Background ─────────────────────────────────────────────────────
      const shouldDraw = drawBackground(
        ctx, hasData, rainRef.current, sessionTypeRef.current,
        hasLiveSessionRef.current, posDataRef.current,
        nextRaceRef.current, lastMeetingRef.current, w, h,
      );

      if (shouldDraw && boundsRef.current) {
        if (hasTransform) {
          ctx.save();
          ctx.translate(offX, offY);
          ctx.scale(zoom, zoom);
        }

        // ── 2. Build/cache projected outline ─────────────────────────────────
        if (!projectedOutlineRef.current && circuitOutlineRef.current && boundsRef.current) {
          projectedOutlineRef.current = projectOutline(
            circuitOutlineRef.current, boundsRef.current, w, h,
          );
        }

        // ── 3. Draw track ────────────────────────────────────────────────────
        if (projectedOutlineRef.current) {
          drawTrack(ctx, projectedOutlineRef.current);
        }

        // ── 4. Draw cars ─────────────────────────────────────────────────────
        drawCars(
          ctx, interpolated, boundsRef.current,
          prevFramePositionsRef.current, followNum, w, h,
        );

        if (hasTransform) ctx.restore();
      } else {
        prevFramePositionsRef.current.clear();
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = (width: number, height: number) => {
      canvas.width = Math.floor(width);
      canvas.height = Math.floor(height);
      prevFramePositionsRef.current.clear();
      projectedOutlineRef.current = null;
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) resize(width, height);
      }
    });
    observer.observe(container);

    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) resize(width, height);

    return () => observer.disconnect();
  }, []);

  // Start/stop RAF
  useEffect(() => {
    startLoop();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
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
