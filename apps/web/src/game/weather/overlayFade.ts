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
 *
 * The box is tested against where the overlay's pixels are (its coverage, 8 px cells), not
 * against its bounding box: a cliff face or a tree crown is a ragged shape, and a car passing
 * the empty corner of its box is not under it. Fading on the bounding box alone made pieces of
 * canyon wall and crowns beside the road blink translucent while the car drove past them.
 */

export const FADE_OWN = 0.28;
export const FADE_RIVAL = 0.5;
/** Half the width of the box a car's body is tested with, and how far it reaches up. */
export const BODY_HALF = 34;
export const BODY_UP = 44;
/** Added round the body, so a fade starts just before the car is under the art. */
export const FADE_MARGIN = 18;
const EASE = 9;

export type FadeCar = { present: boolean; x: number; y: number };

/** Where an overlay's opaque pixels are, on a grid of `cell` px from its top-left corner. */
export type OverlayCoverage = { cell: number; cols: number; rows: number; bits: Uint8Array };

export const COVERAGE_CELL = 8;

/** Coverage from an alpha lookup in the overlay's own pixels (0 is clear). */
export function coverageFromAlpha(
  alpha: (x: number, y: number) => number,
  w: number,
  h: number,
  cell = COVERAGE_CELL,
): OverlayCoverage {
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const bits = new Uint8Array(cols * rows);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha(x, y) > 0) bits[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
  return { cell, cols, rows, bits };
}

/** Coverage from RGBA bytes (`ImageData.data`, a PNG decoded to RGBA). */
export function coverageFromRgba(
  data: ArrayLike<number>,
  w: number,
  h: number,
  cell = COVERAGE_CELL,
): OverlayCoverage {
  return coverageFromAlpha((x, y) => data[(y * w + x) * 4 + 3]!, w, h, cell);
}

/** The car's body box in world pixels, margin included. */
function bodyBox(car: FadeCar): [number, number, number, number] {
  return [
    car.x - BODY_HALF - FADE_MARGIN,
    car.y - BODY_UP - FADE_MARGIN,
    car.x + BODY_HALF + FADE_MARGIN,
    car.y + BODY_HALF + FADE_MARGIN,
  ];
}

/** True when the car's bounding box touches the overlay's bounding box. Cheap; tested first. */
export function nearOverlay(def: TerrainOverlay, car: FadeCar): boolean {
  if (!car.present) return false;
  const [x0, y0, x1, y1] = bodyBox(car);
  return x1 > def.x && x0 < def.x + def.w && y1 > def.y && y0 < def.y + def.h;
}

/**
 * True when the car's body box (margin included) touches the overlay's pixels. Without a
 * coverage the overlay's whole box counts.
 */
export function underOverlay(
  def: TerrainOverlay,
  car: FadeCar,
  coverage?: OverlayCoverage | null,
): boolean {
  if (!nearOverlay(def, car)) return false;
  if (!coverage) return true;
  const [x0, y0, x1, y1] = bodyBox(car);
  const c = coverage.cell;
  const i0 = Math.max(0, Math.floor((x0 - def.x) / c));
  const i1 = Math.min(coverage.cols - 1, Math.ceil((x1 - def.x) / c) - 1);
  const j0 = Math.max(0, Math.floor((y0 - def.y) / c));
  const j1 = Math.min(coverage.rows - 1, Math.ceil((y1 - def.y) / c) - 1);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) if (coverage.bits[j * coverage.cols + i]) return true;
  return false;
}

/**
 * The alpha an overlay is heading for. `coverage` is called only when a car is near the
 * overlay's box, so a client can build it lazily from the texture the first time it is needed.
 */
export function overlayTarget(
  def: TerrainOverlay,
  own: FadeCar,
  rival: FadeCar,
  coverage?: () => OverlayCoverage | null,
): number {
  if (!def.fadeNearPlayer) return 1;
  const nearOwn = nearOverlay(def, own);
  const nearRival = nearOverlay(def, rival);
  if (!nearOwn && !nearRival) return 1;
  const cov = coverage ? coverage() : null;
  if (nearOwn && underOverlay(def, own, cov)) return FADE_OWN;
  if (nearRival && underOverlay(def, rival, cov)) return FADE_RIVAL;
  return 1;
}

/** One frame of easing toward the target; snaps onto the target once within a step. */
export function easeOverlay(current: number, target: number, dt: number): number {
  const next = current + (target - current) * Math.min(1, dt * EASE);
  return Math.abs(next - target) < 0.02 ? target : next;
}
