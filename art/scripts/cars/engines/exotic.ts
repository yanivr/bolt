import type { Decal, Shape, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  intersect,
  mirrorX,
  polygon,
  rotate,
  roundRect,
  subtract,
  union,
} from '../../lib/model.js';
import type { EngineArt } from '../types.js';
import { BASE, engine, lyingY, part, tailpipe } from './common.js';

/**
 * The odd ones: a gas turbine, a rocket, a clockwork spring drive and the Wildcard. Each has a
 * silhouette no piston engine shares (a fan face and tailcone, a bell nozzle between tanks, a
 * brass spiral under a winding key, a lopsided violet block with a lit lamp).
 */

/** A circle whose rim is cut into teeth, for gears and fan hubs. */
const gear =
  (cx: number, cy: number, r: number, teeth: number, depth: number): Shape =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) - r - depth * Math.cos(teeth * Math.atan2(y - cy, x - cx));

/** Alternate sectors of a disc: fan blades seen face on. */
const blades =
  (cx: number, cy: number, r0: number, r1: number, count: number, twist: number): Shape =>
  (x, y) => {
    const r = Math.hypot(x - cx, y - cy);
    const a = Math.atan2(y - cy, x - cx) + r * twist;
    return Math.max(r - r1, r0 - r, (0.2 - Math.cos(count * a)) * r * 0.5);
  };

/** Turbine: an upturned intake with a fan face, a chrome barrel, a wide dark tailcone. */
function turbine(): EngineArt {
  const fan: [number, number] = [0, -2.6];
  const barrel = roundRect(0, 3, 3.6, 3.6, 1.2);
  const cone = polygon(
    [
      [-3.2, 6.2],
      [3.2, 6.2],
      [5.4, 10.4],
      [-5.4, 10.4],
    ],
    0.5,
  );
  const coneRadius = (y: number): number => 3.6 + Math.max(0, y - 6.2) * 0.52;
  const solids: Solid[] = [
    part(cone, 'steelDark', 8, 12, {
      height: (x, y) => 8 + 4.4 * Math.sqrt(Math.max(0.05, 1 - (x / (coneRadius(y) + 0.4)) ** 2)),
      tag: 'cone',
      floor: 6.4,
    }),
    // The lit throat, seen when the tail faces the camera.
    part(roundRect(0, 10.9, 4.2, 0.35, 0.2), 'hot', 8, 11.4, {
      height: (x) => 7.6 + 3.8 * Math.sqrt(Math.max(0.05, 1 - (x / 4.6) ** 2)),
      tag: 'throat',
      floor: 7,
      noShadow: true,
    }),
    part(roundRect(0, 0.6, 5.2, 5.6, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(barrel, 'chrome', 11.2, 14.4, {
      height: lyingY(0, 3.9, 11.2, 3.4),
      tag: 'barrel',
      floor: BASE,
    }),
    part(
      subtract(circle(fan[0], fan[1], 4.6), circle(fan[0], fan[1], 3.4)),
      'chromeLit',
      13.4,
      14.8,
      {
        bevel: 0.7,
        tag: 'cowl',
        floor: BASE,
      },
    ),
    part(circle(fan[0], fan[1], 3.7), 'bore', 13.2, 13.2, {
      tag: 'fan',
      floor: 13,
      noShadow: true,
    }),
    part(circle(fan[0], fan[1], 1.15), 'chrome', 13.8, 15.2, {
      bevel: 1.1,
      tag: 'spinner',
      floor: 13.4,
    }),
  ];
  const decals: Decal[] = [
    { shape: blades(fan[0], fan[1], 1, 3.7, 3, 0.25), on: ['fan'], material: 'chrome' },
    { shape: intersect(barrel, band(4.4, 5.6)), on: ['barrel'], material: 'hot' },
    { shape: intersect(barrel, band(2.2, 2.9)), on: ['barrel'], shade: -2 },
    { shape: intersect(cone, band(9.3, 11)), on: ['cone'], material: 'hot' },
    { shape: intersect(cone, band(7.4, 8.1)), on: ['cone'], shade: 2 },
  ];
  return engine('engine_turbine', 48, 'puff', solids, decals);
}

/** Rocket Engine: a white and a yellow propellant tank over a big dark bell with a lit throat. */
function rocket(): EngineArt {
  const bell = polygon(
    [
      [-1.9, 3.2],
      [1.9, 3.2],
      [5.6, 10.4],
      [-5.6, 10.4],
    ],
    0.7,
  );
  const bellRadius = (y: number): number => 2.6 + Math.max(0, y - 3.2) * 0.5;
  const tankL = circle(-4.6, -1.2, 3.6);
  const tankR = circle(4.6, -1.2, 3.6);
  const solids: Solid[] = [
    part(bell, 'steelDark', 7, 13, {
      height: (x, y) =>
        7 +
        (1 + bellRadius(y) * 0.8) * Math.sqrt(Math.max(0.05, 1 - (x / (bellRadius(y) + 0.7)) ** 2)),
      tag: 'bell',
      floor: 5,
    }),
    part(roundRect(0, 11, 4.6, 0.35, 0.2), 'hotCore', 8, 12, {
      height: (x) => 6.4 + 5.6 * Math.sqrt(Math.max(0.05, 1 - (x / 5) ** 2)),
      tag: 'throat',
      floor: 5.6,
      noShadow: true,
    }),
    part(roundRect(0, 0.2, 8.4, 5.2, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(roundRect(0, 0.8, 1.9, 4, 1), 'steel', 11.4, 13.4, {
      bevel: 1.2,
      tag: 'pump',
      floor: BASE,
    }),
    part(tankL, 'ivory', 11.4, 15.2, { bevel: 3.6, tag: 'tankL', floor: BASE }),
    part(tankR, 'hazard', 11.4, 15.2, { bevel: 3.6, tag: 'tankR', floor: BASE }),
    part(mirrorX(capsule(3.6, 2.2, 1.6, 4.2, 0.8)), 'copper', 11.6, 12.6, {
      bevel: 0.7,
      tag: 'feed',
    }),
  ];
  const decals: Decal[] = [
    { shape: intersect(tankL, band(-1.8, -0.5)), on: ['tankL'], material: 'markRed' },
    { shape: intersect(tankR, band(-1.8, -0.5)), on: ['tankR'], material: 'bore' },
    { shape: intersect(bell, union(band(5.4, 6.1), band(7.7, 8.4))), on: ['bell'], shade: 2 },
    { shape: intersect(bell, band(9.6, 11.2)), on: ['bell'], material: 'hot' },
    { shape: circle(0, -0.6, 0.9), on: ['pump'], material: 'bore' },
  ];
  return engine('engine_rocket', 48, 'flame', solids, decals);
}

/** Spring Drive: a brass mainspring wound in a spiral, a butterfly key on its arbor, two gears. */
function springDrive(): EngineArt {
  const hub: [number, number] = [-1.8, 0.5];
  const drum = circle(hub[0], hub[1], 5);
  const spiral: Shape = (x, y) => {
    const dx = x - hub[0];
    const dy = y - hub[1];
    const r = Math.hypot(dx, dy);
    if (r < 1.2 || r > 4.7) return 1;
    const turn = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
    const m = (((r - turn * 2.3) % 2.3) + 2.3) % 2.3;
    return m - 0.95;
  };
  // The key is a thin upright plate: two round ears on a stem, seen edge-on from above.
  const key = roundRect(hub[0], hub[1], 4, 0.75, 0.5);
  const big = gear(5.1, -2.5, 2.2, 8, 0.45);
  const small = gear(5.2, 2.9, 1.8, 7, 0.4);
  const solids: Solid[] = [
    part(roundRect(0.4, 0.4, 7.6, 5.4, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(big, 'steel', 11.9, 11.9, { tag: 'gear', floor: BASE }),
    part(small, 'copper', 12.3, 12.3, { tag: 'gear2', floor: BASE }),
    part(drum, 'steelDark', 11.4, 12, { bevel: 0.6, tag: 'drum', floor: BASE }),
    part(circle(hub[0], hub[1], 4.7), 'brass', 12.8, 12.8, { tag: 'spring', floor: 11.8 }),
    part(circle(hub[0], hub[1], 1.5), 'steelDark', 13.2, 13.2, { tag: 'boss', floor: 12.6 }),
    part(circle(hub[0], hub[1], 0.95), 'steelLit', 16.4, 16.4, { tag: 'arbor', floor: 12 }),
    part(key, 'chromeLit', 15, 19, {
      height: (x) => {
        const u = Math.abs(x - hub[0]);
        // Two ears with a dip over the stem.
        return 16 + 3.4 * Math.sqrt(Math.max(0, 1 - ((u - 2.4) / 1.7) ** 2));
      },
      tag: 'key',
      floor: 15.4,
    }),
  ];
  const decals: Decal[] = [
    { shape: spiral, on: ['spring'], material: 'bore' },
    { shape: circle(5.1, -2.5, 0.8), on: ['gear'], material: 'bore' },
    { shape: circle(5.2, 2.9, 0.7), on: ['gear2'], material: 'bore' },
  ];
  return engine('engine_spring', 48, 'none', solids, decals);
}

/** Wildcard Motor: a skewed violet block, a lit pink lamp, a coolant tube and three odd pipes. */
function wildcard(): EngineArt {
  const block = rotate(roundRect(-1, 0.6, 4.7, 4, 1.2), 0.16, -1, 0.6);
  const lamp = circle(-2.8, -1, 1.9);
  const gauge = circle(1.4, 2.4, 1.7);
  const coil = capsule(1.2, -2.6, 4.4, -3.4, 1.1);
  const solids: Solid[] = [
    tailpipe(capsule(-4.6, 7, -5.6, 10.6, 2), 'copper', { z1: 6, bevel: 1.6 }),
    tailpipe(capsule(2.4, 7.2, 2.4, 9.4, 0.95), 'steel', { tag: 'thin' }),
    part(roundRect(0, 0.4, 7.4, 5.4, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(block, 'violet', 11.4, 12.8, { bevel: 1, tag: 'block', floor: BASE }),
    part(coil, 'copper', 12.2, 13.6, { bevel: 1, tag: 'coil', floor: 11.6 }),
    part(capsule(-6.6, -3.2, -6.6, 3, 1.3), 'cyan', 11.4, 13.2, { bevel: 1.3, tag: 'tube' }),
    part(gauge, 'ivory', 13, 13.6, { bevel: 0.5, tag: 'gauge', floor: 12.6 }),
    part(lamp, 'pulse', 13, 14.8, { bevel: 1.8, tag: 'lamp', floor: 12.6, noShadow: true }),
    // A bent riser on the right that ends in a chrome stack.
    part(capsule(4.6, 4.4, 6.2, 0.8, 1.05), 'steel', 11.4, 12.6, { bevel: 1, tag: 'riser' }),
    part(circle(6.2, 0.6, 1.6), 'chromeLit', 17.5, 17.5, { tag: 'stack' }),
  ];
  const decals: Decal[] = [
    { shape: subtract(lamp, circle(-2.8, -1, 1.2)), on: ['lamp'], shade: -2 },
    { shape: capsule(1.4, 2.4, 2.4, 1.5, 0.35), on: ['gauge'], material: 'bore' },
    {
      shape: intersect(coil, (x) => ((((x - 1) % 1.3) + 1.3) % 1.3) - 0.6),
      on: ['coil'],
      shade: -2,
    },
    { shape: circle(6.2, 0.6, 0.95), on: ['stack'], material: 'bore' },
    { shape: circle(-5.7, 10.8, 1.2), on: ['pipe'], material: 'bore' },
    { shape: band(-1.2, -0.2), on: ['tube'], shade: 2 },
  ];
  return engine('engine_experimental', 48, 'puff', solids, decals);
}

export const TURBINE_ART = turbine();
export const ROCKET_ART = rocket();
export const SPRING_DRIVE_ART = springDrive();
export const WILDCARD_ART = wildcard();
