import type { ChassisDefinition, ChassisSpriteManifest } from '@bolt/shared';
import { accessoryMounts } from '@bolt/shared';
import type { LocalPoint } from '../components/carProjection.js';
import { mountHeight, projectPoints } from '../components/carProjection.js';
import type { BenchMount, Box } from './benchLayout.js';

/**
 * Where a chassis and its mounts land on the drawn car at a heading frame. Everything goes
 * through `projectPoints`, which runs the shared compositor, so the numbers here are the
 * pixels the car is drawn at: rotation, tilt and the lift of each mount's height included.
 */

/** Headings the rotate-view control steps through: three-quarter views, nose right or left. */
export const VIEW_FRAMES: readonly number[] = [18, 46, 50, 14];

/** Sprite pixels a mounted part may stand above its mount. */
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
 * the largest size on every mount. `body` is the measured extent of the body and shadow art
 * when the page has it; without it the body is taken as a box of the chassis' own size, which
 * is a little generous at the corners.
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
  for (const p of projectPoints(sprite, frame, points).values()) {
    out.left = Math.min(out.left, p.dx);
    out.right = Math.max(out.right, p.dx + (body ? 0 : 2));
    out.top = Math.min(out.top, p.dy);
    out.bottom = Math.max(out.bottom, p.dy + (body ? 0 : 3));
  }
  return {
    left: out.left - SLACK,
    top: out.top - SLACK,
    right: out.right + SLACK,
    bottom: out.bottom + SLACK,
  };
}
