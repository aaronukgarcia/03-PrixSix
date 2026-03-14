// GUID: PIT_WALL_LOADING-000-v01
// [Intent] Full-screen loading overlay shown on first Pit Wall mount while
//          /api/pit-wall/live-data is fetching all 10 OpenF1 endpoints.
//          Animates through the 10 data types at ~400ms/step (≈4s for a typical
//          cold load). Progress caps at 92% until real data arrives, then jumps
//          to 100% and fades out. Shows on initial load only — not on subsequent
//          background polls.
// [Inbound Trigger] Rendered by PitWallClient when isLoading && no drivers yet.
// [Downstream Impact] Pure visual overlay — no data fetching. Disappears
//                     automatically when the first successful fetch completes.

'use client';

import { useEffect, useRef, useState } from 'react';
import { TowerControl } from 'lucide-react';
import { cn } from '@/lib/utils';

// GUID: PIT_WALL_LOADING-001-v01
// [Intent] The 10 labels mirror the 10 OpenF1 endpoints fanned out in
//          /api/pit-wall/live-data — in the same order they appear in the
//          Promise.all call. Each label is shown for one interval tick.
const LOADING_STEPS = [
  'Authenticating with live feed',
  'Connecting to OpenF1 session',
  'Loading driver roster',
  'Loading car positions',
  'Loading lap times',
  'Loading tyre stints',
  'Loading car telemetry',
  'Loading FIA race control',
  'Loading weather data',
  'Loading team radio',
] as const;

// Advance one step every 400ms → fills ~4s before hitting the soft cap.
// Typical cold API call is 2–5s; this keeps the labels moving naturally.
const STEP_INTERVAL_MS = 400;

// Maximum progress shown while still waiting for real data.
// The last 8% is reserved for the moment data actually arrives.
const SOFT_CAP_PCT = 92;

// GUID: PIT_WALL_LOADING-002-v01
interface PitWallLoadingScreenProps {
  /** True while the first API fetch is in-flight (isLoading && no drivers yet). */
  isLoading: boolean;
}

// GUID: PIT_WALL_LOADING-003-v01
// [Intent] Loading screen component — animated progress bar + step labels.
export function PitWallLoadingScreen({ isLoading }: PitWallLoadingScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [complete, setComplete] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Keep a ref so the setInterval callback can read the latest isLoading
  // without being re-created on every render.
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  // GUID: PIT_WALL_LOADING-004-v01
  // [Intent] Advance step labels on a fixed interval, capping at SOFT_CAP_PCT
  //          while still waiting for the API. Runs once on mount — intentionally
  //          no deps to avoid restart mid-animation.
  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex(prev => {
        // Hold at the second-to-last step so "Loading team radio" stays visible
        // until data actually arrives and flips the last step label to "Ready".
        const next = Math.min(prev + 1, LOADING_STEPS.length - 2);
        const pct = Math.round(((next + 1) / LOADING_STEPS.length) * SOFT_CAP_PCT);
        setProgress(pct);
        return next;
      });
    }, STEP_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GUID: PIT_WALL_LOADING-005-v01
  // [Intent] React to real data arriving — complete the bar, then fade out.
  useEffect(() => {
    if (!isLoading && !complete) {
      setStepIndex(LOADING_STEPS.length - 1);
      setProgress(100);
      setComplete(true);
      // Allow the CSS opacity transition (700ms) to finish before unmounting.
      const t = setTimeout(() => setHidden(true), 750);
      return () => clearTimeout(t);
    }
  }, [isLoading, complete]);

  if (hidden) return null;

  const stepLabel = LOADING_STEPS[stepIndex];

  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950',
        'transition-opacity duration-700',
        complete ? 'opacity-0 pointer-events-none' : 'opacity-100',
      )}
    >
      <div className="flex flex-col items-center gap-5 w-72">

        {/* ── Icon + title ── */}
        <div className="flex items-center gap-2.5">
          <TowerControl className="w-5 h-5 text-orange-500" />
          <span className="text-xs font-bold tracking-[0.35em] uppercase text-slate-200">
            Pit Wall
          </span>
        </div>

        {/* ── Current step label ── */}
        <p
          key={stepIndex}
          className="text-xs text-slate-400 h-4 text-center animate-in fade-in duration-300"
        >
          {stepLabel}…
        </p>

        {/* ── Progress bar ── */}
        <div className="w-full">
          <div className="w-full h-[3px] bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Percentage + completion label */}
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] font-mono tabular-nums text-slate-600">
              {progress}%
            </span>
            {complete ? (
              <span className="text-[10px] text-orange-400 tracking-wider uppercase">
                All systems live
              </span>
            ) : (
              <span className="text-[10px] text-slate-700 tabular-nums">
                {LOADING_STEPS.length - stepIndex - 1} streams pending
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
