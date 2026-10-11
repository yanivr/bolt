import type { Decal, Solid } from '../../../lib/model.js';
import {
  capsule,
  circle,
  mirrorX,
  polygon,
  roundRect,
  subtract,
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
 * Buggy: an open roll cage over a narrow tub, long-travel wishbones with yellow coil-overs,
 * and thick tires standing well clear of the body (Section 12.6). Identity: the ivory cage
 * with the seats showing through it.
 */

const tub = polygon(
  mirrorPoints([
    [0, -26.6],
    [4.6, -26.2],
    [8.4, -19],
    [9, 9],
    [8, 25.4],
  ]),
  1,
);
const hood = polygon(
  mirrorPoints([
    [0, -27],
    [4.4, -26.6],
    [8, -19],
    [8.4, -12],
  ]),
  1,
);
const cowl = roundRect(0, 18.6, 8.2, 7.6, 3);
const pods = mirrorX(roundRect(12.6, 0, 3.3, 7.2, 2.4));
const arms = mirrorX(
  union(
    capsule(7.6, -21.4, 13.2, -17, 1),
    capsule(8.2, -12.6, 13.2, -17, 1),
    capsule(7.6, 12.6, 13.2, 17, 1),
    capsule(7.4, 21.4, 13.2, 17, 1),
  ),
);
const shocks = mirrorX(union(capsule(8.4, -17, 12, -17, 1.25), capsule(8.4, 17, 12, 17, 1.25)));
const seats = mirrorX(roundRect(3.8, 1.6, 2.7, 3.7, 1.5));
const mx = (ax: number, ay: number, bx: number, by: number) =>
  mirrorX(capsule(ax, ay, bx, by, 0.95));

const CAGE = 16.6;
const cageTop = union(
  mirrorX(capsule(7.4, -12, 7.8, 10, 0.95)),
  capsule(-7.4, -12, 7.4, -12, 0.95),
  capsule(-7.8, 10, 7.8, 10, 0.95),
  capsule(-7.6, -1, 7.6, -1, 0.95),
);
const roofPads = union(roundRect(0, -7.4, 4.6, 3.6, 1), roundRect(0, 5.4, 4.6, 3.6, 1));

const solids: Solid[] = [
  solid(arms, 'steel', 3.2, 4.8, 1, { tag: 'arm' }),
  solid(shocks, 'spring', 4.6, 6.2, 1.2, { tag: 'shock' }),
  solid(mirrorX(roundRect(13.4, -17, 1, 3, 0.8)), 'steelDark', 3.6, 5.8, 1, { tag: 'hub' }),
  solid(mirrorX(roundRect(13.4, 17, 1, 3, 0.8)), 'steelDark', 3.6, 5.8, 1, { tag: 'hub' }),
  solid(capsule(-7, -27.8, 7, -27.8, 1.1), 'steel', 3.4, 5.4, 1.1, { tag: 'bumper' }),
  solid(capsule(-7.4, 27, 7.4, 27, 1.1), 'steel', 3.4, 5.4, 1.1, { tag: 'bumper' }),
  solid(tub, 'chassis', 2.4, 3.4, 1, { tag: 'floor' }),
  solid(
    subtract(
      tub,
      polygon(
        mirrorPoints([
          [0, -12],
          [7, -12],
          [7.4, 10.6],
          [0, 10.6],
        ]),
      ),
    ),
    'paint',
    3.4,
    7.4,
    2,
    {
      tag: 'side',
    },
  ),
  solid(pods, 'paint', 3, 6.5, 2.6, { tag: 'pod' }),
  solid(hood, 'paint', 4, 8.6, 3.6, { tag: 'hood' }),
  solid(cowl, 'paint', 4.4, 10.4, 3, { tag: 'cowl' }),
  solid(seats, 'seat', 4.4, 7.4, 1.6, { tag: 'seat' }),
  solid(roundRect(0, -10.4, 6.6, 1, 0.5), 'steelDark', 6, 8.4, 0.8, { tag: 'dash' }),
  // Cage: four posts, a roof hoop, and stays sloping down to the hood and the engine cowl.
  solid(mirrorX(union(circle(7.4, -12, 1), circle(7.8, 10, 1))), 'ivory', 4, CAGE, 0, {
    tag: 'cage',
  }),
  ...slopedTube([7.4, -12, CAGE], [7.6, -20, 8.4], 'ivory', mx, 1.6, { tag: 'cage' }),
  ...slopedTube([7.8, 10, CAGE], [6.6, 23.6, 10], 'ivory', mx, 1.6, { tag: 'cage' }),
  floating(roofPads, 'steelDark', CAGE + 0.2, 1.4, { tag: 'pad' }),
  floating(cageTop, 'ivory', CAGE + 0.4, 1.8, { tag: 'cage' }),
  headlight(mirrorX(circle(4.2, -25.6, 1.9)), 7.4, 9.2, 1.4),
  taillight(mirrorX(roundRect(6.2, 25.6, 1.6, 1, 0.5)), 8.4, 9.2),
];

const decals: Decal[] = [
  {
    shape: mirrorX(subtract(circle(4.2, -25.6, 1.9), circle(4.2, -25.6, 1.15))),
    on: ['headlight'],
    shade: -2,
  },
  { shape: ring(roundRect(0, 19, 6.4, 4.6, 2.4), 0.7), on: ['cowl'], shade: -1 },
  { shape: mirrorX(roundRect(12.6, 0, 1.7, 5.4, 1)), on: ['pod'], shade: -1 },
  { shape: mirrorX(roundRect(3.8, 4.2, 2.7, 1, 0.5)), on: ['seat'], shade: 1 },
  {
    shape: union(roundRect(0, -7.4, 3.2, 2.2, 0.6), roundRect(0, 5.4, 3.2, 2.2, 0.6)),
    on: ['pad'],
    shade: 1,
  },
];

export const BUGGY_ART: ChassisArt = {
  id: 'chassis_buggy',
  model: model(solids, decals),
  cell: 96,
  engineAnchor: { x: 0, y: 19 },
  exhausts: [
    { x: -4.6, y: 30 },
    { x: 4.6, y: 30 },
  ],
  headlightAnchors: [
    { x: -4.2, y: -27 },
    { x: 4.2, y: -27 },
  ],
  brakeLightAnchors: [
    { x: -6.2, y: 26.6 },
    { x: 6.2, y: 26.6 },
  ],
  mountHeights: {
    front_center: 8.6,
    roof_front: CAGE + 0.4,
    roof_rear: CAGE + 0.4,
    left_utility: 6.5,
    right_utility: 6.5,
    rear_center: 12,
  },
};
