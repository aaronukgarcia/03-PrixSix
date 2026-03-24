// GUID: ZOOM_RACE_ORDER-000-v01
// [Intent] Race order panel for Zoom 2 — left side vertical list of all drivers
//          sorted by position. Click any driver to jump the camera focus to them.
//          Shows position badge, team colour indicator, and driver code.
// [Inbound Trigger] Rendered in PitWallClient when zoomLevel === 2.
// [Downstream Impact] Calls setFocusPosition to change the camera target.

'use client';

import { cn } from '@/lib/utils';
import type { DriverRaceState } from '../_types/pit-wall.types';

interface ZoomRaceOrderProps {
  drivers: DriverRaceState[];
  focusPosition: number;
  onSelectPosition: (position: number) => void;
}

export function ZoomRaceOrder({ drivers, focusPosition, onSelectPosition }: ZoomRaceOrderProps) {
  const sorted = [...drivers].sort((a, b) => a.position - b.position);

  return (
    <div className="absolute left-3 top-3 bottom-16 z-10 w-[120px] overflow-y-auto rounded bg-slate-950/85 backdrop-blur border border-slate-700/50">
      <div className="py-1">
        {sorted.map(d => {
          const isFocus = d.position === focusPosition;
          return (
            <button
              key={d.driverNumber}
              onClick={() => onSelectPosition(d.position)}
              className={cn(
                'w-full flex items-center gap-1.5 px-2 py-[3px] text-left transition-colors',
                isFocus
                  ? 'bg-cyan-900/40 text-white'
                  : 'hover:bg-slate-800/60 text-slate-300',
              )}
            >
              {/* Position badge */}
              <span className={cn(
                'text-[9px] font-bold tabular-nums w-[18px] text-right',
                isFocus ? 'text-cyan-400' : 'text-slate-500',
              )}>
                P{d.position}
              </span>

              {/* Team colour dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: d.teamColour?.startsWith('#') ? d.teamColour : `#${d.teamColour}` }}
              />

              {/* Driver code */}
              <span className={cn(
                'text-[10px] font-semibold tracking-wider uppercase',
                isFocus ? 'text-white' : 'text-slate-400',
              )}>
                {d.driverCode}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
