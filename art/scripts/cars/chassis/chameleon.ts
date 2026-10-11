import type { Decal, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  intersect,
  roundRect,
  strip,
  subtract,
  union,
} from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { all, headlight, model, ring, solid, taillight } from './kit.js';

/**
 * Chameleon: a modular hull that is deliberately lopsided. A slotted steel rail runs nose to
 * tail, the cab sits left of centre, a long accessory rail hangs off the right flank and two
 * round pods bulge from the left; the panels do not match and nor do the headlights
 * (Section 12.6). Identity: the mismatched ivory and steel panels and the one big eye.
 */

const hull = roundRect(0, 0, 12.4, 33, 5);
const spineRail = roundRect(0, 0, 2.3, 31.4, 1);
const greenhouse = roundRect(-2.6, -2.6, 7.6, 7.2, 3);
const roof = roundRect(-2.4, -2, 4.8, 4, 2);
const sideRail = roundRect(13.6, 1, 2.1, 9.2, 1);
const pods = union(roundRect(-14, -4, 3.5, 3.7, 2.4), roundRect(-14, 6, 3.5, 3.7, 2.4));
const deck = roundRect(0, 20.6, 7.2, 6, 2.4);
const bigEye = circle(-7.4, -31, 2.6);
const smallEyes = union(circle(6, -32, 1.4), circle(9.4, -30.2, 1.4));

const solids: Solid[] = [
  solid(roundRect(0, 0, 11, 32, 4), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(roundRect(0, -33.2, 9, 1.2, 0.8), 'steelDark', 3, 5.4, 1, { tag: 'bumper' }),
  solid(roundRect(0, 33.4, 9.6, 1.2, 0.8), 'steelDark', 3, 5.4, 1, { tag: 'bumper' }),
  solid(
    union(capsule(11, -5, 13.6, -5, 1.1), capsule(11, 7, 13.6, 7, 1.1)),
    'steelDark',
    4,
    6.6,
    1,
    { tag: 'bracket' },
  ),
  solid(sideRail, 'steel', 6, 8, 1, { tag: 'sideRail' }),
  solid(pods, 'paint', 3.4, 7, 2.6, { tag: 'pod' }),
  solid(hull, 'paint', 4.6, 9.4, 4.2, { tag: 'hull' }),
  solid(deck, 'paint', 9.2, 10.4, 2, { tag: 'deck' }),
  solid(spineRail, 'steel', 9.4, 10.3, 0.8, { tag: 'rail' }),
  solid(greenhouse, 'glass', 9.6, 13.4, 3.4, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 13.2, 14.4, 1.6, { tag: 'roof' }),
  headlight(bigEye, 6.4, 8.6, 2),
  headlight(smallEyes, 6.6, 7.8, 1.1),
  taillight(roundRect(-6.6, 32.6, 3.4, 0.95, 0.5), 7.2, 8),
  taillight(circle(7.6, 32.2, 1.3), 7.2, 8, 1),
];

const frontLeft = all(hull, strip(-20, -2.9), band(-31.4, -12.4));
const rearRight = all(hull, strip(2.9, 20), band(13.6, 31.6));
const decals: Decal[] = [
  // Mismatched panels: ivory front left, bare steel rear right.
  { shape: frontLeft, on: ['hull'], material: 'ivory' },
  { shape: rearRight, on: ['hull', 'deck'], material: 'steel' },
  // Panel seams across the hull.
  { shape: union(band(-12.4, -11.8), band(13, 13.6)), on: ['hull'], shade: -1 },
  // Slots in every rail.
  { shape: roundRect(0, 0, 0.6, 30, 0.3), on: ['rail'], material: 'bore' },
  { shape: roundRect(13.6, 1, 0.6, 7.6, 0.3), on: ['sideRail'], material: 'bore' },
  { shape: union(circle(-14, -4, 1.7), circle(-14, 6, 1.7)), on: ['pod'], material: 'steelDark' },
  { shape: subtract(bigEye, circle(-7.4, -31, 1.6)), on: ['headlight'], shade: -2 },
  { shape: ring(deck, 0.6), on: ['hull'], shade: -1 },
  { shape: intersect(capsule(-7.4, -5.4, -4, -7.6, 0.6), greenhouse), on: ['glass'], shade: 2 },
  { shape: capsule(2.4, -7.6, 3.8, -5, 0.75), on: ['glass'], material: 'paint' },
];

export const CHAMELEON_ART: ChassisArt = {
  id: 'chassis_chameleon',
  model: model(solids, decals),
  cell: 96,
  engineAnchor: { x: 0, y: 20 },
  exhausts: [
    { x: -4.6, y: 31 },
    { x: 4.6, y: 31 },
  ],
  headlightAnchors: [
    { x: -7.4, y: -33 },
    { x: 7.6, y: -32.4 },
  ],
  brakeLightAnchors: [
    { x: -6.6, y: 33.4 },
    { x: 7.6, y: 33.2 },
  ],
  mountHeights: {
    rail_front: 10.3,
    rail_hood: 10.3,
    rail_roof: 14.4,
    rail_right: 8,
    pod_left_front: 7,
    pod_left_rear: 7,
    rail_deck: 10.3,
    rail_rear: 11.6,
  },
};
