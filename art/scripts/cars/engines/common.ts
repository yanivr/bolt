import type { Decal, Shape, Solid } from '../../lib/model.js';
import { circle, grow, subtract, union } from '../../lib/model.js';
import type { EngineArt } from '../types.js';
import { DRIVE_MATERIALS } from './materials.js';

/**
 * Shared vocabulary for engine modules. An engine is modelled around the chassis engine anchor
 * (the origin), front toward negative Y, and rests on the rear deck: everything above the deck
 * carries a `floor` so no side wall is drawn down through the bodywork below it. Exhausts that
 * leave the body sit low behind it and hang clear of the ground.
 */

/** Height the deck is assumed to be at; the bottom of every on-deck side wall. */
export const DECK = 10.4;
/** Top of an engine's base plate: where the machinery itself starts. */
export const BASE = 11;

/** A solid standing on the deck. Pass `floor` to stack it on another part instead. */
export function part(
  shape: Shape,
  material: string,
  z0: number,
  z1: number,
  extra: Partial<Solid> = {},
): Solid {
  return { shape, material, z0, z1, floor: DECK, ...extra };
}

/** A low exhaust pipe behind the body, clear of the ground. */
export function tailpipe(shape: Shape, material = 'steel', extra: Partial<Solid> = {}): Solid {
  return {
    shape,
    material,
    z0: 3.8,
    z1: 5.4,
    bevel: 1.2,
    floor: 3,
    tag: 'pipe',
    noShadow: true,
    ...extra,
  };
}

/**
 * A column built from stacked bands of different materials. Each band owns its own strip of
 * the side wall, which is how a tall part shows ribs, shields or stripes in the tilted view.
 */
export function banded(shape: Shape, levels: number[], materials: string[], tag: string): Solid[] {
  return materials.map((material, i) => ({
    shape,
    material,
    z0: levels[i + 1]!,
    z1: levels[i + 1]!,
    floor: levels[i]!,
    tag,
  }));
}

export const ring = (shape: Shape, width: number): Shape => subtract(grow(shape, width), shape);

export const dots = (points: Array<[number, number]>, r: number): Shape =>
  union(...points.map(([x, y]) => circle(x, y, r)));

/** Repeating bars across X (constant-x stripes): cooling fins on a can whose axis runs along X. */
export const finsX =
  (pitch: number, width: number, phase = 0): Shape =>
  (x) =>
    ((((x - phase) % pitch) + pitch) % pitch) - width;

/** Repeating bars across Y (constant-y stripes): ribs, louvers, cell divisions. */
export const finsY =
  (pitch: number, width: number, phase = 0): Shape =>
  (_x, y) =>
    ((((y - phase) % pitch) + pitch) % pitch) - width;

/** Top of a cylinder lying along X: rises from `zBase` to `zBase + rise` over its depth. */
export const lyingX =
  (cy: number, halfDepth: number, zBase: number, rise: number): NonNullable<Solid['height']> =>
  (_x, y) =>
    zBase + rise * Math.sqrt(Math.max(0.03, 1 - ((y - cy) / halfDepth) ** 2));

/** Top of a cylinder lying along Y. */
export const lyingY =
  (cx: number, halfWidth: number, zBase: number, rise: number): NonNullable<Solid['height']> =>
  (x) =>
    zBase + rise * Math.sqrt(Math.max(0.03, 1 - ((x - cx) / halfWidth) ** 2));

export function engine(
  id: string,
  cell: number,
  exhaustStyle: EngineArt['exhaustStyle'],
  solids: Solid[],
  decals: Decal[],
): EngineArt {
  return { id, cell, model: { solids, decals, materials: DRIVE_MATERIALS }, exhaustStyle };
}
