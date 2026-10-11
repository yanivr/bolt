import type { Decal, Solid } from '../../../lib/model.js';
import {
  band,
  capsule,
  ellipse,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  union,
} from '../../../lib/model.js';
import type { ChassisArt } from '../../types.js';
import { headlight, mirrorPoints, model, ring, solid, taillight } from '../kit.js';

/**
 * Cobra: a long nose with a flat head, a raised hood spine and a flared "hood" of vented
 * panels spreading over the front wheels like the snake's neck (Section 12.6). Identity: the
 * flared neck with its slashed vents, and ivory bands across it, and two ivory fangs on the head.
 */

const body = polygon(
  mirrorPoints([
    [0, -36.4],
    [3.6, -35.6],
    [5.6, -31],
    [6.2, -24],
    [8.4, -12],
    [9, 4],
    [9.4, 22],
    [8, 32],
    [5, 35.4],
  ]),
  1.2,
);
const flare = mirrorX(
  polygon(
    [
      [5, -26.6],
      [9.2, -22.6],
      [12, -15],
      [12.2, -8],
      [10, -2.4],
      [6, 0.6],
    ],
    1.2,
  ),
);
const rearFenders = mirrorX(ellipse(11.2, 23, 3.6, 9.6));
const head = polygon(
  mirrorPoints([
    [0, -35.4],
    [3, -34.8],
    [4.6, -30.6],
    [4.6, -26],
  ]),
  0.8,
);
const spine = roundRect(0, -14, 3.5, 12.6, 2);
const greenhouse = roundRect(0, 5, 8, 12.8, 4.2);
const roof = roundRect(0, 7.6, 5, 9.4, 3);
const deck = roundRect(0, 26, 7.6, 8.4, 3);

const solids: Solid[] = [
  solid(roundRect(0, 2, 8, 33, 5), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(roundRect(0, 36.2, 7.6, 1.5, 1), 'steel', 3, 6, 1.2, { tag: 'bumper' }),
  solid(flare, 'paint', 4, 8.2, 2.6, { tag: 'flare' }),
  solid(rearFenders, 'paint', 4, 8.6, 4, { tag: 'fender' }),
  solid(body, 'paint', 4.6, 9.5, 4.6, { tag: 'shell' }),
  solid(head, 'paint', 9.2, 10, 1.4, { tag: 'head' }),
  solid(spine, 'steelDark', 9.4, 11.5, 1.4, { tag: 'spine' }),
  solid(deck, 'paint', 9.3, 10.4, 2.6, { tag: 'deck' }),
  solid(greenhouse, 'glass', 9.8, 13.6, 4, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 13.4, 14.6, 2.2, { tag: 'roof' }),
  headlight(mirrorX(capsule(4.6, -33.4, 6.2, -28.6, 0.95)), 7, 8.2),
  taillight(mirrorX(roundRect(6, 34.6, 2, 0.95, 0.5)), 7.6, 8.4),
];

const vents = mirrorX(capsule(5.4, -24.6, 6.4, -18.6, 0.9));
const bands = union(band(-21.6, -18.8), band(-12.6, -9.8));
const fangs = mirrorX(
  polygon(
    [
      [1.2, -35],
      [3.4, -34],
      [3.6, -29.4],
      [1.8, -31.6],
    ],
    0.2,
  ),
);
const decals: Decal[] = [
  { shape: vents, on: ['shell', 'flare'], material: 'bore' },
  // Banded like the snake: two ivory bars across the nose that widen over the flared hood.
  { shape: bands, on: ['flare', 'shell'], material: 'ivory' },
  { shape: fangs, on: ['head', 'shell'], material: 'ivory' },
  { shape: ring(spine, 0.7), on: ['shell'], shade: -1 },
  { shape: ring(deck, 0.7), on: ['shell'], shade: -1 },
  { shape: ring(greenhouse, 0.8), on: ['shell'], shade: -1 },
  // A dark groove down the spine reads as the ridge of scales.
  { shape: roundRect(0, -14, 1.5, 10.6, 0.6), on: ['spine'], shade: 1 },
  { shape: mirrorX(capsule(5, -3.4, 6.8, -0.4, 0.75)), on: ['glass'], material: 'paint' },
  { shape: mirrorX(roundRect(7, 8, 1.4, 0.7, 0.2)), on: ['glass'], material: 'paint' },
  { shape: intersect(capsule(-5, -1.6, -1.4, -4.2, 0.6), greenhouse), on: ['glass'], shade: 2 },
];

export const COBRA_ART: ChassisArt = {
  id: 'chassis_cobra',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 22 },
  exhausts: [
    { x: -4.6, y: 33 },
    { x: 4.6, y: 33 },
  ],
  headlightAnchors: [
    { x: -5.4, y: -32 },
    { x: 5.4, y: -32 },
  ],
  brakeLightAnchors: [
    { x: -6, y: 35.4 },
    { x: 6, y: 35.4 },
  ],
  mountHeights: {
    front_nose: 10,
    front_spine: 11.5,
    roof_front: 14.6,
    roof_rear: 14.6,
    rear_deck: 11.6,
    rear_center: 6,
  },
};
