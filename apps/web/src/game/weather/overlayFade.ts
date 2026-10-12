import type { TerrainOverlay } from '@bolt/shared';

/**
 * Foreground occlusion (Section 9.1: "Foreground occlusion around the player fades or becomes
 * translucent"; Section 12.10: "Canopies between the camera and local car fade rather than
 * hide it"). Every overlay the bake marks `fadeNearPlayer` (gantries, bridges, lamp arms,
 * street trees, and the forest canopies and cliff ledges the new biomes add) fades while a car
 * is under it, whatever its `kind`: the test is the car's drawn body, not the overlay's name.
 *
 * The car's body reaches above its origin on screen (the sprites are drawn with a tilt), so
 * the box tested is the body plus a margin, a little taller upward. The local car takes an
 * overlay down to 28 percent; the rival to 50, so it stays readable under a canopy too
 * (Section 13.8: both cars distinguishable) while the art still reads as being above it.
 * The value is eased toward, then held on one of a few steps, so it never flickers.
 */

export const FADE_OWN = 0.28;
export const FADE_RIVAL = 0.5;
const BODY_HALF = 34;
const BODY_UP = 44;
const MARGIN = 18;
const EASE = 9;

export type FadeCar = { present: boolean; x: number; y: number };

export function underOverlay(def: TerrainOverlay, car: FadeCar): boolean {
  if (!car.present) return false;
  return (
    car.x + BODY_HALF + MARGIN > def.x &&
    car.x - BODY_HALF - MARGIN < def.x + def.w &&
    car.y + BODY_HALF + MARGIN > def.y &&
    car.y - BODY_UP - MARGIN < def.y + def.h
  );
}

/** The alpha an overlay is heading for. */
export function overlayTarget(def: TerrainOverlay, own: FadeCar, rival: FadeCar): number {
  if (!def.fadeNearPlayer) return 1;
  if (underOverlay(def, own)) return FADE_OWN;
  if (underOverlay(def, rival)) return FADE_RIVAL;
  return 1;
}

/** One frame of easing toward the target; snaps onto the target once within a step. */
export function easeOverlay(current: number, target: number, dt: number): number {
  const next = current + (target - current) * Math.min(1, dt * EASE);
  return Math.abs(next - target) < 0.02 ? target : next;
}
