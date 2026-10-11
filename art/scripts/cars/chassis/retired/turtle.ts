import type { Decal, Shape, Solid } from '../../../lib/model.js';
import {
  capsule,
  circle,
  grow,
  intersect,
  mirrorX,
  polygon,
  roundRect,
  subtract,
  union,
} from '../../../lib/model.js';
import { CAR_MATERIALS } from '../../materials.js';
import type { ChassisArt } from '../../types.js';
import { mirrorPoints } from '../kit.js';

const ring = (shape: Shape, width: number): Shape => subtract(grow(shape, width), shape);

// --- Turtle: squat hexagonal armored shell, compact buried wheels ------------------------------

function turtle(): ChassisArt {
  const outline: Array<[number, number]> = mirrorPoints([
    [9.5, -29.5],
    [20.5, -12],
    [20.5, 13],
    [9.5, 29.5],
  ]);
  const skirt = polygon(outline, 1.2);
  const shell = polygon(
    outline.map(([x, y]) => [x * 0.9, y * 0.93] as [number, number]),
    0.8,
  );
  const crownPoints: Array<[number, number]> = mirrorPoints([
    [5, -15],
    [11, -5.5],
    [11, 7.5],
    [5, 17],
  ]);
  const crown = polygon(crownPoints, 0.6);
  const hatch = circle(0, 2, 4.6);
  const solids: Solid[] = [
    {
      shape: skirt,
      material: 'steelDark',
      z0: 2.5,
      z1: 4.5,
      bevel: 2,
      profile: 'linear',
      tag: 'skirt',
    },
    {
      shape: roundRect(0, -30.4, 8.4, 1.6, 0.8),
      material: 'steel',
      z0: 3,
      z1: 4.6,
      bevel: 1.2,
      tag: 'bumper',
    },
    {
      shape: roundRect(0, 30.4, 8.4, 1.6, 0.8),
      material: 'steel',
      z0: 3,
      z1: 4.6,
      bevel: 1.2,
      tag: 'bumper',
    },
    { shape: shell, material: 'paint', z0: 4.5, z1: 11, bevel: 8, profile: 'linear', tag: 'shell' },
    {
      shape: crown,
      material: 'paint',
      z0: 11,
      z1: 12.6,
      bevel: 1.8,
      profile: 'linear',
      tag: 'crown',
    },
    { shape: hatch, material: 'steel', z0: 12.6, z1: 13.6, bevel: 1.2, tag: 'hatch' },
    {
      shape: roundRect(0, -19.6, 6.6, 1.5, 0.7),
      material: 'glass',
      z0: 8.2,
      z1: 8.6,
      bevel: 0.6,
      tag: 'glass',
      noShadow: true,
    },
    {
      shape: mirrorX(roundRect(13.2, -21.6, 2.1, 1.5, 0.5)),
      material: 'lampOff',
      z0: 6.5,
      z1: 7.4,
      bevel: 0.7,
      tag: 'headlight',
      noShadow: true,
    },
    {
      shape: mirrorX(roundRect(13.2, 22.4, 2.1, 1.3, 0.5)),
      material: 'tailOff',
      z0: 6.5,
      z1: 7.2,
      bevel: 0.6,
      tag: 'taillight',
      noShadow: true,
    },
  ];
  // Scute seams run from each crown corner to the matching shell corner, like plates of armor.
  const seams = union(
    ...crownPoints.map(([x, y], i) => {
      const [ox, oy] = outline[i]!;
      return capsule(x, y, ox * 0.86, oy * 0.9, 0.45);
    }),
  );
  const rivets = union(...crownPoints.map(([x, y]) => circle(x * 0.72, y * 0.78, 0.7)));
  const decals: Decal[] = [
    { shape: seams, on: ['shell'], shade: -1 },
    { shape: ring(crown, 0.7), on: ['shell'], shade: -1 },
    { shape: rivets, on: ['crown'], shade: 1 },
    { shape: subtract(hatch, circle(0, 2, 3.2)), on: ['hatch'], shade: -1 },
    { shape: roundRect(0, 2, 2.2, 0.5, 0.2), on: ['hatch'], shade: -2 },
    // A broad ivory band across the nose plate marks the front.
    {
      shape: intersect(shell, (_x, y) => Math.max(-25.2 - y, y + 22.6)),
      on: ['shell'],
      material: 'ivory',
    },
  ];
  return {
    id: 'chassis_turtle',
    model: { solids, decals, materials: CAR_MATERIALS },
    cell: 96,
    engineAnchor: { x: 0, y: 21.5 },
    exhausts: [
      { x: -4.6, y: 32.5 },
      { x: 4.6, y: 32.5 },
    ],
    headlightAnchors: [
      { x: -13.2, y: -23 },
      { x: 13.2, y: -23 },
    ],
    brakeLightAnchors: [
      { x: -13.2, y: 23.5 },
      { x: 13.2, y: 23.5 },
    ],
  };
}

export const TURTLE_ART = turtle();
