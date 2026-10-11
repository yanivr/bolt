import {
  circle,
  ellipse,
  intersect,
  polygon,
  roundRect,
  strip,
  subtract,
  union,
} from '../../lib/model.js';
import type { PartArt } from '../types.js';
import { Kit, annulus, bar, corners, stripes } from './kit.js';

/**
 * The twenty utility systems of Section 11.7, in blue-black housings with mint, cyan and gold
 * working parts. None of them can be turned, so each is modelled for rotation 0: sensors and
 * intakes look forward (negative Y), the booster nozzle points back (positive Y).
 */

/** Spare Wheel: a real tire lying on a carrier, bright hub, gold strap buckles at each end. */
function spare(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 2, 5.7, 0, 1.2, 'housing', { r: 0.8 });
  k.decal(strip(-0.7, 0.7), base, { material: 'gold' });
  const ring = annulus(0, 0, 3.9, 1.9);
  const tire = k.add(ring, 'tire', 1.2, 4.6, { bevel: 1, tag: 'tire' });
  k.decal(
    intersect(annulus(0, 0, 3.9, 2.9), (x, y) => Math.abs(Math.sin(Math.atan2(y, x) * 5)) - 0.5),
    tire,
    { shade: 2 },
  );
  const hub = k.post(0, 0, 2, 1.2, 3.8, 'iron', { bevel: 0.7 });
  k.decal(circle(0, 0, 0.9), hub, { material: 'mint' });
  for (const y of [-4.9, 4.9]) k.block(0, y, 1.5, 0.7, 1.2, 3.6, 'gold', { r: 0.3 });
  return k.done('utility_spare', 28);
}

/** Repair Kit: a white toolbox with a green band, gold latches and a green wrench on the lid. */
function repair(): PartArt {
  const k = new Kit();
  const shape = roundRect(0, 0, 3.8, 3, 0.7);
  k.banded(shape, 0, [
    [1.6, 'mintBox'],
    [3.2, 'ivory'],
    [3.8, 'mount'],
  ]);
  const lid = k.add(shape, 'ivory', 3.8, 5.4, { bevel: 1.1, floor: 3.6, tag: 'lid' });
  const wrench = union(
    bar(-2.1, 1.3, 1, -0.7, 0.6, true),
    subtract(circle(1.6, -1.1, 1.25), bar(1.7, -1.2, 3.2, -2.2, 0.5)),
  );
  k.decal(wrench, lid, { material: 'mintBox' });
  for (const x of [-2.1, 2.1]) k.block(x, 3.1, 0.7, 0.45, 1.6, 4.4, 'gold', { r: 0.2 });
  return k.done('utility_repair', 28);
}

/** Cooling Fan: three broad mint blades spinning in a square shroud. */
function fan(): PartArt {
  const k = new Kit();
  const frame = subtract(roundRect(0, 0, 3.9, 3.9, 1.3), circle(0, 0, 3.3));
  k.add(frame, 'housing', 0, 4.8, { bevel: 0.4, tag: 'shroud' });
  const disc = k.post(0, 0, 3.35, 0, 4.2, 'mount', { tag: 'fan' });
  k.decal(
    intersect(circle(0, 0, 3.2), (x, y) => {
      const r = Math.hypot(x, y);
      return -0.1 - Math.sin(Math.atan2(y, x) * 3 + r * 0.5);
    }),
    disc,
    { material: 'mint' },
  );
  k.post(0, 0, 1.2, 4.2, 5.4, 'iron', { bevel: 0.8, floor: 4 });
  return k.done('utility_fan', 28);
}

/** Racing Radiator: a wide finned core leaning back between two end tanks, cyan hose caps. */
function radiator(): PartArt {
  const k = new Kit();
  for (const x of [-6.1, 6.1]) k.block(x, 0, 0.85, 2.9, 0, 6.8, 'housing', { r: 0.4 });
  const shape = roundRect(0, 0, 5.3, 2.8, 0.2);
  const core = k.ramp(shape, 'iron', -2.8, 2.2, 2.8, 6.4, { tag: 'core' });
  k.decal(intersect(shape, stripes(2.4, 1.2, 1, 0, 0.6)), core, { material: 'gunmetal' });
  for (const x of [-6.1, 6.1]) k.post(x, 1.2, 0.95, 6.8, 8, 'cyan', { floor: 6.6 });
  return k.done('utility_radiator', 32);
}

/** Extra Battery: a cell block with a bright mint lid, a dark bolt mark and two terminals. */
function battery(): PartArt {
  const k = new Kit();
  const shape = roundRect(0, 0, 3.7, 4.7, 0.8);
  k.banded(shape, 0, [
    [3.6, 'housing'],
    [4.6, 'mint'],
  ]);
  const top = k.add(shape, 'mint', 4.6, 5.4, { bevel: 0.7, floor: 4.4, tag: 'top' });
  k.decal(
    polygon([
      [1.3, -1.6],
      [-2, 1.4],
      [-0.2, 1.4],
      [-1.3, 4.2],
      [2, 1],
      [0.2, 1],
    ]),
    top,
    { material: 'housing' },
  );
  k.post(-1.9, -3.2, 1.05, 5.4, 7.2, 'gold', { floor: 5.2 });
  k.post(1.9, -3.2, 1.05, 5.4, 7.2, 'iron', { floor: 5.2 });
  return k.done('utility_battery', 28);
}

/** Auxiliary Generator: finned engine block under a gold fuel tank, round pull-cord housing. */
function generator(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.8, 5.8, 0, 1.2, 'housing', { r: 0.8 });
  k.bolts(base, corners(3.1, 5.1), 0.5);
  const blockShape = roundRect(0, 2.4, 3.2, 3, 0.6);
  k.banded(blockShape, 1.2, [
    [2.4, 'iron'],
    [2.9, 'mount'],
    [4, 'iron'],
    [4.5, 'mount'],
    [5.4, 'iron'],
  ]);
  const tank = k.block(0, 2.4, 2.7, 2.5, 5.4, 7.6, 'gold', { bevel: 1.1, floor: 5.2, r: 1 });
  k.decal(circle(0, 3.4, 0.8), tank, { material: 'bore' });
  const recoil = k.post(0, -2.9, 2.7, 1.2, 4.8, 'housing', { bevel: 0.9 });
  k.decal(annulus(0, -2.9, 2, 1.2), recoil, { material: 'mint' });
  k.block(0, -2.9, 1.5, 0.5, 4.8, 5.6, 'ivory', { floor: 4.6, r: 0.2, tag: 'cord' });
  return k.done('utility_generator', 28);
}

/** Burst Capacitor: a gold-banded cylinder standing upright with a glowing cyan cap. */
function capacitor(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.7, 3.7, 0, 1.2, 'housing', { r: 1 });
  k.bolts(base, corners(3, 3), 0.5);
  k.banded(circle(0, 0, 3), 1.2, [
    [2.6, 'gold'],
    [4.4, 'housing'],
    [5.4, 'gold'],
    [7.2, 'housing'],
    [8, 'gold'],
  ]);
  const cap = k.post(0, 0, 3, 8, 10, 'cyan', { bevel: 3, floor: 7.8, tag: 'glow' });
  k.decal(circle(-0.4, -0.5, 1.5), cap, { material: 'cyanGlow' });
  return k.done('utility_capacitor', 28);
}

/** Nitro Tank: a blue bottle lying in two saddles, steel neck and a gold valve wheel. */
function nitro(): PartArt {
  const k = new Kit();
  for (const y of [-1.2, 4.2]) k.block(0, y, 3.3, 0.8, 0, 2.6, 'housing', { r: 0.3 });
  const bottle = k.tube(0, 3.6, 0, -1.6, 3.3, 3.8, 3.8, 'nitro', { round: true, tag: 'bottle' });
  k.decal(
    intersect(bar(0, 3.6, 0, -1.6, 3.3, true), (_x, y) => Math.abs(y - 2) - 1),
    bottle,
    {
      material: 'ivory',
    },
  );
  k.decal(
    intersect(bar(0, 3.6, 0, -1.6, 3.3, true), (_x, y) => Math.abs(y + 1.2) - 0.4),
    bottle,
    { material: 'iron' },
  );
  k.tube(0, -4.6, 0, -5.8, 1.4, 3.8, 3.8, 'iron', { tag: 'neck' });
  k.tube(-2.4, -6.3, 2.4, -6.3, 0.75, 4.4, 4.4, 'gold', { round: true, tag: 'valve' });
  return k.done('utility_nitro', 32);
}

/** Emergency Booster: a small rocket pod, round nose forward, gold bell nozzle to the rear. */
function overdrive(): PartArt {
  const k = new Kit();
  for (const y of [-2.4, 1.6]) k.block(0, y, 3, 0.8, 0, 2.8, 'housing', { r: 0.3 });
  const pod = k.tube(0, 2.4, 0, -3, 3, 4.2, 4.2, 'housing', { round: true, tag: 'pod' });
  k.decal(
    intersect(bar(0, 2.4, 0, -3, 3, true), (_x, y) => Math.abs(y + 0.4) - 0.6),
    pod,
    { material: 'gold' },
  );
  k.decal(circle(0, -3.6, 1), pod, { material: 'mintGlow' });
  const bell = polygon([
    [-1.8, 2.2],
    [1.8, 2.2],
    [3.5, 5.7],
    [-3.5, 5.7],
  ]);
  const nozzle = k.add(bell, 'gold', 2, 8, {
    floor: 2.2,
    tag: 'nozzle',
    height: (x, y) => {
      const r = 1.9 + ((y - 2.2) / 3.5) * 1.7;
      return 4.2 + Math.sqrt(Math.max(r * r * 0.1, r * r - x * x));
    },
  });
  k.decal(
    intersect(bell, (_x, y) => 4.9 - y),
    nozzle,
    { material: 'hot' },
  );
  for (const x of [-3.4, 3.4]) k.block(x, 2.6, 0.5, 1.6, 1.6, 6.4, 'iron', { floor: 1.4, r: 0.2 });
  return k.done('utility_overdrive', 32);
}

/** Traction Computer: a black box with three indicator lights, heat-sink fins, a whip aerial. */
function traction(): PartArt {
  const k = new Kit();
  const shape = roundRect(0, 0, 3.7, 3.5, 0.8);
  const box = k.add(shape, 'housing', 0, 4, { bevel: 0.9, tag: 'box' });
  k.decal(
    intersect(
      intersect(shape, (_x, y) => 0.2 - y),
      stripes(1.3, 0.55, 1, 0),
    ),
    box,
    {
      shade: 2,
    },
  );
  [-2.1, 0, 2.1].forEach((x, i) => {
    k.post(x, -1.9, 0.8, 4, 4.8, i === 2 ? 'ledAmber' : 'mintGlow', {
      floor: 3.8,
      tag: `led${i}`,
      noShadow: true,
    });
  });
  k.post(2.5, 2.4, 0.6, 4, 8.6, 'iron');
  k.post(2.5, 2.4, 0.95, 8.6, 9.8, 'mintGlow', { floor: 8.4, noShadow: true });
  return k.done('utility_traction', 32);
}

/** Gyro Stabilizer: a gold gimbal ring between two yokes, a steel rotor ball on its spindle. */
function gyro(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.7, 4.7, 0, 1.2, 'housing', { r: 1 });
  k.bolts(base, corners(3, 4), 0.5);
  for (const y of [-4, 4]) k.block(0, y, 1.2, 0.65, 1.2, 6, 'housing', { r: 0.2 });
  const rotor = k.post(0, 0, 2.5, 2.2, 7.2, 'iron', { bevel: 2.5, floor: 2, tag: 'rotor' });
  k.decal(annulus(0, 0, 2, 1.3), rotor, { material: 'cyan' });
  k.post(0, 0, 0.75, 7.2, 8.4, 'mintGlow', { floor: 7, noShadow: true });
  k.add(annulus(0, 0, 3.9, 2.9), 'gold', 4.6, 5.8, { floor: 4.2, bevel: 0.4, tag: 'gimbal' });
  return k.done('utility_gyro', 28);
}

/** Radar: a white dish with a steel rim tilted toward the front on a mast, mint feed horn. */
function radar(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0.8, 2.9, 2.7, 0, 2.2, 'housing', { r: 0.8, bevel: 0.6 });
  k.decal(circle(-1.7, 2.2, 0.7), base, { material: 'mintGlow' });
  k.post(0, 0.8, 1.1, 2.2, 9.6, 'iron');
  const bowl = circle(0, 0, 3.8);
  const dish = k.add(bowl, 'ivory', 9.6, 14.4, {
    floor: 9.4,
    tag: 'dish',
    height: (x, y) => 10.2 + (y + 3.8) * 0.48 + (x * x + y * y) * 0.04,
  });
  k.decal(annulus(0, 0, 3.9, 2.9), dish, { material: 'iron' });
  k.decal(circle(0, -0.4, 1.5), dish, { material: 'housing' });
  k.post(0, -0.4, 0.9, 12.2, 13.4, 'mintGlow', { floor: 11.6, tag: 'feed', noShadow: true });
  return k.done('utility_radar', 36);
}

/** Mine Detector: a flat gold search coil held out front on a short arm, lit control box. */
function minesensor(): PartArt {
  const k = new Kit();
  const box = k.block(0, 1.9, 2.5, 1, 0, 4.2, 'housing', { r: 0.5, bevel: 0.6 });
  k.decal(circle(-1.2, 1.9, 0.6), box, { material: 'mintGlow' });
  k.post(1.4, 2, 0.55, 4.2, 7, 'iron');
  k.post(1.4, 2, 0.85, 7, 8, 'mintGlow', { floor: 6.8, noShadow: true });
  k.tube(0, 1.4, 0, -0.6, 0.75, 3.2, 2, 'iron', { tag: 'wand', web: 0.6 });
  k.add(subtract(ellipse(0, -0.9, 3.9, 2), ellipse(0, -0.9, 2.5, 0.85)), 'gold', 0.6, 2, {
    bevel: 0.5,
    tag: 'coil',
  });
  return k.done('utility_minesensor', 28);
}

/** Decoy Drone: a small white quadcopter with mint rotors docked on a marked pad. */
function decoy(): PartArt {
  const k = new Kit();
  const pad = k.block(0, 0, 3.8, 4.8, 0, 1.4, 'housing', { r: 1.2 });
  k.decal(subtract(roundRect(0, 0, 3.2, 4.2, 0.8), roundRect(0, 0, 2.6, 3.6, 0.5)), pad, {
    material: 'gold',
  });
  k.add(union(bar(-2.4, -3, 2.4, 3, 0.6), bar(2.4, -3, -2.4, 3, 0.6)), 'iron', 3.6, 4.4, {
    floor: 3.2,
    tag: 'arms',
  });
  const body = k.post(0, 0, 1.9, 1.4, 5.4, 'ivory', { bevel: 1.4, tag: 'drone' });
  k.decal(circle(0, -0.9, 0.7), body, { material: 'cyanGlow' });
  for (const [x, y] of corners(2.4, 3)) {
    k.post(x, y, 1.45, 4.4, 5, 'mint', { floor: 4.2, tag: 'rotor', noShadow: true });
  }
  return k.done('utility_decoy', 28);
}

/** Jump Pad: a fat hydraulic ram in the middle of a base frame, a coil spring at each corner. */
function jump(): PartArt {
  const k = new Kit();
  const frame = roundRect(0, 0, 6.8, 5.8, 1.4);
  const base = k.add(frame, 'housing', 0, 1.6, { tag: 'base' });
  k.decal(
    intersect(subtract(frame, roundRect(0, 0, 5.6, 4.6, 0.8)), stripes(2.4, 1.2, 1, 1)),
    base,
    { material: 'gold' },
  );
  for (const [x, y] of corners(4.9, 3.9)) {
    k.banded(
      circle(x, y, 1.5),
      1.6,
      [
        [2.4, 'gold'],
        [2.9, 'mount'],
        [3.7, 'gold'],
        [4.2, 'mount'],
        [5, 'gold'],
      ],
      { tag: 'spring' },
    );
    k.post(x, y, 1.5, 5, 5.6, 'iron', { floor: 4.8 });
  }
  k.banded(
    circle(0, 0, 3.3),
    1.6,
    [
      [3.2, 'iron'],
      [4, 'gold'],
      [6, 'iron'],
    ],
    { tag: 'ram' },
  );
  const piston = k.post(0, 0, 2.4, 6, 8.4, 'iron', { bevel: 0.8, floor: 5.8, tag: 'piston' });
  k.decal(circle(0, 0, 1.2), piston, { material: 'mintGlow' });
  return k.done('utility_jump', 32);
}

/** Recovery Winch: a cable drum between two cheek plates, fairlead roller and a gold hook. */
function winch(): PartArt {
  const k = new Kit();
  k.block(0, 1.2, 3.7, 3.6, 0, 1.2, 'housing', { r: 0.8 });
  for (const x of [-3.2, 3.2]) k.block(x, 2.2, 0.6, 2.6, 1.2, 6.4, 'housing', { r: 0.3 });
  const drum = k.tube(-2.7, 2.2, 2.7, 2.2, 2.4, 3.8, 3.8, 'iron', { tag: 'drum', web: 0.6 });
  k.decal(intersect(bar(-2.7, 2.2, 2.7, 2.2, 2.4), stripes(2.2, 1, 1, 0)), drum, {
    material: 'gunmetal',
  });
  k.tube(0, 0.4, 0, -2.2, 0.7, 3.4, 2.4, 'iron', { tag: 'cable', web: 0.4 });
  k.tube(-2.8, -1.6, 2.8, -1.6, 0.8, 1.9, 1.9, 'housing', { tag: 'fairlead', floor: 0 });
  k.add(
    subtract(circle(0, -3.2, 1.8), union(circle(0, -3.1, 0.7), bar(0.3, -3.1, 2.4, -2, 0.6))),
    'gold',
    0.8,
    3,
    { tag: 'hook' },
  );
  return k.done('utility_winch', 28);
}

/** Sliding Ballast: a heavy gold counterweight riding two steel rails between end stops. */
function ballast(): PartArt {
  const k = new Kit();
  for (const y of [-5.3, 5.3]) k.block(0, y, 3.7, 0.65, 0, 3.8, 'housing', { r: 0.3 });
  for (const x of [-2.4, 2.4])
    k.tube(x, -5.4, x, 5.4, 1, 1.8, 1.8, 'iron', { tag: 'rail', floor: 0 });
  const shape = roundRect(0, 1.6, 3.7, 2.4, 0.8);
  k.banded(
    shape,
    0.6,
    [
      [2.6, 'gold'],
      [3.8, 'mount'],
      [5.6, 'gold'],
    ],
    { tag: 'weight' },
  );
  const top = k.add(shape, 'gold', 5.6, 6.6, { bevel: 0.9, floor: 5.4, tag: 'weight' });
  k.decal(
    intersect(shape, (_x, y) => Math.abs(y - 1.6) - 0.6),
    top,
    { material: 'mount' },
  );
  return k.done('utility_ballast', 28);
}

/** Active Wing: a real wing high on two struts, mint end plates, gold centre stripe. */
function spoiler(): PartArt {
  const k = new Kit();
  for (const x of [-4.4, 4.4]) {
    k.block(x, 0.6, 1.1, 1.6, 0, 1.2, 'mount', { r: 0.4 });
    k.block(x, 0.6, 0.75, 1.3, 1.2, 9.6, 'housing', { r: 0.3 });
  }
  const plan = roundRect(0, 0, 7.6, 2.5, 1.1);
  const wing = k.add(plan, 'housing', 9.6, 11.4, {
    floor: 9.4,
    tag: 'wing',
    height: (_x, y) => 10.2 + y * 0.42,
  });
  k.decal(intersect(plan, strip(-1, 1)), wing, { material: 'gold' });
  k.decal(
    intersect(plan, (_x, y) => -1.6 - y),
    wing,
    { shade: 1 },
  );
  for (const x of [-7.5, 7.5]) k.block(x, 0, 0.5, 2.9, 8.6, 12.4, 'mint', { floor: 8.4, r: 0.2 });
  return k.done('utility_spoiler', 44);
}

/** Turret Computer: a sight unit with a cyan-lensed scope beside a mint crosshair display. */
function targeting(): PartArt {
  const k = new Kit();
  const shape = roundRect(0, 0.6, 3.7, 3.1, 0.8);
  const box = k.add(shape, 'housing', 0, 3.8, { bevel: 0.8, tag: 'box' });
  k.decal(union(annulus(1.7, 1.2, 1.6, 1), circle(1.7, 1.2, 0.45)), box, { material: 'mintGlow' });
  k.block(-1.6, 0.6, 0.9, 1.6, 3.8, 4.8, 'mount', { floor: 3.6 });
  k.tube(-1.6, 3.4, -1.6, -2.2, 1.6, 5.6, 5.6, 'iron', { tag: 'scope' });
  k.tube(-1.6, -2, -1.6, -3.8, 1.9, 5.6, 5.6, 'cyanGlow', { tag: 'lens' });
  return k.done('utility_targeting', 28);
}

/** Solar Panel: a framed grid of blue cells tilted up toward the rear on two legs. */
function solar(): PartArt {
  const k = new Kit();
  const frame = roundRect(0, 0, 6.9, 4.9, 0.5);
  const cells = roundRect(0, 0, 6.3, 4.3, 0.2);
  k.ramp(frame, 'iron', -4.9, 1.2, 4.9, 5.6, { tag: 'frame' });
  const panel = k.ramp(cells, 'solar', -4.9, 1.8, 4.9, 6.2, { tag: 'panel' });
  k.decal(
    intersect(cells, union(stripes(2.55, 0.5, 1, 0, 1.275), stripes(2.9, 0.5, 0, 1, 1.45))),
    panel,
    { material: 'cyan' },
  );
  return k.done('utility_solar', 32);
}

export const UTILITY_ART: PartArt[] = [
  spare(),
  repair(),
  fan(),
  radiator(),
  battery(),
  generator(),
  capacitor(),
  nitro(),
  overdrive(),
  traction(),
  gyro(),
  radar(),
  minesensor(),
  decoy(),
  jump(),
  winch(),
  ballast(),
  spoiler(),
  targeting(),
  solar(),
];
