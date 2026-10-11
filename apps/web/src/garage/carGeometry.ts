import type { ChassisDefinition, ChassisSpriteManifest } from '@bolt/shared';
import { accessoryMounts } from '@bolt/shared';
import type { LocalPoint } from '../components/carProjection.js';
import { mountHeight, projectPoints } from '../components/carProjection.js';
import type { BenchMount, Box, FocusInput } from './benchLayout.js';

/**
 * Where a chassis and its mounts land on the drawn car at a heading frame. Everything goes
 * through `projectPoints`, which runs the shared compositor, so the numbers here are the
 * pixels the car is drawn at: rotation, tilt and the lift of each mount's height included.
 */

/** Headings the rotate-view control steps through: three-quarter views, nose right or left. */
export const VIEW_FRAMES: readonly number[] = [18, 46, 50, 14];

/**
 * Sprite pixels a mounted part may stand above its mount, for the overview's sizing and the
 * box focus mode frames. It is less than the tallest parts stand (a radar dish is about 13
 * pixels up): the overview is sized so the Spider is drawn at three times on a 370 pixel
 * phone, and its two roof mounts have exactly the room for a part 16 authored units tall.
 * The art keeps to that (docs/ART_GUIDE.md), and an end-to-end test loads the Spider's roof
 * with the tallest of them. Barrels that reach past a nose or a tail run along the car, where
 * the floor has room.
 */
const PART_HEIGHT = 6;
/** Sprite pixels a tire stands above the ground. */
const TIRE_HEIGHT = 8;
/** Slack around everything, for the selected-part halo. */
const SLACK = 1;

function box(x: number, y: number, halfW: number, halfH: number, z: number, id: string) {
  return [
    { id: `${id}a`, x: x - halfW, y: y - halfH, z },
    { id: `${id}b`, x: x + halfW, y: y - halfH, z },
    { id: `${id}c`, x: x + halfW, y: y + halfH, z },
    { id: `${id}d`, x: x - halfW, y: y + halfH, z },
  ];
}

/** Every accessory mount's centre on the drawn car, in sprite pixels from the car's centre. */
export function projectMounts(
  chassis: ChassisDefinition,
  sprite: ChassisSpriteManifest,
  frame: number,
): BenchMount[] {
  const mounts = accessoryMounts(chassis);
  const at = projectPoints(
    sprite,
    frame,
    mounts.map((m) => ({ id: m.id, x: m.x, y: m.y, z: mountHeight(sprite, m.id) })),
  );
  return mounts.map((m) => ({ id: m.id, dx: at.get(m.id)?.dx ?? 0, dy: at.get(m.id)?.dy ?? 0 }));
}

/**
 * A box around everything the car can draw at a heading: body, shadow, wheels, and a part of
 * the largest size on every mount. `body` is the measured extent of the whole bare car as
 * drawn (`measureChassis`) when the page has it; without it the body and wheels are taken as
 * boxes of the chassis' own size, which is a little generous at the corners.
 */
export function carBounds(
  chassis: ChassisDefinition,
  sprite: ChassisSpriteManifest,
  frame: number,
  body?: Box,
): Box {
  const mounts = accessoryMounts(chassis);
  const points: LocalPoint[] = [];
  if (!body) {
    const deck = Math.max(12, ...mounts.map((m) => mountHeight(sprite, m.id)));
    for (const z of [0, deck])
      points.push(...box(0, 0, chassis.bodyHalfWidth, chassis.bodyHalfLength, z, `b${z}`));
    for (const wheel of chassis.wheelAnchors)
      for (const z of [0, TIRE_HEIGHT])
        points.push(...box(wheel.x, wheel.y, 4, 7, z, wheel.id + z));
  }
  for (const mount of mounts) {
    const base = mountHeight(sprite, mount.id);
    for (const z of [base, base + PART_HEIGHT])
      points.push(
        ...box(
          mount.x,
          mount.y,
          mount.maxFootprint.w / 2,
          mount.maxFootprint.h / 2,
          z,
          mount.id + z,
        ),
      );
  }
  // Without measured art, the shadow falls two pixels right and three down of the body.
  const out: Box = body ? { ...body } : { left: 0, top: 0, right: 2, bottom: 3 };
  // The slack is for the halo of a selected part, so it goes round the part boxes. The
  // measured car is exact and takes none: two pixels less here is the difference between the
  // Spider at three times and at two on a 370 pixel phone.
  for (const p of projectPoints(sprite, frame, points).values()) {
    out.left = Math.min(out.left, p.dx - SLACK);
    out.right = Math.max(out.right, p.dx + SLACK + (body ? 0 : 2));
    out.top = Math.min(out.top, p.dy - SLACK);
    out.bottom = Math.max(out.bottom, p.dy + SLACK + (body ? 0 : 3));
  }
  return out;
}

/** Half-size, in chassis pixels, of the box focus frames around an engine of any make. */
const ENGINE_HALF = 8;
/** The band of height an engine is drawn in, in authored units: it stands in the body. */
const ENGINE_BASE = 6;
const ENGINE_TOP = 18;

/**
 * What focus mode frames for a slot: the mount's centre as drawn, and a box around the
 * largest part that mount takes, lifted to the mount's height and standing `PART_HEIGHT` above
 * it. `engine` frames the engine bay. Null for a mount this chassis does not have.
 */
export function focusTarget(
  chassis: ChassisDefinition,
  sprite: ChassisSpriteManifest,
  frame: number,
  slot: string,
): FocusInput['target'] | null {
  const engine = slot === 'engine';
  const mount = engine ? null : accessoryMounts(chassis).find((m) => m.id === slot);
  if (!engine && !mount) return null;
  // The engine sheet is drawn at its anchor, standing in the body; a part stands on the
  // bodywork under its mount.
  const x = mount ? mount.x : sprite.engineAnchor.x;
  const y = mount ? mount.y : sprite.engineAnchor.y;
  const base = mount ? mountHeight(sprite, mount.id) : ENGINE_BASE;
  const top = mount ? base + PART_HEIGHT : ENGINE_TOP;
  const halfW = mount ? mount.maxFootprint.w / 2 : ENGINE_HALF;
  const halfH = mount ? mount.maxFootprint.h / 2 : ENGINE_HALF;
  const points: LocalPoint[] = [
    { id: 'centre', x, y, z: mount ? base : (ENGINE_BASE + ENGINE_TOP) / 2 },
  ];
  for (const z of [base, top]) points.push(...box(x, y, halfW, halfH, z, `p${z}`));
  const at = projectPoints(sprite, frame, points);
  const centre = at.get('centre') ?? { dx: 0, dy: 0 };
  const part: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const [id, p] of at) {
    if (id === 'centre') continue;
    part.left = Math.min(part.left, p.dx);
    part.right = Math.max(part.right, p.dx);
    part.top = Math.min(part.top, p.dy);
    part.bottom = Math.max(part.bottom, p.dy);
  }
  return { id: slot, dx: centre.dx, dy: centre.dy, part };
}
