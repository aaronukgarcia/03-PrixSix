// GUID: REPLAY_CONTROLS-000-v04
// [Intent] Classic media player transport controls for the GPS Replay player.
//          Provides ⏮⏪⏸/▶⏩⏭ buttons, a scrub bar, elapsed/total time display,
//          and a discrete speed selector (0.5× 1× 2× 4× 8×).
//          Matches the dark F1 aesthetic of the Pit Wall toolbar.
//          v02: Enhanced loading states — spinner icon, two-phase progress (session list
//               fetch + GPS data download), initialising phase display.
//          v03: FEAT-PW-004 — session dropdown shows all prior races (including not-yet-ingested
//               sessions as disabled options). Wider max-w for longer labels.
//          v04: FEAT-PW-019 — show download % and frame count in GPS loading message.
// [Inbound Trigger] Rendered by PitWallClient when isReplayMode === true.
// [Downstream Impact] Controls flow into useReplayPlayer — no direct data access.

'use client';

import { useCallback } from 'react';
import { SkipBack, Rewind, Play, Pause, FastForward, SkipForward, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UseReplayPlayerReturn, ReplaySpeed } from '../_types/replay.types';

// GUID: REPLAY_CONTROLS-001-v01
// [Intent] Format milliseconds to MM:SS or H:MM:SS display string.
function formatMs(ms: number): string {
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const h   = Math.floor(totalSec / 3600);
  const m   = Math.floor((totalSec % 3600) / 60);
  const s   = totalSec % 60;
  const mm  = String(m).padStart(2, '0');
  const ss  = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4, 8];

interface ReplaySession {
  sessionKey: number;
  meetingName: string;
  sessionName: string;
  available?: boolean;
}

interface ReplayControlsProps {
  player: UseReplayPlayerReturn;
  meetingName: string;
  sessionsLoading?: boolean;
  sessions?: ReplaySession[];
  selectedSessionKey?: number | null;
  onSessionChange?: (sessionKey: number) => void;
  className?: string;
}

// GUID: REPLAY_CONTROLS-002-v02
// [Intent] Full media player UI — transport buttons, scrub bar, time display, speed selector.
//          v02: Enhanced loading states with spinner, two-phase progress, initialising display.
export function ReplayControls({ player, meetingName, sessionsLoading, sessions, selectedSessionKey, onSessionChange, className }: ReplayControlsProps) {
  const {
    playbackState, downloadProgress, progress,
    elapsedMs, durationMs, speed,
    play, pause, seek, setSpeed,
    skipToStart, skipToEnd, stepBack, stepForward,
    framesLoaded,
  } = player;

  const isPlaying  = playbackState === 'playing';
  const isLoading  = playbackState === 'loading';
  const isDisabled = isLoading || playbackState === 'idle' || playbackState === 'error' || !!sessionsLoading;

  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!durationMs) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(fraction * durationMs);
  }, [durationMs, seek]);

  // GUID: REPLAY_CONTROLS-003-v02
  // [Intent] Render loading/initialising states with spinner and progress bar.
  //          Phase 1: session list fetch ("Finding replay sessions…")
  //          Phase 2: GPS data download (progress bar + percentage)
  //          Phase 3: brief "Initialising…" during ready→playing transition
  if (sessionsLoading) {
    return (
      <div className={cn(
        'flex shrink-0 items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-950',
        className,
      )}>
        <Loader2 className="w-4 h-4 text-orange-400 animate-spin shrink-0" />
        <span className="text-[10px] text-orange-400 uppercase tracking-wider font-semibold whitespace-nowrap">
          REPLAY
        </span>
        <span className="text-[10px] text-slate-400 animate-pulse">
          Finding replay sessions…
        </span>
      </div>
    );
  }

  if (isLoading || playbackState === 'ready') {
    const pct = Math.round(downloadProgress * 100);
    const isFromSource = player.loadingSource === 'source';
    const label = playbackState === 'ready'
      ? 'Initialising replay…'
      : pct < 100
        ? isFromSource
          ? `Downloading from OpenF1… ${pct}%${framesLoaded > 0 ? ` (${framesLoaded.toLocaleString()} frames)` : ''} — first load takes 2-3 min`
          : `Loading replay data… ${pct}%${framesLoaded > 0 ? ` (${framesLoaded.toLocaleString()} frames)` : ''}`
        : 'Processing…';

    return (
      <div className={cn(
        'flex shrink-0 items-center gap-3 px-4 py-2.5 border-b border-slate-800 bg-slate-950',
        className,
      )}>
        <Loader2 className="w-4 h-4 text-orange-400 animate-spin shrink-0" />
        <span className="text-[10px] text-orange-400 uppercase tracking-wider font-semibold whitespace-nowrap">
          REPLAY
        </span>
        <span className="text-[10px] text-slate-500 truncate max-w-[140px]">{meetingName}</span>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-300"
              style={{ width: `${(downloadProgress * 100).toFixed(1)}%` }}
            />
          </div>
          <span className="text-[10px] text-orange-300 font-mono tabular-nums whitespace-nowrap font-semibold">
            {pct}%
          </span>
        </div>
        <span className="text-[10px] text-slate-500 animate-pulse whitespace-nowrap">
          {label}
        </span>
      </div>
    );
  }

  // GUID: REPLAY_CONTROLS-004-v02
  // [Intent] Error state — distinguish expected download states from real errors.
  //          v02: "downloading from source" messages shown in amber (expected), not red (error).
  if (playbackState === 'error' && player.error) {
    const isDownloading = player.error.includes('being downloaded') || player.error.includes('from OpenF1');
    return (
      <div className={cn(
        'flex shrink-0 items-center gap-3 px-4 py-2.5 border-b',
        isDownloading
          ? 'border-amber-900/50 bg-amber-950/30'
          : 'border-red-900/50 bg-red-950/30',
        className,
      )}>
        <span className={cn(
          'text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap',
          isDownloading ? 'text-amber-400' : 'text-red-400',
        )}>
          {isDownloading ? 'DOWNLOADING' : 'REPLAY ERROR'}
        </span>
        <span className={cn(
          'text-[10px] select-all truncate flex-1',
          isDownloading ? 'text-amber-300' : 'text-red-300',
        )}>
          {player.error}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex shrink-0 items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-slate-900/80',
      className,
    )}>
      {/* Badge */}
      <span className="text-[9px] font-bold text-orange-400 border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
        REPLAY
      </span>

      {/* Session selector / label */}
      {/* GUID: REPLAY_CONTROLS-005-v01 */}
      {/* [Intent] FEAT-PW-004 — dropdown lists all prior Race/Sprint sessions. */}
      {/*          Unavailable (not yet ingested) sessions are disabled and greyed out. */}
      {sessions && sessions.length > 1 && onSessionChange ? (
        <select
          value={selectedSessionKey ?? ''}
          onChange={e => onSessionChange(Number(e.target.value))}
          className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 rounded px-1.5 py-0.5 outline-none max-w-[180px] shrink-0 hidden sm:block"
        >
          {sessions.map(s => (
            <option
              key={s.sessionKey}
              value={s.sessionKey}
              disabled={s.available === false}
              className={s.available === false ? 'text-slate-600' : undefined}
            >
              {s.meetingName} — {s.sessionName}{s.available === false ? ' (not ingested)' : ''}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-[10px] text-slate-500 truncate max-w-[120px] hidden sm:block shrink-0">
          {meetingName}
        </span>
      )}

      {/* Transport buttons: ⏮ ⏪ ⏸/▶ ⏩ ⏭ */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 text-slate-500 hover:text-slate-200 disabled:opacity-30"
          onClick={skipToStart}
          disabled={isDisabled}
          title="Skip to start"
        >
          <SkipBack className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 text-slate-500 hover:text-slate-200 disabled:opacity-30"
          onClick={stepBack}
          disabled={isDisabled}
          title="Back 30s"
        >
          <Rewind className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-white hover:text-orange-300 disabled:opacity-30"
          onClick={isPlaying ? pause : play}
          disabled={isDisabled}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying
            ? <Pause   className="w-3.5 h-3.5" />
            : <Play    className="w-3.5 h-3.5" />
          }
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 text-slate-500 hover:text-slate-200 disabled:opacity-30"
          onClick={stepForward}
          disabled={isDisabled}
          title="Forward 30s"
        >
          <FastForward className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-6 w-6 text-slate-500 hover:text-slate-200 disabled:opacity-30"
          onClick={skipToEnd}
          disabled={isDisabled}
          title="Skip to end"
        >
          <SkipForward className="w-3 h-3" />
        </Button>
      </div>

      {/* Scrub bar */}
      <div
        className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer group"
        onClick={handleScrubClick}
        title="Click to seek"
      >
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden group-hover:h-2 transition-all">
          <div
            className="h-full bg-orange-500 rounded-full"
            style={{ width: `${(progress * 100).toFixed(2)}%` }}
          />
        </div>
      </div>

      {/* Time display */}
      <span className="text-[10px] text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
        {formatMs(elapsedMs)} / {formatMs(durationMs)}
      </span>

      {/* Speed selector */}
      <div className="flex items-center gap-0.5 shrink-0">
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={cn(
              'text-[9px] px-1.5 py-0.5 rounded font-mono tabular-nums',
              'transition-colors duration-100',
              s === speed
                ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
                : 'text-slate-600 hover:text-slate-300 border border-transparent',
            )}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
