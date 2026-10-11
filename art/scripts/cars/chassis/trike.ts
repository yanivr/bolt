import type { Decal, Solid } from '../../lib/model.js';
import {
  capsule,
  circle,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  subtract,
  union,
} from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, headlight, mirrorPoints, model, solid, taillight } from './kit.js';

/**
 * Trike: a tiny triangular three-wheeler. Two steel frame tubes run from the front hubs to
 * the single rear wheel and stay exposed; a shield-shaped nose fairing and a small tub are
 * the only bodywork, and two steel luggage plates flank the bare rear tire. Identity: the
 * cyclops headlight, the V frame and the lone rear wheel.
 */

const fairing = polygon(
  mirrorPoints([
    [0, -23.4],
    [4, -22.2],
    [6.6, -14],
    [5.8, -6.4],
    [0, -4.6],
  ]),
  1,
);
const tub = polygon(
  mirrorPoints([
    [0, -6],
    [7.2, -5],
    [7.2, 6],
    [4, 9.4],
    [0, 9.4],
  ]),
  1,
);
const deck = roundRect(0, 3, 6.2, 4.6, 2.2);
const frame = union(mirrorX(capsule(8.4, -13, 5.8, 16.4, 1.2)), capsule(-8.4, -13, 8.4, -13, 1.3));
const fork = mirrorX(roundRect(5.8, 16.2, 1.1, 3.8, 0.9));
const plates = mirrorX(roundRect(10.3, 15, 2.7, 4.8, 1.2));
const tail = roundRect(0, 22.2, 2.6, 1.9, 1.2);
const lamp = circle(0, -22.4, 2.1);

const solids: Solid[] = [
  solid(frame, 'steel', 3.4, 5.2, 1.2, { tag: 'frame' }),
  solid(fork, 'steelDark', 3.6, 6.4, 1, { tag: 'hub' }),
  solid(mirrorX(capsule(6.4, 13, 9, 13, 0.9)), 'steel', 3.6, 5, 0.9, { tag: 'frame' }),
  solid(mirrorX(capsule(6.4, 17.6, 9, 17.6, 0.9)), 'steel', 3.6, 5, 0.9, { tag: 'frame' }),
  solid(mirrorX(roundRect(8.2, -13, 1.1, 3, 0.8)), 'steelDark', 3.6, 6, 1, { tag: 'hub' }),
  floating(plates, 'steel', 6.5, 1.4, { tag: 'plate' }),
  solid(tub, 'paint', 3.6, 9, 3.4, { tag: 'tub' }),
  solid(fairing, 'paint', 4, 9, 4, { tag: 'fairing' }),
  solid(deck, 'steelDark', 9.6, 10.4, 1, { tag: 'deck', floor: 8.6 }),
  // A stub of fender behind the tire carries the tail lamp.
  floating(capsule(-5.8, 21.4, 5.8, 21.4, 0.9), 'steel', 6.6, 1.6, { tag: 'frame' }),
  floating(tail, 'paint', 7.8, 2.2, { tag: 'tail' }),
  solid(circle(0, -4.6, 1), 'steelDark', 9, 11.6, 0, { tag: 'stem', noShadow: true }),
  floating(capsule(-6.4, -4.6, 6.4, -4.6, 0.95), 'steel', 12.2, 1.3, {
    tag: 'bar',
    noShadow: true,
  }),
  floating(mirrorX(capsule(5.2, -4.6, 7, -4.6, 1.15)), 'seat', 12.4, 1.7, {
    tag: 'grip',
    noShadow: true,
  }),
  headlight(lamp, 6.4, 8.4, 1.6),
  taillight(roundRect(0, 23.6, 1.9, 0.9, 0.5), 7.8, 8.6),
];

const decals: Decal[] = [
  // Twin ivory flashes down the fairing.
  {
    shape: intersect(fairing, mirrorX(capsule(2.5, -18.6, 4, -8.6, 0.85))),
    on: ['fairing'],
    material: 'ivory',
  },
  { shape: subtract(lamp, circle(0, -22.4, 1.3)), on: ['headlight'], shade: -2 },
  { shape: mirrorX(roundRect(10.3, 15, 1.3, 3.2, 0.6)), on: ['plate'], shade: -2 },
];

export const TRIKE_ART: ChassisArt = {
  id: 'chassis_trike',
  model: model(solids, decals),
  cell: 96,
  engineAnchor: { x: 0, y: 3 },
  exhausts: [
    { x: -4.6, y: 14 },
    { x: 4.6, y: 14 },
  ],
  headlightAnchors: [{ x: 0, y: -23.6 }],
  brakeLightAnchors: [{ x: 0, y: 24.2 }],
  mountHeights: { front_center: 9, roof_mid: 12, left_rear: 6.5, right_rear: 6.5 },
};
