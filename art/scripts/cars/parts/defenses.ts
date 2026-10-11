import type { Shape } from '../../lib/model.js';
import { circle, intersect, polygon, roundRect, strip, subtract, union } from '../../lib/model.js';
import type { PartArt } from '../types.js';
import { Kit, annulus, bar, corners, stripes } from './kit.js';

/**
 * The twenty defenses of Section 11.6, in pale armor steel with rivets and hazard or ivory
 * edging. Plates stand proud of the bodywork with real thickness and a sloped outer face, so
 * their rivets and stripes stay visible from the tilted camera. A plate's outer face points
 * toward negative Y, quarter turn 0. The parts with a fixed facing are written the same way
 * and turned by it: the rear guard to the back, the side shields outward.
 *
 * Hero pass: defenses are drawn about a tenth larger than written (`D`), the tall ones that
 * are recognised by their shape a little more. Plates stay plates: low, on the body.
 */

/** How much larger than written a defense is drawn. */
const D = 1.1;

const OCTAGON = (r: number, cut: number): Shape =>
  polygon(
    [
      [-cut, -r],
      [cut, -r],
      [r, -cut],
      [r, cut],
      [cut, r],
      [-cut, r],
      [-r, cut],
      [-r, -cut],
    ],
    0.4,
  );

/** Light Plates: three thin sloped plates side by side on a rail, broad ivory top edges. */
function lightPlate(): PartArt {
  const k = new Kit();
  k.block(0, 1.2, 5.8, 0.9, 0, 2.8, 'armorDark', { r: 0.3 });
  [-4, 0, 4].forEach((x, i) => {
    const shape = roundRect(x, -0.5, 1.7, 1.6, 0.4);
    const top = i === 1 ? 7.4 : 6.2;
    const plate = k.ramp(shape, 'armor', -2.1, 2.2, 1.1, top, { tag: `plate${i}` });
    k.decal(
      intersect(shape, (_x, y) => -0.1 - y),
      plate,
      { material: 'ivory' },
    );
    k.bolts(plate, [[x, 0.5]], 0.5, -3);
  });
  return k.done('defense_light_plate', 32, { scale: 1.15 });
}

/** Heavy Plating: a thick two-step slab, riveted lower glacis, ivory crown, three buttresses. */
function heavyPlate(): PartArt {
  const k = new Kit();
  for (const x of [-4.6, 0, 4.6]) k.block(x, 2.2, 1, 0.8, 0, 4.6, 'armorDark', { r: 0.3 });
  const shape = roundRect(0, -0.7, 6.9, 2.3, 0.7);
  const slab = k.add(shape, 'armor', 2.4, 8.4, {
    tag: 'slab',
    height: (_x, y) =>
      y < -1.2
        ? 2.4 + Math.max(0, Math.min(1, (y + 3) / 1.8)) * 2.4
        : 4.8 + Math.max(0, Math.min(1, (y + 1.2) / 0.7)) * 3.6,
  });
  k.decal(
    intersect(shape, (_x, y) => -0.5 - y),
    slab,
    { material: 'ivory' },
  );
  k.decal(
    intersect(shape, (_x, y) => Math.abs(y + 0.9) - 0.4),
    slab,
    { shade: -2 },
  );
  k.bolts(
    slab,
    [-5, -1.7, 1.7, 5].map((x) => [x, -2] as [number, number]),
    0.85,
    -3,
  );
  return k.done('defense_heavy_plate', 38, { scale: D });
}

/** Crash Bumper: a steel V plow, sloped leading face under a hazard-striped crown. */
function frontBumper(): PartArt {
  const k = new Kit();
  k.block(0, 1.5, 3.2, 0.9, 0, 3.4, 'armorDark', { r: 0.4 });
  const front = (x: number) => -2.4 + Math.abs(x) * 0.3;
  const plow = polygon(
    [
      [0, -2.2],
      [6.7, -0.2],
      [6.7, 2.2],
      [0, 0.6],
      [-6.7, 2.2],
      [-6.7, -0.2],
    ],
    0.3,
  );
  const blade = k.add(plow, 'armor', 2, 6.4, {
    tag: 'blade',
    height: (x, y) => 2 + Math.max(0, Math.min(1, (y - front(x)) / 1.1)) * 4.4,
  });
  const crown = intersect(plow, (x, y) => front(x) + 1.1 - y);
  k.decal(crown, blade, { material: 'hazard' });
  k.decal(intersect(crown, stripes(3, 1.5, 1, 0)), blade, { material: 'bore' });
  return k.done('defense_front_bumper', 36, { scale: D });
}

/**
 * Rear Guard: two tubular rails on uprights with red reflectors. Its fixed facing is quarter
 * turn 2, so the rails are toward negative Y here and the turn points them behind the car.
 */
function rearBumper(): PartArt {
  const k = new Kit();
  for (const x of [-4.2, 4.2]) {
    k.block(x, 0.9, 1.2, 1.4, 0, 1.4, 'mount', { r: 0.4 });
    k.block(x, -0.4, 0.9, 1.5, 0, 6.2, 'armorDark', { r: 0.3 });
  }
  k.tube(-5.9, -1.6, 5.9, -1.6, 1.25, 2.3, 2.3, 'armor', { round: true, tag: 'rail' });
  const top = k.tube(-5.8, -0.5, 5.8, -0.5, 1.4, 5.8, 5.8, 'armor', { round: true, tag: 'rail' });
  k.decal(union(strip(-7.2, -4.4), strip(4.4, 7.2)), top, { material: 'coral' });
  k.decal(strip(-1.6, 1.6), top, { material: 'ivory' });
  return k.done('defense_rear_bumper', 36, { scale: 1.1 });
}

/**
 * Side Shields: a tall ribbed plate with an ivory cap. Its fixed facing is outward, so the
 * plate is written across the part, outer face toward negative Y, and the turn lays it along
 * whichever flank it is mounted on.
 */
function sidePanels(): PartArt {
  const k = new Kit();
  const shape = roundRect(0, -0.4, 6.8, 1.6, 0.6);
  k.banded(shape, 0, [
    [1.6, 'armorDark'],
    [6, 'armor'],
  ]);
  const cap = k.add(shape, 'ivory', 6, 7.6, {
    tag: 'cap',
    height: (_x, y) => 7.6 - Math.abs(y + 0.4) * 0.7,
  });
  k.bolts(
    cap,
    [-5.2, -2.6, 0, 2.6, 5.2].map((x) => [x, -0.4] as [number, number]),
    0.55,
    -3,
  );
  for (const x of [-4.4, 0, 4.4]) k.block(x, 0.6, 0.7, 2, 0, 5.2, 'armorDark', { r: 0.2 });
  return k.done('defense_side_panels', 36, { scale: 1.1 });
}

/** Wheel Cage: a yellow roll cage of posts and bars bolted over a treaded tire. */
function wheelCage(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.8, 4.8, 0, 1.2, 'armorDark', { r: 0.8 });
  k.bolts(base, corners(3, 4), 0.6);
  const tire = k.tube(-1.7, 0, 1.7, 0, 3.3, 3.4, 3.4, 'tire', { tag: 'tire', floor: 1.2 });
  k.decal(intersect(bar(-1.7, 0, 1.7, 0, 3.3), stripes(2.2, 1, 0, 1)), tire, { shade: 2 });
  k.tube(-2.3, 0, 2.3, 0, 1.4, 3.4, 3.4, 'iron', { tag: 'hub', floor: 2 });
  for (const x of [-3, 3]) {
    for (const y of [-4, 4]) k.block(x, y, 0.75, 0.75, 1.2, 7.4, 'hazard', { r: 0.3 });
    k.tube(x, -4.6, x, 4.6, 0.8, 7.4, 7.4, 'hazard', { tag: 'bar' });
  }
  return k.done('defense_wheel_cage', 34, { scale: D });
}

/** Engine Shell: an armor clamshell, engine heat glowing through three slots, copper breather. */
function engineCase(): PartArt {
  const k = new Kit();
  const flange = k.block(0, 0, 3.9, 5.9, 0, 1.4, 'armorDark', { r: 1 });
  k.bolts(flange, [...corners(3.2, 5.2), [-3.3, 0], [3.3, 0]], 0.7);
  const dome = roundRect(0, 0, 3.1, 5.1, 1.6);
  const shell = k.add(dome, 'armor', 1.4, 6.6, { bevel: 2.2, tag: 'shell' });
  const slots = union(...[-0.6, 1.8, 4.2].map((y) => roundRect(0, y - 0.6, 2.2, 0.6, 0.3)));
  k.decal(slots, shell, { material: 'ledAmber' });
  k.banded(circle(0, -3.4, 1.5), 5, [
    [7.6, 'armorDark'],
    [8.8, 'copper'],
  ]);
  return k.done('defense_engine_case', 34, { scale: D });
}

/** Ceramic Panels: six glossy ivory tiles set in a dark frame. */
function ceramic(): PartArt {
  const k = new Kit();
  k.block(0, 0, 3.9, 5.9, 0, 1.8, 'armorDark', { r: 0.6 });
  for (const x of [-1.85, 1.85]) {
    for (const y of [-3.75, 0, 3.75]) {
      const tile = k.block(x, y, 1.6, 1.6, 1.8, 4.4, 'ivory', { r: 0.4, bevel: 0.7 });
      k.decal(circle(x - 0.5, y - 0.5, 0.5), tile, { shade: 1 });
    }
  }
  return k.done('defense_ceramic', 28, { scale: D });
}

/** Breakaway Armor: a plate pre-scored into three shards, held by red shear bolts. */
function breakaway(): PartArt {
  const k = new Kit();
  k.block(0, 0, 3.8, 4.8, 0, 1.4, 'armorDark', { r: 0.6 });
  const shards: Array<[Array<[number, number]>, number]> = [
    [
      [
        [-3.5, -4.5],
        [3.5, -4.5],
        [3.5, -2.2],
        [-0.6, -0.4],
        [-3.5, -1.6],
      ],
      4.8,
    ],
    [
      [
        [-3.5, -0.8],
        [-0.7, 0.4],
        [0.8, 4.5],
        [-3.5, 4.5],
      ],
      4.2,
    ],
    [
      [
        [3.5, -1.4],
        [0.2, 0.1],
        [1.7, 4.5],
        [3.5, 4.5],
      ],
      5.4,
    ],
  ];
  for (const [points, top] of shards)
    k.add(polygon(points, 0.15), 'armor', 1.4, top, { bevel: 0.7, profile: 'linear' });
  for (const [x, y] of corners(2.8, 3.8)) k.post(x, y, 0.75, 5.4, 6.2, 'coral', { floor: 4 });
  return k.done('defense_breakaway', 30, { scale: D });
}

/** Composite Shell: three stepped layers, dark base, ivory-rimmed steel, woven carbon top. */
function composite(): PartArt {
  const k = new Kit();
  k.block(0, 0, 3.9, 5.9, 0, 2, 'armorDark', { r: 1 });
  const mid = k.block(0, 0, 3.2, 5.2, 2, 4, 'armor', { r: 0.9 });
  k.decal(subtract(roundRect(0, 0, 3.2, 5.2, 0.9), roundRect(0, 0, 2.6, 4.6, 0.6)), mid, {
    material: 'ivory',
  });
  const topShape = roundRect(0, 0, 2.4, 4.4, 0.8);
  const top = k.add(topShape, 'gunmetal', 4, 6.4, { bevel: 0.8, profile: 'linear' });
  k.decal(intersect(topShape, stripes(1.7, 0.7, 1, 1)), top, { shade: -2 });
  return k.done('defense_composite', 28, { scale: D });
}

/** Energy Shield: banded copper coil, four emitter claws and a cyan lens dome on top. */
function energyShield(): PartArt {
  const k = new Kit();
  const plate = k.add(OCTAGON(4.6, 2), 'armorDark', 0, 1.4);
  k.bolts(plate, [
    [0, -4.2],
    [0, 4.2],
    [-4.2, 0],
    [4.2, 0],
  ]);
  for (const [x, y] of corners(3.1, 3.1)) {
    k.post(x, y, 1, 1.4, 7.4, 'armor');
    k.post(x, y, 1, 7.4, 8.2, 'ivory', { floor: 7.2 });
  }
  k.banded(
    circle(0, 0, 3.1),
    1.4,
    [
      [2.6, 'copper'],
      [3.2, 'mount'],
      [4.4, 'copper'],
      [5, 'mount'],
      [6.2, 'copper'],
      [6.8, 'armor'],
    ],
    { tag: 'coil' },
  );
  const lens = k.post(0, 0, 2.6, 6.8, 9.8, 'cyan', { bevel: 2.6, floor: 6.6, tag: 'lens' });
  k.decal(circle(-0.6, -0.7, 1), lens, { material: 'cyanGlow' });
  return k.done('defense_energy_shield', 36, { scale: 1.18 });
}

/** Faraday Cage: brass wire hoops and a ridge wire caging a dark electronics box. */
function faraday(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.8, 4.8, 0, 1.2, 'armorDark', { r: 0.8 });
  k.bolts(base, corners(3.1, 4.1), 0.45);
  const box = k.block(0, 0, 2.2, 3.4, 1.2, 4.2, 'housing', { bevel: 0.7, r: 0.6 });
  k.decal(roundRect(0, 0, 0.8, 1.6, 0.3), box, { material: 'violetGlow' });
  for (const y of [-3.9, 0, 3.9]) {
    for (const x of [-3.2, 3.2]) k.block(x, y, 0.7, 0.7, 1.2, 7, 'brass', { r: 0.3 });
    k.tube(-3.8, y, 3.8, y, 0.75, 7, 7, 'brass', { tag: 'hoop' });
  }
  k.tube(0, -4.6, 0, 4.6, 0.75, 7.3, 7.3, 'brass', { tag: 'hoop' });
  return k.done('defense_faraday', 34, { scale: D });
}

/** Heat Guard: a quilted gold-foil heat shield arched over the mount, steel end bands. */
function heatguard(): PartArt {
  const k = new Kit();
  k.block(0, 0, 3.9, 3.9, 0, 1, 'armorDark', { r: 0.6 });
  const shape = bar(0, -3.7, 0, 3.7, 3.6);
  const foil = k.tube(0, -3.7, 0, 3.7, 3.6, 2.2, 2.2, 'foil', { floor: 0.8, tag: 'foil' });
  k.decal(intersect(shape, union(stripes(2.2, 0.5, 1, 1), stripes(2.2, 0.5, 1, -1))), foil, {
    shade: -1,
  });
  k.decal(
    intersect(shape, (_x, y) => 2.8 - Math.abs(y)),
    foil,
    { material: 'armor' },
  );
  return k.done('defense_heatguard', 26, { scale: D });
}

/** Missile Interceptor: a compact auto-turret, twin barrels raised skyward, white radome. */
function antimissile(): PartArt {
  const k = new Kit();
  const ring = k.post(0, 0, 4.7, 0, 1.6, 'armor', { bevel: 0.7 });
  k.bolts(
    ring,
    [
      [-4, 0],
      [4, 0],
      [0, -4],
    ],
    0.5,
    -3,
  );
  k.banded(circle(0, 0.6, 3.3), 1.6, [
    [2.4, 'mount'],
    [5, 'armor'],
  ]);
  k.post(0, 0.6, 3.3, 5, 5.8, 'armor', { bevel: 1.2, floor: 4.8, tag: 'turret' });
  for (const x of [-1.6, 1.6]) {
    k.tube(x, 0.4, x, -3.6, 1, 5.6, 9, 'iron', { tag: 'barrel' });
    k.tube(x, -3.4, x, -4.8, 1.15, 9, 10.2, 'hazard', { tag: 'muzzle' });
  }
  k.post(0, 2.6, 2, 5.8, 8.6, 'ivory', { bevel: 2, floor: 5.6, tag: 'sensor' });
  k.post(0, 2.6, 0.75, 8.6, 9.2, 'ledRed', { floor: 8.4, noShadow: true });
  return k.done('defense_antimissile', 44, { scale: 1.18 });
}

/** Mine Sweeper: a yellow and black roller carried ahead of the car on two arms. */
function minesweeper(): PartArt {
  const k = new Kit();
  k.block(0, 2.3, 5.2, 0.7, 0, 2.6, 'armorDark', { r: 0.3 });
  for (const x of [-4.6, 4.6]) k.tube(x, 2.6, x, -1, 0.95, 3, 2, 'armor', { tag: 'arm', web: 1 });
  const roller = k.tube(-5.9, -1.2, 5.9, -1.2, 1.8, 1.9, 1.9, 'hazard', {
    tag: 'roller',
    floor: 0,
  });
  k.decal(intersect(bar(-5.9, -1.2, 5.9, -1.2, 1.8), stripes(2.9, 1.45, 1, 0)), roller, {
    material: 'bore',
  });
  return k.done('defense_minesweeper', 28, { scale: 1.12 });
}

/** Fireproof Lining: a quilted white fire blanket with red piping and an extinguisher. */
function fireproof(): PartArt {
  const k = new Kit();
  const shape = roundRect(0, 0, 3.8, 3.8, 1);
  const pad = k.add(shape, 'ivory', 0, 2.4, { bevel: 1, tag: 'pad' });
  k.decal(subtract(shape, roundRect(0, 0, 3, 3, 0.6)), pad, { material: 'coral' });
  k.decal(
    intersect(
      roundRect(0, 0, 3, 3, 0.6),
      union(strip(-0.3, 0.3), (_x, y) => Math.abs(y) - 0.3),
    ),
    pad,
    {
      shade: -1,
    },
  );
  k.banded(circle(-1.3, 1.1, 1.9), 2.4, [[7, 'coral']]);
  k.post(-1.3, 1.1, 1.9, 7, 8.2, 'coral', { bevel: 1.6, floor: 6.8 });
  k.post(-1.3, 1.1, 0.85, 8.2, 9.4, 'iron', { floor: 8 });
  k.tube(-1.3, 1.1, 1, -0.4, 0.6, 9, 9, 'bore', { tag: 'hose', noShadow: true });
  return k.done('defense_fireproof', 30, { scale: D });
}

/** Grip Coating: a fat coating drum with a hazard band beside a strip of chevron grip tread. */
function oilproof(): PartArt {
  const k = new Kit();
  k.block(0, 0, 3.9, 3.9, 0, 1.2, 'armorDark', { r: 0.6 });
  const mat = roundRect(1.9, 0, 1.7, 3.6, 0.4);
  const tread = k.add(mat, 'tire', 1.2, 2.6, { bevel: 0.5, tag: 'tread' });
  const chevrons = union(
    ...[-2.4, 0, 2.4].map((y) =>
      union(bar(1.9, y - 0.7, 3.6, y + 0.6, 0.55), bar(1.9, y - 0.7, 0.2, y + 0.6, 0.55)),
    ),
  );
  k.decal(intersect(mat, chevrons), tread, { material: 'ivory' });
  k.banded(circle(-1.5, 0.2, 2.3), 1.2, [
    [3, 'armor'],
    [4.6, 'hazard'],
    [6.4, 'armor'],
  ]);
  const lid = k.post(-1.5, 0.2, 2.3, 6.4, 7, 'armor', { bevel: 0.6, floor: 6.2 });
  k.decal(circle(-1.5, 0.2, 1), lid, { material: 'bore' });
  return k.done('defense_oilproof', 28, { scale: D });
}

/** Shock Dampers: twin coil-over shocks with yellow springs, tied by a top bar. */
function damper(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.7, 4.6, 0, 1.2, 'armorDark', { r: 0.8 });
  k.bolts(base, corners(2.9, 3.8), 0.5);
  for (const y of [-2.5, 2.5]) {
    k.banded(
      circle(0, y, 2),
      1.2,
      [
        [2.4, 'iron'],
        [3.3, 'hazard'],
        [3.8, 'mount'],
        [4.7, 'hazard'],
        [5.2, 'mount'],
        [6.1, 'hazard'],
        [6.6, 'mount'],
        [7.5, 'hazard'],
      ],
      { tag: 'spring' },
    );
    k.post(0, y, 1.3, 7.5, 9.2, 'iron', { bevel: 0.6, floor: 7.3 });
  }
  k.tube(0, -2.5, 0, 2.5, 0.8, 8.6, 8.6, 'armor', { tag: 'bar' });
  return k.done('defense_damper', 32, { scale: D });
}

/** Steering Stabilizer: a white steering wheel on a short column over a damper strut. */
function steerAssist(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.7, 3.7, 0, 1.4, 'armorDark', { r: 0.8 });
  k.bolts(base, corners(2.9, 2.9), 0.6);
  k.tube(-3.8, -3, 3.8, -3, 0.9, 2.2, 2.2, 'iron', { tag: 'strut', floor: 1.2 });
  k.post(0, 0.3, 1.5, 1.4, 4.2, 'armor');
  k.add(union(bar(-3, 0.3, 3, 0.3, 0.7), bar(0, 0.3, 0, 3.4, 0.7)), 'armor', 4.2, 5, {
    floor: 4,
    tag: 'spokes',
  });
  k.add(annulus(0, 0.3, 3.7, 2.4), 'ivory', 4.2, 5.6, { floor: 3.8, tag: 'wheel', bevel: 0.6 });
  k.post(0, 0.3, 1.3, 5, 6.2, 'hazard', { bevel: 0.7, floor: 4.8 });
  return k.done('defense_steer_assist', 26, { scale: D });
}

/** Reactive Foam: six puffy olive charge blocks in a dark frame, a red primer on each. */
function reactive(): PartArt {
  const k = new Kit();
  k.block(0, 0, 3.9, 5.9, 0, 1.6, 'armorDark', { r: 0.6 });
  for (const x of [-1.85, 1.85]) {
    for (const y of [-3.75, 0, 3.75]) {
      k.block(x, y, 1.65, 1.65, 1.6, 5, 'pad', { r: 1, bevel: 1.5 });
      k.post(x, y, 0.6, 5, 5.5, 'coral', { floor: 4.8, noShadow: true });
    }
  }
  return k.done('defense_reactive', 28, { scale: D });
}

export const DEFENSE_ART: PartArt[] = [
  lightPlate(),
  heavyPlate(),
  frontBumper(),
  rearBumper(),
  sidePanels(),
  wheelCage(),
  engineCase(),
  ceramic(),
  breakaway(),
  composite(),
  energyShield(),
  faraday(),
  heatguard(),
  antimissile(),
  minesweeper(),
  fireproof(),
  oilproof(),
  damper(),
  steerAssist(),
  reactive(),
];
