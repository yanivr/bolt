import type { Model, Shape } from '../../lib/model.js';
import { intersect, mirrorX, strip } from '../../lib/model.js';
import type { TireSpec } from './common.js';
import {
  bar,
  disc,
  flank,
  kit,
  rollOffset,
  tire,
  tireShape,
  wheel,
  withSideLugs,
  wrap,
} from './common.js';

/**
 * Loose-surface kits. Their tread stands up from the carcass as real height, so paddles, lugs
 * and studs show as teeth along the silhouette as well as shading on top.
 */

/** Sand Paddles: a smooth carcass with tall scoops right across it. */
function sand(phase: number): Model {
  const spec: TireSpec = { hw: 4.8, hl: 6.9, corner: 2.6, top: 4.4, crown: 2.6 };
  const pitch = 4.6;
  const offset = rollOffset(phase, 4, pitch);
  const paddle = (y: number): number => bar(y + offset, pitch, 2.2, 0.4);
  const shape = withSideLugs(spec, (_x, y) => 0.9 * paddle(y));
  const tops: Shape = (x, y) => Math.max(wrap(y + offset, pitch) - 2.2, Math.abs(x) - 5.6);
  return kit(
    [tire(spec, (_x, y) => 1.9 * paddle(y), shape)],
    [{ shape: intersect(shape, tops), on: ['tire'], material: 'rubberHard', shade: 1 }],
  );
}

/** Mud Claws: staggered chevron lugs that hang over the shoulders, with open gaps between. */
function mud(phase: number): Model {
  const spec: TireSpec = { hw: 4.7, hl: 7, corner: 2.1, top: 5.4, crown: 4 };
  const pitch = 4.8;
  const offset = rollOffset(phase, 4, pitch);
  // The right-hand lugs sit half a pitch behind the left-hand ones.
  const along = (x: number, y: number): number =>
    y + offset - Math.abs(x) * 0.55 + (x > 0 ? pitch / 2 : 0);
  const lug = (x: number, y: number): number =>
    Math.abs(x) < 0.45 ? 0 : bar(along(x, y), pitch, 2.3);
  const shape = withSideLugs(spec, (x, y) => 1 * lug(x, y));
  const tops: Shape = (x, y) =>
    Math.max(wrap(along(x, y), pitch) - 2.3, 0.45 - Math.abs(x), Math.abs(x) - 5.4);
  return kit(
    [tire(spec, (x, y) => 1.5 * lug(x, y), shape)],
    [{ shape: intersect(shape, tops), on: ['tire'], material: 'rubberHard', shade: 1 }],
  );
}

/** Snow Treads: two rows of square blocks, with snow packed into every groove between them. */
function snow(phase: number): Model {
  const spec: TireSpec = { hw: 4.3, hl: 6.6, corner: 2, top: 5.2, crown: 4 };
  const shape = tireShape(spec);
  const pitch = 3.4;
  const offset = rollOffset(phase, 3, pitch);
  const block: Shape = (x, y) =>
    Math.max(wrap(y + offset, pitch) - 2.3, 0.55 - Math.abs(x), Math.abs(x) - 3.4);
  return kit(
    [tire(spec)],
    [
      { shape: intersect(shape, strip(-3.4, 3.4)), on: ['tire'], material: 'frost', shade: -1 },
      { shape: intersect(shape, block), on: ['tire'], material: 'rubber', shade: 1 },
    ],
  );
}

/** Ice Spikes: a plain tire with rows of steel studs, the outer rows standing proud of the sides. */
function ice(phase: number): Model {
  const spec: TireSpec = { hw: 4, hl: 6.6, corner: 2.1, top: 5, crown: 3 };
  const shape = tireShape(spec);
  const pitch = 3.4;
  const offset = rollOffset(phase, 4, pitch);
  // Two outer rows in step, one centre row half a pitch out.
  const stud = (x: number, y: number, r: number): number => {
    const side = Math.abs(x) > 1.3;
    const cx = side ? Math.abs(x) - 2.6 : x;
    const cy = wrap(y + offset + (side ? 0 : pitch / 2), pitch) - pitch / 2;
    return Math.hypot(cx, cy) - r;
  };
  const spikes: Shape = (x, y) => {
    const m = wrap(y + offset + pitch / 2, pitch) - pitch / 2;
    const out = Math.abs(x) - spec.hw + 0.4;
    // A little triangle pointing outward from each sidewall.
    return Math.max(-out, Math.abs(m) - (1.7 - out) * 0.5, Math.abs(y) - (spec.hl - 1.6));
  };
  return kit(
    [
      tire(spec, (x, y) => 1.1 * Math.max(0, Math.min(1, -stud(x, y, 0.9) / 0.4))),
      {
        shape: spikes,
        material: 'chromeLit',
        z0: 2.4,
        z1: 3.4,
        floor: 1.6,
        tag: 'spike',
        noShadow: true,
      },
    ],
    [
      {
        shape: intersect(shape, (x, y) => stud(x, y, 0.85)),
        on: ['tire'],
        material: 'chrome',
        shade: 1,
      },
      {
        shape: intersect(shape, mirrorX(strip(0.9, 1.5))),
        on: ['tire'],
        material: 'frost',
        shade: -2,
      },
    ],
  );
}

/** Balloon Tires: fat, round in every direction and nearly bald, with a soft sheen. */
function balloon(phase: number): Model {
  const spec: TireSpec = { hw: 5.9, hl: 6.3, corner: 4.6, top: 6.6, crown: 2, arc: 0.5 };
  const shape = tireShape(spec);
  const pitch = 4.2;
  const offset = rollOffset(phase, 3, pitch);
  // Soft, shallow ribs: enough of a ripple for the light to catch as the tire turns.
  const rib = (x: number, y: number): number =>
    Math.abs(x) > 4.2 ? 0 : 0.55 * bar(y + offset, pitch, 2.1, 0.9);
  const ribs: Shape = (x, y) => Math.max(wrap(y + offset - 0.5, pitch) - 1.1, Math.abs(x) - 3.6);
  return kit(
    [
      tire(spec, rib),
      // A small pale hub: most of a balloon tire is tire.
      flank(spec.hw - 0.3, spec.hw + 0.7, 2.2, 'ivory', disc(0, 2.2, 1.9, 1), { floor: 1.1 }),
    ],
    [
      { shape: intersect(shape, ribs), on: ['tire'], shade: 2 },
      { shape: mirrorX(strip(4.3, 5)), on: ['tire'], shade: 1 },
    ],
  );
}

/** Monster Wheels: tall and wide, deep staggered chevrons, a steel hub on each side. */
function monster(phase: number): Model {
  const spec: TireSpec = { hw: 6.2, hl: 8, corner: 3.2, top: 7.4, crown: 3, arc: 0.36 };
  const pitch = 5.6;
  const offset = rollOffset(phase, 4, pitch);
  const along = (x: number, y: number): number =>
    y + offset - Math.abs(x) * 0.5 + (x > 0 ? pitch / 2 : 0);
  const lug = (x: number, y: number): number =>
    Math.abs(x) < 0.6 ? 0 : bar(along(x, y), pitch, 2.7, 0.6);
  const shape = withSideLugs(spec, (x, y) => 1.1 * lug(x, y));
  const tops: Shape = (x, y) =>
    Math.max(wrap(along(x, y), pitch) - 2.7, 0.6 - Math.abs(x), Math.abs(x) - 7);
  return kit(
    [
      tire(spec, (x, y) => 1.6 * lug(x, y), shape),
      flank(spec.hw - 0.2, spec.hw + 1.1, 3.4, 'steelWall', disc(0, 3.4, 1.6, 1), { floor: 0.8 }),
    ],
    [{ shape: intersect(shape, tops), on: ['tire'], material: 'rubberHard', shade: 1 }],
  );
}

export const SAND_WHEEL_ART = wheel('tires_sand', 28, 4, sand);
export const MUD_WHEEL_ART = wheel('tires_mud', 28, 4, mud);
export const SNOW_WHEEL_ART = wheel('tires_snow', 24, 3, snow);
export const ICE_WHEEL_ART = wheel('tires_ice', 24, 4, ice);
export const BALLOON_WHEEL_ART = wheel('tires_balloon', 24, 3, balloon);
export const MONSTER_WHEEL_ART = wheel('tires_monster', 32, 4, monster);
