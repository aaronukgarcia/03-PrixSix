// GUID: DELTA_INDICATOR-000-v01
// [Intent] Animated gap/interval value display with F1 colour coding.
//          Handles OpenF1 string formats: "+1.234", "1 LAP", "RETIRED", null.
// [Inbound Trigger] Used by PitWallRaceTable gap and interval columns.
// [Downstream Impact] Visual-only — no state side-effects.

'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// GUID: DELTA_INDICATOR-001-v01
// [Intent] Props for the DeltaIndicator component.
interface DeltaIndicatorProps {
  value: string | null;
  type: 'gap' | 'interval';
  className?: string;
}

// GUID: DELTA_INDICATOR-002-v01
// [Intent] Derive Tailwind colour class from delta value string.
function getColourClass(value: string | null): string {
  if (value === null || value === '--') return 'text-slate-500';

  const upper = value.toUpperCase();

  if (upper === 'RETIRED' || upper === 'OUT') return 'text-red-400';
  if (upper === 'PIT' || upper.includes('LAP')) return 'text-orange-400';

  // Strip leading '+' and try numeric parse
  const numeric = parseFloat(value.replace(/^\+/, ''));
  if (!isNaN(numeric)) {
    if (numeric < 1.0) return 'text-green-400';
    if (numeric < 3.0) return 'text-yellow-400';
    return 'text-slate-300';
  }

  return 'text-slate-400';
}

// GUID: DELTA_INDICATOR-003-v01
// [Intent] Format display value — strip leading '+', show '--' for null.
function formatValue(value: string | null): string {
  if (value === null) return '--';
  return value.replace(/^\+/, '');
}

// GUID: DELTA_INDICATOR-004-v01
// [Intent] Main DeltaIndicator component. Uses AnimatePresence to animate
//          value transitions with a vertical slide-through effect.
export function DeltaIndicator({ value, type, className = '' }: DeltaIndicatorProps) {
  const colourClass = useMemo(() => getColourClass(value), [value]);
  const displayValue = useMemo(() => formatValue(value), [value]);

  return (
    <span
      className={`font-mono text-xs tabular-nums inline-block overflow-hidden relative ${className}`}
      style={{ minWidth: '3.5rem' }}
      aria-label={`${type === 'gap' ? 'Gap to leader' : 'Interval to car ahead'}: ${displayValue}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value ?? '__null__'}
          className={`inline-block ${colourClass}`}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {displayValue}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
