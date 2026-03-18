// GUID: PIT_WALL_TRACK_SPLINE-000-v02
// [Intent] Track spline utilities for snap-to-track interpolation AND circuit outline rendering.
//          Converts the accumulated GPS circuit path into usable data structures.
//
//          Interpolation functions (existing):
//          - buildTrackPolyline: downsamples + computes cumulative distances
//          - projectOntoTrack: finds nearest point on polyline, returns 1D parameter
//          - paramToPoint: converts 1D parameter back to 2D coordinates
//
//          Circuit outline function (v02):
//          - buildCircuitOutline: deduplicates point cloud → nearest-neighbor sort → clean
//            single-lap path suitable for rendering with visible track width and sector colours.
//
// [Inbound Trigger] Called from PitWallTrackMap RAF loop when polyline is available.
// [Downstream Impact] Pure math — no side effects, no DOM, no React state.

import type { CircuitPoint } from '../_types/pit-wall.types';

// GUID: PIT_WALL_TRACK_SPLINE-001-v01
// [Intent] Downsampled polyline with cumulative arc-length distances for 1D projection.
export interface TrackPolyline {
  /** Downsampled 2D points on the circuit centreline */
  points: { x: number; y: number }[];
  /** Cumulative arc-length distance at each point (distances[0] = 0) */
  distances: number[];
  /** Total arc length of the polyline */
  totalLength: number;
}

// GUID: PIT_WALL_TRACK_SPLINE-002-v01
// [Intent] Target number of points after downsampling. 500 gives sub-metre resolution
//          on a ~5km circuit while keeping projectOntoTrack fast (500 segments × 20 cars = 10K ops/frame).
const TARGET_POINTS = 500;

// GUID: PIT_WALL_TRACK_SPLINE-003-v01
// [Intent] Build a downsampled polyline from raw GPS circuit path with cumulative distances.
//          Downsamples by taking every Nth point (N = path.length / TARGET_POINTS).
//          Returns null if path has fewer than 20 points (not enough for a meaningful polyline).
export function buildTrackPolyline(path: CircuitPoint[]): TrackPolyline | null {
  if (path.length < 20) return null;

  // Downsample
  const step = Math.max(1, Math.floor(path.length / TARGET_POINTS));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < path.length; i += step) {
    points.push({ x: path[i].x, y: path[i].y });
  }
  // Always include the last point for a closed-ish loop
  const last = path[path.length - 1];
  if (points.length > 0) {
    const lastPt = points[points.length - 1];
    if (lastPt.x !== last.x || lastPt.y !== last.y) {
      points.push({ x: last.x, y: last.y });
    }
  }

  // Compute cumulative arc-length distances
  const distances: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    distances.push(total);
  }

  if (total === 0) return null;

  return { points, distances, totalLength: total };
}

// GUID: PIT_WALL_TRACK_SPLINE-004-v01
// [Intent] Project a 2D point onto the nearest segment of the polyline.
//          Returns the 1D arc-length parameter [0, totalLength] of the closest point.
//          Uses perpendicular projection onto each segment, clamped to segment endpoints.
export function projectOntoTrack(poly: TrackPolyline, x: number, y: number): number {
  let bestDist = Infinity;
  let bestParam = 0;

  for (let i = 0; i < poly.points.length - 1; i++) {
    const ax = poly.points[i].x;
    const ay = poly.points[i].y;
    const bx = poly.points[i + 1].x;
    const by = poly.points[i + 1].y;

    const abx = bx - ax;
    const aby = by - ay;
    const segLenSq = abx * abx + aby * aby;

    // t = projection of point onto segment, clamped to [0, 1]
    let t = 0;
    if (segLenSq > 0) {
      t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / segLenSq));
    }

    // Closest point on segment
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dx = x - cx;
    const dy = y - cy;
    const dist = dx * dx + dy * dy; // squared — fine for comparison

    if (dist < bestDist) {
      bestDist = dist;
      // Interpolate between cumulative distances at segment endpoints
      bestParam = poly.distances[i] + t * (poly.distances[i + 1] - poly.distances[i]);
    }
  }

  return bestParam;
}

// GUID: PIT_WALL_TRACK_SPLINE-005-v01
// [Intent] Convert a 1D arc-length parameter back to 2D coordinates on the polyline.
//          Uses binary search on cumulative distances for O(log n) lookup.
//          Handles lap wraparound via modulo on totalLength.
export function paramToPoint(poly: TrackPolyline, param: number): { x: number; y: number } {
  // Wrap to [0, totalLength)
  let p = param % poly.totalLength;
  if (p < 0) p += poly.totalLength;

  // Binary search for the segment containing p
  let lo = 0;
  let hi = poly.distances.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (poly.distances[mid] <= p) lo = mid;
    else hi = mid;
  }

  // Interpolate within segment [lo, lo+1]
  const segStart = poly.distances[lo];
  const segEnd = poly.distances[lo + 1] ?? poly.totalLength;
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (p - segStart) / segLen : 0;

  return {
    x: poly.points[lo].x + t * (poly.points[lo + 1].x - poly.points[lo].x),
    y: poly.points[lo].y + t * (poly.points[lo + 1].y - poly.points[lo].y),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CIRCUIT OUTLINE — for visual track rendering (v02)
// ═══════════════════════════════════════════════════════════════════════════════

// GUID: PIT_WALL_TRACK_SPLINE-006-v01
// [Intent] Clean single-lap circuit outline for rendering. Unlike TrackPolyline (which
//          is optimised for interpolation from raw sequential data), CircuitOutline is
//          spatially deduplicated and nearest-neighbor sorted so it forms a coherent
//          closed loop even when built from a jumbled multi-car point cloud.
export interface CircuitOutline {
  points: { x: number; y: number }[];
  distances: number[];
  totalLength: number;
  isClosed: boolean;
}

// GUID: PIT_WALL_TRACK_SPLINE-007-v01
// [Intent] Grid-based spatial deduplication — collapse all points within the same grid
//          cell into a single representative point (the first one encountered).
//          O(n) time. Grid size controls resolution: 10m = ~500 cells for a 5km circuit.
function deduplicateGrid(
  points: { x: number; y: number }[],
  gridSize: number,
): { x: number; y: number }[] {
  const seen = new Set<string>();
  const result: { x: number; y: number }[] = [];
  for (const p of points) {
    const gx = Math.floor(p.x / gridSize);
    const gy = Math.floor(p.y / gridSize);
    const key = `${gx},${gy}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}

// GUID: PIT_WALL_TRACK_SPLINE-008-v01
// [Intent] Nearest-neighbor traversal — reorders a cloud of 2D points into a spatially
//          coherent path by always stepping to the closest unvisited point. This turns a
//          jumbled multi-car point cloud into a single-lap circuit outline.
//          O(n²) but n ≈ 300-600 after dedup so it runs in <1ms.
function nearestNeighborSort(
  points: { x: number; y: number }[],
): { x: number; y: number }[] {
  if (points.length < 3) return [...points];

  const n = points.length;
  const sorted: { x: number; y: number }[] = [];
  const used = new Uint8Array(n); // 0 = unused, 1 = used

  // Start from the point with the smallest x (leftmost) — gives a stable start
  let current = 0;
  for (let i = 1; i < n; i++) {
    if (points[i].x < points[current].x) current = i;
  }

  sorted.push(points[current]);
  used[current] = 1;

  for (let step = 1; step < n; step++) {
    let nearestDistSq = Infinity;
    let nearestIdx = -1;

    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const dx = points[i].x - points[current].x;
      const dy = points[i].y - points[current].y;
      const distSq = dx * dx + dy * dy;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIdx = i;
      }
    }

    if (nearestIdx === -1) break;
    sorted.push(points[nearestIdx]);
    used[nearestIdx] = 1;
    current = nearestIdx;
  }

  return sorted;
}

// GUID: PIT_WALL_TRACK_SPLINE-009-v01
// [Intent] Build a clean circuit outline from the raw accumulated GPS point cloud.
//          Steps: deduplicate on a 10m grid → nearest-neighbor sort → compute distances
//          → detect loop closure. Returns null if insufficient data.
// [Inbound Trigger] Called from PitWallTrackMap when circuitPath changes significantly.
// [Downstream Impact] Used by the track rendering function to draw visible-width sectors.
export function buildCircuitOutline(path: CircuitPoint[]): CircuitOutline | null {
  if (path.length < 30) return null;

  // 1. Grid deduplication — 10m cells
  const deduped = deduplicateGrid(path, 10);
  if (deduped.length < 15) return null;

  // 2. Nearest-neighbor sort into coherent path
  const sorted = nearestNeighborSort(deduped);

  // 3. Compute cumulative arc-length distances
  const distances: number[] = [0];
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dx = sorted[i].x - sorted[i - 1].x;
    const dy = sorted[i].y - sorted[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    distances.push(total);
  }

  if (total === 0) return null;

  // 4. Detect loop closure — last point close to first point
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const closeDx = first.x - last.x;
  const closeDy = first.y - last.y;
  const closeDist = Math.sqrt(closeDx * closeDx + closeDy * closeDy);
  const isClosed = closeDist < 150; // within 150m = circuit loops back

  return { points: sorted, distances, totalLength: total, isClosed };
}
