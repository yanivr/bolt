import type { Decal, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  intersect,
  mirrorX,
  roundRect,
  strip,
  subtract,
  union,
} from '../../lib/model.js';
import type { EngineArt } from '../types.js';
import { BASE, engine, finsX, finsY, lyingX, part, tailpipe } from './common.js';

/**
 * Electric and split drives. No exhaust: these are told by finned motor cans, orange
 * high-voltage looms and a signature color each (cyan for the mini, a lit cyan pair of bands on
 * the dark sport motor, a green ring on the cream eco drum, a green pack beside the hybrid's
 * half block).
 */

/** Mini Electric: one small finned can on a plate, cyan end caps, a single orange lead. */
function miniElectric(): EngineArt {
  const can = roundRect(0, 0.2, 4.6, 2.9, 0.9);
  const solids: Solid[] = [
    part(roundRect(0, 0.6, 5.6, 4.2, 1.4), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(can, 'steel', 11.2, 14.2, { height: lyingX(0.2, 3.1, 11.2, 3), tag: 'can', floor: BASE }),
    part(capsule(-3.4, 3.9, 3.6, 3.9, 0.9), 'cable', 11.3, 12.2, { bevel: 0.8, tag: 'cable' }),
  ];
  const decals: Decal[] = [
    { shape: intersect(can, finsX(1.6, 0.7, -2.75)), on: ['can'], shade: -1 },
    { shape: intersect(can, mirrorX(strip(3.3, 6))), on: ['can'], material: 'cyan' },
  ];
  return engine('engine_mini_electric', 48, 'none', solids, decals);
}

/** Sport Electric: a wide dark motor with two lit bands, an inverter in front, a triple loom. */
function sportElectric(): EngineArt {
  const can = roundRect(0, 1.5, 7.6, 3.4, 1);
  const inverter = roundRect(0, -3.6, 4.6, 1.5, 0.5);
  const looms = union(
    capsule(0, -2.6, 0, -1.4, 0.8),
    mirrorX(capsule(5.6, -3.6, 8, -1, 0.85)),
    mirrorX(capsule(8, -1, 8, 2, 0.85)),
  );
  const solids: Solid[] = [
    part(roundRect(0, 0.3, 8.6, 5.4, 1.4), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(looms, 'cable', 11.3, 12.3, { bevel: 0.8, tag: 'cable' }),
    part(inverter, 'steel', 11.4, 12.8, { bevel: 0.5, tag: 'inverter', floor: BASE }),
    part(can, 'steelDark', 11.2, 14.8, {
      height: lyingX(1.5, 3.6, 11.2, 3.7),
      tag: 'can',
      floor: BASE,
    }),
  ];
  const decals: Decal[] = [
    { shape: intersect(can, finsX(1.5, 0.7, -0.35)), on: ['can'], shade: 1 },
    { shape: intersect(can, mirrorX(strip(2.6, 3.9))), on: ['can'], material: 'cyanGlow' },
    { shape: intersect(can, mirrorX(strip(6.4, 9))), on: ['can'], material: 'chrome' },
    { shape: roundRect(0, -3.6, 3, 0.55, 0.2), on: ['inverter'], material: 'cyanGlow' },
  ];
  return engine('engine_electric_sport', 48, 'none', solids, decals);
}

/** Eco Electric: a cream motor drum with a green ring, a slim green cell stack, one thin lead. */
function ecoElectric(): EngineArt {
  const drum = circle(-2.4, 0.5, 4.2);
  const pack = roundRect(5, 0.5, 2.2, 4.2, 0.7);
  const solids: Solid[] = [
    part(roundRect(0.4, 0.5, 7.4, 5, 1.6), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(capsule(-1, -3.8, 4.6, -4, 0.85), 'cable', 11.3, 12.2, { bevel: 0.8, tag: 'cable' }),
    part(drum, 'ivory', 11.4, 13.6, { bevel: 2.4, tag: 'drum', floor: BASE }),
    part(pack, 'green', 11.5, 13, { bevel: 0.7, tag: 'pack', floor: BASE }),
  ];
  const decals: Decal[] = [
    {
      shape: subtract(circle(-2.4, 0.5, 2.9), circle(-2.4, 0.5, 1.7)),
      on: ['drum'],
      material: 'green',
    },
    { shape: circle(-2.4, 0.5, 0.8), on: ['drum'], shade: -2 },
    { shape: intersect(pack, finsY(2.1, 0.65, -2.95)), on: ['pack'], shade: -2 },
  ];
  return engine('engine_electric_eco', 48, 'none', solids, decals);
}

/** Hybrid: a half-size louvered block with one pipe on the left, a battery pack on the right. */
function hybrid(): EngineArt {
  const lid = roundRect(-4.3, 0.3, 3.6, 5.4, 1.4);
  const pack = roundRect(4.5, 0.3, 3.4, 5.4, 0.8);
  const solids: Solid[] = [
    tailpipe(capsule(-4.6, 7.4, -4.6, 10.4, 1.35)),
    part(roundRect(0, 0.3, 8.6, 6, 1.4), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(lid, 'steelDark', 11.3, 12, { bevel: 1.2, tag: 'lid', floor: BASE }),
    part(circle(-4.3, -2.6, 1.8), 'copper', 12, 13.2, { bevel: 1.4, tag: 'intake', floor: 11.6 }),
    part(pack, 'green', 11.6, 13.2, { bevel: 0.7, tag: 'pack', floor: BASE }),
    part(capsule(-1.6, 3.2, 2, 3.2, 0.95), 'cable', 12.4, 13.6, {
      bevel: 0.9,
      tag: 'cable',
      floor: 11.6,
    }),
  ];
  const decals: Decal[] = [
    { shape: intersect(lid, band(0.4, 1.3)), on: ['lid'], shade: 2 },
    { shape: intersect(lid, band(2.4, 3.3)), on: ['lid'], shade: 2 },
    { shape: circle(-4.3, -2.6, 0.85), on: ['intake'], material: 'bore' },
    { shape: intersect(pack, finsY(2.7, 0.7, -3.75)), on: ['pack'], shade: -2 },
    { shape: intersect(pack, strip(6.3, 7.2)), on: ['pack'], material: 'cyanGlow' },
    { shape: circle(-4.6, 10.6, 0.75), on: ['pipe'], material: 'bore' },
  ];
  return engine('engine_hybrid', 48, 'puff', solids, decals);
}

/** Twin Drive: two separate blocks with yellow caps, a coupling shaft between, a pipe each. */
function twinDrive(): EngineArt {
  const blocks = mirrorX(roundRect(6, 0.3, 3.6, 5.2, 1.2));
  const caps = mirrorX(roundRect(6, -2, 2.4, 1.8, 0.7));
  const solids: Solid[] = [
    tailpipe(mirrorX(capsule(6, 7.2, 6, 10.4, 1.4))),
    part(roundRect(0, 0.3, 2.6, 2.6, 0.8), 'steelDark', 10.9, BASE, { tag: 'base' }),
    part(capsule(-3, 0.3, 3, 0.3, 1.1), 'chrome', 11.2, 12.4, { bevel: 1, tag: 'shaft' }),
    part(blocks, 'steel', 11.4, 13, { bevel: 1, tag: 'block' }),
    part(caps, 'hazard', 13.2, 13.9, { bevel: 0.6, tag: 'cap', floor: 12.8 }),
  ];
  const decals: Decal[] = [
    { shape: intersect(blocks, union(band(1.2, 2), band(3, 3.8))), on: ['block'], shade: -2 },
    { shape: strip(-0.6, 0.6), on: ['shaft'], material: 'bore' },
    { shape: mirrorX(circle(6, 10.6, 0.8)), on: ['pipe'], material: 'bore' },
  ];
  return engine('engine_twin', 48, 'puff', solids, decals);
}

export const MINI_ELECTRIC_ART = miniElectric();
export const SPORT_ELECTRIC_ART = sportElectric();
export const ECO_ELECTRIC_ART = ecoElectric();
export const HYBRID_ART = hybrid();
export const TWIN_DRIVE_ART = twinDrive();
