import type { Decal, Solid } from '../../../lib/model.js';
import {
  capsule,
  circle,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  union,
} from '../../../lib/model.js';
import type { ChassisArt } from '../../types.js';
import { floating, headlight, model, ring, solid, taillight } from '../kit.js';

/**
 * Kangaroo: a narrow cab lifted clear of the road on four tall coil-spring towers, bigger at
 * the back like haunches, over a steel skid plate with a roo bar at the nose (Section 12.6).
 * Identity: the yellow spring towers and the daylight under the body.
 */

const FLOOR = 7;
const hull = roundRect(0, 0, 10.4, 29, 4);
const nose = roundRect(0, -24, 8.6, 4.6, 2.4);
const greenhouse = roundRect(0, -3.4, 9.8, 14.6, 3.6);
const roof = roundRect(0, -3.4, 7.8, 12, 2.6);
const deck = roundRect(0, 20.4, 8, 7.6, 2.6);
const frontTowers = mirrorX(circle(12.2, -19, 2));
const rearTowers = mirrorX(circle(12.2, 20, 2.5));
const skid = roundRect(0, -1, 8.4, 30.6, 3);

const solids: Solid[] = [
  solid(skid, 'steel', 2.4, 4, 1.4, { tag: 'skid' }),
  solid(
    mirrorX(union(capsule(7, -19, 12.6, -19, 1.3), capsule(7, 20, 12.6, 20, 1.5))),
    'steelDark',
    3.2,
    5,
    1.2,
    { tag: 'arm' },
  ),
  solid(
    union(capsule(-12, -31.4, 12, -31.4, 1.15), mirrorX(capsule(6, -31.4, 6, -28.6, 1))),
    'steel',
    4,
    8.6,
    1,
    { tag: 'bar' },
  ),
  solid(
    polygon(
      [
        [-4.6, 29],
        [4.6, 29],
        [1.2, 35],
        [-1.2, 35],
      ],
      0.6,
    ),
    'steel',
    3,
    6.6,
    1.4,
    { tag: 'tail' },
  ),
  solid(frontTowers, 'spring', 4, 12.4, 0, { tag: 'spring' }),
  solid(rearTowers, 'spring', 4, 13.6, 0, { tag: 'spring' }),
  floating(
    mirrorX(union(capsule(8.6, -19, 12.2, -19, 2.3), circle(12.2, -19, 2.5))),
    'steelDark',
    13.4,
    1.4,
    { tag: 'cap' },
  ),
  floating(
    mirrorX(union(capsule(8.6, 20, 12.2, 20, 2.6), circle(12.2, 20, 3))),
    'steelDark',
    14.6,
    1.4,
    { tag: 'cap' },
  ),
  solid(hull, 'paint', FLOOR + 1.4, 12, 3, { tag: 'hull', floor: FLOOR }),
  solid(nose, 'paint', 11.6, 12.4, 1.2, { tag: 'nose', floor: 11 }),
  solid(deck, 'paint', 9, 10.4, 0, { tag: 'deck', floor: 9, height: () => 10.4 }),
  solid(greenhouse, 'glass', 12, 16.8, 3.6, { tag: 'glass', profile: 'linear', floor: 11 }),
  solid(roof, 'paint', 16.6, 18, 1.8, { tag: 'roof', floor: 16 }),
  headlight(mirrorX(roundRect(6, -28.6, 2.2, 1, 0.5)), 9.6, 10.8),
  taillight(mirrorX(roundRect(6.4, 28.8, 2, 0.95, 0.5)), 9.4, 10.4),
];

const decals: Decal[] = [
  // Ivory flank stripes down the lifted body.
  {
    shape: intersect(hull, mirrorX(roundRect(8.8, 0, 1.2, 25, 0.4))),
    on: ['hull'],
    material: 'ivory',
  },
  // Utility bay hatches on the roof and a seam round the nose pad.
  { shape: ring(roundRect(0, -10.6, 5, 3.6, 1), 0.6), on: ['roof'], shade: -1 },
  { shape: ring(roundRect(0, 3.4, 5, 3.6, 1), 0.6), on: ['roof'], shade: -1 },
  { shape: ring(nose, 0.6), on: ['hull'], shade: -1 },
  { shape: mirrorX(circle(12.2, -19, 1)), on: ['cap'], shade: 2 },
  { shape: mirrorX(circle(12.2, 20, 1.2)), on: ['cap'], shade: 2 },
  { shape: mirrorX(capsule(6.4, -16.6, 8.6, -13.6, 0.8)), on: ['glass'], material: 'paint' },
  { shape: mirrorX(roundRect(8.8, -3, 1.4, 0.7, 0.2)), on: ['glass'], material: 'paint' },
  { shape: mirrorX(capsule(6.4, 9.6, 8.6, 6.8, 0.8)), on: ['glass'], material: 'paint' },
  { shape: intersect(capsule(-6.4, -14.4, -2.6, -16.6, 0.6), greenhouse), on: ['glass'], shade: 2 },
  {
    shape: union(roundRect(0, -28, 6, 0.5, 0.2), roundRect(0, -24, 6, 0.5, 0.2)),
    on: ['skid'],
    shade: -1,
  },
];

export const KANGAROO_ART: ChassisArt = {
  id: 'chassis_kangaroo',
  model: model(solids, decals),
  cell: 96,
  engineAnchor: { x: 0, y: 20 },
  exhausts: [
    { x: -4.6, y: 31 },
    { x: 4.6, y: 31 },
  ],
  headlightAnchors: [
    { x: -6, y: -29.6 },
    { x: 6, y: -29.6 },
  ],
  brakeLightAnchors: [
    { x: -6.4, y: 29.8 },
    { x: 6.4, y: 29.8 },
  ],
  mountHeights: {
    front_center: 12.4,
    utility_front: 18,
    utility_mid: 18,
    utility_rear: 12,
    rear_center: 11,
  },
};
