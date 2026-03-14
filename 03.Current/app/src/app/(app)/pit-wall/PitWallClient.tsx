// GUID: PIT_WALL_CLIENT-000-v01
// [Intent] Client-side orchestrator for the Pit Wall live race data module.
//          Wires all hooks, manages layout (track map + FIA feed header, toolbar,
//          race table, radio zoom panel), and enforces the dark F1 aesthetic.
// [Inbound Trigger] Rendered by page.tsx (server component) on every /pit-wall request.
// [Downstream Impact] All Pit Wall state and data flow originates here.
//                     Sub-components receive only the props they need — no prop drilling
//                     beyond one level.

'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/firebase';
import { usePitWallSettings } from './_hooks/usePitWallSettings';
import { usePitWallData } from './_hooks/usePitWallData';
import { useRadioState } from './_hooks/useRadioState';
import { useCarInterpolation } from './_hooks/useCarInterpolation';
import type { TrackBounds } from './_types/pit-wall.types';
import { PitWallTrackMap } from './_components/PitWallTrackMap';
import { FIARaceControlFeed } from './_components/FIARaceControlFeed';
import { PitWallRaceTable } from './_components/PitWallRaceTable';
import { RadioZoomPanel } from './_components/RadioZoomPanel';
import { UpdateSpeedSlider } from './_components/UpdateSpeedSlider';
import { ColumnSelector } from './_components/ColumnSelector';
import { WeatherStrip } from './_components/WeatherStrip';
import { AlertCircle, RefreshCw, TowerControl } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// GUID: PIT_WALL_CLIENT-001-v01
// [Intent] Derive track bounds from current driver GPS positions.
//          Used by PitWallTrackMap to project projected-metre coords to canvas pixels.
//          Returns null when no position data is available yet.
function computeTrackBounds(
  drivers: { x: number | null; y: number | null }[]
): TrackBounds | null {
  const xs = drivers.map(d => d.x).filter((v): v is number => v !== null);
  const ys = drivers.map(d => d.y).filter((v): v is number => v !== null);
  if (xs.length < 2 || ys.length < 2) return null;
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// GUID: PIT_WALL_CLIENT-002-v01
// [Intent] Main orchestrator component — assembles the full Pit Wall layout.
//          Layout regions:
//            Header (280px): TrackMap (2/3 width) | FIA Feed (1/3 width)
//            Toolbar: UpdateSpeedSlider | ColumnSelector | session info
//            Body: PitWallRaceTable (scrollable, fills remaining height)
//            Bottom panel: RadioZoomPanel (slides up 50vh when open)
// [Inbound Trigger] Rendered by page.tsx.
// [Downstream Impact] All child components receive data via props — no child
//                     components fetch independently.
export default function PitWallClient() {
  const { firebaseUser } = useAuth();

  // Settings (localStorage)
  const {
    settings,
    setUpdateInterval,
    toggleColumn,
    setRadioZoomMode,
    isHighFrequency,
  } = usePitWallSettings();

  // Live data polling
  const {
    drivers,
    raceControl,
    radioMessages,
    weather,
    sessionKey,
    sessionName,
    meetingName,
    sessionType,
    circuitLat,
    circuitLon,
    totalLaps,
    isLoading,
    error,
    errorCode,
    correlationId,
    lastUpdated,
    forceRefresh,
  } = usePitWallData(settings.updateIntervalSeconds, firebaseUser);

  // Radio state (read/unread, mute — localStorage)
  const radioState = useRadioState(sessionKey);

  // Car interpolation (RAF 60fps smooth movement)
  const interpolatedPositions = useCarInterpolation(
    drivers,
    settings.updateIntervalSeconds * 1000
  );

  // Track bounds derived from driver GPS positions
  const trackBounds = useMemo(() => computeTrackBounds(drivers), [drivers]);

  // Table sort state
  const [sortKey, setSortKey] = useState<string | null>(null);

  // GUID: PIT_WALL_CLIENT-003-v01
  // [Intent] Radio zoom panel state — selected driver and open/close.
  const [radioZoomOpen, setRadioZoomOpen] = useState(false);
  const [selectedRadioDriver, setSelectedRadioDriver] = useState<number | null>(null);

  const handleRadioClick = (driverNumber: number) => {
    setSelectedRadioDriver(driverNumber);
    setRadioZoomOpen(true);
    setRadioZoomMode(true);
  };

  const handleRadioClose = () => {
    setRadioZoomOpen(false);
    setRadioZoomMode(false);
  };

  const handleSort = (key: string) => {
    setSortKey(prev => (prev === key ? null : key));
  };

  // GUID: PIT_WALL_CLIENT-004-v01
  // [Intent] Format last-updated timestamp for the toolbar display.
  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-950">

      {/* ── HEADER: Track Map (2/3) + FIA Feed (1/3) ── */}
      {/* GUID: PIT_WALL_CLIENT-005-v01 */}
      <div className="flex shrink-0 h-[280px] border-b border-slate-800">
        {/* Track map */}
        <div className="flex-[2] min-w-0 border-r border-slate-800">
          <PitWallTrackMap
            positions={interpolatedPositions}
            bounds={trackBounds}
            circuitLat={circuitLat}
            circuitLon={circuitLon}
            rainIntensity={weather?.rainIntensity ?? null}
            sessionType={sessionType}
            className="w-full h-full"
          />
        </div>
        {/* FIA race control feed */}
        <div className="flex-[1] min-w-0 min-h-0">
          <FIARaceControlFeed messages={raceControl} className="h-full" />
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      {/* GUID: PIT_WALL_CLIENT-006-v01 */}
      <div className="flex shrink-0 items-center gap-4 px-4 py-2 border-b border-slate-800 bg-slate-950">
        {/* Session identity */}
        <div className="flex items-center gap-2 mr-2">
          <TowerControl className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest truncate max-w-[200px]">
            {meetingName ?? sessionName ?? 'Pit Wall'}
          </span>
          {sessionType && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 uppercase tracking-wider">
              {sessionType}
            </span>
          )}
        </div>

        {/* Weather strip */}
        <WeatherStrip weather={weather} className="flex-1 min-w-0" />

        {/* High frequency warning */}
        {isHighFrequency && (
          <span className="text-[10px] text-orange-400 border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 rounded whitespace-nowrap">
            High data use
          </span>
        )}

        {/* Controls */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          <UpdateSpeedSlider
            value={settings.updateIntervalSeconds}
            onChange={setUpdateInterval}
          />
          <ColumnSelector
            visibleColumns={settings.visibleColumns}
            onToggle={toggleColumn}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-500 hover:text-slate-200"
            onClick={forceRefresh}
            title="Refresh now"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </Button>
          {lastUpdatedLabel && (
            <span className="text-[9px] text-slate-600 font-mono tabular-nums whitespace-nowrap">
              {lastUpdatedLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── ERROR BANNER ── */}
      {/* GUID: PIT_WALL_CLIENT-007-v01 */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-950/50 border-b border-red-900/50 text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          {errorCode && (
            <span className="font-mono text-[10px] select-all text-red-500">{errorCode}</span>
          )}
          {correlationId && (
            <span className="font-mono text-[10px] select-all text-red-600">{correlationId}</span>
          )}
        </div>
      )}

      {/* ── RACE TABLE (fills remaining height) ── */}
      {/* GUID: PIT_WALL_CLIENT-008-v01 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PitWallRaceTable
          drivers={drivers}
          radioMessages={radioMessages}
          visibleColumns={settings.visibleColumns}
          radioState={radioState}
          onRadioClick={handleRadioClick}
          sortKey={sortKey}
          onSort={handleSort}
          totalLaps={totalLaps}
          className="h-full"
        />
      </div>

      {/* ── RADIO ZOOM PANEL (slides up from bottom) ── */}
      {/* GUID: PIT_WALL_CLIENT-009-v01 */}
      <RadioZoomPanel
        isOpen={radioZoomOpen}
        onClose={handleRadioClose}
        drivers={drivers}
        radioMessages={radioMessages}
        radioState={radioState}
        selectedDriver={selectedRadioDriver}
        onSelectDriver={setSelectedRadioDriver}
      />
    </div>
  );
}
