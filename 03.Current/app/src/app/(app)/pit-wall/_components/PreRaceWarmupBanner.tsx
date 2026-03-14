// GUID: PRE_RACE_WARMUP_BANNER-000-v01
// [Intent] Banner displayed at top of Pit Wall during pre-race showreel mode.
//          Shows current historical race name and countdown to actual race start.
// [Inbound Trigger] Rendered by PitWallClient when preRaceMode.isShowreel is true.
// [Downstream Impact] Overlays existing header area. Does not hide track map.

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface PreRaceWarmupBannerProps {
  currentRaceName: string;   // e.g. "2025 Chinese Grand Prix"
  nextRaceName: string;      // e.g. "2026 Chinese Grand Prix"
  minutesToStart: number;    // minutes until actual race
  isCountdown: boolean;      // true when < 5 min (countdown-only mode)
}

// GUID: PRE_RACE_WARMUP_BANNER-001-v01
// [Intent] Format a remaining-seconds value into a human-readable countdown string.
//          > 60 min → "2h 14m" | < 60 min → "14:32" | < 1 min → "0:XX"
function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0:00';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (totalSeconds >= 3600) {
    return `${hours}h ${minutes}m`;
  }

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${mm}:${ss}`;
}

// GUID: PRE_RACE_WARMUP_BANNER-002-v01
// [Intent] Pre-race warmup banner component. Displays historical race context and live
//          countdown to the real race start. Switches to red urgency mode when < 5 minutes.
export function PreRaceWarmupBanner({
  currentRaceName,
  nextRaceName,
  minutesToStart,
  isCountdown,
}: PreRaceWarmupBannerProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(
    Math.max(0, Math.round(minutesToStart * 60))
  );

  useEffect(() => {
    setRemainingSeconds(Math.max(0, Math.round(minutesToStart * 60)));
  }, [minutesToStart]);

  useEffect(() => {
    if (remainingSeconds <= 0) return;

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [remainingSeconds]);

  const countdownText = formatCountdown(remainingSeconds);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'w-full h-12 flex items-center justify-between px-4 select-none',
        isCountdown
          ? 'bg-linear-to-r from-red-700 to-red-500'
          : 'bg-linear-to-r from-orange-600 to-amber-500'
      )}
    >
      {/* Left: current race context */}
      <div className="flex items-center gap-2 text-white text-sm font-medium min-w-0">
        <span className="text-base leading-none shrink-0">🏎</span>
        {isCountdown ? (
          <span className="truncate">
            Get ready for{' '}
            <span className="font-bold">{nextRaceName}</span>
          </span>
        ) : (
          <span className="truncate">
            Warming up with{' '}
            <span className="font-bold">{currentRaceName}</span>
          </span>
        )}
      </div>

      {/* Right: countdown */}
      <div className="flex items-center gap-1.5 text-white text-sm font-medium shrink-0 ml-4">
        {isCountdown ? (
          <>
            <span className="text-base leading-none">🚦</span>
            <span>
              Race starts in{' '}
              <span className="font-bold font-mono">{countdownText}</span>
              {' '}— get ready!
            </span>
          </>
        ) : (
          <span>
            Race starts in{' '}
            <span className="font-bold font-mono">{countdownText}</span>
          </span>
        )}
      </div>
    </motion.div>
  );
}
