import type { Decal, Solid } from '../../lib/model.js';
import {
  band,
  capsule,
  circle,
  ellipse,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  union,
} from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, headlight, mirrorPoints, model, ring, solid, taillight } from './kit.js';

/**
 * Needle: a long tapered nose ahead of the front axle, a fuselage barely wider than the
 * driver, tiny side pods and all four wheels standing clear on steel wishbones (Section 12.6).
 * Identity: the ivory needle point with one ivory ring behind it, and ivory wing endplates.
 */

const fuselage = polygon(
  mirrorPoints([
    [0, -35.2],
    [1.2, -34.6],
    [3.4, -22],
    [5, -8],
    [6, 6],
    [6.4, 20],
    [5.4, 30.4],
  ]),
  1,
);
const canopy = ellipse(0, 3.6, 4.7, 9.6);
const roof = roundRect(0, 5.2, 3.1, 5.2, 2.6);
const engineDeck = roundRect(0, 22.2, 6.6, 7.6, 3);
const pods = mirrorX(roundRect(8.4, 6.4, 2.5, 6.6, 2.2));
const wishbones = mirrorX(
  union(
    capsule(3.2, -15.6, 8.4, -11, 1.05),
    capsule(4.6, -5.6, 8.4, -11, 1.05),
    capsule(6, 22, 8.6, 22, 1.2),
  ),
);
const uprights = mirrorX(
  union(roundRect(8.2, -11, 1.2, 3, 0.8), roundRect(8.6, 22, 1.1, 3.2, 0.8)),
);

const solids: Solid[] = [
  solid(wishbones, 'steel', 3.4, 5, 1.2, { tag: 'arm' }),
  solid(uprights, 'steelDark', 3.6, 5.8, 1, { tag: 'hub' }),
  solid(roundRect(0, 32, 4.6, 1.6, 0.8), 'steelDark', 3, 5.4, 1, { tag: 'diffuser' }),
  solid(pods, 'paint', 3, 7, 2.6, { tag: 'pod' }),
  solid(fuselage, 'paint', 4, 8.6, 4.2, { tag: 'shell' }),
  solid(engineDeck, 'paint', 8.2, 10.4, 2.6, { tag: 'deck' }),
  solid(canopy, 'glass', 8.4, 12.2, 4.4, { tag: 'glass' }),
  solid(roof, 'paint', 12, 12.9, 1.6, { tag: 'roof' }),
  // A low rear wing on two posts, behind the engine.
  solid(mirrorX(circle(4.4, 32.6, 0.9)), 'steelDark', 4, 11.6, 0, { tag: 'post' }),
  floating(roundRect(0, 32.8, 9.4, 1.7, 0.8), 'paint', 12.6, 1.4, { tag: 'wing' }),
  floating(mirrorX(roundRect(9.6, 32.6, 0.9, 2.6, 0.6)), 'ivory', 13.4, 2.6, { tag: 'endplate' }),
  headlight(mirrorX(roundRect(4.6, -15.4, 1.3, 2, 0.8)), 5.6, 7, 1),
  taillight(mirrorX(roundRect(3.6, 30.6, 1.7, 0.95, 0.5)), 7.4, 8.2),
];

const decals: Decal[] = [
  // The needle point and two graduation rings.
  {
    shape: intersect(fuselage, union(band(-40, -31), band(-26.4, -24))),
    on: ['shell'],
    material: 'ivory',
  },
  { shape: ring(canopy, 0.8), on: ['shell'], shade: -1 },
  { shape: ring(engineDeck, 0.7), on: ['shell'], shade: -1 },
  { shape: intersect(capsule(-3, -1.6, -1, -4.6, 0.55), canopy), on: ['glass'], shade: 2 },
  // Radiator mouths at the front of each pod.
  { shape: mirrorX(roundRect(8.4, 1.4, 1.5, 1, 0.4)), on: ['pod'], material: 'bore' },
];

export const NEEDLE_ART: ChassisArt = {
  id: 'chassis_needle',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 22 },
  exhausts: [
    { x: -4.6, y: 33 },
    { x: 4.6, y: 33 },
  ],
  headlightAnchors: [
    { x: -4.9, y: -16.5 },
    { x: 4.9, y: -16.5 },
  ],
  brakeLightAnchors: [
    { x: -3.6, y: 31.4 },
    { x: 3.6, y: 31.4 },
  ],
  mountHeights: { front_nose: 8, front_spine: 8.6, roof_mid: 12.9, roof_rear: 12 },
};
