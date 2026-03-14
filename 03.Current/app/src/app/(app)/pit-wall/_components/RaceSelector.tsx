// GUID: RACE_SELECTOR-000-v01
// [Intent] On-demand race picker for showreel mode. Lets users choose any 2025 session to replay.
// [Inbound Trigger] Rendered by PitWallClient toolbar when in pre-race/showreel mode.
// [Downstream Impact] onSelectSession triggers usePreRaceMode.onRaceSelect, switching replay source.

'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HistoricalSession } from '../_types/showreel.types';

interface RaceSelectorProps {
  sessions: HistoricalSession[];
  currentSession: HistoricalSession | null;
  onSelectSession: (s: HistoricalSession) => void;
  disabled?: boolean;
}

// GUID: RACE_SELECTOR-001-v01
// [Intent] Dropdown race selector component for choosing any available historical session
//          to replay on demand. Shows session name, date, and type badge.
//          Closes on outside click; highlights the currently-playing session.
export function RaceSelector({
  sessions,
  currentSession,
  onSelectSession,
  disabled = false,
}: RaceSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  function handleSelect(session: HistoricalSession) {
    setOpen(false);
    onSelectSession(session);
  }

  function formatDate(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
          'border border-orange-500/60 text-orange-400',
          'hover:bg-orange-500/10 transition-colors duration-150',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'bg-orange-500/10'
        )}
      >
        <span>Show different 2025 race</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Popover list */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 min-w-64 max-h-72 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl">
          {sessions.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500 italic">
              No sessions available.
            </p>
          ) : (
            <ul className="py-1">
              {sessions.map((session) => {
                const isCurrent =
                  currentSession?.sessionKey === session.sessionKey;

                return (
                  <li key={session.sessionKey}>
                    <button
                      type="button"
                      onClick={() => handleSelect(session)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 text-left',
                        'hover:bg-slate-800 transition-colors duration-100',
                        isCurrent && 'bg-slate-800/60'
                      )}
                    >
                      {/* Playing indicator */}
                      <span className="w-4 shrink-0 flex items-center justify-center">
                        {isCurrent ? (
                          <Play className="w-3 h-3 text-orange-400 fill-orange-400" />
                        ) : null}
                      </span>

                      {/* Session info */}
                      <span className="flex-1 min-w-0">
                        <span
                          className={cn(
                            'block text-sm font-medium truncate',
                            isCurrent ? 'text-orange-400' : 'text-slate-200'
                          )}
                        >
                          {session.year} {session.meetingName}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {formatDate(session.dateStart)}
                        </span>
                      </span>

                      {/* Session type badge */}
                      {(session.sessionType === 'Race' ||
                        session.sessionType === 'Sprint') && (
                        <span
                          className={cn(
                            'shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded',
                            session.sessionType === 'Sprint'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                          )}
                        >
                          {session.sessionType}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
