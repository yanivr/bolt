import type { Decal, Solid } from '../lib/model.js';
import {
  capsule,
  circle,
  ellipse,
  grow,
  intersect,
  mirrorX,
  roundRect,
  strip,
  subtract,
  union,
} from '../lib/model.js';
import { CAR_MATERIALS } from './materials.js';
import type { ChassisArt } from './types.js';

/**
 * Beetle: rounded hood, twin fenders, compact cabin, playful roofline (Section 12.6).
 * Model space is chassis-local world pixels: front is negative Y, right is positive X.
 * The body is 34 wide and 58 long. Tires show outside the fenders so steering reads.
 */

const shell = roundRect(0, 0.5, 11.6, 26.3, 10.6);
const hood = roundRect(0, -16.4, 8.3, 8.8, 7);
const deck = roundRect(0, 20.6, 8.8, 6, 5);
const greenhouse = roundRect(0, 2.4, 10.3, 11.6, 6.2);
const roof = roundRect(0, 3.3, 7.6, 7.3, 5);
const frontFenders = mirrorX(ellipse(10.2, -17, 4.5, 9.3));
const rearFenders = mirrorX(ellipse(10.4, 17.4, 4.7, 9.8));

const solids: Solid[] = [
  { shape: roundRect(0, 0, 13, 27, 9), material: 'chassis', z0: 2, z1: 2, tag: 'floor' },
  {
    shape: roundRect(0, -27.4, 8.6, 1.5, 1.5),
    material: 'steel',
    z0: 3,
    z1: 4.6,
    bevel: 1.4,
    tag: 'bumper',
  },
  {
    shape: roundRect(0, 27.6, 9.4, 1.5, 1.5),
    material: 'steel',
    z0: 3,
    z1: 4.6,
    bevel: 1.4,
    tag: 'bumper',
  },
  { shape: frontFenders, material: 'paint', z0: 4, z1: 8.2, bevel: 4.4, tag: 'fender' },
  { shape: rearFenders, material: 'paint', z0: 4, z1: 8.6, bevel: 4.6, tag: 'fender' },
  { shape: shell, material: 'paint', z0: 5, z1: 10, bevel: 6, tag: 'shell' },
  { shape: hood, material: 'paint', z0: 9.7, z1: 11.3, bevel: 4.2, tag: 'hood' },
  { shape: deck, material: 'paint', z0: 9.7, z1: 10.9, bevel: 3.4, tag: 'deck' },
  {
    shape: greenhouse,
    material: 'glass',
    z0: 10.4,
    z1: 14.4,
    bevel: 4.2,
    profile: 'linear',
    tag: 'glass',
  },
  { shape: roof, material: 'paint', z0: 14.4, z1: 16, bevel: 3, tag: 'roof' },
  {
    shape: mirrorX(circle(10, -23.4, 2.3)),
    material: 'lampOff',
    z0: 7.6,
    z1: 9,
    bevel: 1.6,
    tag: 'headlight',
    noShadow: true,
  },
  {
    shape: mirrorX(roundRect(9.9, 25, 2.1, 1.5, 1)),
    material: 'tailOff',
    z0: 8,
    z1: 8.8,
    bevel: 1,
    tag: 'taillight',
    noShadow: true,
  },
  {
    shape: mirrorX(roundRect(12.3, -6.4, 1.7, 1.1, 0.8)),
    material: 'paint',
    z0: 11.5,
    z1: 12,
    bevel: 0.6,
    tag: 'mirror',
    noShadow: true,
  },
];

const stripe = strip(-1.6, 1.6);
const pillars = union(
  mirrorX(capsule(6.4, -3.2, 9, -7.6, 0.75)),
  mirrorX(capsule(6.4, 9.8, 9, 12.8, 0.85)),
  mirrorX(roundRect(9, 2.9, 1.6, 0.7, 0.2)),
);

const decals: Decal[] = [
  // Panel gap around the hood and the engine deck.
  { shape: subtract(grow(hood, 0.75), hood), on: ['shell'], shade: -1 },
  { shape: subtract(grow(deck, 0.75), deck), on: ['shell'], shade: -1 },
  // Racing stripe, front to back, skipping the glass.
  { shape: stripe, on: ['hood', 'roof', 'deck', 'shell'], material: 'ivory' },
  // Roof pillars cross the glass in body color.
  { shape: pillars, on: ['glass'], material: 'paint' },
  // A bright glint on the windshield and a softer one on the rear window.
  { shape: intersect(capsule(-7.2, -5.2, -2.6, -7.4, 0.6), greenhouse), on: ['glass'], shade: 2 },
  { shape: capsule(3.2, 12.4, 6.2, 11.2, 0.5), on: ['glass'], shade: 1 },
  // Headlight lens ring.
  {
    shape: mirrorX(subtract(circle(10, -23.4, 2.3), circle(10, -23.4, 1.45))),
    on: ['headlight'],
    shade: -2,
  },
];

export const BEETLE_ART: ChassisArt = {
  id: 'chassis_beetle',
  model: { solids, decals, materials: CAR_MATERIALS },
  cell: 96,
  engineAnchor: { x: 0, y: 20.6 },
  exhausts: [
    { x: -4.6, y: 31 },
    { x: 4.6, y: 31 },
  ],
  headlightAnchors: [
    { x: -10, y: -24.5 },
    { x: 10, y: -24.5 },
  ],
  brakeLightAnchors: [
    { x: -9.9, y: 26 },
    { x: 9.9, y: 26 },
  ],
};
