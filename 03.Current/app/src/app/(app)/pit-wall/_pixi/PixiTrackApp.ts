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
import { hexToPixi, projectToCanvas } from './utils/pixi-helpers';
import type { DriverRaceState, TrackBounds, CircuitPoint } from '../_types/pit-wall.types';
import type { CircuitOutline } from '../_utils/trackSpline';
import { buildTrackPolyline, buildCircuitOutline, type TrackPolyline } from '../_utils/trackSpline';

// GUID: PIXI_TRACK_APP-001-v01
// [Intent] Scene graph structure:
//   stage
//     +-- backgroundLayer.container  (no zoom — stays fixed behind everything)
//     +-- worldContainer             (camera zoom/pan applied here)
//           +-- trackLayer.container     (circuit outline with sector colours)
//           +-- bloomContainer           (AdvancedBloomFilter applied to this group)
//           |     +-- trailLayer.container  (comet trail contrails)
//           |     +-- carLayer.dotContainer (car dots with glow)
//           +-- carLayer.labelContainer    (driver codes + badges — no bloom)

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

    // Build scene graph (see PIXI_TRACK_APP-001 for structure)
    this.app.stage.addChild(this.backgroundLayer.container);
    this.app.stage.addChild(this.worldContainer);
    this.worldContainer.addChild(this.trackLayer.container);
    this.worldContainer.addChild(this.bloomContainer);
    this.bloomContainer.addChild(this.trailLayer.container);
    this.bloomContainer.addChild(this.carLayer.dotContainer);
    this.worldContainer.addChild(this.carLayer.labelContainer);

    // Apply bloom filter to bloomContainer
    try {
      this.bloomContainer.filters = [new AdvancedBloomFilter({
        threshold: 0.3,
        bloomScale: 0.8,
        brightness: 1.2,
        blur: 4,
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

  // GUID: PIXI_TRACK_APP-004-v01
  // [Intent] Data ingress from React. Called on every prop change via the React useEffect
  //          in PitWallTrackMap. Pushes new driver data to the interpolation system and
  //          rebuilds track polyline/outline when the circuit path grows significantly.
  //          No rendering happens here — rendering is driven by the ticker.
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
  }): void {
    // If drivers changed, notify interpolation system
    if (opts.drivers !== this.drivers) {
      this.interpolation.onDriversUpdate(opts.drivers);
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

    // 2. Track (rebuild only when outline changes or canvas resized)
    if (this.outline && this.bounds && !this.trackBuilt) {
      this.trackLayer.rebuild(this.outline, this.bounds, w, h);
      this.trackBuilt = true;
    }

    // 3. Interpolate driver positions
    const interpolated = this.interpolation.interpolate(
      this.drivers, now, this.updateIntervalMs, this.polyline,
    );

    if (interpolated.length > 0 && this.bounds) {
      // Build a quick lookup map for telemetry data from the original drivers array.
      // InterpolatedPosition doesn't carry speed/throttle/brake, so we fetch them
      // from the source DriverRaceState by driverNumber.
      const driverLookup = new Map<number, DriverRaceState>();
      for (const d of this.drivers) {
        driverLookup.set(d.driverNumber, d);
      }

      // 4. Update trails — push new points with telemetry colour data
      for (const pos of interpolated) {
        const { px, py } = projectToCanvas(pos.x, pos.y, this.bounds, w, h);
        const trail = this.trailSystem.getOrCreate(pos.driverNumber, hexToPixi(pos.teamColour));

        // Look up telemetry from original driver data
        const src = driverLookup.get(pos.driverNumber);
        const speed = src?.speed ?? 0;
        const throttle = src?.throttle ?? 0;
        const brake = src?.brake ?? false;

        trail.push(px, py, now, speed, throttle, brake);
      }

      // 5. Update trail layer rendering
      this.trailLayer.update(this.trailSystem, now);

      // 6. Update cars
      this.carLayer.update(interpolated, this.bounds, w, h, this.followDriver);

      // 7. Camera
      const followPos = this.followDriver
        ? this.carLayer.getDriverPosition(this.followDriver, interpolated, this.bounds, w, h)
        : null;
      this.camera.update(followPos, w, h);
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
