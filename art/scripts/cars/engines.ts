import type { Decal, Solid } from '../lib/model.js';
import { band, capsule, circle, intersect, mirrorX, roundRect } from '../lib/model.js';
import { CAR_MATERIALS } from './materials.js';
import type { EngineArt } from './types.js';

/**
 * Engine modules, drawn as their own layer at the chassis engine anchor. A closed body never
 * shows the whole block, so each engine is recognised by its lid, intake and exhaust.
 */

/** Four-Cylinder: louvered steel lid, small copper-rimmed intake, twin tailpipes. */
function fourCylinder(): EngineArt {
  const lid = roundRect(0, 0.2, 6.3, 4.1, 2.4);
  const solids: Solid[] = [
    {
      shape: mirrorX(capsule(4.6, 7.4, 4.6, 10.4, 1.35)),
      material: 'steel',
      z0: 3.5,
      z1: 5,
      bevel: 1.2,
      tag: 'pipe',
      noShadow: true,
    },
    { shape: lid, material: 'steelDark', z0: 11, z1: 11.7, bevel: 1.2, tag: 'lid', floor: 10.4 },
    {
      shape: circle(0, -2.3, 1.9),
      material: 'copper',
      z0: 11.8,
      z1: 13,
      bevel: 1.4,
      tag: 'intake',
      floor: 11.4,
    },
  ];
  const decals: Decal[] = [
    { shape: intersect(lid, band(0.6, 1.5)), on: ['lid'], shade: 2 },
    { shape: intersect(lid, band(2.5, 3.4)), on: ['lid'], shade: 2 },
    { shape: circle(0, -2.3, 0.85), on: ['intake'], material: 'bore' },
    { shape: mirrorX(circle(4.6, 10.6, 0.75)), on: ['pipe'], material: 'bore' },
  ];
  return {
    id: 'engine_four_cylinder',
    cell: 40,
    model: { solids, decals, materials: CAR_MATERIALS },
    exhaustStyle: 'puff',
  };
}

export const FOUR_CYLINDER_ART = fourCylinder();
