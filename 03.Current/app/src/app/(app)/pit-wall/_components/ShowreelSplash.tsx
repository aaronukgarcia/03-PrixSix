// GUID: SHOWREEL_SPLASH-000-v01
// [Intent] Full-screen splash shown between historical races in showreel mode.
//          Prix Six branded, shown for 2 seconds then fades out.
// [Inbound Trigger] Rendered by PitWallClient when preRaceMode.mode === 'SHOWREEL_BETWEEN'.
// [Downstream Impact] Temporarily replaces Pit Wall content. onComplete signals return to replay.

'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';

interface ShowreelSplashProps {
  upNextRaceName: string;  // e.g. "2025 Brazilian Grand Prix"
  onComplete: () => void;  // called after 2 seconds
}

// GUID: SHOWREEL_SPLASH-001-v01
// [Intent] Prix Six branded full-screen splash displayed for 2 seconds between historical race
//          replays in showreel mode. Auto-advances via onComplete callback after the timeout.
export function ShowreelSplash({ upNextRaceName, onComplete }: ShowreelSplashProps) {
  useEffect(() => {
    const t = setTimeout(onComplete, 2000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950"
    >
      <div className="flex flex-col items-center gap-3 text-center px-6">
        {/* Logo mark */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: 'easeOut' }}
        >
          <span className="text-8xl font-black text-orange-500 tracking-tighter leading-none select-none">
            P6
          </span>
        </motion.div>

        {/* Brand name */}
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          className="text-2xl font-bold text-slate-200 tracking-widest uppercase select-none"
        >
          PRIX SIX
        </motion.p>

        {/* Divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.35, duration: 0.4 }}
          className="w-48 h-px bg-slate-700 my-1"
        />

        {/* Up next */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.3 }}
          className="flex flex-col items-center gap-1"
        >
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            Up Next
          </span>
          <span className="text-lg font-bold text-orange-400">
            {upNextRaceName}
          </span>
        </motion.div>
      </div>
    </motion.div>
  );
}
