// GUID: PIT_WALL_RACE_TABLE-000-v02
// [Intent] Div-grid race data table with Framer Motion row animations.
//          F1 timing tower style — driver rows reorder with spring physics.
// [Inbound Trigger] Rendered by PitWallClient as the primary race data view.
// [Downstream Impact] Reads DriverRaceState[] and RadioMessage[]; writes nothing.
//                     onRadioClick bubbles up to open RadioZoomPanel.

'use client';

import { useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { buildGridTemplate, PIT_WALL_COLUMNS } from '../_types/columns';
import type { DriverRaceState, RadioMessage, SectorStatus } from '../_types/pit-wall.types';
import type { UseRadioStateReturn } from '../_hooks/useRadioState';
import { RollingLapTime } from './RollingLapTime';
import { TyreBadge } from './TyreBadge';
import { DeltaIndicator } from './DeltaIndicator';
import { RadioIcon } from './RadioIcon';

// GUID: PIT_WALL_RACE_TABLE-001-v01
// [Intent] The grid container uses CSS grid-template-columns derived from visible columns.
//          Rows animate in/out and reorder using Framer Motion layoutId on the outer row div.
interface PitWallRaceTableProps {
  drivers: DriverRaceState[];
  radioMessages: RadioMessage[];
  visibleColumns: string[];
  radioState: UseRadioStateReturn;
  onRadioClick: (driverNumber: number) => void;
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

// GUID: PIT_WALL_RACE_TABLE-003-v01
// [Intent] Derive Tailwind text colour class from SectorStatus.
function sectorColour(status: SectorStatus): string {
  switch (status) {
    case 'session_best':  return 'text-green-400';
    case 'personal_best': return 'text-purple-400';
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

// GUID: PIT_WALL_RACE_TABLE-007-v01
// [Intent] Row background tint based on driver state (retired, in pit, fastest, leader).
function rowBgClass(driver: DriverRaceState): string {
  if (driver.retired) return 'opacity-40';
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

// GUID: PIT_WALL_RACE_TABLE-010-v01
// [Intent] Props for DriverRow — all values are primitives or stable references so
//          React.memo can do a cheap equality check without deep comparison.
interface DriverRowProps {
  driver: DriverRaceState;
  unreadCount: number;
  visibleColDefs: typeof PIT_WALL_COLUMNS;
  visibleColumns: string[];
  gridTemplate: string;
  onRadioClick: () => void;
  totalLaps: number | null;
  sortKey: string | null;
}

// GUID: PIT_WALL_RACE_TABLE-011-v01
// [Intent] Memoised per-driver row component — skips re-render when all driving data
//          and display config are unchanged between polls.
//          Custom comparator checks every field that affects visual output:
//          positional data, lap times, sectors, tyre, DRS, pit/retired flags,
//          radio unread count, column layout, and sort key.
//          onRadioClick must be a stable reference (useCallback in the parent) for
//          memo to be effective.
const DriverRow = memo(
  function DriverRow({
    driver,
    unreadCount,
    visibleColDefs,
    gridTemplate,
    onRadioClick,
    totalLaps,
  }: DriverRowProps) {
    return (
      <motion.div
        layoutId={`pw-row-${driver.driverNumber}`}
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ layout: { type: 'spring', stiffness: 500, damping: 40 } }}
        className={cn(
          'grid border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors',
          rowBgClass(driver)
        )}
        style={{ gridTemplateColumns: gridTemplate }}
        role="row"
        aria-label={`${driver.driverCode} position ${driver.position}`}
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
      </motion.div>
    );
  },
  (prev, next) => {
    const pd = prev.driver;
    const nd = next.driver;

    // Driver telemetry and state
    if (pd.driverNumber       !== nd.driverNumber)       return false;
    if (pd.position           !== nd.position)           return false;
    if (pd.positionChange     !== nd.positionChange)     return false;
    if (pd.lastLapTime        !== nd.lastLapTime)        return false;
    if (pd.bestLapTime        !== nd.bestLapTime)        return false;
    if (pd.gapToLeader        !== nd.gapToLeader)        return false;
    if (pd.intervalToAhead    !== nd.intervalToAhead)    return false;
    if (pd.sectors.s1         !== nd.sectors.s1)         return false;
    if (pd.sectors.s2         !== nd.sectors.s2)         return false;
    if (pd.sectors.s3         !== nd.sectors.s3)         return false;
    if (pd.sectors.s1Status   !== nd.sectors.s1Status)   return false;
    if (pd.sectors.s2Status   !== nd.sectors.s2Status)   return false;
    if (pd.sectors.s3Status   !== nd.sectors.s3Status)   return false;
    if (pd.tyreCompound       !== nd.tyreCompound)       return false;
    if (pd.tyreLapAge         !== nd.tyreLapAge)         return false;
    if (pd.pitStopCount       !== nd.pitStopCount)       return false;
    if (pd.hasDrs             !== nd.hasDrs)             return false;
    if (pd.retired            !== nd.retired)            return false;
    if (pd.inPit              !== nd.inPit)              return false;
    if (pd.speed              !== nd.speed)              return false;
    if (pd.throttle           !== nd.throttle)           return false;
    if (pd.currentLap         !== nd.currentLap)         return false;
    if (pd.fastestLap         !== nd.fastestLap)         return false;
    if (pd.teamColour         !== nd.teamColour)         return false;
    if (pd.driverCode         !== nd.driverCode)         return false;
    if (pd.hasUnreadRadio     !== nd.hasUnreadRadio)     return false;
    if (pd.isMuted            !== nd.isMuted)            return false;

    // Radio unread count (computed scalar passed from parent)
    if (prev.unreadCount      !== next.unreadCount)      return false;

    // Display config — shallow reference equality is sufficient because both are
    // derived from the same useMemo in the parent and only change when columns change.
    if (prev.visibleColumns   !== next.visibleColumns)   return false;
    if (prev.visibleColDefs   !== next.visibleColDefs)   return false;
    if (prev.gridTemplate     !== next.gridTemplate)     return false;
    if (prev.sortKey          !== next.sortKey)          return false;
    if (prev.totalLaps        !== next.totalLaps)        return false;

    // Callback — must be a stable useCallback reference in the parent
    if (prev.onRadioClick     !== next.onRadioClick)     return false;

    return true; // nothing changed — skip re-render
  }
);

// GUID: PIT_WALL_RACE_TABLE-009-v01
// [Intent] Main PitWallRaceTable component — sticky header + AnimatePresence animated row list.
export function PitWallRaceTable({
  drivers,
  radioMessages,
  visibleColumns,
  radioState,
  onRadioClick,
  sortKey,
  onSort,
  totalLaps,
  className,
}: PitWallRaceTableProps) {
  const sortedDrivers = useMemo(
    () => sortDrivers(drivers, sortKey),
    [drivers, sortKey]
  );

  const gridTemplate = useMemo(
    () => buildGridTemplate(visibleColumns),
    [visibleColumns]
  );

  const visibleColDefs = useMemo(
    () => PIT_WALL_COLUMNS.filter(c => visibleColumns.includes(c.key)),
    [visibleColumns]
  );

  // Stabilise per-driver radio click callbacks so React.memo comparisons on
  // onRadioClick reference equality are not invalidated on every parent render.
  // Each driver number gets its own stable callback; the map is keyed by driverNumber.
  const radioClickCallbacks = useMemo(() => {
    const map = new Map<number, () => void>();
    for (const driver of drivers) {
      map.set(driver.driverNumber, () => onRadioClick(driver.driverNumber));
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, onRadioClick]);

  if (drivers.length === 0) {
    return (
      <div className={cn('flex-1 flex items-center justify-center text-slate-600 text-sm', className)}>
        Waiting for session data…
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
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
        <AnimatePresence initial={false}>
          {sortedDrivers.map((driver) => (
            <DriverRow
              key={driver.driverNumber}
              driver={driver}
              unreadCount={radioState.unreadCountFor(driver.driverNumber, radioMessages)}
              visibleColDefs={visibleColDefs}
              visibleColumns={visibleColumns}
              gridTemplate={gridTemplate}
              onRadioClick={radioClickCallbacks.get(driver.driverNumber) ?? (() => onRadioClick(driver.driverNumber))}
              totalLaps={totalLaps}
              sortKey={sortKey}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
