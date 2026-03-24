// GUID: PIXI_TRACK_APP-000-v01
// [Intent] Main PixiJS Application lifecycle manager for the Pit Wall track map.
//          Coordinates all rendering layers (background, track, trails, cars) and
//          systems (interpolation, trails, camera). Created from a React shell via
//          dynamic import to avoid SSR issues. All rendering runs on the PixiJS v8
//          WebGL ticker at 60fps — React only pushes data in via setData().
// [Inbound Trigger] Instantiated by PitWallTrackMap React component on mount.
// [Downstream Impact] Owns the PixiJS Application and canvas lifecycle. Destroyed on unmount.

import { Application, Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { BackgroundLayer } from './layers/BackgroundLayer';
import { TrackLayer } from './layers/TrackLayer';
import { CarLayer } from './layers/CarLayer';
import { TrailLayer } from './layers/TrailLayer';
import { InterpolationSystem } from './systems/InterpolationSystem';
import { TrailSystem } from './systems/TrailSystem';
import { CameraSystem } from './systems/CameraSystem';
import { hexToPixi } from './utils/pixi-helpers';
import { DEFAULT_TRAIL_TTL_MS } from './systems/TrailSystem';
import type { DriverRaceState, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';
import type { CircuitOutline } from '../_utils/trackSpline';
import { buildTrackPolyline, buildCircuitOutline, type TrackPolyline } from '../_utils/trackSpline';

// GUID: PIXI_TRACK_APP-001-v02
// [Intent] Scene graph structure:
//   stage
//     +-- backgroundLayer.container  (no zoom — stays fixed behind everything)
//     +-- worldContainer             (camera zoom/pan applied here)
//           +-- trackLayer.container     (circuit outline with sector colours)
//           +-- bloomContainer           (AdvancedBloomFilter — trails only)
//           |     +-- trailLayer.container  (comet trail contrails)
//           +-- carLayer.dotContainer      (car dots — OUTSIDE bloom for reliability)
//           +-- carLayer.labelContainer    (driver codes + badges — no bloom)
//   v02: Moved carLayer.dotContainer out of bloomContainer. The bloom filter on some
//        GPUs/browsers can produce blank output, making all children invisible.
//        Trails get the bloom glow effect; car dots render unconditionally.

export class PixiTrackApp {
  private app: Application;
  private ready = false;
  private destroyed = false;

  // Layers
  private backgroundLayer: BackgroundLayer;
  private trackLayer: TrackLayer;
  private trailLayer: TrailLayer;
  private carLayer: CarLayer;

  // Systems
  private interpolation: InterpolationSystem;
  private trailSystem: TrailSystem;
  private camera: CameraSystem;

  // GUID: PIXI_TRACK_APP-002-v01
  // [Intent] Scene graph containers — worldContainer receives camera transforms,
  //          bloomContainer receives the AdvancedBloomFilter for car/trail glow.
  private worldContainer: Container;
  private bloomContainer: Container;

  // Cached data (set from React via setData)
  private drivers: DriverRaceState[] = [];
  private bounds: TrackBounds | null = null;
  private updateIntervalMs = 5000;
  private followDriver: number | null = null;
  private rainIntensity: number | null = null;
  private sessionType: string | null = null;
  private hasLiveSession = false;
  private positionDataAvailable = false;
  private nextRaceName: string | null = null;
  private lastMeetingName: string | null = null;

  // GUID: PIXI_TRACK_APP-013-v01
  // [Intent] Zoom level state for the 3-tier zoom system.
  //          0 = default overview, 1 = fullscreen overview, 2 = hyper-focus (~100m radius).
  //          focusPosition = race position to track in Zoom 2 (default P1).
  private zoomLevel: 0 | 1 | 2 = 0;
  private focusPosition = 1;

  // GUID: PIXI_TRACK_APP-008-v01
  // [Intent] Trail display settings — configurable from React via setData().
  //          trailEnabled: master toggle for trail rendering.
  //          trailTtlMs: trail lifetime in milliseconds (250-1500ms).
  private trailEnabled = true;
  private trailTtlMs = DEFAULT_TRAIL_TTL_MS;

  // GUID: PIXI_TRACK_APP-011-v01
  // [Intent] Per-driver trail direction tracking — prevents backwards trail artifacts.
  //          Stores the last trail GPS position and normalised direction vector per driver.
  //          If a new trail point implies the car reversed direction (negative dot product
  //          with the previous direction), the trail point is skipped.
  private lastTrailGps = new Map<number, { x: number; y: number }>();
  private lastTrailDir = new Map<number, { dx: number; dy: number }>();

  // GUID: PIXI_TRACK_APP-012-v01
  // [Intent] S/F line GPS position from API (lap date_start correlated with location data).
  //          Passed to TrackLayer.rebuild() for accurate S/F marker placement.
  private sfLineGps: { x: number; y: number } | null = null;

  // GUID: PIXI_TRACK_APP-015-v01
  // [Intent] Session key tracking — when session changes (live→replay, replay→different session),
  //          all interpolation, trail, and direction state must be flushed so stale data from
  //          the previous session doesn't leak into the new one.
  private currentSessionKey: string | null = null;

  // Track data
  private polyline: TrackPolyline | null = null;
  private outline: CircuitOutline | null = null;
  private lastPathLength = 0;
  private trackBuilt = false;

  // Canvas dimensions (tracked for resize detection in background layer)
  private lastW = 0;
  private lastH = 0;

  constructor(container: HTMLDivElement) {
    this.app = new Application();
    this.backgroundLayer = new BackgroundLayer();
    this.trackLayer = new TrackLayer();
    this.trailLayer = new TrailLayer();
    this.carLayer = new CarLayer();
    this.interpolation = new InterpolationSystem();
    this.trailSystem = new TrailSystem();
    this.camera = new CameraSystem();
    this.worldContainer = new Container();
    this.bloomContainer = new Container();

    this.init(container);
  }

  // GUID: PIXI_TRACK_APP-003-v01
  // [Intent] Async initialisation — creates the PixiJS Application, appends the canvas to
  //          the DOM, builds the scene graph, applies the bloom filter, and starts the ticker.
  //          Guarded against races with destroy() (the React component may unmount before
  //          init completes if the user navigates away quickly).
  private async init(container: HTMLDivElement): Promise<void> {
    if (this.destroyed) return;

    await this.app.init({
      background: 0x0A0A0E,
      resizeTo: container,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
    });

    if (this.destroyed) return;
    container.appendChild(this.app.canvas);

    // Build scene graph (see PIXI_TRACK_APP-001-v02 for structure)
    this.app.stage.addChild(this.backgroundLayer.container);
    this.app.stage.addChild(this.worldContainer);
    this.worldContainer.addChild(this.trackLayer.container);
    this.worldContainer.addChild(this.bloomContainer);
    this.bloomContainer.addChild(this.trailLayer.container);
    // Car dots OUTSIDE bloom — bloom filter can eat output on some GPUs
    this.worldContainer.addChild(this.carLayer.dotContainer);
    this.worldContainer.addChild(this.carLayer.labelContainer);

    // GUID: PIXI_TRACK_APP-009-v01
    // [Intent] Subtle bloom — threshold raised so only bright elements (car dots) glow.
    //          Scale and blur reduced to avoid amplifying trail noise. Cars glow softly,
    //          trails get a faint halo, track outline does NOT glow.
    try {
      this.bloomContainer.filters = [new AdvancedBloomFilter({
        threshold: 0.5,
        bloomScale: 0.4,
        brightness: 1.1,
        blur: 2,
        quality: 4,
      })];
    } catch {
      // Bloom filter not available — continue without. This can happen on low-end
      // GPUs or if the pixi-filters package has a version mismatch.
      console.warn('[PixiTrackApp] AdvancedBloomFilter failed to init — running without bloom');
    }

    this.ready = true;

    // Start ticker
    this.app.ticker.add(this.onTick, this);
  }

  // GUID: PIXI_TRACK_APP-004-v03
  // [Intent] Data ingress from React. Called on every prop change via the React useEffect
  //          in PitWallTrackMap. Pushes new driver data to the interpolation system and
  //          rebuilds track polyline/outline when the circuit path grows significantly.
  //          No rendering happens here — rendering is driven by the ticker.
  //          v02: Added zoomLevel + focusPosition for 3-tier zoom system.
  //          v03: Added virtualTimeDeltaMs for replay mode — passed to InterpolationSystem
  //               so the impossible-travel filter uses virtual time instead of wall time.
  setData(opts: {
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
  }): void {
    // GUID: PIXI_TRACK_APP-016-v01
    // [Intent] Detect session change and flush all interpolation/trail/direction state.
    //          Without this, stale updateCount/prevPositions/lastDrawnPositions persist
    //          across session switches and drivers that reappear skip spawn protection.
    if (opts.sessionKey !== undefined && opts.sessionKey !== this.currentSessionKey) {
      this.currentSessionKey = opts.sessionKey;
      this.interpolation.reset();
      this.trailSystem.clear();
      this.trailLayer.clear();
      this.lastTrailGps.clear();
      this.lastTrailDir.clear();
    }

    // If drivers changed, notify interpolation system
    if (opts.drivers !== this.drivers) {
      this.interpolation.onDriversUpdate(opts.drivers, opts.virtualTimeDeltaMs);
    }

    this.drivers = opts.drivers;
    this.bounds = opts.bounds;
    this.updateIntervalMs = opts.updateIntervalMs;
    this.followDriver = opts.followDriver;
    this.rainIntensity = opts.rainIntensity;
    this.sessionType = opts.sessionType;
    this.hasLiveSession = opts.hasLiveSession;
    this.positionDataAvailable = opts.positionDataAvailable;
    this.nextRaceName = opts.nextRaceName;
    this.lastMeetingName = opts.lastMeetingName;

    // Trail settings (optional — preserve existing if not provided)
    if (opts.trailEnabled !== undefined) this.trailEnabled = opts.trailEnabled;
    if (opts.trailTtlMs !== undefined) this.trailTtlMs = opts.trailTtlMs;

    // Zoom settings (optional — preserve existing if not provided)
    // Force track rebuild when zoom changes so stroke width scales inversely
    if (opts.zoomLevel !== undefined && opts.zoomLevel !== this.zoomLevel) {
      this.zoomLevel = opts.zoomLevel;
      this.trackBuilt = false;
    }
    if (opts.focusPosition !== undefined) this.focusPosition = opts.focusPosition;

    // S/F line GPS position (from API lap/location correlation)
    if (opts.sfLineX != null && opts.sfLineY != null) {
      this.sfLineGps = { x: opts.sfLineX, y: opts.sfLineY };
    }

    // Rebuild track polyline/outline if circuit path grew significantly
    const pathLen = opts.circuitPath.length;
    if (pathLen >= 30 && pathLen - this.lastPathLength >= 80) {
      this.polyline = buildTrackPolyline(opts.circuitPath);
      this.outline = buildCircuitOutline(opts.circuitPath);
      this.lastPathLength = pathLen;
      this.trackBuilt = false; // force track layer rebuild on next frame
    }
  }

  // GUID: PIXI_TRACK_APP-005-v01
  // [Intent] 60fps ticker callback — the main render loop. Order:
  //          1. Background layer (rain, status text, atmosphere)
  //          2. Track layer (rebuild circuit outline if changed)
  //          3. Interpolate driver positions
  //          4. Push trail points (look up speed/throttle/brake from drivers array)
  //          5. Update trail layer rendering
  //          6. Update car layer rendering
  //          7. Camera follow-mode (zoom/pan to followed driver)
  //
  //          Note: speed, throttle, brake are NOT on InterpolatedPosition — they are
  //          looked up from the original DriverRaceState[] by driverNumber when pushing
  //          trail points to avoid extending the InterpolatedPosition interface.
  private onTick(): void {
    if (!this.ready || this.destroyed) return;

    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const now = Date.now();
    const hasData = this.drivers.length > 0;

    // Detect canvas resize — tell background layer to redraw fixed geometry
    if (w !== this.lastW || h !== this.lastH) {
      this.backgroundLayer.resize(w, h);
      this.trackBuilt = false; // force track rebuild at new dimensions
      this.lastW = w;
      this.lastH = h;
    }

    // 1. Background
    this.backgroundLayer.update({
      w, h,
      rainIntensity: this.rainIntensity,
      sessionType: this.sessionType,
      hasLiveSession: this.hasLiveSession,
      positionDataAvailable: this.positionDataAvailable,
      hasData,
      nextRaceName: this.nextRaceName,
      lastMeetingName: this.lastMeetingName,
    });

    // 2. Track (rebuild only when outline changes or canvas resized or zoom changed)
    if (this.outline && this.bounds && !this.trackBuilt) {
      this.trackLayer.rebuild(this.outline, this.bounds, w, h, this.sfLineGps, this.zoomLevel);
      this.trackBuilt = true;
    }

    // 3. Interpolate driver positions
    const interpolated = this.interpolation.interpolate(
      this.drivers, now, this.updateIntervalMs, this.polyline,
    );

    // TEMPORARY DIAGNOSTIC — remove after debugging
    if (now % 5000 < 17) {
      const driversWithGps = this.drivers.filter(d => d.x != null && d.y != null).length;
      const sample = this.drivers[0];
      console.log('[PixiTrackApp] diag', {
        driversTotal: this.drivers.length,
        driversWithGps,
        interpolatedLen: interpolated.length,
        boundsNull: this.bounds === null,
        bounds: this.bounds,
        sampleXY: sample ? { x: sample.x, y: sample.y, pos: sample.position } : null,
        circuitPathLen: this.polyline ? 'has polyline' : 'no polyline',
        outlineLen: this.outline ? 'has outline' : 'no outline',
        w, h,
      });
    }

    if (interpolated.length > 0 && this.bounds) {
      // Build a quick lookup map for telemetry data from the original drivers array.
      // InterpolatedPosition doesn't carry speed/throttle/brake, so we fetch them
      // from the source DriverRaceState by driverNumber.
      const driverLookup = new Map<number, DriverRaceState>();
      for (const d of this.drivers) {
        driverLookup.set(d.driverNumber, d);
      }

      // GUID: PIXI_TRACK_APP-010-v01
      // [Intent] GPS rogue filtering — compute track centroid from bounds and discard
      //          positions > 2000m away (rogue spikes from OpenF1 GPS data).
      const centroidX = (this.bounds.minX + this.bounds.maxX) / 2;
      const centroidY = (this.bounds.minY + this.bounds.maxY) / 2;
      const ROGUE_DIST_SQ = 2000 * 2000;

      // 4. Update trails — push GPS-space points with telemetry colour data.
      //    Skip: snapped drivers, rogue GPS (>2000m from centroid), direction reversals.
      for (const pos of interpolated) {
        // Rogue GPS filter
        const rdx = pos.x - centroidX;
        const rdy = pos.y - centroidY;
        if (rdx * rdx + rdy * rdy > ROGUE_DIST_SQ) continue;

        // Skip trail point if driver snapped (teleported) this frame
        if (this.interpolation.snappedThisFrame.has(pos.driverNumber)) {
          // Reset direction tracking so the next valid point doesn't compare against stale dir
          this.lastTrailGps.delete(pos.driverNumber);
          this.lastTrailDir.delete(pos.driverNumber);
          continue;
        }

        // Direction validation — skip trail points that imply the car reversed direction.
        // This catches residual GPS jitter and interpolation artifacts that would draw
        // the trail going backwards around the track.
        const lastGps = this.lastTrailGps.get(pos.driverNumber);
        if (lastGps) {
          const tdx = pos.x - lastGps.x;
          const tdy = pos.y - lastGps.y;
          const tDistSq = tdx * tdx + tdy * tdy;

          if (tDistSq > 1) { // ignore sub-metre jitter
            const tDist = Math.sqrt(tDistSq);
            const normDx = tdx / tDist;
            const normDy = tdy / tDist;

            const prevDir = this.lastTrailDir.get(pos.driverNumber);
            if (prevDir) {
              // Dot product: > 0 = same direction, < 0 = reversed
              const dot = normDx * prevDir.dx + normDy * prevDir.dy;
              if (dot < -0.3) {
                // Direction reversed — skip trail point, don't update tracking
                continue;
              }
            }

            this.lastTrailDir.set(pos.driverNumber, { dx: normDx, dy: normDy });
          }
        }
        this.lastTrailGps.set(pos.driverNumber, { x: pos.x, y: pos.y });

        const trail = this.trailSystem.getOrCreate(pos.driverNumber, hexToPixi(pos.teamColour));

        // Look up telemetry from original driver data
        const src = driverLookup.get(pos.driverNumber);
        const speed = src?.speed ?? 0;
        const throttle = src?.throttle ?? 0;
        const brake = src?.brake ?? false;

        // Push GPS-space coordinates (projected metres, NOT canvas pixels)
        trail.push(pos.x, pos.y, now, speed, throttle, brake);
      }

      // 4b. Clean up trails for retired drivers — prevents stale ring buffer entries
      //     and direction tracking maps from accumulating for DNF'd cars.
      for (const d of this.drivers) {
        if (d.retired) {
          this.trailSystem.delete(d.driverNumber);
          this.lastTrailGps.delete(d.driverNumber);
          this.lastTrailDir.delete(d.driverNumber);
        }
      }

      // 5. Update trail layer rendering (projects GPS->canvas at draw time)
      this.trailLayer.update(
        this.trailSystem, now, this.bounds, w, h, this.trailTtlMs, this.trailEnabled,
      );

      // GUID: PIXI_TRACK_APP-014-v02
      // [Intent] Zoom 2 hyper-focus — resolve which driver holds the focusPosition and
      //          pass their driverNumber to CarLayer for differentiated rendering.
      //          Position-based: if P1 is overtaken, focus auto-jumps to new P1.
      //          v02: Falls back to first driver in array if no exact position match,
      //               preventing the camera from zooming to empty canvas centre.
      let focusDriverNumber: number | null = null;
      if (this.zoomLevel === 2 && interpolated.length > 0) {
        const focusDriver = interpolated.find(d => d.position === this.focusPosition);
        focusDriverNumber = focusDriver?.driverNumber
          ?? interpolated[0]?.driverNumber
          ?? null;
      }

      // 6. Update cars
      this.carLayer.update(interpolated, this.bounds, w, h, this.followDriver, focusDriverNumber);

      // 7. Camera — in Zoom 2, always follow the focus driver (mandatory for chase-cam).
      //    In Zoom 0/1, follow if user selected a driver, else overview.
      let cameraTarget: { px: number; py: number } | null = null;
      if (this.zoomLevel === 2 && focusDriverNumber) {
        cameraTarget = this.carLayer.getDriverPosition(focusDriverNumber, interpolated, this.bounds!, w, h);
      } else if (this.followDriver) {
        cameraTarget = this.carLayer.getDriverPosition(this.followDriver, interpolated, this.bounds!, w, h);
      }
      this.camera.update(cameraTarget, w, h, this.zoomLevel);
      this.camera.applyTo(this.worldContainer, w, h);

      // Show world
      this.worldContainer.visible = true;
    } else {
      this.worldContainer.visible = hasData; // hide if truly no data
      this.camera.reset();
      this.camera.applyTo(this.worldContainer, w, h);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.app.ticker.remove(this.onTick, this);
    this.trailLayer.clear();
    this.trailSystem.clear();
    this.app.destroy(true, { children: true, texture: true });
  }
}
