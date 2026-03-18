// GUID: PIT_WALL_TRACK_SPLINE-000-v01
// [Intent] Track spline utilities for snap-to-track interpolation. Converts the accumulated
//          GPS circuit path into a polyline with cumulative arc-length distances, enabling
//          1D lerp along the track centreline instead of 2D linear lerp that cuts corners.
//
//          Three pure functions:
//          - buildTrackPolyline: downsamples + computes cumulative distances
//          - projectOntoTrack: finds nearest point on polyline, returns 1D parameter
//          - paramToPoint: converts 1D parameter back to 2D screen-space coordinates
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
