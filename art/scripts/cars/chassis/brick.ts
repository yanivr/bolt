import type { Decal, Solid } from '../../lib/model.js';
import { circle, intersect, mirrorX, roundRect, subtract, union } from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { headlight, model, ring, solid, taillight } from './kit.js';

/**
 * Brick: a heavy rectilinear slab. A tall square hull with a stepped-down hood and tail deck,
 * wheels buried in notched arches, riveted steel doors on both flanks and a slatted roof rack
 * (Section 12.6). Identity: the slab outline, the steel doors and two ivory hood blocks.
 */

const arches = mirrorX(union(roundRect(25, -24, 6.4, 8.2, 1.4), roundRect(25, 24, 6.4, 8.2, 1.4)));
const hoodBlock = subtract(roundRect(0, -30, 22.6, 6, 2), arches);
const tailBlock = subtract(roundRect(0, 29.6, 22.6, 6.6, 2), arches);
const hull = subtract(roundRect(0, 0, 24, 22.6, 2.4), arches);
const roof = roundRect(0, 0, 13.6, 21.2, 2.4);
const windshield = roundRect(0, -24.2, 18.6, 3.4, 1);
const rack = roundRect(0, 0, 9, 9.6, 1);
const doors = mirrorX(roundRect(24.4, 0, 1.6, 11.6, 0.4));
const rivetRow = (x: number, ys: number[]) => mirrorX(union(...ys.map((y) => circle(x, y, 0.8))));

const solids: Solid[] = [
  solid(roundRect(0, 0, 20, 35, 2), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(roundRect(0, -36.8, 21, 1.5, 0.8), 'steel', 3, 6.4, 1.2, { tag: 'bumper' }),
  solid(roundRect(0, 36.8, 21, 1.5, 0.8), 'steel', 3, 6.4, 1.2, { tag: 'bumper' }),
  solid(hoodBlock, 'paint', 4.6, 9.6, 2.4, { tag: 'hood' }),
  solid(tailBlock, 'paint', 4.6, 10.4, 2.4, { tag: 'tail' }),
  solid(doors, 'steel', 5, 12, 0.8, { tag: 'door' }),
  solid(hull, 'paint', 4.6, 14, 2.2, { tag: 'hull' }),
  solid(windshield, 'glass', 9.6, 13.6, 3.2, { tag: 'glass', profile: 'linear', noShadow: true }),
  solid(roof, 'paint', 13.8, 16, 1.8, { tag: 'roof' }),
  solid(mirrorX(roundRect(11, 0, 0.9, 18, 0.5)), 'paint', 16, 16.9, 0.8, { tag: 'rib' }),
  solid(rack, 'steelDark', 16, 16.7, 0.7, { tag: 'rack', noShadow: true }),
  headlight(mirrorX(roundRect(16.6, -36.2, 3, 1.1, 0.5)), 6.6, 7.8),
  taillight(mirrorX(roundRect(16.8, 36.3, 2.8, 1, 0.5)), 7.2, 8.2),
];

const decals: Decal[] = [
  // Two ivory blocks on the hood corners mark the front.
  { shape: mirrorX(roundRect(17, -30.4, 3.2, 2.6, 0.6)), on: ['hood'], material: 'ivory' },
  // Door frames and rivets on the shoulders above the steel doors.
  { shape: mirrorX(roundRect(21.6, 0, 0.4, 11.6, 0.2)), on: ['hull'], shade: -1 },
  { shape: rivetRow(19.6, [-14.6, 14.6]), on: ['hull'], shade: 1 },
  { shape: rivetRow(24.6, [-8.8, -3, 3, 8.8]), on: ['door'], shade: 1 },
  { shape: mirrorX(roundRect(18.4, 0, 3.4, 0.4, 0.2)), on: ['hull'], shade: -1 },
  // Roof rack slats, roof seams and the two utility hatches.
  {
    shape: intersect(rack, union(...[-6, -2, 2, 6].map((y) => roundRect(0, y, 7.4, 0.6, 0.3)))),
    on: ['rack'],
    shade: 2,
  },
  { shape: ring(roundRect(0, -17.4, 6.4, 2.6, 1), 0.6), on: ['roof'], shade: -1 },
  { shape: roundRect(-13, -24.4, 0.6, 3, 0.2), on: ['glass'], material: 'paint' },
  { shape: roundRect(13, -24.4, 0.6, 3, 0.2), on: ['glass'], material: 'paint' },
  { shape: roundRect(-6, -24.6, 4, 0.6, 0.3), on: ['glass'], shade: 2 },
  { shape: ring(roundRect(0, 16.6, 6.4, 3, 1), 0.6), on: ['roof'], shade: -1 },
  { shape: ring(roundRect(0, 28.6, 9.6, 4.6, 1.4), 0.6), on: ['tail'], shade: -1 },
  { shape: ring(roundRect(0, -30.6, 10.4, 3.4, 1.2), 0.6), on: ['hood'], shade: -1 },
];

export const BRICK_ART: ChassisArt = {
  id: 'chassis_brick',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 26 },
  exhausts: [
    { x: -4.6, y: 37 },
    { x: 4.6, y: 37 },
  ],
  headlightAnchors: [
    { x: -16.6, y: -37.4 },
    { x: 16.6, y: -37.4 },
  ],
  brakeLightAnchors: [
    { x: -16.8, y: 37.4 },
    { x: 16.8, y: 37.4 },
  ],
  mountHeights: {
    front_center: 9.6,
    front_utility: 16,
    left_front: 14,
    right_front: 14,
    roof_mid: 16.7,
    left_rear: 14,
    right_rear: 14,
    rear_utility: 16,
    rear_center: 11.6,
  },
};
