import type { Decal, Solid } from '../../../lib/model.js';
import {
  capsule,
  circle,
  ellipse,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  union,
} from '../../../lib/model.js';
import type { ChassisArt } from '../../types.js';
import { floating, headlight, mirrorPoints, model, ring, slash, solid, taillight } from '../kit.js';

/**
 * Drifter: a low coupe with a long hood over a front engine, a swept low roof, a pinched
 * waist, wide flared rear arches and both tailpipes exiting on the right (Section 12.6).
 * Identity: two ivory slashes raked across the roof and tail, and the full-width tail lamp.
 */

const shell = polygon(
  mirrorPoints([
    [0, -29.4],
    [7, -29],
    [9.6, -25],
    [10, -8],
    [9, 3],
    [10.6, 11],
    [11.4, 25],
    [9.6, 28.8],
  ]),
  1.4,
);
const hood = roundRect(0, -17, 8, 9.6, 4);
const greenhouse = polygon(
  mirrorPoints([
    [0, -8.4],
    [6.4, -8],
    [8.2, -2],
    [7.8, 6],
    [5, 13.6],
  ]),
  1.4,
);
const roof = roundRect(0, 0.6, 5.9, 5.4, 3.4);
const deck = roundRect(0, 21.5, 8.4, 6, 3);
const frontFenders = mirrorX(ellipse(10.6, -17, 4, 9.4));
const rearArches = mirrorX(ellipse(12.4, 18, 4.8, 10.8));
const skirts = mirrorX(roundRect(11.6, 0, 2.6, 7.6, 1.4));
const pipes = union(capsule(7.6, 28.6, 7.6, 32.6, 1.45), capsule(10.9, 28.2, 10.9, 32, 1.45));
const lip = roundRect(0, 28.2, 10.4, 1.3, 0.9);

const solids: Solid[] = [
  solid(roundRect(0, 0, 9.6, 28, 6), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(pipes, 'steel', 3.4, 5.6, 1.3, { tag: 'pipe', noShadow: true }),
  solid(roundRect(0, -29.8, 8.6, 1.3, 1), 'steelDark', 3, 4.6, 1, { tag: 'splitter' }),
  solid(skirts, 'steelDark', 3.4, 6.5, 1.4, { tag: 'skirt' }),
  solid(frontFenders, 'paint', 4, 8.2, 4, { tag: 'fender' }),
  solid(rearArches, 'paint', 4, 9.6, 4.6, { tag: 'arch' }),
  solid(shell, 'paint', 4.6, 9.4, 4.6, { tag: 'shell' }),
  solid(hood, 'paint', 9.2, 10.4, 3.4, { tag: 'hood' }),
  solid(deck, 'paint', 9.2, 10.2, 3, { tag: 'deck' }),
  solid(lip, 'paint', 9.6, 11.4, 1.1, { tag: 'lip' }),
  solid(greenhouse, 'glass', 9.6, 12.8, 4, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 12.6, 13.6, 2.4, { tag: 'roof' }),
  // A tall drift wing on two struts, behind the tail mount.
  solid(mirrorX(circle(9.6, 30.6, 0.95)), 'steelDark', 6, 13, 0, { tag: 'strut' }),
  floating(roundRect(0, 31.4, 14.6, 1.5, 0.8), 'paint', 14.2, 1.4, { tag: 'wing' }),
  floating(mirrorX(roundRect(14.4, 31, 0.9, 2.6, 0.5)), 'ivory', 15, 2.6, { tag: 'endplate' }),
  headlight(mirrorX(roundRect(7.4, -28.4, 2.7, 1.1, 0.6)), 7, 8),
  taillight(roundRect(0, 29.2, 8.8, 0.95, 0.5), 7.6, 8.4),
];

const slashes = union(slash(-40, 12, 1.5), slash(-40, 16.6, 1.5));
const decals: Decal[] = [
  { shape: slashes, on: ['shell', 'roof', 'deck', 'arch', 'lip'], material: 'ivory' },
  { shape: ring(hood, 0.75), on: ['shell'], shade: -1 },
  { shape: ring(deck, 0.75), on: ['shell'], shade: -1 },
  // Hood vents either side of the engine lid.
  { shape: mirrorX(capsule(6.8, -22, 6.8, -13, 0.6)), on: ['hood', 'shell'], material: 'bore' },
  { shape: mirrorX(capsule(5, 10.6, 6.9, 5.6, 0.75)), on: ['glass'], material: 'paint' },
  { shape: mirrorX(capsule(5.6, -6.4, 7.6, -2.6, 0.75)), on: ['glass'], material: 'paint' },
  { shape: intersect(capsule(-5.2, -3.6, -1.6, -6.4, 0.6), greenhouse), on: ['glass'], shade: 2 },
  { shape: union(circle(7.6, 32.6, 0.8), circle(10.9, 32, 0.8)), on: ['pipe'], material: 'bore' },
  { shape: mirrorX(roundRect(11.8, 0, 1.2, 5.6, 0.5)), on: ['skirt'], shade: 1 },
];

export const DRIFTER_ART: ChassisArt = {
  id: 'chassis_drifter',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: -16 },
  exhausts: [
    { x: 7.6, y: 33.6 },
    { x: 10.9, y: 33 },
  ],
  headlightAnchors: [
    { x: -7.4, y: -29.6 },
    { x: 7.4, y: -29.6 },
  ],
  brakeLightAnchors: [
    { x: -6.5, y: 30 },
    { x: 6.5, y: 30 },
  ],
  mountHeights: {
    roof_front: 12,
    roof_mid: 13.6,
    left_mid: 6.5,
    right_mid: 6.5,
    rear_deck: 10.2,
    rear_center: 10.2,
  },
};
