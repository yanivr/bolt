import type { Decal, Solid } from '../../lib/model.js';
import {
  above,
  capsule,
  circle,
  ellipse,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  subtract,
  union,
} from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, mirrorPoints, model, ring, solid, taillight } from './kit.js';

/**
 * Crab: a narrow domed carapace with the wheels tucked against it, and three steel outrigger
 * arms a side reaching past them to claw pads (Section 12.6). The front pair are curved
 * pincers. Identity: the ivory-tipped pincers and the two eye-stalk headlights.
 */

const carapace = polygon(
  mirrorPoints([
    [0, -24.6],
    [5.6, -23.6],
    [9.6, -15],
    [10.4, 0],
    [9.6, 15],
    [6.6, 26],
    [0, 27],
  ]),
  1.4,
);
const crown = roundRect(0, -5, 6.8, 13, 4);
const deck = roundRect(0, 20.4, 7, 5.8, 2.6);
const arms = mirrorX(
  union(capsule(8, -17, 21, -17, 1.6), capsule(9, 0, 21, 0, 1.6), capsule(8, 17, 21, 17, 1.6)),
);
// A crescent that opens forward and inward: the pincer.
const pincers = mirrorX(
  subtract(
    union(ellipse(23.4, -19.6, 4.8, 9.6), roundRect(24, -16.6, 4.2, 5.2, 2)),
    ellipse(20.4, -25, 3, 6.2),
  ),
);
const midPads = mirrorX(roundRect(24, 0, 4.1, 6.6, 2.4));
const rearPads = mirrorX(roundRect(24, 17.2, 4.1, 5, 2.4));
const padPlates = mirrorX(
  union(
    roundRect(24, -16.8, 2.6, 3.4, 0.8),
    roundRect(24, 0, 2.6, 4.6, 0.8),
    roundRect(24, 17.2, 2.6, 3.2, 0.8),
  ),
);
const eyes = mirrorX(circle(4.4, -26.6, 1.9));
const eyeLamp: Solid = {
  shape: eyes,
  material: 'lampOff',
  z0: 11,
  z1: 12.8,
  bevel: 1.6,
  floor: 9.6,
  tag: 'headlight',
  noShadow: true,
};

const solids: Solid[] = [
  floating(arms, 'steel', 7.4, 2, { tag: 'arm' }),
  solid(pincers, 'paint', 3.4, 7, 2.6, { tag: 'claw' }),
  solid(midPads, 'paint', 3.4, 7, 2.4, { tag: 'claw' }),
  solid(rearPads, 'paint', 3.4, 7, 2.4, { tag: 'claw' }),
  solid(mirrorX(roundRect(7.4, 0, 1.4, 22, 1)), 'chassis', 2.4, 3.4, 0, { tag: 'floor' }),
  solid(carapace, 'paint', 4.6, 10, 5.6, { tag: 'shell' }),
  solid(crown, 'paint', 10, 11.4, 2.4, { tag: 'crown' }),
  solid(deck, 'paint', 9.4, 10.4, 2.4, { tag: 'deck' }),
  solid(roundRect(0, -20.2, 5.2, 1.5, 0.7), 'glass', 8.4, 8.9, 0.6, {
    tag: 'glass',
    noShadow: true,
  }),
  solid(mirrorX(circle(4.4, -26.2, 1)), 'steelDark', 4, 10.4, 0, { tag: 'stalk' }),
  eyeLamp,
  taillight(mirrorX(roundRect(5.4, 26.6, 1.9, 0.95, 0.5)), 7.2, 8),
];

const decals: Decal[] = [
  { shape: padPlates, on: ['claw'], material: 'steelDark' },
  // Ivory pincer tips.
  { shape: intersect(pincers, above(-24.4)), on: ['claw'], material: 'ivory' },
  { shape: ring(crown, 0.7), on: ['shell'], shade: -1 },
  { shape: ring(deck, 0.7), on: ['shell'], shade: -1 },
  // Shell plates: two seams across the crown.
  {
    shape: union(roundRect(0, -9.6, 6.8, 0.45, 0.2), roundRect(0, 1.4, 6.8, 0.45, 0.2)),
    on: ['crown'],
    shade: -1,
  },
  {
    shape: mirrorX(subtract(circle(4.4, -26.6, 1.9), circle(4.4, -26.6, 1.1))),
    on: ['headlight'],
    shade: -2,
  },
];

export const CRAB_ART: ChassisArt = {
  id: 'chassis_crab',
  model: model(solids, decals),
  cell: 96,
  engineAnchor: { x: 0, y: 20 },
  exhausts: [
    { x: -4.6, y: 31 },
    { x: 4.6, y: 31 },
  ],
  headlightAnchors: [
    { x: -4.4, y: -27.6 },
    { x: 4.4, y: -27.6 },
  ],
  brakeLightAnchors: [
    { x: -5.4, y: 27.4 },
    { x: 5.4, y: 27.4 },
  ],
  mountHeights: {
    left_front: 7,
    right_front: 7,
    left_mid: 7,
    right_mid: 7,
    left_rear: 7,
    right_rear: 7,
    roof_front: 11.4,
    roof_mid: 11.4,
  },
};
