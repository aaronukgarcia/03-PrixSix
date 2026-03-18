// GUID: REPLAY_CONTROLS-000-v01
// [Intent] Classic media player transport controls for the GPS Replay player.
//          Provides ⏮⏪⏸/▶⏩⏭ buttons, a scrub bar, elapsed/total time display,
//          and a discrete speed selector (0.5× 1× 2× 4× 8×).
//          Matches the dark F1 aesthetic of the Pit Wall toolbar.
// [Inbound Trigger] Rendered by PitWallClient when isReplayMode === true.
// [Downstream Impact] Controls flow into useReplayPlayer — no direct data access.

'use client';

import { useCallback } from 'react';
import { SkipBack, Rewind, Play, Pause, FastForward, SkipForward } from 'lucide-react';
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

interface ReplayControlsProps {
  player: UseReplayPlayerReturn;
  meetingName: string;
  className?: string;
}

// GUID: REPLAY_CONTROLS-002-v01
// [Intent] Full media player UI — transport buttons, scrub bar, time display, speed selector.
export function ReplayControls({ player, meetingName, className }: ReplayControlsProps) {
  const {
    playbackState, downloadProgress, progress,
    elapsedMs, durationMs, speed,
    play, pause, seek, setSpeed,
    skipToStart, skipToEnd, stepBack, stepForward,
  } = player;

  const isPlaying  = playbackState === 'playing';
  const isLoading  = playbackState === 'loading';
  const isDisabled = isLoading || playbackState === 'idle' || playbackState === 'error';

  const handleScrubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!durationMs) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(fraction * durationMs);
  }, [durationMs, seek]);

  // GUID: REPLAY_CONTROLS-003-v01
  // [Intent] Render a loading bar while replay data is downloading.
  if (isLoading) {
    return (
      <div className={cn(
        'flex shrink-0 items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-950',
        className,
      )}>
        <span className="text-[10px] text-orange-400 uppercase tracking-wider whitespace-nowrap">
          REPLAY
        </span>
        <span className="text-[10px] text-slate-500 truncate">{meetingName}</span>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-300"
              style={{ width: `${(downloadProgress * 100).toFixed(1)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
        <span className="text-[10px] text-slate-600 animate-pulse">Loading GPS data…</span>
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

      {/* Session label */}
      <span className="text-[10px] text-slate-500 truncate max-w-[120px] hidden sm:block shrink-0">
        {meetingName}
      </span>

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
