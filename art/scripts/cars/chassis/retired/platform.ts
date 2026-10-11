import type { Decal, Shape, Solid } from '../../../lib/model.js';
import { capsule, circle, mirrorX, polygon, roundRect, union } from '../../../lib/model.js';
import type { ChassisArt } from '../../types.js';
import { floating, headlight, model, solid, taillight } from '../kit.js';

/**
 * Platform: no body at all. A painted square truss of rails, cross beams and diagonal braces
 * with the road showing through it, steel pads bolted on wherever something can mount, bare
 * wheels on stub axles and wiring looms draped along the rails (Section 12.6). Identity: the
 * see-through lattice and the bright looms.
 */

const RAIL = 11.6;
const beam = (y: number, hw: number): Shape => roundRect(0, y, hw, 1.3, 0.5);
const rails = mirrorX(roundRect(RAIL, 0, 1.4, 35, 0.8));
const wingRails = mirrorX(roundRect(21.6, 0, 1.3, 15.4, 0.8));
const beams: Shape[] = [
  beam(-34.6, 13),
  beam(-21.8, 13),
  beam(-2, 23),
  beam(12.4, 13),
  beam(21.6, 13),
  beam(34.6, 13),
  beam(-14.6, 23),
  beam(14.6, 23),
];
const brace = (y0: number, y1: number): Shape =>
  union(capsule(-RAIL, y0, RAIL, y1, 0.85), capsule(RAIL, y0, -RAIL, y1, 0.85));
const braces: Shape[] = [brace(-34, -22), brace(-21, -3), brace(-1, 12), brace(22, 34)];
const wingBraces = mirrorX(
  union(
    capsule(RAIL, -14, 21.6, -5.6, 0.8),
    capsule(RAIL, 14, 21.6, 5.6, 0.8),
    capsule(RAIL, 5, 21.6, 5, 0.8),
    capsule(RAIL, -5, 21.6, -5, 0.8),
  ),
);
const pads = union(
  roundRect(0, -29, 7.4, 3.6, 1),
  roundRect(0, -12, 6.6, 5.6, 1),
  roundRect(0, 6, 6.6, 4.2, 1),
  roundRect(0, 28, 7.4, 3.8, 1),
  mirrorX(
    union(
      roundRect(18.2, -10, 3.4, 2.6, 0.8),
      roundRect(18.2, 0, 3.4, 2.6, 0.8),
      roundRect(18.2, 10, 3.4, 2.6, 0.8),
    ),
  ),
);
const cradle = roundRect(0, 18.4, 7.2, 5, 1.6);
const gussets = mirrorX(
  polygon(
    [
      [RAIL, -35.4],
      [RAIL, -28],
      [5, -35.4],
    ],
    0.5,
  ),
);
const loomA = union(
  capsule(6.6, 16, 9.4, 12, 0.75),
  capsule(9.4, 12, 9.4, -24, 0.75),
  capsule(9.4, -24, 8.4, -33, 0.75),
);
const loomB = union(
  capsule(-6.6, 16, -9.4, 12, 0.75),
  capsule(-9.4, 12, -9.4, -3, 0.75),
  capsule(-9.4, -3, -17, -3.4, 0.75),
);

const DECK = 7;
const solids: Solid[] = [
  solid(
    mirrorX(union(capsule(RAIL, -24, 15.4, -24, 1.5), capsule(RAIL, 24, 15.4, 24, 1.5))),
    'steel',
    3.4,
    5.4,
    1.3,
    { tag: 'axle' },
  ),
  solid(
    mirrorX(union(roundRect(15.2, -24, 1.1, 3.6, 0.8), roundRect(15.2, 24, 1.1, 3.6, 0.8))),
    'steelDark',
    3.6,
    6.2,
    1,
    { tag: 'hub' },
  ),
  solid(roundRect(0, -36, 12.6, 1.2, 0.8), 'steel', 3, 5.6, 1, { tag: 'bumper' }),
  solid(roundRect(0, 36, 12.6, 1.2, 0.8), 'steel', 3, 5.6, 1, { tag: 'bumper' }),
  ...[...braces, wingBraces].map((shape) =>
    floating(shape, 'paint', DECK - 0.8, 1.6, { tag: 'brace' }),
  ),
  ...[rails, wingRails, ...beams].map((shape) =>
    solid(shape, 'paint', 3.6, DECK, 1.1, { tag: 'truss' }),
  ),
  solid(gussets, 'ivory', 3.6, DECK + 0.2, 0.8, { tag: 'gusset' }),
  floating(pads, 'steelDark', DECK + 0.8, 1.2, { tag: 'pad' }),
  solid(cradle, 'steelDark', 6, 10.4, 1.4, { tag: 'cradle' }),
  floating(loomA, 'wire', DECK + 1.5, 1.2, { tag: 'loom', noShadow: true }),
  floating(loomB, 'spring', DECK + 1.5, 1.2, { tag: 'loom', noShadow: true }),
  solid(roundRect(-18.2, -3.4, 2, 1.6, 0.6), 'steel', 6, DECK + 2.4, 0.8, { tag: 'box' }),
  headlight(mirrorX(roundRect(8.6, -36.2, 2.4, 1.1, 0.5)), 5.6, 7),
  taillight(mirrorX(roundRect(9, 36.2, 2.4, 1, 0.5)), 5.6, 6.8),
];

const bolt = (x: number, y: number): Shape => circle(x, y, 0.7);
const decals: Decal[] = [
  {
    shape: union(
      ...[
        [-5.6, -29],
        [5.6, -29],
        [-4.8, -15.6],
        [4.8, -15.6],
        [-4.8, -8.4],
        [4.8, -8.4],
        [-4.8, 3.6],
        [4.8, 3.6],
        [-4.8, 8.4],
        [4.8, 8.4],
        [-5.6, 28],
        [5.6, 28],
      ].map(([x, y]) => bolt(x!, y!)),
    ),
    on: ['pad'],
    shade: 2,
  },
  {
    shape: mirrorX(
      union(
        roundRect(18.2, -10, 1.8, 1.2, 0.4),
        roundRect(18.2, 0, 1.8, 1.2, 0.4),
        roundRect(18.2, 10, 1.8, 1.2, 0.4),
      ),
    ),
    on: ['pad'],
    shade: 1,
  },
];

export const PLATFORM_ART: ChassisArt = {
  id: 'chassis_platform',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 18 },
  exhausts: [
    { x: -4.6, y: 29 },
    { x: 4.6, y: 29 },
  ],
  headlightAnchors: [
    { x: -8.6, y: -37.2 },
    { x: 8.6, y: -37.2 },
  ],
  brakeLightAnchors: [
    { x: -9, y: 37.2 },
    { x: 9, y: 37.2 },
  ],
  mountHeights: {
    deck_front: DECK + 0.8,
    deck_fore: DECK + 0.8,
    left_edge_front: DECK + 0.8,
    right_edge_front: DECK + 0.8,
    left_edge_mid: DECK + 0.8,
    right_edge_mid: DECK + 0.8,
    left_edge_rear: DECK + 0.8,
    right_edge_rear: DECK + 0.8,
    deck_aft: DECK + 0.8,
    deck_rear: DECK + 0.8,
  },
};
