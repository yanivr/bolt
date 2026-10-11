import type { Decal, Solid } from '../../lib/model.js';
import { above, capsule, intersect, mirrorX, roundRect, union } from '../../lib/model.js';
import type { ChassisArt } from '../types.js';
import { headlight, model, ring, solid, taillight } from './kit.js';

/**
 * Horseshoe: two heavy arms reach forward round an open weapon cavity with a bare railed
 * floor; a cross brace joins them and a thin spine carries the cab and engine to exposed
 * rear wheels (Section 12.6). Identity: the U itself, with ivory pole tips like a magnet.
 */

const arms = mirrorX(roundRect(16.2, -12.4, 4.6, 22.4, 3));
const brace = roundRect(0, -1, 13, 6.8, 3);
const bracePad = roundRect(0, -1, 7.4, 4.8, 1.6);
const spine = roundRect(0, 20, 8, 14, 3.6);
const greenhouse = roundRect(0, 10.4, 6.4, 4.4, 2.4);
const roof = roundRect(0, 10.6, 4.4, 2.8, 1.6);
const deck = roundRect(0, 22, 7, 7.6, 2.6);
const cavity = roundRect(0, -19.6, 12, 13.6, 1);

const solids: Solid[] = [
  solid(cavity, 'steelDark', 2.4, 3.2, 0.8, { tag: 'cavity' }),
  solid(mirrorX(capsule(7, 22, 14.4, 22, 1.6)), 'steel', 3.4, 5.4, 1.4, { tag: 'axle' }),
  solid(mirrorX(roundRect(14.4, 22, 1.1, 3.6, 0.8)), 'steelDark', 3.6, 6.2, 1, { tag: 'hub' }),
  solid(roundRect(0, 34.4, 6.6, 1.4, 1), 'steel', 3, 5.4, 1.2, { tag: 'bumper' }),
  solid(arms, 'paint', 4.6, 10, 3.4, { tag: 'arm' }),
  solid(spine, 'paint', 4.6, 9.6, 4, { tag: 'spine' }),
  solid(brace, 'paint', 4.6, 10.6, 3, { tag: 'brace' }),
  solid(bracePad, 'paint', 10.4, 11.2, 1, { tag: 'bracePad' }),
  solid(deck, 'paint', 9.4, 10.4, 2.4, { tag: 'deck' }),
  solid(greenhouse, 'glass', 9.8, 13.4, 3, { tag: 'glass', profile: 'linear' }),
  solid(roof, 'paint', 13.2, 14.2, 1.4, { tag: 'roof' }),
  headlight(mirrorX(roundRect(16.2, -34.2, 2.6, 1, 0.6)), 6.6, 7.6),
  taillight(mirrorX(roundRect(5.4, 33.4, 1.8, 0.95, 0.5)), 7.4, 8.2),
];

const decals: Decal[] = [
  // Magnet poles: ivory tips on both arms.
  { shape: intersect(arms, above(-29.4)), on: ['arm'], material: 'ivory' },
  // Mounting rails on the cavity floor.
  { shape: mirrorX(roundRect(5, -19.6, 0.7, 12, 0.3)), on: ['cavity'], shade: 2 },
  {
    shape: union(roundRect(0, -27, 9.6, 0.5, 0.2), roundRect(0, -13, 9.6, 0.5, 0.2)),
    on: ['cavity'],
    shade: -1,
  },
  // Bolted seams where the arms meet the brace, and side pads behind them.
  { shape: mirrorX(roundRect(16.2, -8.6, 4.6, 0.45, 0.2)), on: ['arm'], shade: -1 },
  { shape: mirrorX(roundRect(16.4, 4, 2.4, 4.6, 0.8)), on: ['arm'], material: 'steelDark' },
  { shape: mirrorX(roundRect(16.4, -27, 2.4, 2.6, 0.8)), on: ['arm'], material: 'steelDark' },
  { shape: ring(bracePad, 0.6), on: ['brace'], shade: -1 },
  { shape: ring(deck, 0.7), on: ['spine'], shade: -1 },
  { shape: intersect(capsule(-4, 8.6, -1, 7.2, 0.55), greenhouse), on: ['glass'], shade: 2 },
];

export const HORSESHOE_ART: ChassisArt = {
  id: 'chassis_horseshoe',
  model: model(solids, decals),
  cell: 96,
  engineAnchor: { x: 0, y: 20 },
  exhausts: [
    { x: -4.6, y: 31 },
    { x: 4.6, y: 31 },
  ],
  headlightAnchors: [
    { x: -16.2, y: -35 },
    { x: 16.2, y: -35 },
  ],
  brakeLightAnchors: [
    { x: -5.4, y: 34.2 },
    { x: 5.4, y: 34.2 },
  ],
  mountHeights: {
    front_cavity: 3.2,
    left_prong: 10,
    right_prong: 10,
    front_brace: 11.2,
    left_mid: 10,
    right_mid: 10,
  },
};
