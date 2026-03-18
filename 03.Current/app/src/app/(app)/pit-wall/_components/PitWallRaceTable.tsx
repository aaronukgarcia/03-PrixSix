// GUID: PIT_WALL_RACE_TABLE-000-v03
// [Intent] Div-grid race data table with CSS position-change flashes.
//          F1 broadcast style — rows snap instantly, green/red flash on position change.
//          v03: Replaced Framer Motion spring animations with CSS keyframe flashes.
//               Removed React.memo — 20 plain div rows are trivial to reconcile.
// [Inbound Trigger] Rendered by PitWallClient as the primary race data view.
// [Downstream Impact] Reads DriverRaceState[] and RadioMessage[]; writes nothing.
//                     onRadioClick bubbles up to open RadioZoomPanel.

'use client';

import { useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { buildGridTemplate, PIT_WALL_COLUMNS } from '../_types/columns';
import type { DriverRaceState, RadioMessage, SectorStatus } from '../_types/pit-wall.types';
import type { UseRadioStateReturn } from '../_hooks/useRadioState';
import { RollingLapTime } from './RollingLapTime';
import { TyreBadge } from './TyreBadge';
import { DeltaIndicator } from './DeltaIndicator';
import { RadioIcon } from './RadioIcon';

// GUID: PIT_WALL_RACE_TABLE-001-v02
// [Intent] Props for the race table. v02: Added onDriverClick + followDriver for follow-mode camera.
interface PitWallRaceTableProps {
  drivers: DriverRaceState[];
  radioMessages: RadioMessage[];
  visibleColumns: string[];
  radioState: UseRadioStateReturn;
  onRadioClick: (driverNumber: number) => void;
  onDriverClick?: (driverNumber: number) => void;
  followDriver?: number | null;
  sortKey: string | null;
  onSort: (key: string) => void;
  totalLaps: number | null;
  className?: string;
}

// GUID: PIT_WALL_RACE_TABLE-002-v01
// [Intent] Format a sector time in seconds to S.mmm string.
function formatSectorTime(seconds: number | null): string {
  if (seconds === null) return '--';
  const s = Math.floor(seconds);
  const ms = Math.round((seconds - s) * 1000);
  return `${s}.${ms.toString().padStart(3, '0')}`;
}

// GUID: PIT_WALL_RACE_TABLE-003-v02
// [Intent] Derive Tailwind text colour + glow animation class from SectorStatus.
function sectorColour(status: SectorStatus): string {
  switch (status) {
    case 'session_best':  return 'text-green-400 animate-sector-green-glow';
    case 'personal_best': return 'text-purple-400 animate-sector-purple-glow';
    case 'normal':        return 'text-slate-300';
    default:              return 'text-slate-500';
  }
}

// GUID: PIT_WALL_RACE_TABLE-004-v01
// [Intent] Position medal colour for P1/P2/P3 left-border accent.
function positionBorderColour(position: number): string {
  if (position === 1) return '#ffd700'; // gold
  if (position === 2) return '#c0c0c0'; // silver
  if (position === 3) return '#cd7f32'; // bronze
  return 'transparent';
}

// GUID: PIT_WALL_RACE_TABLE-005-v01
// [Intent] Sort drivers array by the active sortKey, defaulting to race position.
function sortDrivers(drivers: DriverRaceState[], sortKey: string | null): DriverRaceState[] {
  const arr = [...drivers];
  switch (sortKey) {
    case 'lastLap':  return arr.sort((a, b) => (a.lastLapTime ?? 999) - (b.lastLapTime ?? 999));
    case 'bestLap':  return arr.sort((a, b) => (a.bestLapTime ?? 999) - (b.bestLapTime ?? 999));
    case 'tyreAge':  return arr.sort((a, b) => b.tyreLapAge - a.tyreLapAge);
    case 'pitstops': return arr.sort((a, b) => b.pitStopCount - a.pitStopCount);
    default:         return arr.sort((a, b) => a.position - b.position);
  }
}

// GUID: PIT_WALL_RACE_TABLE-006-v01
// [Intent] Render cell content for a given column key for one driver row.
function CellContent({
  columnKey,
  driver,
  unreadCount,
  onRadioClick,
  totalLaps,
}: {
  columnKey: string;
  driver: DriverRaceState;
  unreadCount: number;
  onRadioClick: () => void;
  totalLaps: number | null;
}) {
  switch (columnKey) {
    case 'position': {
      return (
        <div className="flex items-center justify-center gap-1 w-full h-full">
          <span
            className="font-mono text-sm font-bold text-slate-100"
            aria-label={`Position ${driver.position}`}
          >
            {driver.position}
          </span>
          {driver.positionChange > 0 && (
            <span className="text-[9px] text-green-400 leading-none" aria-label={`Gained ${driver.positionChange}`}>
              ▲
            </span>
          )}
          {driver.positionChange < 0 && (
            <span className="text-[9px] text-red-400 leading-none" aria-label={`Lost ${Math.abs(driver.positionChange)}`}>
              ▼
            </span>
          )}
        </div>
      );
    }

    case 'driver': {
      return (
        <div className="flex items-center gap-1.5 w-full h-full overflow-hidden">
          {/* Team colour strip */}
          <span
            className="w-1.5 self-stretch rounded-sm shrink-0"
            style={{ backgroundColor: `#${driver.teamColour}` }}
            aria-hidden="true"
          />
          {/* Driver code */}
          <span className="font-mono text-xs font-bold text-slate-100 truncate">
            {driver.driverCode}
          </span>
          {/* Status badges */}
          {driver.inPit && !driver.retired && (
            <span className="text-[9px] bg-orange-900/60 text-orange-400 px-1 rounded leading-tight shrink-0">
              PIT
            </span>
          )}
          {driver.retired && (
            <span className="text-[9px] bg-red-900/60 text-red-400 px-1 rounded leading-tight shrink-0">
              DNF
            </span>
          )}
        </div>
      );
    }

    case 'radio': {
      return (
        <div className="flex items-center justify-center w-full h-full">
          <RadioIcon
            driverNumber={driver.driverNumber}
            hasUnread={driver.hasUnreadRadio}
            isMuted={driver.isMuted}
            unreadCount={unreadCount}
            onClick={onRadioClick}
          />
        </div>
      );
    }

    case 'gap': {
      return (
        <div className="flex items-center justify-end w-full h-full">
          <DeltaIndicator value={driver.gapToLeader} type="gap" />
        </div>
      );
    }

    case 'interval': {
      return (
        <div className="flex items-center justify-end w-full h-full">
          <DeltaIndicator value={driver.intervalToAhead} type="interval" />
        </div>
      );
    }

    case 'lastLap': {
      return (
        <div className="flex items-center justify-end w-full h-full">
          <RollingLapTime
            timeSeconds={driver.lastLapTime}
            isFastest={driver.fastestLap}
          />
        </div>
      );
    }

    case 'bestLap': {
      const isPersonalBest =
        driver.bestLapTime !== null &&
        driver.lastLapTime !== null &&
        driver.lastLapTime === driver.bestLapTime;
      return (
        <div className="flex items-center justify-end w-full h-full">
          <RollingLapTime
            timeSeconds={driver.bestLapTime}
            isPersonalBest={isPersonalBest}
          />
        </div>
      );
    }

    case 'sector1': {
      const colour = sectorColour(driver.sectors.s1Status);
      return (
        <div className={cn('flex items-center justify-end w-full h-full font-mono text-xs', colour)}>
          {formatSectorTime(driver.sectors.s1)}
        </div>
      );
    }

    case 'sector2': {
      const colour = sectorColour(driver.sectors.s2Status);
      return (
        <div className={cn('flex items-center justify-end w-full h-full font-mono text-xs', colour)}>
          {formatSectorTime(driver.sectors.s2)}
        </div>
      );
    }

    case 'sector3': {
      const colour = sectorColour(driver.sectors.s3Status);
      return (
        <div className={cn('flex items-center justify-end w-full h-full font-mono text-xs', colour)}>
          {formatSectorTime(driver.sectors.s3)}
        </div>
      );
    }

    case 'tyre': {
      return (
        <div className="flex items-center justify-center w-full h-full">
          <TyreBadge compound={driver.tyreCompound} lapAge={driver.tyreLapAge} size="sm" />
        </div>
      );
    }

    case 'tyreAge': {
      return (
        <div className="flex items-center justify-end w-full h-full">
          <span className="font-mono text-xs text-slate-300">{driver.tyreLapAge}</span>
        </div>
      );
    }

    case 'lap': {
      return (
        <div className="flex items-center justify-center w-full h-full">
          <span className="font-mono text-xs text-slate-400">
            {driver.currentLap}{totalLaps ? `/${totalLaps}` : ''}
          </span>
        </div>
      );
    }

    case 'drs': {
      return (
        <div className="flex items-center justify-center w-full h-full">
          {driver.hasDrs ? (
            <span
              className="text-[9px] font-bold font-mono px-1 py-0.5 rounded bg-green-900/60 text-green-400 ring-1 ring-green-500/30 leading-tight"
              aria-label="DRS open"
            >
              DRS
            </span>
          ) : (
            <span
              className="text-[9px] font-bold font-mono px-1 py-0.5 rounded bg-slate-800 text-slate-600 leading-tight"
              aria-label="DRS closed"
            >
              DRS
            </span>
          )}
        </div>
      );
    }

    case 'speed': {
      return (
        <div className="flex items-center justify-end gap-0.5 w-full h-full">
          <span className="font-mono text-xs text-slate-300 tabular-nums">
            {driver.speed !== null ? driver.speed : '--'}
          </span>
          <span className="text-[9px] text-slate-600">km/h</span>
        </div>
      );
    }

    case 'throttle': {
      const pct = driver.throttle ?? 0;
      return (
        <div className="flex items-center w-full h-full px-1">
          <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-green-500 rounded transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              aria-label={`Throttle ${pct}%`}
            />
          </div>
        </div>
      );
    }

    case 'pitstops': {
      const dots = Math.min(driver.pitStopCount, 8); // cap visual at 8
      return (
        <div className="flex items-center justify-center gap-0.5 w-full h-full flex-wrap">
          {Array.from({ length: dots }).map((_, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-slate-500 shrink-0"
              aria-hidden="true"
            />
          ))}
          {driver.pitStopCount === 0 && (
            <span className="font-mono text-xs text-slate-600">0</span>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

// GUID: PIT_WALL_RACE_TABLE-007-v02
// [Intent] Row background tint based on driver state (retired, in pit, fastest, leader).
//          v02: Adds CSS position-change flash — green for gained, red for lost.
//          Flash is a 1.5s ease-out animation that fires on every React reconciliation
//          where positionChange !== 0 (browser de-dups identical animation names).
function rowBgClass(driver: DriverRaceState): string {
  if (driver.retired) return 'opacity-40';
  if (driver.positionChange > 0) return 'animate-position-gain';
  if (driver.positionChange < 0) return 'animate-position-loss';
  if (driver.fastestLap) return 'bg-purple-950/30';
  if (driver.inPit) return 'bg-orange-950/20';
  if (driver.position === 1) return 'bg-yellow-950/10';
  return '';
}

// GUID: PIT_WALL_RACE_TABLE-008-v01
// [Intent] Header column sort indicator — ↑ active ascending, ↓ active descending, ↕ sortable but inactive.
function SortIndicator({ colKey, sortKey }: { colKey: string; sortKey: string | null }) {
  if (sortKey !== colKey) return <span className="text-slate-700 ml-0.5">↕</span>;
  return <span className="text-blue-400 ml-0.5">↑</span>;
}

// GUID: PIT_WALL_RACE_TABLE-011-v03
// [Intent] Plain div row with follow-mode highlight. Click anywhere on the row to
//          toggle follow-mode camera in the track map. Orange ring when followed.
function DriverRow({
  driver,
  unreadCount,
  visibleColDefs,
  gridTemplate,
  onRadioClick,
  onDriverClick,
  isFollowed,
  totalLaps,
}: {
  driver: DriverRaceState;
  unreadCount: number;
  visibleColDefs: typeof PIT_WALL_COLUMNS;
  gridTemplate: string;
  onRadioClick: () => void;
  onDriverClick?: () => void;
  isFollowed?: boolean;
  totalLaps: number | null;
}) {
  return (
    <div
      className={cn(
        'grid border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors cursor-pointer',
        rowBgClass(driver),
        isFollowed && 'ring-1 ring-inset ring-orange-500/50 bg-orange-950/10'
      )}
      style={{ gridTemplateColumns: gridTemplate, contain: 'content' }}
      role="row"
      aria-label={`${driver.driverCode} position ${driver.position}`}
      onClick={onDriverClick}
    >
      {visibleColDefs.map((col) => (
        <div
          key={col.key}
          className={cn(
            'px-2 py-1.5 overflow-hidden',
            col.key === 'position' && 'border-l-2'
          )}
          style={
            col.key === 'position'
              ? { borderLeftColor: positionBorderColour(driver.position) }
              : undefined
          }
          role="cell"
        >
          <CellContent
            columnKey={col.key}
            driver={driver}
            unreadCount={unreadCount}
            onRadioClick={onRadioClick}
            totalLaps={totalLaps}
          />
        </div>
      ))}
    </div>
  );
}

// GUID: PIT_WALL_RACE_TABLE-009-v02
// [Intent] Main PitWallRaceTable component — sticky header + row list.
//          v02: Holds last valid driver data in a ref so the table never flashes
//               "Waiting for session data" between poll cycles or replay frames.
//               Only shows the empty state if we've NEVER received any data.
export function PitWallRaceTable({
  drivers,
  radioMessages,
  visibleColumns,
  radioState,
  onRadioClick,
  onDriverClick,
  followDriver,
  sortKey,
  onSort,
  totalLaps,
  className,
}: PitWallRaceTableProps) {
  // GUID: PIT_WALL_RACE_TABLE-012-v01
  // [Intent] Cache last non-empty driver array so the table keeps rendering stale rows
  //          while new data is in transit. Prevents "Waiting for session data" flash
  //          between live polls (every 5-60s) and replay frame updates.
  const lastDriversRef = useRef<DriverRaceState[]>([]);
  const displayDrivers = drivers.length > 0 ? drivers : lastDriversRef.current;
  if (drivers.length > 0) lastDriversRef.current = drivers;

  const isStale = drivers.length === 0 && displayDrivers.length > 0;

  const sortedDrivers = useMemo(
    () => sortDrivers(displayDrivers, sortKey),
    [displayDrivers, sortKey]
  );

  const gridTemplate = useMemo(
    () => buildGridTemplate(visibleColumns),
    [visibleColumns]
  );

  const visibleColDefs = useMemo(
    () => PIT_WALL_COLUMNS.filter(c => visibleColumns.includes(c.key)),
    [visibleColumns]
  );

  // Stabilise per-driver radio click callbacks
  const radioClickCallbacks = useMemo(() => {
    const map = new Map<number, () => void>();
    for (const driver of displayDrivers) {
      map.set(driver.driverNumber, () => onRadioClick(driver.driverNumber));
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayDrivers, onRadioClick]);

  if (displayDrivers.length === 0) {
    return (
      <div className={cn('flex-1 flex items-center justify-center text-slate-600 text-sm', className)}>
        Waiting for session data…
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full relative', className)}>
      {/* Stale data indicator — shows when holding cached data between updates */}
      {isStale && (
        <div className="absolute top-0 right-0 z-20 px-2 py-0.5 text-[9px] text-slate-600 bg-slate-900/80 rounded-bl">
          updating…
        </div>
      )}

      {/* ── Header row ── */}
      <div
        className="grid sticky top-0 z-10 bg-slate-950 border-b border-slate-800 shrink-0"
        style={{ gridTemplateColumns: gridTemplate }}
        role="row"
        aria-label="Column headers"
      >
        {visibleColDefs.map((col) => (
          <div
            key={col.key}
            className={cn(
              'px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider select-none flex items-center',
              col.sortable ? 'cursor-pointer hover:text-slate-300 transition-colors' : 'cursor-default',
              col.align === 'right'  && 'justify-end',
              col.align === 'center' && 'justify-center',
              col.align === 'left'   && 'justify-start',
              col.key === 'position' && 'border-l-2 border-transparent'
            )}
            onClick={col.sortable ? () => onSort(col.key) : undefined}
            role={col.sortable ? 'button' : undefined}
            aria-sort={col.sortable && sortKey === col.key ? 'ascending' : undefined}
            title={col.description}
          >
            <span>{col.label}</span>
            {col.sortable && <SortIndicator colKey={col.key} sortKey={sortKey} />}
          </div>
        ))}
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" role="rowgroup">
        {sortedDrivers.map((driver) => (
          <DriverRow
            key={driver.driverNumber}
            driver={driver}
            unreadCount={radioState.unreadCountFor(driver.driverNumber, radioMessages)}
            visibleColDefs={visibleColDefs}
            gridTemplate={gridTemplate}
            onRadioClick={radioClickCallbacks.get(driver.driverNumber) ?? (() => onRadioClick(driver.driverNumber))}
            onDriverClick={onDriverClick ? () => onDriverClick(driver.driverNumber) : undefined}
            isFollowed={followDriver === driver.driverNumber}
            totalLaps={totalLaps}
          />
        ))}
      </div>
    </div>
  );
}
