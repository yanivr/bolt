import type { Decal, Solid } from '../../../lib/model.js';
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
} from '../../../lib/model.js';
import type { ChassisArt } from '../../types.js';
import {
  floating,
  headlight,
  mirrorPoints,
  model,
  ring,
  slopedTube,
  solid,
  taillight,
} from '../kit.js';

/**
 * Scorpion: a tapered, empty nose and a mid engine, then a segmented tail that climbs behind
 * the rear axle to a lifted equipment platform (Section 12.6). Identity: the raised tail with
 * ivory joints, standing clear of the ground at every heading.
 */

const body = polygon(
  mirrorPoints([
    [0, -35.4],
    [2.4, -34.6],
    [8.6, -22],
    [10, -8],
    [10.4, 8],
    [8.4, 19.6],
  ]),
  1.2,
);
const frontFenders = mirrorX(ellipse(10.2, -18, 3.4, 8.6));
const pods = mirrorX(roundRect(12.6, -2, 3, 5.2, 2));
const greenhouse = roundRect(0, -3.4, 7.8, 7.6, 4);
const roof = roundRect(0, -2.4, 5.6, 5.2, 3);
const deck = roundRect(0, 11, 7.4, 6.6, 2.6);
const hoodPad = roundRect(0, -17.4, 4.6, 4.6, 1.6);
const legs = mirrorX(union(capsule(8, 11, 11.4, 14, 1.5), capsule(8, 17, 11.4, 14, 1.5)));
const platform = roundRect(0, 31.4, 6.8, 4.6, 2);
const TAIL = 17.5;

const solids: Solid[] = [
  solid(roundRect(0, 0, 8.6, 20, 5), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(legs, 'steel', 3.4, 5.4, 1.4, { tag: 'arm' }),
  solid(mirrorX(roundRect(11.4, 14, 1.1, 3.6, 0.8)), 'steelDark', 3.6, 6.2, 1, { tag: 'hub' }),
  solid(pods, 'paint', 3, 6.5, 2.4, { tag: 'pod' }),
  solid(frontFenders, 'paint', 4, 8, 3.6, { tag: 'fender' }),
  solid(body, 'paint', 4.6, 9.6, 4.8, { tag: 'shell' }),
  solid(hoodPad, 'steelDark', 9.4, 10, 0.8, { tag: 'pad', noShadow: true }),
  solid(deck, 'paint', 9.4, 10.4, 2.4, { tag: 'deck' }),
  solid(greenhouse, 'glass', 9.8, 13.4, 3.8, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 13.2, 14.4, 2.2, { tag: 'roof' }),
  // The tail: four climbing segments, then the platform.
  solid(roundRect(0, 19.4, 3.6, 2, 1.4), 'steelDark', 6, 10.6, 1.2, { tag: 'root' }),
  ...slopedTube(
    [0, 18.6, 11.4],
    [0, 30.4, 16.2],
    'paint',
    (ax, ay, bx, by) => capsule(ax, ay + 0.9, bx, by - 0.9, 2.7),
    3,
    { tag: 'tail' },
  ),
  floating(platform, 'paint', TAIL, 2.6, { tag: 'platform' }),
  floating(roundRect(0, 31.4, 4.8, 3, 1), 'steelDark', TAIL + 0.3, 1, {
    tag: 'pad',
    noShadow: true,
  }),
  headlight(mirrorX(capsule(4.2, -29, 6.4, -24.6, 0.95)), 7, 8.2),
  taillight(mirrorX(roundRect(6.6, 19.6, 1.9, 1, 0.5)), 7.6, 8.4),
];

const decals: Decal[] = [
  // Ivory joints between the tail segments, and ivory stinger corners on the platform.
  {
    shape: union(band(21.3, 22.5), band(24.3, 25.5), band(27.2, 28.4)),
    on: ['tail'],
    material: 'ivory',
  },
  {
    shape: intersect(platform, mirrorX(circle(6.4, 35.6, 3))),
    on: ['platform'],
    material: 'ivory',
  },
  { shape: ring(deck, 0.7), on: ['shell'], shade: -1 },
  { shape: ring(greenhouse, 0.8), on: ['shell'], shade: -1 },
  { shape: roundRect(0, -17.4, 3.2, 3.2, 1), on: ['pad'], shade: 1 },
  { shape: roundRect(0, 31.4, 3.4, 1.8, 0.6), on: ['pad'], shade: 1 },
  // Carapace plates across the nose.
  {
    shape: intersect(body, union(band(-25.6, -24.9), band(-10.6, -9.9))),
    on: ['shell'],
    shade: -1,
  },
  // A centre crease down the tapered nose.
  { shape: intersect(body, roundRect(0, -28.4, 0.6, 5, 0.3)), on: ['shell'], shade: -1 },
  { shape: mirrorX(capsule(5.2, -8.6, 7, -6, 0.75)), on: ['glass'], material: 'paint' },
  { shape: intersect(capsule(-5, -6.4, -1.6, -8.6, 0.6), greenhouse), on: ['glass'], shade: 2 },
  { shape: mirrorX(roundRect(12.6, -2, 1.4, 3.6, 0.7)), on: ['pod'], shade: -1 },
];

export const SCORPION_ART: ChassisArt = {
  id: 'chassis_scorpion',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 10 },
  exhausts: [
    { x: -4.6, y: 21 },
    { x: 4.6, y: 21 },
  ],
  headlightAnchors: [
    { x: -5.3, y: -27.6 },
    { x: 5.3, y: -27.6 },
  ],
  brakeLightAnchors: [
    { x: -6.6, y: 20.6 },
    { x: 6.6, y: 20.6 },
  ],
  mountHeights: {
    roof_front: 10,
    roof_mid: 14.4,
    left_utility: 6.5,
    right_utility: 6.5,
    rear_center: 12,
    rear_boom: TAIL + 0.3,
  },
};
