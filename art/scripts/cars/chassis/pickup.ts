import type { Decal, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  ellipse,
  intersect,
  mirrorX,
  roundRect,
  subtract,
  union,
} from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, headlight, model, ring, solid, taillight } from './kit.js';

/**
 * Pickup: a front-engined truck with a short tall cab, a steel sport bar behind it and a
 * long open bed with a ribbed floor and thick walls that carry the bed-rail mounts
 * (Section 12.6). Identity: the open bed, the sport bar and an ivory tailgate.
 */

const hoodBlock = roundRect(0, -27.4, 10.6, 9.2, 3.6);
const hood = roundRect(0, -27.6, 8.4, 7, 3);
const fenders = mirrorX(ellipse(13, -23, 3.2, 8.8));
const cabBase = roundRect(0, -11, 12.6, 7.4, 2.6);
const greenhouse = roundRect(0, -11, 11.4, 6.4, 3);
const roof = roundRect(0, -10.8, 8.8, 4.2, 2);
const bedOuter = roundRect(0, 13.6, 17.6, 18, 1.2);
const bedInner = roundRect(0, 13, 11.2, 15.4, 1);
const walls = subtract(bedOuter, bedInner);
const steps = mirrorX(roundRect(16, -8, 2.6, 5, 1.2));

const BAR = 17;
const solids: Solid[] = [
  solid(roundRect(0, 0, 12, 35, 4), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(roundRect(0, -36.6, 12, 1.5, 0.9), 'steel', 3, 6, 1.2, { tag: 'bumper' }),
  solid(roundRect(0, 34, 13, 2.4, 1), 'steel', 3.2, 6.6, 1.2, { tag: 'bumper' }),
  solid(steps, 'steelDark', 3.4, 6.5, 1, { tag: 'step' }),
  solid(fenders, 'paint', 4, 8.4, 3.8, { tag: 'fender' }),
  solid(hoodBlock, 'paint', 4.6, 9.6, 4, { tag: 'front' }),
  solid(hood, 'paint', 9.4, 10.4, 2.4, { tag: 'hood' }),
  solid(cabBase, 'paint', 4.6, 10, 2.4, { tag: 'cab' }),
  solid(bedInner, 'steelDark', 5.4, 6, 0, { tag: 'bed' }),
  solid(walls, 'paint', 4.6, 10, 1.6, { tag: 'wall' }),
  solid(greenhouse, 'glass', 10, 14.8, 3.4, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 14.6, 16.2, 1.8, { tag: 'roof' }),
  // Sport bar: two posts on the bed walls and a hoop over them.
  solid(mirrorX(circle(13.6, -2.4, 1.1)), 'steel', 9, BAR - 1, 0, { tag: 'bar' }),
  floating(capsule(-13.6, -2.4, 13.6, -2.4, 1.05), 'steel', BAR, 1.8, { tag: 'bar' }),
  headlight(mirrorX(circle(12.6, -31, 1.9)), 7.6, 9.2, 1.4),
  taillight(mirrorX(roundRect(14.4, 31.6, 1.7, 0.9, 0.4)), 8.4, 9.4),
];

const decals: Decal[] = [
  // Ivory tailgate.
  { shape: intersect(walls, band(28.4, 33)), on: ['wall'], material: 'ivory' },
  // Bed ribs.
  {
    shape: intersect(
      bedInner,
      union(...[-6.6, -2.2, 2.2, 6.6].map((x) => roundRect(x, 13, 0.55, 14.4, 0.2))),
    ),
    on: ['bed'],
    shade: 1,
  },
  { shape: mirrorX(roundRect(14, 6, 1.6, 4, 0.6)), on: ['wall'], shade: -1 },
  { shape: ring(hood, 0.7), on: ['front'], shade: -1 },
  { shape: mirrorX(capsule(7.8, -16, 10, -13.4, 0.8)), on: ['glass'], material: 'paint' },
  { shape: mirrorX(capsule(7.8, -6, 10, -8.4, 0.8)), on: ['glass'], material: 'paint' },
  { shape: intersect(capsule(-8, -14.4, -3.4, -16.4, 0.6), greenhouse), on: ['glass'], shade: 2 },
  { shape: mirrorX(roundRect(16, -8, 1.2, 3.4, 0.5)), on: ['step'], shade: 1 },
];

export const PICKUP_ART: ChassisArt = {
  id: 'chassis_pickup',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: -22 },
  exhausts: [
    { x: -4.6, y: 36.6 },
    { x: 4.6, y: 36.6 },
  ],
  headlightAnchors: [
    { x: -12.6, y: -32.4 },
    { x: 12.6, y: -32.4 },
  ],
  brakeLightAnchors: [
    { x: -14.4, y: 32.4 },
    { x: 14.4, y: 32.4 },
  ],
  mountHeights: {
    utility_hood: 12,
    left_utility: 6.5,
    right_utility: 6.5,
    bed_front: 6,
    left_bed: 10,
    right_bed: 10,
    bed_rear: 6,
    rear_center: 6.6,
  },
};
