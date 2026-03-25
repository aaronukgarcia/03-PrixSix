// GUID: FIA_RACE_CONTROL_FEED-000-v02
// [Intent] Scrollable feed of FIA race control messages, colour-coded by flag type.
//          F1 TV timing tower side panel aesthetic — dark, newest-first, full history.
// [Inbound Trigger] Rendered in the Pit Wall layout alongside the track map.
// [Downstream Impact] Visual-only — reads RaceControlMessage[] from usePitWallData, no state writes.

'use client';

import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { RaceControlMessage } from '../_types/pit-wall.types';

// GUID: FIA_RACE_CONTROL_FEED-001-v01
// [Intent] Props for the FIARaceControlFeed component.
interface FIARaceControlFeedProps {
  messages: RaceControlMessage[];
  className?: string;
}

// GUID: FIA_RACE_CONTROL_FEED-002-v02
// [Intent] Flag-to-styling config — border colour, background tint, emoji/text icon, and optional badge.
type FlagConfig = {
  borderClass: string;
  bgClass: string;
  icon: string;
  iconIsBadge: boolean;
  badgeClass?: string;
};

const FLAG_CONFIG: Record<string, FlagConfig> = {
  GREEN:      { borderClass: 'border-l-4 border-green-500',   bgClass: 'bg-green-500/5',   icon: '🟢', iconIsBadge: false },
  YELLOW:     { borderClass: 'border-l-4 border-yellow-500',  bgClass: 'bg-yellow-500/10', icon: '🟡', iconIsBadge: false },
  RED:        { borderClass: 'border-l-4 border-red-500',     bgClass: 'bg-red-500/10',    icon: '🔴', iconIsBadge: false },
  BLUE:       { borderClass: 'border-l-4 border-blue-500',    bgClass: 'bg-blue-500/5',    icon: '🔵', iconIsBadge: false },
  CHEQUERED:  { borderClass: 'border-l-4 border-white',       bgClass: 'bg-white/5',       icon: '🏁', iconIsBadge: false },
  SC:         {
    borderClass: 'border-l-4 border-yellow-400',
    bgClass: 'bg-yellow-400/10',
    icon: 'SC',
    iconIsBadge: true,
    badgeClass: 'text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/40',
  },
  VSC:        {
    borderClass: 'border-l-4 border-yellow-300',
    bgClass: 'bg-yellow-300/8',
    icon: 'VSC',
    iconIsBadge: true,
    badgeClass: 'text-yellow-300 bg-yellow-300/10 ring-1 ring-yellow-300/40',
  },
  DEFAULT:    { borderClass: 'border-l-4 border-slate-600',   bgClass: '',                 icon: '',   iconIsBadge: false },
};

// GUID: FIA_RACE_CONTROL_FEED-003-v01
// [Intent] Categories that warrant a visible badge label on the message row.
const NOTABLE_CATEGORIES = new Set([
  'SAFETY_CAR',
  'DRS_ENABLED',
  'DRS_DISABLED',
  'FLAG',
  'INCIDENT',
  'PENALTY',
]);

// GUID: FIA_RACE_CONTROL_FEED-004-v01
// [Intent] Format an ISO date string as HH:MM:SS for the message timestamp.
function formatMessageTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

// GUID: FIA_RACE_CONTROL_FEED-005-v01
// [Intent] Single message row — flag border, icon, time, lap, message text, category badge.
interface MessageRowProps {
  message: RaceControlMessage;
}

function MessageRow({ message }: MessageRowProps) {
  const flagKey = message.flag ?? 'DEFAULT';
  const config = FLAG_CONFIG[flagKey] ?? FLAG_CONFIG.DEFAULT;

  return (
    <motion.div
      layout
      layoutId={message.id}
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'px-3 py-2 border-b border-slate-800/50 flex flex-col gap-0.5',
        config.borderClass,
        config.bgClass
      )}
    >
      {/* Top row: icon + time + lap */}
      <div className="flex items-center gap-1.5">
        {/* Icon or badge */}
        {config.icon && (
          config.iconIsBadge ? (
            <span
              className={cn(
                'text-[9px] font-bold px-1 py-0.5 rounded font-mono leading-none',
                config.badgeClass
              )}
            >
              {config.icon}
            </span>
          ) : (
            <span className="text-[11px] leading-none select-none" aria-hidden="true">
              {config.icon}
            </span>
          )
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-slate-500 font-mono tabular-nums">
          {formatMessageTime(message.date)}
        </span>

        {/* Lap number */}
        {message.lapNumber !== null && (
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">
            · LAP {message.lapNumber}
          </span>
        )}

        {/* Sector */}
        {message.sector !== null && (
          <span className="text-[10px] text-slate-600 font-mono tabular-nums">
            S{message.sector}
          </span>
        )}
      </div>

      {/* Message text */}
      <p className="text-xs text-slate-200 leading-snug">
        {message.message}
      </p>

      {/* Category badge — only for notable categories */}
      {NOTABLE_CATEGORIES.has(message.category) && (
        <span className="self-start text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wide font-mono leading-none">
          {message.category.replace(/_/g, ' ')}
        </span>
      )}
    </motion.div>
  );
}

// GUID: FIA_RACE_CONTROL_FEED-006-v02
// [Intent] Main FIARaceControlFeed component — header + scrollable full-history message list.
//          Shows ALL messages (no cap), newest first, auto-scrolls to top on new arrivals.
export function FIARaceControlFeed({ messages, className }: FIARaceControlFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Sort newest first — no cap, show full history
  const sorted = useMemo(() => {
    return [...messages]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [messages]);

  // Auto-scroll to top when new messages arrive (newest is at top)
  useEffect(() => {
    if (sorted.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevCountRef.current = sorted.length;
  }, [sorted.length]);

  return (
    <div className={cn('h-full overflow-hidden relative flex flex-col', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-bold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono leading-none">
          FIA
        </span>
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
          Race Control
        </span>
        {sorted.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono tabular-nums">
            {sorted.length} msg{sorted.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Messages list */}
      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-slate-600 font-mono">Waiting for race control…</span>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden space-y-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {sorted.map((msg) => (
              <MessageRow key={msg.id} message={msg} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
