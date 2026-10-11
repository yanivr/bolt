import type { Decal, Shape, Solid } from '../../lib/model.js';
import { capsule, ellipse, intersect, mirrorX, roundRect, union } from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, headlight, model, ring, solid, taillight } from './kit.js';

/**
 * Wagon: the longest car in the catalog. A front-engined estate with an elongated cab, roof
 * rails, and three slatted cargo racks stepping down behind it to a low tail (Section 12.6).
 * Identity: timber side panels along both flanks and the staircase of racks.
 */

const shell = roundRect(0, -3.4, 13, 35, 5);
const tailStep = roundRect(0, 35.6, 8.6, 4, 1.4);
const hood = roundRect(0, -28, 9.6, 8.6, 3.4);
const greenhouse = roundRect(0, -11.4, 12, 8.4, 3.4);
const roof = roundRect(0, -12, 9.6, 6.4, 2.6);
const fenders = mirrorX(union(ellipse(14, -24, 3.6, 9.4), ellipse(14, 22, 3.6, 9.4)));
const timber = mirrorX(roundRect(14.8, 1, 2.5, 12.6, 1));
const tierA = roundRect(0, 1.6, 11.6, 5.2, 1.6);
const tierB = roundRect(0, 13.2, 11.6, 6, 1.6);
const tierC = roundRect(0, 25.2, 11.6, 5.8, 1.6);
const rackPlate = (y: number): Shape => roundRect(0, y, 9, 3.8, 0.8);
const slats = (y: number): Shape =>
  union(roundRect(0, y - 1.8, 7.8, 0.5, 0.2), roundRect(0, y + 1.8, 7.8, 0.5, 0.2));
const rail = (y0: number, y1: number): Shape => mirrorX(capsule(10.4, y0, 10.4, y1, 0.8));

const A = 13.4;
const B = 10.8;
const C = 8.2;
const solids: Solid[] = [
  solid(roundRect(0, -3, 12, 33.6, 4), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(roundRect(0, -38.8, 10.6, 1.4, 0.9), 'steel', 3, 5.4, 1.2, { tag: 'bumper' }),
  solid(tailStep, 'steelDark', 3.4, 6.4, 1, { tag: 'step' }),
  solid(timber, 'wood', 3.6, 6.8, 1.2, { tag: 'timber' }),
  solid(fenders, 'paint', 4, 8.2, 3.6, { tag: 'fender' }),
  solid(shell, 'paint', 4.6, 7.4, 3.4, { tag: 'shell' }),
  solid(roundRect(0, -19, 13, 19.4, 4.4), 'paint', 4.6, 9.6, 4.4, { tag: 'front' }),
  solid(hood, 'paint', 9.4, 10.4, 2.6, { tag: 'hood' }),
  solid(tierC, 'paint', 4.6, C, 1.6, { tag: 'tier' }),
  solid(tierB, 'paint', 4.6, B, 1.6, { tag: 'tier' }),
  solid(tierA, 'paint', 4.6, A, 1.6, { tag: 'tier' }),
  solid(greenhouse, 'glass', 10, 14.6, 3.6, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 14.4, 16, 2, { tag: 'roof' }),
  solid(union(rackPlate(1.6), rackPlate(13.2), rackPlate(25.2)), 'steelDark', 0, 0, 0, {
    tag: 'rack',
    noShadow: true,
    height: (_x, y) => (y < 7.4 ? A : y < 19.3 ? B : C) + 0.5,
    floor: C,
  }),
  floating(rail(-17.4, -6.6), 'steel', 17.4, 1.2, { tag: 'rail', noShadow: true }),
  floating(rail(-2.6, 5.8), 'steel', A + 1.6, 1.4, { tag: 'rail', noShadow: true }),
  floating(rail(8.6, 17.8), 'steel', B + 1.6, 1.4, { tag: 'rail', noShadow: true }),
  floating(rail(20.6, 29.8), 'steel', C + 1.6, 1.4, { tag: 'rail', noShadow: true }),
  headlight(mirrorX(roundRect(9, -38, 2.6, 1.1, 0.6)), 6.6, 7.8),
  taillight(mirrorX(roundRect(10, 31.2, 2, 1, 0.5)), 6.4, 7.4),
];

const decals: Decal[] = [
  { shape: union(slats(1.6), slats(13.2), slats(25.2)), on: ['rack'], shade: 2 },
  // Timber framing: darker rails round each panel and one upright.
  { shape: mirrorX(ring(roundRect(14.8, 1, 1.3, 11.2, 0.6), 0.5)), on: ['timber'], shade: -1 },
  { shape: mirrorX(roundRect(14.8, 1, 2.5, 0.45, 0.2)), on: ['timber'], shade: -1 },
  { shape: ring(hood, 0.7), on: ['front'], shade: -1 },
  { shape: mirrorX(capsule(8, -17.6, 10.6, -14.4, 0.8)), on: ['glass'], material: 'paint' },
  { shape: mirrorX(roundRect(10.8, -8.6, 1.4, 0.7, 0.2)), on: ['glass'], material: 'paint' },
  { shape: intersect(capsule(-8, -16, -3, -18.4, 0.6), greenhouse), on: ['glass'], shade: 2 },
  {
    shape: union(roundRect(0, 34.4, 6.6, 0.5, 0.2), roundRect(0, 37, 6.6, 0.5, 0.2)),
    on: ['step'],
    shade: 2,
  },
];

export const WAGON_ART: ChassisArt = {
  id: 'chassis_wagon',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: -24 },
  exhausts: [
    { x: -6.4, y: 40.4 },
    { x: 6.4, y: 40.4 },
  ],
  headlightAnchors: [
    { x: -9, y: -39.2 },
    { x: 9, y: -39.2 },
  ],
  brakeLightAnchors: [
    { x: -10, y: 32.2 },
    { x: 10, y: 32.2 },
  ],
  mountHeights: {
    roof_front: 12,
    roof_mid: 16,
    rack_upper: A + 0.5,
    left_utility: 6.8,
    right_utility: 6.8,
    rack_deck: B + 0.5,
    rear_rack: C + 0.5,
    rear_center: 6.4,
  },
};
