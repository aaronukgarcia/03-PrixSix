// GUID: PIT_WALL_CLIENT-000-v02
// [Intent] Client-side orchestrator for the Pit Wall live race data module.
//          Wires all hooks, manages layout (track map + FIA feed header, toolbar,
//          race table, radio zoom panel), and enforces the dark F1 aesthetic.
//          v02: Pre-Race Showreel integration — plays 2025 historical telemetry
//               before live sessions via usePreRaceMode + useHistoricalReplay.
// [Inbound Trigger] Rendered by page.tsx (server component) on every /pit-wall request.
// [Downstream Impact] All Pit Wall state and data flow originates here.
//                     Sub-components receive only the props they need — no prop drilling
//                     beyond one level.

'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from '@/firebase';
import { usePitWallSettings } from './_hooks/usePitWallSettings';
import { usePitWallData } from './_hooks/usePitWallData';
import { useRadioState } from './_hooks/useRadioState';
import { useCarInterpolation } from './_hooks/useCarInterpolation';
import { usePreRaceMode } from './_hooks/usePreRaceMode';
import { useHistoricalReplay } from './_hooks/useHistoricalReplay';
import type { TrackBounds, DriverRaceState } from './_types/pit-wall.types';
import type { ReplayDriverState } from './_types/showreel.types';
import { PitWallTrackMap } from './_components/PitWallTrackMap';
import { FIARaceControlFeed } from './_components/FIARaceControlFeed';
import { PitWallRaceTable } from './_components/PitWallRaceTable';
import { RadioZoomPanel } from './_components/RadioZoomPanel';
import { UpdateSpeedSlider } from './_components/UpdateSpeedSlider';
import { ColumnSelector } from './_components/ColumnSelector';
import { WeatherStrip } from './_components/WeatherStrip';
import { PreRaceWarmupBanner } from './_components/PreRaceWarmupBanner';
import { ShowreelSplash } from './_components/ShowreelSplash';
import { RaceSelector } from './_components/RaceSelector';
import { AlertCircle, RefreshCw, TowerControl } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RaceSchedule } from '@/lib/data';

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

// GUID: PIT_WALL_CLIENT-010-v01
// [Intent] Find the next upcoming race from the schedule that has not yet started.
//          Returns null if all races are in the past.
function findNextRaceFromSchedule(): { name: string; raceStart: Date; location: string; isSprintNext: boolean } | null {
  const now = new Date();
  for (const race of RaceSchedule) {
    // Check if sprint is upcoming before the main race
    if (race.hasSprint && race.sprintTime) {
      const sprintStart = new Date(race.sprintTime);
      const raceStart = new Date(race.raceTime);
      if (sprintStart > now) {
        return { name: `${race.name} (Sprint)`, raceStart: sprintStart, location: race.location, isSprintNext: true };
      }
      if (raceStart > now) {
        return { name: race.name, raceStart, location: race.location, isSprintNext: false };
      }
    } else {
      const raceStart = new Date(race.raceTime);
      if (raceStart > now) {
        return { name: race.name, raceStart, location: race.location, isSprintNext: false };
      }
    }
  }
  return null;
}

// GUID: PIT_WALL_CLIENT-011-v01
// [Intent] Cast ReplayDriverState[] to DriverRaceState[] for drop-in compatibility.
//          The replay type uses the same field names with identical types — cast is safe.
function castReplayToLive(replay: ReplayDriverState[]): DriverRaceState[] {
  return replay as unknown as DriverRaceState[];
}

// GUID: PIT_WALL_CLIENT-002-v02
// [Intent] Main orchestrator component — assembles the full Pit Wall layout.
//          Layout regions:
//            Showreel banner (optional, h-12): PreRaceWarmupBanner when in showreel mode
//            Header (280px): TrackMap (2/3 width) | FIA Feed (1/3 width)
//            Toolbar: UpdateSpeedSlider | ColumnSelector | RaceSelector (showreel) | session info
//            Body: PitWallRaceTable (scrollable, fills remaining height)
//            Bottom panel: RadioZoomPanel (slides up 50vh when open)
//            Full overlay: ShowreelSplash (between historical races)
// [Inbound Trigger] Rendered by page.tsx.
// [Downstream Impact] All child components receive data via props — no child
//                     components fetch independently.
export default function PitWallClient() {
  const { firebaseUser } = useAuth();

  // GUID: PIT_WALL_CLIENT-012-v01
  // [Intent] Maintain a fresh Firebase ID token for showreel API calls.
  //          Refreshed when firebaseUser changes (token auto-refreshes every ~55min).
  const [idToken, setIdToken] = useState<string | null>(null);
  useEffect(() => {
    if (!firebaseUser) { setIdToken(null); return; }
    firebaseUser.getIdToken().then(setIdToken).catch(() => setIdToken(null));
  }, [firebaseUser]);

  // Settings (localStorage)
  const {
    settings,
    setUpdateInterval,
    toggleColumn,
    setRadioZoomMode,
    isHighFrequency,
    intervalIsTemporary,
    intervalResetMinutes,
  } = usePitWallSettings();

  // Live data polling
  const {
    drivers: liveDrivers,
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

  // Next race from schedule
  const nextRaceInfo = useMemo(() => findNextRaceFromSchedule(), []);

  // GUID: PIT_WALL_CLIENT-013-v01
  // [Intent] Pre-race showreel state machine — determines when to play historical replay.
  const preRaceMode = usePreRaceMode(
    !!sessionKey,
    nextRaceInfo?.raceStart ?? null,
    nextRaceInfo?.name ?? '',
    idToken,
    nextRaceInfo?.location ?? null,
  );

  // GUID: PIT_WALL_CLIENT-014-v01
  // [Intent] Historical replay hook — RAF playback of 2025 telemetry.
  //          Active when preRaceMode.isShowreel is true.
  const historicalReplay = useHistoricalReplay(
    preRaceMode.currentItem?.session ?? preRaceMode.onDemandSession ?? null,
    preRaceMode.currentItem?.compressionFactor ?? 1.0,
    idToken,
    () => {
      // Replay of current item completed — preRaceMode ticker will advance automatically
    },
  );

  // Radio state (read/unread, mute — localStorage)
  const radioState = useRadioState(sessionKey);

  // GUID: PIT_WALL_CLIENT-015-v01
  // [Intent] Select data source: live data when session is active, replay data when showreel.
  const activeDrivers: DriverRaceState[] = useMemo(() => {
    if (preRaceMode.isShowreel && historicalReplay.replayDrivers.length > 0) {
      return castReplayToLive(historicalReplay.replayDrivers);
    }
    return liveDrivers;
  }, [preRaceMode.isShowreel, historicalReplay.replayDrivers, liveDrivers]);

  // Car interpolation (RAF 60fps smooth movement)
  const interpolatedPositions = useCarInterpolation(
    activeDrivers,
    preRaceMode.isShowreel ? 5000 : settings.updateIntervalSeconds * 1000
  );

  // Track bounds derived from driver GPS positions
  const trackBounds = useMemo(() => computeTrackBounds(activeDrivers), [activeDrivers]);

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

  // Session display: in showreel mode, show historical race name instead of live session
  const displayMeetingName = preRaceMode.isShowreel
    ? (preRaceMode.currentItem?.session.meetingName ?? preRaceMode.onDemandSession?.meetingName ?? meetingName)
    : meetingName;
  const displaySessionType = preRaceMode.isShowreel
    ? (preRaceMode.currentItem?.session.sessionType ?? preRaceMode.onDemandSession?.sessionType ?? sessionType)
    : sessionType;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-950">

      {/* ── SHOWREEL BETWEEN SPLASH (full overlay) ── */}
      <AnimatePresence>
        {preRaceMode.mode === 'SHOWREEL_BETWEEN' && (
          <ShowreelSplash
            upNextRaceName={
              preRaceMode.schedule?.items[preRaceMode.currentItemIndex + 1]?.session.meetingName
              ?? nextRaceInfo?.name
              ?? 'Next Race'
            }
            onComplete={() => {/* preRaceMode ticker handles the transition */}}
          />
        )}
      </AnimatePresence>

      {/* ── PRE-RACE WARMUP BANNER ── */}
      {/* GUID: PIT_WALL_CLIENT-016-v01 */}
      {preRaceMode.isShowreel && (
        <PreRaceWarmupBanner
          currentRaceName={
            `2025 ${preRaceMode.currentItem?.session.meetingName
              ?? preRaceMode.onDemandSession?.meetingName
              ?? 'Race'}`
          }
          nextRaceName={nextRaceInfo?.name ?? 'Next Race'}
          minutesToStart={preRaceMode.minutesToRaceStart}
          isCountdown={preRaceMode.mode === 'COUNTDOWN'}
        />
      )}

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
            sessionType={displaySessionType}
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
            {displayMeetingName ?? sessionName ?? 'Pit Wall'}
          </span>
          {displaySessionType && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 uppercase tracking-wider">
              {preRaceMode.isShowreel ? '2025 REPLAY' : displaySessionType}
            </span>
          )}
        </div>

        {/* Weather strip */}
        <WeatherStrip weather={weather} className="flex-1 min-w-0" />

        {/* Showreel replay progress */}
        {preRaceMode.isShowreel && historicalReplay.durationSeconds > 0 && (
          <div className="flex items-center gap-2 text-[10px] text-orange-400">
            <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-1000"
                style={{ width: `${(historicalReplay.progress * 100).toFixed(1)}%` }}
              />
            </div>
            <span className="tabular-nums">
              {Math.floor(historicalReplay.elapsedSeconds / 60)}:{String(Math.floor(historicalReplay.elapsedSeconds % 60)).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* High frequency warning */}
        {isHighFrequency && !preRaceMode.isShowreel && (
          <span className="text-[10px] text-orange-400 border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 rounded whitespace-nowrap">
            High data use
          </span>
        )}

        {/* Race selector (showreel mode only) */}
        {preRaceMode.isShowreel && preRaceMode.schedule && (
          <RaceSelector
            sessions={preRaceMode.schedule.items.map(i => i.session)}
            currentSession={preRaceMode.currentItem?.session ?? preRaceMode.onDemandSession ?? null}
            onSelectSession={preRaceMode.onRaceSelect}
          />
        )}

        {/* Controls */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          {!preRaceMode.isShowreel && (
            <div className="flex items-center gap-1.5">
              <UpdateSpeedSlider
                value={settings.updateIntervalSeconds}
                onChange={setUpdateInterval}
              />
              {intervalIsTemporary && (
                <span
                  className="text-[9px] text-amber-400 tabular-nums whitespace-nowrap"
                  title={`Custom refresh rate resets to 60s in ${intervalResetMinutes}m`}
                >
                  ↺{intervalResetMinutes}m
                </span>
              )}
            </div>
          )}
          <ColumnSelector
            visibleColumns={settings.visibleColumns}
            onToggle={toggleColumn}
          />
          {!preRaceMode.isShowreel && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:text-slate-200"
              onClick={forceRefresh}
              title="Refresh now"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </Button>
          )}
          {lastUpdatedLabel && !preRaceMode.isShowreel && (
            <span className="text-[9px] text-slate-600 font-mono tabular-nums whitespace-nowrap">
              {lastUpdatedLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── ERROR BANNER ── */}
      {/* GUID: PIT_WALL_CLIENT-007-v01 */}
      {error && !preRaceMode.isShowreel && (
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
          drivers={activeDrivers}
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
        drivers={activeDrivers}
        radioMessages={radioMessages}
        radioState={radioState}
        selectedDriver={selectedRadioDriver}
        onSelectDriver={setSelectedRadioDriver}
      />
    </div>
  );
}
