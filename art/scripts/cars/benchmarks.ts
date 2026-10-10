import type { Decal, Shape, Solid } from '../lib/model.js';
import { capsule, circle, ellipse, grow, intersect, mirrorX, polygon, roundRect, strip, subtract, union } from '../lib/model.js';
import { CAR_MATERIALS } from './materials.js';
import type { ChassisArt } from './types.js';

/**
 * The three benchmark chassis from Section 14.2, modelled before the rest of the catalog is
 * mass-produced: a narrow wedge, a squat armored shell and a six-wheeled walker frame. Between
 * them they exercise every awkward case in the pipeline: open and buried wheels, faceted and
 * rounded forms, three wheel pairs, and bodies near the largest allowed footprint.
 */

const mirrorPoints = (right: Array<[number, number]>): Array<[number, number]> => [
  ...right,
  ...right
    .slice()
    .reverse()
    .filter(([x]) => x !== 0)
    .map(([x, y]) => [-x, y] as [number, number]),
];

const ring = (shape: Shape, width: number): Shape => subtract(grow(shape, width), shape);

// --- Arrow: narrow aerodynamic wedge, rear fins, hidden suspension -----------------------------

function arrow(): ChassisArt {
  const wedge = polygon(mirrorPoints([[0, -30], [4.5, -26.5], [10.5, -5], [12.5, 18], [11, 28.5]]), 1.6);
  const canopy = ellipse(0, 1.5, 5.2, 10.5);
  const spine = roundRect(0, 15, 3.6, 9.5, 2.4);
  const solids: Solid[] = [
    { shape: grow(wedge, -1.5), material: 'chassis', z0: 2, z1: 2, tag: 'floor' },
    { shape: mirrorX(roundRect(11.8, 9, 3.2, 13.5, 2.8)), material: 'paint', z0: 3, z1: 7, bevel: 3.4, tag: 'pod' },
    { shape: wedge, material: 'paint', z0: 4, z1: 9, bevel: 6, profile: 'linear', tag: 'shell' },
    { shape: spine, material: 'paint', z0: 9, z1: 11.4, bevel: 2.6, tag: 'spine' },
    { shape: canopy, material: 'glass', z0: 9, z1: 13, bevel: 4.5, tag: 'glass' },
    { shape: mirrorX(polygon([[8.2, 19.5], [12.6, 19.5], [15, 30.5], [10.6, 30.5]], 0.6)), material: 'paint', z0: 11, z1: 14, bevel: 1.4, profile: 'linear', tag: 'fin' },
    { shape: roundRect(0, 29, 8.6, 1.4, 0.7), material: 'steelDark', z0: 12.5, z1: 13, bevel: 0.5, tag: 'wing' },
    { shape: mirrorX(capsule(3.6, -25, 7, -18.5, 0.95)), material: 'lampOff', z0: 8.6, z1: 9.4, bevel: 0.8, tag: 'headlight', noShadow: true },
    { shape: mirrorX(roundRect(7.4, 29.4, 2.3, 0.95, 0.5)), material: 'tailOff', z0: 9, z1: 9.6, bevel: 0.6, tag: 'taillight', noShadow: true },
  ];
  // Stacked chevrons down the nose: the car's name, readable at any heading.
  const chevron = (y: number): Shape => mirrorX(capsule(0, y, 5.6, y + 4.6, 0.85));
  const decals: Decal[] = [
    { shape: intersect(union(chevron(-21), chevron(-15.5)), wedge), on: ['shell'], material: 'ivory' },
    { shape: strip(-0.9, 0.9), on: ['spine'], material: 'ivory' },
    { shape: ring(canopy, 0.8), on: ['shell', 'spine'], shade: -1 },
    { shape: intersect(capsule(-3.4, -4.5, -1, -7.4, 0.55), canopy), on: ['glass'], shade: 2 },
    { shape: mirrorX(roundRect(11.8, 9, 0.5, 9, 0.2)), on: ['pod'], shade: -1 },
  ];
  return {
    id: 'chassis_arrow',
    model: { solids, decals, materials: CAR_MATERIALS },
    cell: 96,
    engineAnchor: { x: 0, y: 20 },
    exhausts: [
      { x: -4.6, y: 31 },
      { x: 4.6, y: 31 },
    ],
    headlightAnchors: [
      { x: -5.5, y: -23 },
      { x: 5.5, y: -23 },
    ],
    brakeLightAnchors: [
      { x: -7.4, y: 30 },
      { x: 7.4, y: 30 },
    ],
  };
}

// --- Turtle: squat hexagonal armored shell, compact buried wheels ------------------------------

function turtle(): ChassisArt {
  const outline: Array<[number, number]> = mirrorPoints([[9.5, -29.5], [20.5, -12], [20.5, 13], [9.5, 29.5]]);
  const skirt = polygon(outline, 1.2);
  const shell = polygon(outline.map(([x, y]) => [x * 0.9, y * 0.93] as [number, number]), 0.8);
  const crownPoints: Array<[number, number]> = mirrorPoints([[5, -15], [11, -5.5], [11, 7.5], [5, 17]]);
  const crown = polygon(crownPoints, 0.6);
  const hatch = circle(0, 2, 4.6);
  const solids: Solid[] = [
    { shape: skirt, material: 'steelDark', z0: 2.5, z1: 4.5, bevel: 2, profile: 'linear', tag: 'skirt' },
    { shape: roundRect(0, -30.4, 8.4, 1.6, 0.8), material: 'steel', z0: 3, z1: 4.6, bevel: 1.2, tag: 'bumper' },
    { shape: roundRect(0, 30.4, 8.4, 1.6, 0.8), material: 'steel', z0: 3, z1: 4.6, bevel: 1.2, tag: 'bumper' },
    { shape: shell, material: 'paint', z0: 4.5, z1: 11, bevel: 8, profile: 'linear', tag: 'shell' },
    { shape: crown, material: 'paint', z0: 11, z1: 12.6, bevel: 1.8, profile: 'linear', tag: 'crown' },
    { shape: hatch, material: 'steel', z0: 12.6, z1: 13.6, bevel: 1.2, tag: 'hatch' },
    { shape: roundRect(0, -19.6, 6.6, 1.5, 0.7), material: 'glass', z0: 8.2, z1: 8.6, bevel: 0.6, tag: 'glass', noShadow: true },
    { shape: mirrorX(roundRect(13.2, -21.6, 2.1, 1.5, 0.5)), material: 'lampOff', z0: 6.5, z1: 7.4, bevel: 0.7, tag: 'headlight', noShadow: true },
    { shape: mirrorX(roundRect(13.2, 22.4, 2.1, 1.3, 0.5)), material: 'tailOff', z0: 6.5, z1: 7.2, bevel: 0.6, tag: 'taillight', noShadow: true },
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
    { shape: intersect(shell, (_x, y) => Math.max(-25.2 - y, y + 22.6)), on: ['shell'], material: 'ivory' },
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

// --- Spider: six visible wheels, segmented suspension arms, angular central cab ---------------

function spider(): ChassisArt {
  const hull = polygon(mirrorPoints([[0, -33], [6.5, -27], [10.5, -12], [10.5, 15], [7.5, 31]]), 1);
  const cab = polygon(mirrorPoints([[0, -15.5], [6.6, -9.5], [6.6, 3.5], [3.6, 9.5]]), 0.8);
  const cabRoof = polygon(mirrorPoints([[0, -9], [3.8, -6], [3.8, 2.5], [2, 5.5]]), 0.6);
  const abdomen = roundRect(0, 13.5, 6.2, 4.2, 2.4);
  const legs: Array<[number, number, number]> = [
    [22.5, -24, -17],
    [24.5, 0, 0],
    [22.5, 24, 18],
  ];
  const arms = mirrorX(union(...legs.map(([wx, wy, by]) => capsule(8, by, wx - 3, wy, 1.7))));
  const knuckles = mirrorX(union(...legs.map(([wx, wy, by]) => circle((8 + wx - 3) / 2 + 1.5, (by + wy) / 2, 2.5))));
  const knuckleCaps = mirrorX(union(...legs.map(([wx, wy, by]) => circle((8 + wx - 3) / 2 + 1.5, (by + wy) / 2, 0.9))));
  const hubs = mirrorX(union(...legs.map(([wx, wy]) => roundRect(wx - 3.4, wy, 1.8, 3.4, 0.9))));
  const eyes = mirrorX(union(circle(2.6, -28.6, 1.35), circle(6, -23.4, 1.15)));
  const solids: Solid[] = [
    { shape: arms, material: 'steel', z0: 3, z1: 5, bevel: 1.6, tag: 'arm' },
    { shape: hubs, material: 'steelDark', z0: 4, z1: 6, bevel: 1, tag: 'hub' },
    { shape: knuckles, material: 'steelDark', z0: 5, z1: 6.6, bevel: 1.8, tag: 'knuckle' },
    { shape: hull, material: 'paint', z0: 5, z1: 10, bevel: 5.5, profile: 'linear', tag: 'shell' },
    { shape: abdomen, material: 'paint', z0: 10, z1: 11.6, bevel: 2.4, tag: 'abdomen' },
    { shape: cab, material: 'glass', z0: 10, z1: 13.2, bevel: 3.4, profile: 'linear', tag: 'glass' },
    { shape: cabRoof, material: 'paint', z0: 13.2, z1: 14.4, bevel: 1.4, profile: 'linear', tag: 'roof' },
    { shape: eyes, material: 'lampOff', z0: 8, z1: 9, bevel: 0.9, tag: 'headlight', noShadow: true },
    { shape: mirrorX(roundRect(5, 31.2, 1.9, 0.95, 0.5)), material: 'tailOff', z0: 8, z1: 8.6, bevel: 0.6, tag: 'taillight', noShadow: true },
  ];
  // An hourglass on the abdomen, and a centre ridge down the nose.
  const hourglass = polygon([[-3.4, 10.6], [3.4, 10.6], [0.9, 13.5], [3.4, 16.4], [-3.4, 16.4], [-0.9, 13.5]], 0.2);
  const decals: Decal[] = [
    { shape: hourglass, on: ['abdomen'], material: 'ivory' },
    { shape: intersect(strip(-0.8, 0.8), (_x, y) => y + 17), on: ['shell'], material: 'ivory' },
    { shape: ring(cab, 0.8), on: ['shell'], shade: -1 },
    { shape: ring(abdomen, 0.7), on: ['shell'], shade: -1 },
    { shape: intersect(capsule(-4.6, -7.6, -1.6, -11.6, 0.55), cab), on: ['glass'], shade: 2 },
    { shape: knuckleCaps, on: ['knuckle'], shade: 2 },
  ];
  return {
    id: 'chassis_spider',
    model: { solids, decals, materials: CAR_MATERIALS },
    cell: 96,
    engineAnchor: { x: 0, y: 24.5 },
    exhausts: [
      { x: -4.6, y: 35.5 },
      { x: 4.6, y: 35.5 },
    ],
    headlightAnchors: [
      { x: -4.3, y: -27 },
      { x: 4.3, y: -27 },
    ],
    brakeLightAnchors: [
      { x: -5, y: 32 },
      { x: 5, y: 32 },
    ],
  };
}

export const ARROW_ART = arrow();
export const TURTLE_ART = turtle();
export const SPIDER_ART = spider();
