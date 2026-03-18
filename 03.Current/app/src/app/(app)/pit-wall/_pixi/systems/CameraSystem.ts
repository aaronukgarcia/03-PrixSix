// GUID: PIXI_CAMERA_SYSTEM-000-v01
// [Intent] Camera system for the PixiJS track map. Handles follow-driver zoom/pan with
//          smooth lerp transitions. Works by manipulating a PixiJS Container's pivot,
//          position, and scale — no matrix math needed.
// [Inbound Trigger] Called every animation frame by the PixiJS track map renderer.
// [Downstream Impact] Mutates the world Container's transform. No React state touched.

import { Container } from 'pixi.js';

// GUID: PIXI_CAMERA_SYSTEM-001-v01
// [Intent] Constants for camera behaviour. FOLLOW_ZOOM = magnification when tracking a
//          driver. LERP_SPEED = 0-1 blend factor per frame (lower = smoother/slower).
//          SNAP_THRESHOLD = distance below which we snap to target to stop micro-jitter.
const FOLLOW_ZOOM = 3.0;
const LERP_SPEED = 0.08;
const SNAP_THRESHOLD = 0.5;

export class CameraSystem {
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  private currentX = 0;
  private currentY = 0;
  private currentZoom = 1;

  // GUID: PIXI_CAMERA_SYSTEM-002-v01
  // [Intent] Update camera target based on whether a driver is being followed.
  //          If followedPos is non-null, target that driver's canvas-space position at
  //          FOLLOW_ZOOM. If null, target the canvas centre at zoom 1 (full overview).
  //          Lerps current values toward targets each frame for smooth transitions.
  update(
    followedPos: { px: number; py: number } | null,
    canvasW: number,
    canvasH: number,
  ): void {
    if (followedPos) {
      this.targetX = followedPos.px;
      this.targetY = followedPos.py;
      this.targetZoom = FOLLOW_ZOOM;
    } else {
      this.targetX = canvasW / 2;
      this.targetY = canvasH / 2;
      this.targetZoom = 1;
    }

    // Lerp current toward target
    this.currentX += (this.targetX - this.currentX) * LERP_SPEED;
    this.currentY += (this.targetY - this.currentY) * LERP_SPEED;
    this.currentZoom += (this.targetZoom - this.currentZoom) * LERP_SPEED;

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
