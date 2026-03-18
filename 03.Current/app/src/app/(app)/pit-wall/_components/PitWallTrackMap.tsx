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

import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { DriverRaceState, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';

// GUID: PIT_WALL_TRACK_MAP-001-v07
// [Intent] Props interface — MUST remain identical to the v06 interface so PitWallClient
//          imports don't break. circuitLat and circuitLon are kept for compatibility even
//          though the PixiJS renderer does not use them (bounds + circuitPath are sufficient).
interface PitWallTrackMapProps {
  drivers: DriverRaceState[];
  updateIntervalMs: number;
  bounds: TrackBounds | null;
  circuitPath: CircuitPoint[];
  circuitLat: number | null;
  circuitLon: number | null;
  rainIntensity: number | null;
  sessionType: string | null;
  hasLiveSession: boolean;
  positionDataAvailable: boolean;
  nextRaceName: string | null;
  lastMeetingName: string | null;
  followDriver: number | null;
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
  rainIntensity,
  sessionType,
  hasLiveSession,
  positionDataAvailable,
  nextRaceName,
  lastMeetingName,
  followDriver,
  className,
}: PitWallTrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PixiTrackAppInstance | null>(null);

  // GUID: PIT_WALL_TRACK_MAP-004-v07
  // [Intent] Create PixiTrackApp on mount, destroy on unmount.
  //          Dynamic import() prevents PixiJS from loading during SSR (Next.js server render)
  //          since PixiJS requires a browser environment (WebGL context, DOM, window).
  //          The `cancelled` flag guards against the import resolving after the component
  //          has already unmounted (React strict mode double-mount in dev).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let app: PixiTrackAppInstance | null = null;
    let cancelled = false;

    import('../_pixi/PixiTrackApp').then(({ PixiTrackApp }) => {
      if (cancelled) return;
      app = new PixiTrackApp(el);
      pixiAppRef.current = app;
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
    });
  }, [
    drivers, bounds, circuitPath, updateIntervalMs, followDriver,
    rainIntensity, sessionType, hasLiveSession, positionDataAvailable,
    nextRaceName, lastMeetingName,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden bg-[#0a0a0e] rounded-lg', className)}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
