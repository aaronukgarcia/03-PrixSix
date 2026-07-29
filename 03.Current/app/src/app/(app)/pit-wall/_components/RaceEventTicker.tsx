// GUID: PW_EVENT_TICKER-000-v01
// [Intent] FEAT-PW-020 — the "race story" panel: detected events (overtakes, battles, pit stops,
//          fastest laps) merged chronologically with the FIA race control feed, newest first.
//          This is the anti-TV-director: the broadcast shows one event at a time chosen for the
//          average viewer; this shows every event, and each detected-event row is a BUTTON that
//          flies the track-map camera to that car via the existing follow mode. Replaces the
//          plain FIARaceControlFeed in the zoom-0 layout; FIA rows render through the exact
//          MessageRow component exported from FIARaceControlFeed (GR#3 — no duplicated styling).
// [Inbound Trigger] PitWallClient zoom-0 right panel.
// [Downstream Impact] onSelectDriver feeds handleDriverFollow (PIT_WALL_CLIENT-028).

'use client';

import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { RaceControlMessage } from '../_types/pit-wall.types';
import type { RaceEvent, RaceEventKind } from '../_utils/race-events';
import { MessageRow } from './FIARaceControlFeed';

interface RaceEventTickerProps {
  events: RaceEvent[];
  raceControl: RaceControlMessage[];
  onSelectDriver: (driverNumber: number) => void;
  className?: string;
}

// GUID: PW_EVENT_TICKER-001-v01
// [Intent] Per-kind presentation. Overtakes are the headline (green, bold); battles amber;
//          pits slate; fastest lap purple — matching the tower's existing colour language
//          (green = gain, purple = session best, orange/amber = pit).
const KIND_CONFIG: Record<RaceEventKind, { border: string; bg: string; badge: string; badgeClass: string }> = {
  overtake:      { border: 'border-l-4 border-green-500',  bg: 'bg-green-500/10',  badge: 'PASS',   badgeClass: 'text-green-400 bg-green-400/10 ring-1 ring-green-400/40' },
  battle_forming:{ border: 'border-l-4 border-amber-400',  bg: 'bg-amber-400/10',  badge: 'BATTLE', badgeClass: 'text-amber-300 bg-amber-400/10 ring-1 ring-amber-400/40' },
  battle_over:   { border: 'border-l-4 border-slate-600',  bg: '',                 badge: 'SETTLED',badgeClass: 'text-slate-400 bg-slate-700/40 ring-1 ring-slate-600/40' },
  pit_in:        { border: 'border-l-4 border-orange-400', bg: 'bg-orange-400/5',  badge: 'PIT IN', badgeClass: 'text-orange-300 bg-orange-400/10 ring-1 ring-orange-400/40' },
  pit_out:       { border: 'border-l-4 border-orange-400', bg: 'bg-orange-400/5',  badge: 'PIT OUT',badgeClass: 'text-orange-300 bg-orange-400/10 ring-1 ring-orange-400/40' },
  fastest_lap:   { border: 'border-l-4 border-purple-500', bg: 'bg-purple-500/10', badge: 'FL',     badgeClass: 'text-purple-300 bg-purple-400/10 ring-1 ring-purple-400/40' },
};

function formatEventTime(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// GUID: PW_EVENT_TICKER-002-v01
// [Intent] One detected-event row. The whole row is a button — clicking follows the primary
//          driver on the track map, which is the entire point: "battle brewing at T4" → tap →
//          you are watching T4 before the TV director cuts to it.
function EventRow({ event, onSelectDriver }: { event: RaceEvent; onSelectDriver: (n: number) => void }) {
  const config = KIND_CONFIG[event.kind];
  return (
    <motion.button
      layout
      type="button"
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      onClick={() => onSelectDriver(event.driverNumber)}
      title={`Follow ${event.driverCode} on the track map`}
      className={cn(
        'w-full text-left px-3 py-2 border-b border-slate-800/50 flex flex-col gap-0.5 cursor-pointer',
        'hover:brightness-125 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500',
        config.border,
        config.bg,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('text-[9px] font-bold px-1 py-0.5 rounded font-mono leading-none', config.badgeClass)}>
          {config.badge}
        </span>
        <span className="text-[10px] text-slate-500 font-mono tabular-nums">{formatEventTime(event.at)}</span>
        {event.lap !== null && (
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">· LAP {event.lap}</span>
        )}
        <span
          className="ml-auto h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: `#${event.teamColour}` }}
          aria-hidden="true"
        />
      </div>
      <p className="text-xs text-slate-200 leading-snug">{event.message}</p>
    </motion.button>
  );
}

type TickerItem =
  | { kind: 'event'; at: number; event: RaceEvent }
  | { kind: 'fia'; at: number; message: RaceControlMessage };

// GUID: PW_EVENT_TICKER-003-v01
// [Intent] The merged panel. Header shows a live battle count when any are active. FIA messages
//          and detected events interleave by timestamp, newest first; auto-scrolls to top on
//          arrival like the FIA feed it replaces.
export function RaceEventTicker({ events, raceControl, onSelectDriver, className }: RaceEventTickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const items = useMemo<TickerItem[]>(() => {
    const merged: TickerItem[] = [
      ...events.map(e => ({ kind: 'event' as const, at: e.at, event: e })),
      ...raceControl.map(m => ({ kind: 'fia' as const, at: new Date(m.date).getTime() || 0, message: m })),
    ];
    return merged.sort((a, b) => b.at - a.at);
  }, [events, raceControl]);

  const liveBattles = useMemo(
    () => events.filter(e => e.kind === 'battle_forming').length - events.filter(e => e.kind === 'battle_over').length,
    [events],
  );

  useEffect(() => {
    if (items.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  return (
    <div className={cn('h-full overflow-hidden relative flex flex-col', className)}>
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-bold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono leading-none">
          LIVE
        </span>
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
          Race Story
        </span>
        {liveBattles > 0 && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono leading-none text-amber-300 bg-amber-400/10 ring-1 ring-amber-400/40 animate-pulse">
            ⚔ {liveBattles} BATTLE{liveBattles !== 1 ? 'S' : ''}
          </span>
        )}
        {items.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-600 font-mono tabular-nums">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-xs text-slate-600 font-mono leading-relaxed">
            Watching for overtakes, battles and pit stops…
          </span>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden space-y-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {items.map(item =>
              item.kind === 'event' ? (
                <EventRow key={item.event.id} event={item.event} onSelectDriver={onSelectDriver} />
              ) : (
                <MessageRow key={item.message.id} message={item.message} />
              )
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
