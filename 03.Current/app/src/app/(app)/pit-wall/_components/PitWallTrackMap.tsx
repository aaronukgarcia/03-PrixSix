// GUID: PIT_WALL_TRACK_MAP-000-v07
// [Intent] Thin React shell for the PixiJS WebGL track map.
//          v07: Complete rewrite — all rendering moved to PixiTrackApp (WebGL via PixiJS v8).
//               React manages data lifecycle; PixiJS manages rendering lifecycle.
//               The PixiTrackApp is dynamically imported to avoid SSR issues with PixiJS.
//               circuitLat/circuitLon props retained for interface compatibility with
//               PitWallClient even though they are unused by the PixiJS renderer.
// [Inbound Trigger] Rendered in the Pit Wall layout. Receives DriverRaceState[] from PitWallClient.
// [Downstream Impact] Creates and owns a PixiTrackApp instance. No Firestore reads/writes.

'use client';

import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { DriverRaceState, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';

// GUID: PIT_WALL_TRACK_MAP-001-v09
// [Intent] Props interface — extends v07 with zoomLevel + focusPosition for the 3-tier
//          zoom system. circuitLat and circuitLon kept for compatibility.
//          v08: Added zoomLevel (0|1|2) and focusPosition for Zoom 2 hyper-focus mode.
//          v09: Added virtualTimeDeltaMs for replay mode — passed through to PixiTrackApp
//               so the impossible-travel filter uses virtual time instead of wall time.
interface PitWallTrackMapProps {
  drivers: DriverRaceState[];
  updateIntervalMs: number;
  bounds: TrackBounds | null;
  circuitPath: CircuitPoint[];
  circuitLat: number | null;
  circuitLon: number | null;
  sfLineX: number | null;
  sfLineY: number | null;
  rainIntensity: number | null;
  sessionType: string | null;
  hasLiveSession: boolean;
  positionDataAvailable: boolean;
  nextRaceName: string | null;
  lastMeetingName: string | null;
  followDriver: number | null;
  trailEnabled?: boolean;
  trailTtlMs?: number;
  zoomLevel?: 0 | 1 | 2;
  focusPosition?: number;
  virtualTimeDeltaMs?: number;
  sessionKey?: string | null;
  bloomEnabled?: boolean;
  className?: string;
}

// GUID: PIT_WALL_TRACK_MAP-002-v07
// [Intent] Type alias for the dynamically imported PixiTrackApp class. Using `any` here
//          because the import is dynamic (to avoid SSR) and TypeScript cannot resolve the
//          type at compile time without importing the module statically.
type PixiTrackAppInstance = {
  setData: (opts: {
    drivers: DriverRaceState[];
    bounds: TrackBounds | null;
    circuitPath: CircuitPoint[];
    updateIntervalMs: number;
    followDriver: number | null;
    rainIntensity: number | null;
    sessionType: string | null;
    hasLiveSession: boolean;
    positionDataAvailable: boolean;
    nextRaceName: string | null;
    lastMeetingName: string | null;
    trailEnabled?: boolean;
    trailTtlMs?: number;
    sfLineX?: number | null;
    sfLineY?: number | null;
    zoomLevel?: 0 | 1 | 2;
    focusPosition?: number;
    virtualTimeDeltaMs?: number;
    sessionKey?: string | null;
    bloomEnabled?: boolean;
  }) => void;
  destroy: () => void;
};

// GUID: PIT_WALL_TRACK_MAP-003-v07
// [Intent] Main component. Creates a PixiTrackApp on mount (via dynamic import to avoid SSR),
//          pushes data on every prop change via setData(), and destroys on unmount.
//          The div ref is passed to PixiTrackApp which appends its own canvas element.
export function PitWallTrackMap({
  drivers,
  updateIntervalMs,
  bounds,
  circuitPath,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  circuitLat,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  circuitLon,
  sfLineX,
  sfLineY,
  rainIntensity,
  sessionType,
  hasLiveSession,
  positionDataAvailable,
  nextRaceName,
  lastMeetingName,
  followDriver,
  trailEnabled,
  trailTtlMs,
  zoomLevel,
  focusPosition,
  virtualTimeDeltaMs,
  sessionKey,
  bloomEnabled,
  className,
}: PitWallTrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PixiTrackAppInstance | null>(null);
  // GUID: PIT_WALL_TRACK_MAP-006-v01
  // [Intent] Ready signal — increments when the dynamic import resolves and PixiTrackApp
  //          is created. Added to the data-push useEffect dep array so that setData() is
  //          guaranteed to fire with current props after the app is ready. Without this,
  //          setData calls during the async import window are lost (null?.setData() = no-op)
  //          and the PixiTrackApp starts with empty drivers → no car dots.
  const [pixiReady, setPixiReady] = useState(0);

  // GUID: PIT_WALL_TRACK_MAP-004-v08
  // [Intent] Create PixiTrackApp on mount, destroy on unmount.
  //          Dynamic import() prevents PixiJS from loading during SSR (Next.js server render).
  //          v08: Sets pixiReady state after import resolves, triggering the data-push
  //               useEffect to re-run with current props.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let app: PixiTrackAppInstance | null = null;
    let cancelled = false;

    import('../_pixi/PixiTrackApp').then(({ PixiTrackApp }) => {
      if (cancelled) return;
      app = new PixiTrackApp(el);
      pixiAppRef.current = app;
      setPixiReady(c => c + 1); // trigger data-push useEffect
    });

    return () => {
      cancelled = true;
      if (app) app.destroy();
      pixiAppRef.current = null;
    };
  }, []);

  // GUID: PIT_WALL_TRACK_MAP-005-v07
  // [Intent] Push data to PixiJS on every prop change. This is the React→PixiJS bridge:
  //          React owns the data lifecycle (fetch, state, props), PixiJS owns the render
  //          lifecycle (60fps ticker, WebGL draw calls). setData() is a non-blocking call
  //          that updates cached values inside PixiTrackApp — the next ticker frame picks
  //          them up automatically.
  useEffect(() => {
    pixiAppRef.current?.setData({
      drivers,
      bounds,
      circuitPath,
      updateIntervalMs,
      followDriver,
      rainIntensity,
      sessionType,
      hasLiveSession,
      positionDataAvailable,
      nextRaceName,
      lastMeetingName,
      trailEnabled,
      trailTtlMs,
      sfLineX,
      sfLineY,
      zoomLevel,
      focusPosition,
      virtualTimeDeltaMs,
      sessionKey,
      bloomEnabled,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pixiReady, // <-- forces re-run after dynamic import resolves
    drivers, bounds, circuitPath, updateIntervalMs, followDriver,
    rainIntensity, sessionType, hasLiveSession, positionDataAvailable,
    nextRaceName, lastMeetingName, trailEnabled, trailTtlMs, sfLineX, sfLineY,
    zoomLevel, focusPosition, virtualTimeDeltaMs, sessionKey, bloomEnabled,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden bg-[#0a0a0e] rounded-lg', className)}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
