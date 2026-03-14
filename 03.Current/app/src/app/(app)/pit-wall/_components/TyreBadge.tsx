// GUID: TYRE_BADGE-000-v01
// [Intent] F1-standard tyre compound badge with wear indicator arc.
// [Inbound Trigger] Used by PitWallRaceTable tyre column.
// [Downstream Impact] Visual-only — no state side-effects.

'use client';

import { useMemo } from 'react';
import type { TyreCompound } from '../_types/pit-wall.types';

// GUID: TYRE_BADGE-001-v01
// [Intent] Props for the TyreBadge component.
interface TyreBadgeProps {
  compound: TyreCompound;
  lapAge: number;
  maxLapAge?: number;
  size?: 'sm' | 'md';
}

// GUID: TYRE_BADGE-002-v01
// [Intent] F1 standard compound colour map and letter abbreviation map.
const COMPOUND_CONFIG: Record<
  TyreCompound,
  { bg: string; text: string; letter: string }
> = {
  SOFT:         { bg: '#e8002d', text: 'white',       letter: 'S' },
  MEDIUM:       { bg: '#ffd700', text: 'white',       letter: 'M' },
  HARD:         { bg: '#f0f0f0', text: '#1f2937',     letter: 'H' },
  INTERMEDIATE: { bg: '#39b54a', text: 'white',       letter: 'I' },
  WET:          { bg: '#0067ff', text: 'white',       letter: 'W' },
  UNKNOWN:      { bg: '#6b7280', text: 'white',       letter: '?' },
};

// GUID: TYRE_BADGE-003-v01
// [Intent] SVG wear arc — full circle at 0 laps, shrinking arc as laps increase.
interface WearArcProps {
  wearFraction: number; // 0 = new, 1 = fully worn
  colour: string;
  radius: number;
  cx: number;
  cy: number;
  strokeWidth: number;
}

function WearArc({ wearFraction, colour, radius, cx, cy, strokeWidth }: WearArcProps) {
  const circumference = 2 * Math.PI * radius;
  // remainingFraction = 1 - wearFraction (full arc when new, empty when worn)
  const remainingFraction = Math.max(0, 1 - wearFraction);
  const dashArray = circumference * remainingFraction;
  const dashOffset = 0;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill="none"
      stroke={colour}
      strokeWidth={strokeWidth}
      strokeOpacity={0.6}
      strokeDasharray={`${dashArray} ${circumference}`}
      strokeDashoffset={dashOffset}
      strokeLinecap="round"
      // Start arc from top (12 o'clock)
      transform={`rotate(-90, ${cx}, ${cy})`}
    />
  );
}

// GUID: TYRE_BADGE-004-v01
// [Intent] Main TyreBadge component — circular badge with compound letter,
//          opacity fade based on wear, and SVG wear arc overlay.
export function TyreBadge({
  compound,
  lapAge,
  maxLapAge = 40,
  size = 'md',
}: TyreBadgeProps) {
  const config = COMPOUND_CONFIG[compound] ?? COMPOUND_CONFIG.UNKNOWN;

  const wearFraction = useMemo(
    () => Math.min(1, Math.max(0, lapAge / maxLapAge)),
    [lapAge, maxLapAge]
  );

  // Opacity: 1.0 when new → 0.5 when fully worn
  const opacity = 1.0 - wearFraction * 0.5;

  const sizeClasses = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';

  // SVG dimensions: sm=24, md=32
  const svgSize = size === 'sm' ? 24 : 32;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  // Arc radius just outside the badge circle
  const arcRadius = (svgSize / 2) - 1;
  const strokeWidth = size === 'sm' ? 1.5 : 2;

  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full font-bold font-mono ring-1 ring-white/20 select-none ${sizeClasses}`}
      style={{
        backgroundColor: config.bg,
        color: config.text,
        opacity,
      }}
      title={`${compound} — ${lapAge} lap${lapAge !== 1 ? 's' : ''}`}
      aria-label={`${compound} tyre, ${lapAge} laps old`}
    >
      {/* Compound letter */}
      <span className="relative z-10 leading-none">{config.letter}</span>

      {/* SVG wear arc overlay */}
      <svg
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <WearArc
          wearFraction={wearFraction}
          colour={config.bg}
          radius={arcRadius}
          cx={cx}
          cy={cy}
          strokeWidth={strokeWidth}
        />
      </svg>
    </span>
  );
}
