import type {
  CarPose,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  SpriteSheetRef,
  WheelSpriteManifest,
} from '@bolt/shared';
import { CAR_HEADINGS, TAU, layoutCar } from '@bolt/shared';

/**
 * Where points on a car land on its drawing. Pure geometry over the shared compositor, with
 * nothing from the browser, so the garage layout that depends on it can be unit tested.
 */

export type LocalPoint = { id: string; x: number; y: number; z: number };
export type ScreenPoint = { id: string; dx: number; dy: number };

const NO_SHEET: SpriteSheetRef = { file: '', frameWidth: 1, frameHeight: 1, columns: 1, rows: 1 };
const NO_WHEELS: WheelSpriteManifest = { id: '', sheet: NO_SHEET, rollFrames: 1 };
const NO_ENGINE: EngineSpriteManifest = { id: '', sheet: NO_SHEET, exhaustStyle: 'none' };

/**
 * Where chassis-local points land on the drawn car at a heading frame, as offsets from the
 * car's centre in sprite pixels. The points are run through `layoutCar` itself as if they
 * were mounted parts, so a mount marker sits exactly where the compositor draws the part.
 */
export function projectPoints(
  chassis: ChassisSpriteManifest,
  frame: number,
  points: readonly LocalPoint[],
): Map<string, ScreenPoint> {
  const pose: CarPose = {
    headingRad: (frame * TAU) / CAR_HEADINGS,
    steer: 0,
    roll: 0,
    braking: false,
    headlights: false,
    bodyShiftX: 0,
    bodyShiftY: 0,
  };
  const ops = layoutCar(
    chassis,
    NO_WHEELS,
    NO_ENGINE,
    pose,
    points.map((p) => ({ instanceId: p.id, partId: '', x: p.x, y: p.y, z: p.z, quarterTurns: 0 })),
  );
  const out = new Map<string, ScreenPoint>();
  for (const op of ops)
    if (op.kind === 'part' && op.instanceId !== undefined)
      out.set(op.instanceId, { id: op.instanceId, dx: op.dx, dy: op.dy });
  return out;
}

/** A screen-space drag, in sprite pixels, as a chassis-local offset at a heading frame. */
export function screenToLocal(frame: number, dx: number, dy: number): { x: number; y: number } {
  const rad = (-frame * TAU) / CAR_HEADINGS;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Height of the bodywork under a mount, as the compositor reads it. */
export function mountHeight(chassis: ChassisSpriteManifest, mountId: string): number {
  const heights = chassis.mountHeights ?? {};
  return Object.prototype.hasOwnProperty.call(heights, mountId) ? heights[mountId]! : 10;
}
