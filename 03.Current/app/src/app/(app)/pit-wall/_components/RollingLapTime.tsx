// GUID: ROLLING_LAP_TIME-000-v01
// [Intent] Slot-machine digit-roll animation for lap times. F1 TV style.
// [Inbound Trigger] Used by PitWallRaceTable for last lap and best lap time columns.
// [Downstream Impact] Visual-only — no state side-effects.

'use client';

import { useRef, useMemo } from 'react';
import { motion } from 'framer-motion';

// GUID: ROLLING_LAP_TIME-001-v01
// [Intent] Props for the RollingLapTime component.
interface RollingLapTimeProps {
  timeSeconds: number | null;
  isFastest?: boolean;
  isPersonalBest?: boolean;
  className?: string;
}

// GUID: ROLLING_LAP_TIME-002-v01
// [Intent] Format seconds into M:SS.mmm string. Returns '--:--.---' if null.
function formatLapTime(seconds: number | null): string {
  if (seconds === null || isNaN(seconds) || seconds <= 0) return '--:--.---';
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const remaining = totalMs % 60000;
  const secs = Math.floor(remaining / 1000);
  const ms = remaining % 1000;
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// GUID: ROLLING_LAP_TIME-003-v01
// [Intent] Animated single digit using slot-machine vertical scroll effect.
interface DigitRollerProps {
  digit: number;
  color: string;
}

function DigitRoller({ digit, color }: DigitRollerProps) {
  return (
    <span
      className={`inline-block overflow-hidden relative ${color}`}
      style={{ height: '1em', width: '0.6em', verticalAlign: 'bottom' }}
    >
      <motion.span
        key={digit}
        className="absolute top-0 left-0 flex flex-col"
        style={{ lineHeight: '1em' }}
        animate={{ y: `${digit * -1}em` }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <span key={d} style={{ height: '1em', display: 'block' }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

// GUID: ROLLING_LAP_TIME-004-v01
// [Intent] Static separator character (colon or dot) — no animation needed.
interface SeparatorProps {
  char: string;
  color: string;
}

function Separator({ char, color }: SeparatorProps) {
  return (
    <span className={`inline-block ${color}`} style={{ lineHeight: '1em' }}>
      {char}
    </span>
  );
}

// GUID: ROLLING_LAP_TIME-005-v01
// [Intent] Main RollingLapTime component — parses formatted time and renders
//          digit rollers for numeric chars and static separators for ':' and '.'.
export function RollingLapTime({
  timeSeconds,
  isFastest = false,
  isPersonalBest = false,
  className = '',
}: RollingLapTimeProps) {
  const prevTimeRef = useRef<string>('--:--.---');
  const formatted = formatLapTime(timeSeconds);

  const color = useMemo(() => {
    if (isFastest) return 'text-purple-400';
    if (isPersonalBest) return 'text-green-400';
    return 'text-slate-100';
  }, [isFastest, isPersonalBest]);

  // Build segment list: each char is either a digit or a separator
  const segments = useMemo(() => {
    return formatted.split('').map((char, idx) => {
      const isDigit = char >= '0' && char <= '9';
      return { char, isDigit, idx };
    });
  }, [formatted]);

  prevTimeRef.current = formatted;

  return (
    <span
      className={`font-mono text-sm tabular-nums inline-flex items-end ${color} ${className}`}
      style={{ lineHeight: '1em', height: '1em' }}
      aria-label={formatted}
    >
      {segments.map(({ char, isDigit, idx }) => {
        if (formatted === '--:--.---') {
          // Static display for null times
          return (
            <span key={idx} className={`inline-block ${color}`} style={{ lineHeight: '1em' }}>
              {char}
            </span>
          );
        }
        if (isDigit) {
          return <DigitRoller key={idx} digit={parseInt(char, 10)} color={color} />;
        }
        return <Separator key={idx} char={char} color={color} />;
      })}
    </span>
  );
}
