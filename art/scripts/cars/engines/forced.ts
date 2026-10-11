import type { Decal, Shape, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  ellipse,
  grow,
  intersect,
  mirrorX,
  roundRect,
  subtract,
  union,
} from '../../lib/model.js';
import type { EngineArt } from '../types.js';
import { BASE, banded, engine, finsX, finsY, part, tailpipe } from './common.js';

/**
 * Forced induction. A turbocharger is drawn as a pair of snails: a chrome compressor and a
 * copper turbine whose core glows. One turbo sits beside the block, two flank it. The
 * supercharger is the tall one: a ribbed blower, a belt and a butterfly scoop.
 */

type Turbo = { cold: Shape; hotHousing: Shape; glow: Shape; eye: Shape; scroll: Shape };

function turbo(cx: number, cy: number, side: 1 | -1): Turbo {
  const hx = cx + side * 1.5;
  const hy = cy + 3.7;
  return {
    cold: union(circle(cx, cy, 3.1), capsule(cx - side * 2, cy - 1, cx - side * 2, cy - 3.2, 1.1)),
    hotHousing: circle(hx, hy, 2.6),
    glow: subtract(circle(hx, hy, 1.75), circle(hx, hy, 0.8)),
    eye: circle(hx, hy, 0.8),
    // One turn of a scroll groove, so the housing reads as a snail rather than a dial.
    scroll: (x, y) => {
      const dx = (x - cx) * side;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const turn = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      return Math.max(Math.abs(r - (0.7 + turn * 1.5)) - 0.42, r - 2.5);
    },
  };
}

function turboSolids(t: Turbo): Solid[] {
  return [
    part(t.hotHousing, 'copper', 11.4, 13, { bevel: 1.5, tag: 'turbine' }),
    part(t.cold, 'chromeLit', 12, 13.4, { bevel: 1.1, tag: 'compressor' }),
  ];
}

function turboDecals(t: Turbo): Decal[] {
  return [
    { shape: t.glow, on: ['turbine'], material: 'hot' },
    { shape: t.eye, on: ['turbine'], material: 'hotCore' },
    { shape: t.scroll, on: ['compressor'], shade: -3 },
  ];
}

/** Small Turbo: a compact lid with a front intercooler, and one turbo hung off the right. */
function smallTurbo(): EngineArt {
  const lid = roundRect(-3.2, 1, 4.2, 4.2, 1.6);
  const cooler = roundRect(-3.2, -4.3, 4.2, 1.3, 0.4);
  const t = turbo(4.4, -1.6, 1);
  const solids: Solid[] = [
    tailpipe(capsule(5.9, 7, 5.9, 10.4, 1.7), 'steel', { z1: 5.8 }),
    part(roundRect(-0.6, 0.3, 7.6, 5.4, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(lid, 'steelDark', 11.3, 12, { bevel: 1.2, tag: 'lid', floor: BASE }),
    part(cooler, 'steel', 11.4, 12.4, { bevel: 0.4, tag: 'cooler', floor: BASE }),
    ...turboSolids(t),
  ];
  const decals: Decal[] = [
    { shape: intersect(lid, band(0.2, 1.1)), on: ['lid'], shade: 2 },
    { shape: intersect(lid, band(2.2, 3.1)), on: ['lid'], shade: 2 },
    { shape: intersect(cooler, finsX(1.6, 0.75, -7.2)), on: ['cooler'], shade: -2 },
    ...turboDecals(t),
    { shape: circle(5.9, 10.5, 1.05), on: ['pipe'], material: 'hot' },
  ];
  return engine('engine_small_turbo', 48, 'puff', solids, decals);
}

/** Twin Turbo: a top-mount intercooler on the centreline with a turbo each side. */
function twinTurbo(): EngineArt {
  const cooler = roundRect(0, 0.2, 3.3, 4.6, 0.6);
  const left = turbo(-6.3, -2, -1);
  const right = turbo(6.3, -2, 1);
  const solids: Solid[] = [
    tailpipe(mirrorX(capsule(6.4, 7, 6.4, 10.4, 1.6)), 'steel', { z1: 5.8 }),
    part(roundRect(0, 0.3, 8.6, 5.6, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(grow(cooler, 0.6), 'steelDark', 11.6, 12.2, { tag: 'frame', floor: BASE }),
    part(cooler, 'steel', 12.4, 13.2, { bevel: 0.5, tag: 'cooler', floor: 12 }),
    ...turboSolids(left),
    ...turboSolids(right),
  ];
  const decals: Decal[] = [
    { shape: intersect(cooler, finsY(1.7, 0.8, -4.2)), on: ['cooler'], shade: -2 },
    ...turboDecals(left),
    ...turboDecals(right),
    { shape: mirrorX(circle(6.4, 10.5, 1)), on: ['pipe'], material: 'hot' },
  ];
  return engine('engine_twin_turbo', 48, 'puff', solids, decals);
}

/** Supercharger: a tall ribbed blower through the deck, belt drive in front, brass scoop on top. */
function supercharger(): EngineArt {
  const blower = roundRect(0, 0.9, 4, 4, 0.9);
  const hat = roundRect(0, 0.7, 4.2, 3, 1.3);
  const belt = roundRect(0, -4.4, 1.5, 1.6, 0.5);
  const butterflies = union(ellipse(0, 0.7, 0.85, 1.9), mirrorX(ellipse(2.6, 0.7, 0.85, 1.9)));
  const solids: Solid[] = [
    tailpipe(mirrorX(capsule(5.6, 7.2, 5.6, 10.4, 1.4)), 'chrome'),
    part(roundRect(0, 0.4, 7.4, 5.4, 1.4), 'steelDark', 10.9, BASE + 0.3, {
      bevel: 0.8,
      tag: 'base',
    }),
    part(mirrorX(roundRect(5.4, 0.6, 1.5, 4.4, 0.7)), 'steel', 11.5, 12.4, {
      bevel: 0.7,
      tag: 'cover',
      floor: BASE,
    }),
    part(belt, 'rubber', 11.5, 15, {
      // The belt climbs from the crank pulley to the blower snout.
      height: (_x, y) => 17.4 - Math.max(0, -3.4 - y) * 2.4,
      tag: 'belt',
      floor: BASE,
    }),
    ...banded(
      blower,
      [BASE, 12.5, 14, 15.5, 17, 18.5],
      ['chromeLit', 'steel', 'chromeLit', 'steel', 'chromeLit'],
      'blower',
    ),
    part(hat, 'brassLit', 19, 20.8, { bevel: 1.3, tag: 'hat', floor: 18.5 }),
  ];
  const decals: Decal[] = [
    { shape: butterflies, on: ['hat'], material: 'bore' },
    {
      shape: intersect(mirrorX(roundRect(5.4, 0.6, 1.5, 4.4, 0.7)), finsY(2.2, 0.7, -3.2)),
      on: ['cover'],
      shade: -2,
    },
    { shape: circle(0, -4.9, 0.9), on: ['belt'], material: 'chrome' },
    { shape: mirrorX(circle(5.6, 10.6, 0.8)), on: ['pipe'], material: 'bore' },
  ];
  return engine('engine_supercharger', 48, 'puff', solids, decals);
}

export const SMALL_TURBO_ART = smallTurbo();
export const TWIN_TURBO_ART = twinTurbo();
export const SUPERCHARGER_ART = supercharger();
