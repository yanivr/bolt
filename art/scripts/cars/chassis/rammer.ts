import type { Decal, Solid } from '../../lib/model.js';
import { capsule, circle, intersect, mirrorX, polygon, roundRect, union } from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { floating, headlight, mirrorPoints, model, ring, solid, taillight } from './kit.js';

/**
 * Rammer: a steel plow blade across the whole nose, a gun deck behind it, a slit-windowed cab,
 * a mid engine and broad armored shoulders standing out between the axles (Section 12.6).
 * Identity: the toothed ram, wider than the body, and the steel straps over the shoulders.
 */

const ram = polygon(
  mirrorPoints([
    [0, -34.4],
    [9, -33.6],
    [21.6, -29.6],
    [21.6, -27.4],
    [9, -28.2],
    [0, -28.6],
  ]),
  0.9,
);
const foreDeck = roundRect(0, -20, 10.6, 7, 2);
const cab = roundRect(0, -7.4, 10, 5.8, 2.2);
const engineDeck = roundRect(0, 4.4, 9, 5.8, 2);
const aftDeck = roundRect(0, 22.4, 10.6, 8, 2);
const shoulders = mirrorX(
  polygon(
    [
      [9, -11.4],
      [20.6, -9],
      [21.6, -1],
      [20.6, 7],
      [9, 9.4],
    ],
    1.2,
  ),
);
const core = roundRect(0, 1.6, 11.8, 30.4, 2.4);
const wheelArmor = mirrorX(union(roundRect(18, -18, 3, 4.6, 1.2), roundRect(18, 20, 3, 4.6, 1.2)));
const teeth = union(...[-16, -8, 0, 8, 16].map((x) => roundRect(x, -31, 2, 4, 0.2)));

const solids: Solid[] = [
  solid(roundRect(0, 0, 9, 30, 2), 'chassis', 2, 2, 0, { tag: 'floor' }),
  solid(mirrorX(capsule(7, -27, 9, -24, 1.5)), 'steelDark', 3.4, 6.6, 1.2, { tag: 'pusher' }),
  solid(mirrorX(capsule(10, -18, 14.4, -18, 1.5)), 'steel', 3.4, 5.6, 1.3, { tag: 'axle' }),
  solid(mirrorX(capsule(10, 20, 14.4, 20, 1.5)), 'steel', 3.4, 5.6, 1.3, { tag: 'axle' }),
  solid(ram, 'steel', 3, 8, 1.6, { tag: 'ram' }),
  solid(roundRect(0, 33, 10.6, 1.4, 0.8), 'steel', 3, 6, 1.2, { tag: 'bumper' }),
  solid(shoulders, 'paint', 4.2, 8.6, 2.2, { tag: 'shoulder' }),
  solid(core, 'paint', 4.6, 8.2, 2.4, { tag: 'core' }),
  solid(foreDeck, 'paint', 8, 9, 1.2, { tag: 'fore' }),
  solid(aftDeck, 'paint', 8, 9, 1.2, { tag: 'aft' }),
  solid(engineDeck, 'paint', 8, 10.4, 1.6, { tag: 'engine' }),
  solid(cab, 'paint', 8, 13.6, 2, { tag: 'cab' }),
  solid(roundRect(0, -13.4, 7.4, 1.3, 0.6), 'glass', 10.2, 12.2, 1.4, {
    tag: 'glass',
    profile: 'linear',
    noShadow: true,
  }),
  floating(wheelArmor, 'steelDark', 7.4, 1.6, { tag: 'armor' }),
  headlight(mirrorX(roundRect(8.6, -27.2, 2, 1, 0.5)), 7.4, 8.6),
  taillight(mirrorX(roundRect(8.4, 32.2, 2.2, 0.95, 0.5)), 7.4, 8.2),
];

const straps = mirrorX(union(roundRect(15, -6, 6.4, 0.9, 0.3), roundRect(15, 4, 6.4, 0.9, 0.3)));
const decals: Decal[] = [
  { shape: intersect(ram, teeth), on: ['ram'], material: 'ivory' },
  // Reinforcing straps and rivets over each shoulder.
  { shape: mirrorX(roundRect(15.6, -1, 4.4, 3.6, 1)), on: ['shoulder'], material: 'steelDark' },
  { shape: straps, on: ['shoulder'], material: 'steel' },
  {
    shape: mirrorX(
      union(
        circle(19.4, -6, 0.75),
        circle(19.4, 4, 0.75),
        circle(11, -6, 0.75),
        circle(11, 4, 0.75),
      ),
    ),
    on: ['shoulder'],
    material: 'steelDark',
  },
  // Weld seams across the decks, a roof hatch and wheel-armor bolts.
  { shape: roundRect(0, -20, 0.45, 7, 0.2), on: ['fore'], shade: -1 },
  { shape: roundRect(0, 22.4, 0.45, 8, 0.2), on: ['aft'], shade: -1 },
  { shape: ring(roundRect(0, -7.2, 5.4, 2.8, 1), 0.6), on: ['cab'], shade: -1 },
  { shape: mirrorX(roundRect(9.4, -7.4, 0.5, 2.6, 0.2)), on: ['cab'], material: 'glass' },
  { shape: mirrorX(union(circle(18, -18, 1), circle(18, 20, 1))), on: ['armor'], shade: 2 },
];

export const RAMMER_ART: ChassisArt = {
  id: 'chassis_rammer',
  model: model(solids, decals),
  cell: 112,
  engineAnchor: { x: 0, y: 4 },
  exhausts: [
    { x: -4.6, y: 15 },
    { x: 4.6, y: 15 },
  ],
  headlightAnchors: [
    { x: -8.6, y: -28.2 },
    { x: 8.6, y: -28.2 },
  ],
  brakeLightAnchors: [
    { x: -8.4, y: 33.2 },
    { x: 8.4, y: 33.2 },
  ],
  mountHeights: {
    front_ram: 8,
    front_left: 9,
    front_right: 9,
    left_shoulder: 8.6,
    right_shoulder: 8.6,
    left_rear: 9,
    right_rear: 9,
  },
};
