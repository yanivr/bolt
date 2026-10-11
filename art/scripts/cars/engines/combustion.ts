import type { Decal, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  grow,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  strip,
  union,
} from '../../lib/model.js';
import type { EngineArt } from '../types.js';
import { BASE, banded, dots, engine, finsY, part, ring, tailpipe } from './common.js';

/**
 * Piston and rotary engines. Cylinder count is told by the shape of the top end: one round
 * air cleaner between short banks (V6), a scoop over eight stub pipes (V8), long cream covers
 * either side of a row of brass trumpets (V12), a tall stack (diesel), a rotor badge (rotary).
 */

/** V6: two short steel banks around a chrome pancake air cleaner; twin tailpipes. */
function v6(): EngineArt {
  const base = roundRect(0, 0.3, 7.8, 5, 1.6);
  const banks = mirrorX(roundRect(5.4, 0.3, 1.9, 4.5, 0.9));
  const capAt: Array<[number, number]> = [
    [5.4, -2.7],
    [5.4, 0.3],
    [5.4, 3.3],
  ];
  const caps = mirrorX(dots(capAt, 1.2));
  const filter = circle(0, 0, 3.2);
  const solids: Solid[] = [
    tailpipe(mirrorX(capsule(4.6, 7.2, 4.6, 10.4, 1.35))),
    part(base, 'steelDark', 10.9, BASE + 0.3, { bevel: 0.8, tag: 'base' }),
    part(banks, 'steel', 11.5, 12.3, { bevel: 0.8, tag: 'bank', floor: BASE }),
    part(caps, 'chrome', 12.5, 13.5, { bevel: 1.1, tag: 'cap', floor: 12 }),
    ...banded(filter, [BASE, 12, 13.4], ['steelDark', 'ivory'], 'filter'),
    part(filter, 'chromeLit', 13.4, 14.4, { bevel: 1.8, tag: 'lid', floor: 13.4 }),
  ];
  const decals: Decal[] = [
    { shape: circle(0, 0, 0.9), on: ['lid'], material: 'bore' },
    { shape: mirrorX(circle(4.6, 10.6, 0.75)), on: ['pipe'], material: 'bore' },
  ];
  return engine('engine_v6', 48, 'puff', solids, decals);
}

/** V8: a wide block, a bug-catcher scoop on the centreline and four copper stubs per side. */
function v8(): EngineArt {
  const base = roundRect(0, 0.2, 8.2, 5.8, 1.4);
  const covers = mirrorX(roundRect(4.9, 0.2, 1.9, 5.3, 0.8));
  const stubY = [-3.9, -1.2, 1.5, 4.2];
  const stubs = mirrorX(union(...stubY.map((y) => capsule(6.6, y, 9, y + 0.9, 1.05))));
  const tips = mirrorX(
    dots(
      stubY.map((y) => [9.1, y + 0.95] as [number, number]),
      0.62,
    ),
  );
  const scoop = roundRect(0, -0.4, 2.7, 3.7, 1);
  const solids: Solid[] = [
    part(base, 'steelDark', 10.9, BASE + 0.3, { bevel: 0.8, tag: 'base' }),
    part(covers, 'steel', 11.6, 12.9, { bevel: 0.8, tag: 'cover', floor: BASE }),
    part(stubs, 'copper', 11.6, 12.6, {
      // Each stub sweeps up and out of the head.
      height: (x) => 11.5 + Math.max(0, Math.abs(x) - 6) * 0.45,
      tag: 'stub',
      floor: 11.2,
    }),
    part(scoop, 'chromeLit', 13, 17, {
      // Wedge: tallest at the open mouth, falling away toward the back.
      height: (_x, y) => 17 - Math.max(0, y + 2.2) * 0.5,
      tag: 'scoop',
      floor: BASE,
    }),
  ];
  const decals: Decal[] = [
    { shape: intersect(scoop, band(-3.6, -1.9)), on: ['scoop'], material: 'bore' },
    { shape: intersect(scoop, band(0.6, 1.3)), on: ['scoop'], shade: -1 },
    { shape: tips, on: ['stub'], material: 'bore' },
    { shape: intersect(covers, strip(-5.3, 5.3)), on: ['cover'], shade: 1 },
  ];
  return engine('engine_v8', 48, 'puff', solids, decals);
}

/** V12: two long cream cam covers, a brass row of six trumpets between them, four tailpipes. */
function v12(): EngineArt {
  const base = roundRect(0, 0.2, 8, 6.9, 1.4);
  const covers = mirrorX(roundRect(5, 0.2, 1.9, 6.4, 0.9));
  const trumpetY = [-5.3, -3.1, -0.9, 1.3, 3.5, 5.7];
  const trumpetAt = trumpetY.map((y) => [0, y] as [number, number]);
  const trumpets = dots(trumpetAt, 1.25);
  const pipes = mirrorX(union(capsule(2.3, 8, 2.3, 10.6, 1.1), capsule(5.4, 8, 5.4, 10.6, 1.1)));
  const solids: Solid[] = [
    tailpipe(pipes, 'chrome'),
    part(base, 'steelDark', 10.9, BASE + 0.3, { bevel: 0.8, tag: 'base' }),
    part(roundRect(0, 0.2, 1.7, 6.6, 1), 'steel', 11.5, 12.2, { bevel: 0.6, tag: 'plenum' }),
    part(covers, 'ivory', 11.7, 13.2, { bevel: 1, tag: 'cover', floor: BASE }),
    part(trumpets, 'brass', 12.6, 14.2, { bevel: 0.9, tag: 'trumpet', floor: 12 }),
  ];
  const decals: Decal[] = [
    { shape: intersect(covers, finsY(2.2, 0.75, -6.55)), on: ['cover'], shade: -2 },
    { shape: dots(trumpetAt, 0.62), on: ['trumpet'], material: 'bore' },
    {
      shape: mirrorX(union(circle(2.3, 10.8, 0.6), circle(5.4, 10.8, 0.6))),
      on: ['pipe'],
      material: 'bore',
    },
  ];
  return engine('engine_v12', 48, 'puff', solids, decals);
}

/** Torque Diesel: a yellow slab of a block, an air canister, and a tall shielded stack. */
function diesel(): EngineArt {
  const block = roundRect(-0.9, 0.5, 6.3, 5.2, 1);
  const rocker = roundRect(-0.9, 0.5, 2.6, 4.2, 0.8);
  const stack: [number, number] = [6.4, -1.2];
  const solids: Solid[] = [
    part(grow(block, 0.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(block, 'hazard', 11.4, 12.7, { bevel: 0.8, tag: 'block', floor: BASE }),
    part(rocker, 'steelDark', 12.8, 13.5, { bevel: 0.7, tag: 'rocker', floor: 12.6 }),
    part(capsule(-5.4, -2.6, -5.4, 3.4, 1.7), 'steel', 12.2, 14.2, {
      bevel: 1.7,
      tag: 'canister',
      floor: 12.4,
    }),
    // Elbow from the manifold to the foot of the stack.
    part(capsule(4.4, 3.2, stack[0], stack[1], 1.3), 'steelDark', 11.4, 12.6, {
      bevel: 1.2,
      tag: 'elbow',
    }),
    ...banded(
      circle(stack[0], stack[1], 2.6),
      [BASE, 12.6, 14, 15.4, 16.8],
      ['steelLit', 'steelDark', 'steelLit', 'steelDark'],
      'shield',
    ),
    part(circle(stack[0], stack[1], 2), 'chromeLit', 21.5, 21.5, { tag: 'stack', floor: 16.8 }),
  ];
  const decals: Decal[] = [
    { shape: intersect(rocker, finsY(1.7, 0.7, -3.4)), on: ['rocker'], shade: 2 },
    { shape: intersect(block, finsY(3.4, 0.6, -4.4)), on: ['block'], shade: -1 },
    { shape: circle(stack[0], stack[1], 1.25), on: ['stack'], material: 'bore' },
    { shape: band(-0.2, 0.9), on: ['canister'], shade: -2 },
  ];
  return engine('engine_diesel', 56, 'puff', solids, decals);
}

/** Rotary: a round housing with a copper rotor badge, one trumpet and one fat exhaust. */
function rotary(): EngineArt {
  const housing = circle(0, 0.5, 5.3);
  const tri = (r: number): Array<[number, number]> =>
    [0, 1, 2].map((i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      return [Math.cos(a) * r, 0.5 + Math.sin(a) * r] as [number, number];
    });
  // A Reuleaux-like rotor: a triangle with generously rounded sides.
  const rotor = polygon(tri(2.5), 1.6);
  const solids: Solid[] = [
    tailpipe(capsule(0, 7, 0, 10.4, 1.9), 'steel', { z1: 5.8, bevel: 1.6 }),
    part(circle(0, 0.5, 6.1), 'steelDark', 10.9, BASE + 0.2, { tag: 'base' }),
    part(housing, 'steelLit', 11.6, 13, { bevel: 1.2, tag: 'housing', floor: BASE }),
    part(rotor, 'copper', 13.4, 14.2, { bevel: 0.9, tag: 'rotor', floor: 13 }),
    part(circle(5.6, -3.4, 1.7), 'chrome', 11.8, 13.4, { bevel: 1.2, tag: 'trumpet' }),
  ];
  const decals: Decal[] = [
    { shape: grow(rotor, 0.7), on: ['housing'], shade: -2 },
    { shape: circle(0, 0.5, 0.95), on: ['rotor'], material: 'bore' },
    { shape: circle(5.6, -3.4, 0.85), on: ['trumpet'], material: 'bore' },
    { shape: circle(0, 10.5, 1.15), on: ['pipe'], material: 'bore' },
  ];
  return engine('engine_rotary', 48, 'puff', solids, decals);
}

/** Trail Engine: olive block with a ribbed sump guard, a tall snorkel and a swept-up exhaust. */
function trail(): EngineArt {
  const block = roundRect(0.6, 0.6, 5.6, 4.8, 1.2);
  const snorkel: [number, number] = [-6.9, -2.8];
  const guard = roundRect(0, 8.3, 7.6, 1.7, 0.7);
  const solids: Solid[] = [
    part(guard, 'steel', 3.4, 5.6, {
      // Skid plate: slopes down and back from the tail of the body.
      height: (_x, y) => 6 - (y - 6.6) * 0.9,
      tag: 'guard',
      floor: 2.6,
      noShadow: true,
    }),
    part(grow(block, 0.7), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(block, 'olive', 11.4, 12.9, { bevel: 1, tag: 'block', floor: BASE }),
    part(roundRect(0.6, -1.6, 3.2, 1.5, 0.6), 'steelDark', 13, 13.6, {
      bevel: 0.5,
      tag: 'cap',
      floor: 12.8,
    }),
    // High exhaust, swept up along the right side and shielded.
    part(capsule(6.2, 0.4, 7.4, 7.4, 1.25), 'steel', 12, 13.4, {
      height: (_x, y) => 11.6 + (y + 1) * 0.3,
      tag: 'highpipe',
    }),
    part(capsule(-4.8, 2.6, snorkel[0], snorkel[1], 1.4), 'steelDark', 11.6, 12.8, {
      bevel: 1.3,
      tag: 'duct',
    }),
    part(circle(snorkel[0], snorkel[1], 1.6), 'steelDark', 19.4, 19.4, { tag: 'riser' }),
    part(circle(snorkel[0], snorkel[1], 2.6), 'olive', 20, 21.4, {
      bevel: 2,
      tag: 'mushroom',
      floor: 19.2,
    }),
  ];
  const decals: Decal[] = [
    { shape: intersect(block, finsY(2.4, 0.7, 1)), on: ['block'], shade: -1 },
    { shape: roundRect(0.6, -1.6, 2, 0.5, 0.2), on: ['cap'], shade: 2 },
    { shape: circle(7.4, 7.6, 0.7), on: ['highpipe'], material: 'bore' },
    {
      shape: intersect(capsule(6.2, 0.4, 7.4, 7.4, 1.25), finsY(1.8, 0.6, 0.6)),
      on: ['highpipe'],
      shade: -1,
    },
    {
      shape: mirrorX(union(roundRect(2.4, 8.3, 0.5, 1, 0.3), roundRect(5, 8.3, 0.5, 1, 0.3))),
      on: ['guard'],
      shade: -2,
    },
    { shape: circle(snorkel[0], snorkel[1], 1.1), on: ['mushroom'], shade: 1 },
  ];
  return engine('engine_offroad', 56, 'puff', solids, decals);
}

/** Ironheart: a chamfered, riveted iron casing with a furnace window and armored pipes. */
function ironheart(): EngineArt {
  const casing = roundRect(0, 0.4, 7.4, 5.5, 1.8);
  const crown = roundRect(0, 0.4, 4.9, 3.2, 1);
  const heart = union(
    circle(-0.95, 0, 1.15),
    circle(0.95, 0, 1.15),
    polygon(
      [
        [-1.9, 0.5],
        [1.9, 0.5],
        [0, 2.7],
      ],
      0.15,
    ),
  );
  const rivetAt: Array<[number, number]> = [
    [-6, -3],
    [6, -3],
    [-6, 3.8],
    [6, 3.8],
    [-6, 0.4],
    [6, 0.4],
  ];
  const solids: Solid[] = [
    tailpipe(mirrorX(capsule(5.4, 7.2, 5.4, 10.2, 1.7)), 'iron', { z1: 5.8, bevel: 1.2 }),
    part(mirrorX(roundRect(5.4, 7.2, 2.2, 0.8, 0.3)), 'steel', 6.2, 6.2, {
      floor: 3,
      tag: 'collar',
      noShadow: true,
    }),
    part(grow(casing, 0.7), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(casing, 'iron', 11.2, 13.4, { bevel: 2, profile: 'linear', tag: 'casing', floor: BASE }),
    part(crown, 'iron', 13.5, 14.4, { bevel: 0.9, profile: 'linear', tag: 'crown', floor: 13.2 }),
  ];
  const decals: Decal[] = [
    { shape: ring(crown, 0.6), on: ['casing'], shade: -1 },
    { shape: intersect(casing, mirrorX(strip(5.1, 6.9))), on: ['casing'], material: 'steel' },
    { shape: dots(rivetAt, 0.7), on: ['casing'], material: 'bore' },
    { shape: grow(heart, 0.55), on: ['crown'], shade: -2 },
    { shape: heart, on: ['crown'], material: 'ember' },
    { shape: mirrorX(circle(5.4, 10.4, 1)), on: ['pipe'], material: 'bore' },
  ];
  return engine('engine_resilient', 48, 'puff', solids, decals);
}

export const V6_ART = v6();
export const V8_ART = v8();
export const V12_ART = v12();
export const DIESEL_ART = diesel();
export const ROTARY_ART = rotary();
export const TRAIL_ART = trail();
export const IRONHEART_ART = ironheart();
