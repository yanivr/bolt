import type { Decal, Solid } from '../../lib/model.js';
import {
  capsule,
  ellipse,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  subtract,
  union,
} from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, headlight, model, ring, solid, taillight } from './kit.js';

/**
 * Twins: two long hulls, each with its own bubble canopy and tail fin, carrying a pair of
 * wheels apiece and joined by steel struts to a short central nacelle (Section 12.6).
 * Identity: the H-shaped plan, open at both ends, with twin canopies and twin ivory fins.
 */

const arches = mirrorX(union(roundRect(27.6, -22, 4, 7.8, 1.4), roundRect(27.6, 22, 4, 7.8, 1.4)));
const hullOutline = mirrorX(
  polygon(
    [
      [23.4, -35],
      [25.6, -30],
      [26, -12],
      [26, 28],
      [24, 33.4],
      [18.4, 33.4],
      [16.4, 28],
      [16.4, -12],
      [16.8, -30],
      [19, -35],
    ],
    1,
  ),
);
const hulls = subtract(hullOutline, arches);
const hullDecks = mirrorX(roundRect(21.2, 0, 3.6, 13.6, 1.6));
const canopies = mirrorX(ellipse(21.2, -21, 3.7, 6.2));
const fins = mirrorX(roundRect(21.2, 28.4, 1.1, 4.6, 0.8));
const nacelle = roundRect(0, 4, 8.8, 23, 3.6);
const plate = roundRect(0, -3.4, 6.8, 14.4, 2);
const deck = roundRect(0, 20.6, 7, 5.6, 2.4);
const struts = mirrorX(
  union(capsule(7, -12, 17, -12, 1.5), capsule(7, 5, 17, 5, 1.5), capsule(7, 21, 17, 21, 1.5)),
);

const solids: Solid[] = [
  floating(struts, 'steel', 7.6, 2.2, { tag: 'strut' }),
  solid(hulls, 'paint', 4.6, 9.4, 3.4, { tag: 'hull' }),
  solid(hullDecks, 'paint', 9.2, 10, 1, { tag: 'hullDeck' }),
  solid(canopies, 'glass', 9.2, 12.8, 3.4, { tag: 'glass' }),
  solid(fins, 'ivory', 9, 15.4, 1, { tag: 'fin', profile: 'linear' }),
  solid(nacelle, 'paint', 4.6, 10.2, 3.6, { tag: 'nacelle' }),
  solid(plate, 'paint', 10.2, 11.4, 1.2, { tag: 'plate' }),
  solid(deck, 'paint', 9.6, 10.4, 1.6, { tag: 'deck' }),
  solid(roundRect(0, -18.4, 5, 1.2, 0.6), 'glass', 8.2, 8.8, 0.5, { tag: 'glass', noShadow: true }),
  headlight(mirrorX(capsule(18, -32.6, 17.2, -29.6, 0.95)), 6.6, 7.8),
  headlight(mirrorX(capsule(24.4, -32.6, 25.2, -29.6, 0.95)), 6.6, 7.8),
  taillight(mirrorX(roundRect(21.2, 33.4, 2.6, 0.95, 0.5)), 7, 8),
];

const decals: Decal[] = [
  { shape: ring(hullDecks, 0.6), on: ['hull'], shade: -1 },
  { shape: mirrorX(roundRect(21.2, -0.6, 3.6, 0.4, 0.2)), on: ['hullDeck'], shade: -1 },
  // An ivory band across each hull ahead of the fin.
  {
    shape: intersect(hullOutline, (_x, y) => Math.abs(y - 16.4) - 1.2),
    on: ['hull'],
    material: 'ivory',
  },
  { shape: mirrorX(capsule(19.6, -22.6, 20.6, -25, 0.5)), on: ['glass'], shade: 2 },
  { shape: ring(plate, 0.6), on: ['nacelle'], shade: -1 },
  { shape: roundRect(0, -4.4, 6.8, 0.4, 0.2), on: ['plate'], shade: -1 },
  { shape: ring(deck, 0.6), on: ['nacelle'], shade: -1 },
];

export const TWINS_ART: ChassisArt = {
  id: 'chassis_twins',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 20 },
  exhausts: [
    { x: -4.6, y: 31 },
    { x: 4.6, y: 31 },
  ],
  headlightAnchors: [
    { x: -21.2, y: -34 },
    { x: 21.2, y: -34 },
  ],
  brakeLightAnchors: [
    { x: -21.2, y: 34.2 },
    { x: 21.2, y: 34.2 },
  ],
  mountHeights: {
    left_nose: 8.6,
    right_nose: 8.6,
    roof_front: 11.4,
    left_front: 10,
    right_front: 10,
    roof_rear: 11.4,
    left_rear: 10,
    right_rear: 10,
  },
};
