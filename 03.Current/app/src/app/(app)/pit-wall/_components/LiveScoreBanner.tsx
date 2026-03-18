// GUID: PIT_WALL_LIVE_SCORE_BANNER-000-v01
// [Intent] Compact banner showing the logged-in user's predicted score in real-time
//          based on current driver positions. Sits between the toolbar and race table
//          in the Pit Wall layout. Shows total points, per-driver breakdown, and
//          primary/secondary team toggle.
// [Inbound Trigger] Rendered by PitWallClient when useLivePredictionScore returns data.
// [Downstream Impact] Pure display — no writes, no side effects.

'use client';

import { cn } from '@/lib/utils';
import type { LivePredictionScore } from '../_hooks/useLivePredictionScore';
import { Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

// GUID: PIT_WALL_LIVE_SCORE_BANNER-001-v01
// [Intent] Props for the LiveScoreBanner component.
interface LiveScoreBannerProps {
  score: LivePredictionScore;
  className?: string;
}

// GUID: PIT_WALL_LIVE_SCORE_BANNER-002-v01
// [Intent] Colour code per-driver points — green for exact, amber for close, dim for zero.
function pointsColour(points: number, isExact: boolean): string {
  if (isExact) return 'text-emerald-400';
  if (points >= 4) return 'text-green-400';
  if (points >= 2) return 'text-amber-400';
  return 'text-slate-600';
}

// GUID: PIT_WALL_LIVE_SCORE_BANNER-003-v01
// [Intent] Main banner component — collapsed shows total + compact driver chips,
//          expanded shows per-driver detail rows.
export function LiveScoreBanner({ score, className }: LiveScoreBannerProps) {
  const [expanded, setExpanded] = useState(false);

  // Don't render if no predictions or still loading
  if (score.isLoading || !score.hasPredictions) return null;

  const {
    totalPoints,
    maxPoints,
    bonusEarned,
    breakdown,
    teamName,
    selectedTeamType,
    setSelectedTeamType,
    hasSecondaryTeam,
  } = score;

  const pctOfMax = maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0;

  return (
    <div className={cn(
      'shrink-0 border-b border-slate-800 bg-slate-950/80',
      className,
    )}>
      {/* ── Collapsed row ─────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-1.5 cursor-pointer select-none"
        onClick={() => setExpanded(prev => !prev)}
      >
        {/* Trophy + total */}
        <div className="flex items-center gap-1.5">
          <Trophy className={cn(
            'w-3.5 h-3.5',
            totalPoints >= 30 ? 'text-yellow-400' : 'text-slate-500',
          )} />
          <span className="text-sm font-bold tabular-nums text-white">
            {totalPoints}
          </span>
          <span className="text-[10px] text-slate-600 tabular-nums">
            /{maxPoints}
          </span>
        </div>

        {/* Bonus badge */}
        {bonusEarned && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-semibold uppercase tracking-wider">
            +{10} bonus
          </span>
        )}

        {/* Progress bar (thin) */}
        <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden max-w-[120px]">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              pctOfMax >= 80 ? 'bg-emerald-500' :
              pctOfMax >= 50 ? 'bg-green-500' :
              pctOfMax >= 25 ? 'bg-amber-500' : 'bg-slate-600',
            )}
            style={{ width: `${pctOfMax}%` }}
          />
        </div>

        {/* Compact driver chips */}
        <div className="flex items-center gap-1 overflow-hidden">
          {breakdown.map(d => (
            <span
              key={d.driverCode}
              className={cn(
                'text-[9px] font-mono tabular-nums whitespace-nowrap',
                pointsColour(d.points, d.isExact),
              )}
            >
              {d.driverCode}{d.points > 0 ? `+${d.points}` : ''}
            </span>
          ))}
        </div>

        {/* Team name + toggle */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {hasSecondaryTeam && (
            <div className="flex items-center gap-0.5 text-[9px]">
              <button
                className={cn(
                  'px-1.5 py-0.5 rounded-l transition-colors',
                  selectedTeamType === 'primary'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-600 hover:text-slate-400',
                )}
                onClick={(e) => { e.stopPropagation(); setSelectedTeamType('primary'); }}
              >
                1st
              </button>
              <button
                className={cn(
                  'px-1.5 py-0.5 rounded-r transition-colors',
                  selectedTeamType === 'secondary'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-900 text-slate-600 hover:text-slate-400',
                )}
                onClick={(e) => { e.stopPropagation(); setSelectedTeamType('secondary'); }}
              >
                2nd
              </button>
            </div>
          )}
          <span className="text-[10px] text-slate-500 truncate max-w-[100px]">
            {teamName}
          </span>
          {expanded
            ? <ChevronUp className="w-3 h-3 text-slate-600" />
            : <ChevronDown className="w-3 h-3 text-slate-600" />
          }
        </div>
      </div>

      {/* ── Expanded detail rows ──────────────────────────────────────── */}
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ maxHeight: expanded ? '200px' : '0px', opacity: expanded ? 1 : 0 }}
      >
        <div className="px-4 pb-2 grid grid-cols-6 gap-1">
          {breakdown.map((d, i) => (
            <div
              key={d.driverCode}
              className={cn(
                'flex flex-col items-center py-1 px-1 rounded text-center',
                d.isExact ? 'bg-emerald-950/40' :
                d.inTopSix ? 'bg-slate-800/50' : 'bg-slate-900/30',
              )}
            >
              <span className="text-[9px] text-slate-500 tabular-nums">
                P{i + 1}
              </span>
              <span className={cn(
                'text-xs font-bold',
                pointsColour(d.points, d.isExact),
              )}>
                {d.driverCode}
              </span>
              <span className="text-[9px] text-slate-500 tabular-nums">
                {d.actualPosition !== null ? `now P${d.actualPosition}` : 'out'}
              </span>
              <span className={cn(
                'text-[10px] font-bold tabular-nums',
                pointsColour(d.points, d.isExact),
              )}>
                +{d.points}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
