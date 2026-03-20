// GUID: PIXI_CAMERA_SYSTEM-000-v01
// [Intent] Camera system for the PixiJS track map. Handles follow-driver zoom/pan with
//          smooth lerp transitions. Works by manipulating a PixiJS Container's pivot,
//          position, and scale — no matrix math needed.
// [Inbound Trigger] Called every animation frame by the PixiJS track map renderer.
// [Downstream Impact] Mutates the world Container's transform. No React state touched.

import { Container } from 'pixi.js';

// GUID: PIXI_CAMERA_SYSTEM-001-v03
// [Intent] Constants for camera behaviour.
//          OVERVIEW_ZOOM = Zoom 1 fullscreen magnification centred on track (no driver selected).
//          FOLLOW_ZOOM = magnification when tracking a driver (Zoom 0/1 with follow).
//          HYPER_ZOOM = Zoom 2 hyper-focus mode (~100m radius).
//          LERP_SPEED = 0-1 blend factor per frame (lower = smoother/slower).
//          SNAP_THRESHOLD = distance below which we snap to target to stop micro-jitter.
//          v03: Added OVERVIEW_ZOOM — Zoom 1 now applies 1.8x centred zoom instead of 1x.
const OVERVIEW_ZOOM = 1.8;
const FOLLOW_ZOOM = 3.0;
const HYPER_ZOOM = 5.0;
const LERP_SPEED = 0.08;
const HYPER_LERP_SPEED = 0.18;
const SNAP_THRESHOLD = 0.5;

export class CameraSystem {
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  private currentX = 0;
  private currentY = 0;
  private currentZoom = 1;

  // GUID: PIXI_CAMERA_SYSTEM-002-v03
  // [Intent] Update camera target based on zoom level and followed position.
  //          zoomLevel 0 with no followedPos: default overview (zoom 1x).
  //          zoomLevel 1 with no followedPos: fullscreen overview (OVERVIEW_ZOOM = 1.8x centred).
  //          zoomLevel 0/1 with followedPos: follow-mode (FOLLOW_ZOOM = 3x).
  //          zoomLevel 2 with followedPos: hyper-focus (HYPER_ZOOM = 8x, ~100m radius).
  //          v03: Zoom 1 now applies OVERVIEW_ZOOM when no driver is followed, so the track
  //               visibly enlarges when entering fullscreen mode.
  update(
    followedPos: { px: number; py: number } | null,
    canvasW: number,
    canvasH: number,
    zoomLevel: 0 | 1 | 2 = 0,
  ): void {
    if (followedPos && isFinite(followedPos.px) && isFinite(followedPos.py)) {
      this.targetX = followedPos.px;
      this.targetY = followedPos.py;
      this.targetZoom = zoomLevel === 2 ? HYPER_ZOOM : FOLLOW_ZOOM;
    } else {
      this.targetX = canvasW / 2;
      this.targetY = canvasH / 2;
      this.targetZoom = zoomLevel >= 1 ? OVERVIEW_ZOOM : 1;
    }

    // Lerp current toward target — faster at Zoom 2 so camera keeps up with focus car
    const lerpSpeed = zoomLevel === 2 ? HYPER_LERP_SPEED : LERP_SPEED;
    this.currentX += (this.targetX - this.currentX) * lerpSpeed;
    this.currentY += (this.targetY - this.currentY) * lerpSpeed;
    this.currentZoom += (this.targetZoom - this.currentZoom) * lerpSpeed;

    // Snap if very close to avoid perpetual micro-lerp
    if (Math.abs(this.currentX - this.targetX) < SNAP_THRESHOLD) {
      this.currentX = this.targetX;
    }
    if (Math.abs(this.currentY - this.targetY) < SNAP_THRESHOLD) {
      this.currentY = this.targetY;
    }
    if (Math.abs(this.currentZoom - this.targetZoom) < 0.001) {
      this.currentZoom = this.targetZoom;
    }
  }

  // GUID: PIXI_CAMERA_SYSTEM-003-v01
  // [Intent] Apply the current camera state to a PixiJS Container. Sets pivot to the
  //          camera focus point, positions the container so the focus point is at screen
  //          centre, and applies zoom via uniform scale.
  applyTo(worldContainer: Container, canvasW: number, canvasH: number): void {
    worldContainer.pivot.set(this.currentX, this.currentY);
    worldContainer.position.set(canvasW / 2, canvasH / 2);
    worldContainer.scale.set(this.currentZoom);
  }

  // GUID: PIXI_CAMERA_SYSTEM-004-v01
  // [Intent] Immediately snap to the overview state (zoom 1, centred). No lerp transition.
  //          Use when switching sessions or resetting the view.
  reset(): void {
    this.targetX = 0;
    this.targetY = 0;
    this.targetZoom = 1;
    this.currentX = 0;
    this.currentY = 0;
    this.currentZoom = 1;
  }
}
