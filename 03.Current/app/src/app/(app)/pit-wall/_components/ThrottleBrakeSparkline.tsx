// GUID: PW_THROTTLE_BRAKE_SPARKLINE-000-v01
// [Intent] @FEAT (FEAT-PW-011, 2026-07-27) Inline canvas sparkline showing recent
//          throttle/brake input history for one driver row — replaces the single
//          instantaneous throttle bar. Green trace = throttle (0-100%), red blocks
//          along the baseline = braking. Shows driving style and braking points.
//          History is sample-count based (last MAX_SAMPLES telemetry updates) rather
//          than wall-time based, so it stays meaningful at any data cadence: replay
//          mode updates every ~500ms (rich trace), live mode every 5-60s poll
//          (coarse step trace) — a fixed 10s wall window would hold ≤2 points live.
// [Inbound Trigger] Rendered by PitWallRaceTable CellContent for the 'throttle' column.
// [Downstream Impact] Pure display — reads props, writes nothing. Ring buffer lives in
//          a ref inside the per-row component instance (rows are keyed by driverNumber,
//          so history survives re-renders and sorts, and resets when a row unmounts).

'use client';

import { useEffect, useRef } from 'react';

interface ThrottleBrakeSparklineProps {
  /** Throttle application 0-100, null when telemetry unavailable */
  throttle: number | null;
  /** Brake applied flag, null when telemetry unavailable */
  brake: boolean | null;
}

interface InputSample {
  throttle: number;
  brake: boolean;
}

// GUID: PW_THROTTLE_BRAKE_SPARKLINE-001-v01
// [Intent] Sizing/behaviour constants. MAX_SAMPLES=40 ≈ 20s of replay data at 500ms
//          cadence, or the last ~40 live polls — enough to read braking rhythm without
//          the trace churning. Canvas uses a fixed internal resolution scaled by DPR.
const MAX_SAMPLES = 40;
const CANVAS_W = 56; // CSS px
const CANVAS_H = 14; // CSS px
const BRAKE_BAR_H = 3; // red brake blocks along the baseline

// GUID: PW_THROTTLE_BRAKE_SPARKLINE-002-v01
// [Intent] Draw the dual trace. Latest sample is right-aligned; with < 2 samples the
//          current value renders as a flat line so the cell is never blank mid-session.
function drawSparkline(
  canvas: HTMLCanvasElement,
  samples: InputSample[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // canvas context unavailable (headless/old browser) — silently skip

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const w = CANVAS_W * dpr;
  const h = CANVAS_H * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.clearRect(0, 0, w, h);
  if (samples.length === 0) return;

  const drawList = samples.length === 1 ? [samples[0], samples[0]] : samples;
  const stepX = w / (drawList.length - 1);

  // Brake blocks first (under the throttle trace)
  ctx.fillStyle = 'rgba(239, 68, 68, 0.85)'; // red-500
  for (let i = 0; i < drawList.length; i++) {
    if (!drawList[i].brake) continue;
    const x0 = i === 0 ? 0 : (i - 0.5) * stepX;
    const x1 = i === drawList.length - 1 ? w : (i + 0.5) * stepX;
    ctx.fillRect(x0, h - BRAKE_BAR_H * dpr, x1 - x0, BRAKE_BAR_H * dpr);
  }

  // Throttle trace — green polyline, 0% at the bottom, 100% at the top
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'; // green-500
  ctx.lineWidth = 1 * dpr;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const usableH = h - (BRAKE_BAR_H + 1) * dpr; // keep clear of the brake blocks
  for (let i = 0; i < drawList.length; i++) {
    const pct = Math.min(100, Math.max(0, drawList[i].throttle));
    const x = i * stepX;
    const y = usableH - (pct / 100) * (usableH - 1 * dpr) + 0.5 * dpr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// GUID: PW_THROTTLE_BRAKE_SPARKLINE-003-v01
// [Intent] Component — appends one sample per telemetry change and redraws.
//          When telemetry is entirely absent (both props null and no history yet),
//          renders the same '--' placeholder style as other empty cells.
export function ThrottleBrakeSparkline({ throttle, brake }: ThrottleBrakeSparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<InputSample[]>([]);

  useEffect(() => {
    if (throttle === null && brake === null) return; // no telemetry this update — keep history
    const samples = samplesRef.current;
    samples.push({
      throttle: throttle ?? 0,
      brake: brake ?? false,
    });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    if (canvasRef.current) drawSparkline(canvasRef.current, samples);
  }, [throttle, brake]);

  // Redraw on mount (e.g. after a sort re-parents the canvas element)
  useEffect(() => {
    if (canvasRef.current && samplesRef.current.length > 0) {
      drawSparkline(canvasRef.current, samplesRef.current);
    }
  }, []);

  if (throttle === null && brake === null && samplesRef.current.length === 0) {
    return <span className="font-mono text-xs text-slate-600">--</span>;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: CANVAS_W, height: CANVAS_H }}
      className="block"
      aria-label={`Throttle ${throttle !== null ? Math.round(throttle) : 0}%${brake ? ', braking' : ''}`}
      role="img"
    />
  );
}
