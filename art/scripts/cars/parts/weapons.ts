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
 * The twenty weapons of Section 11.5, in gunmetal with warm tips. The muzzle end points toward
 * negative Y and carries the brightest accent, so a player can see which way a weapon was
 * turned. The elements Section 13.4 animates are tagged: `muzzle`, `charge0..`, `hatch`,
 * `spool`, `nozzle`, `pilot`, `arm`, `spring`, `teeth`, `sensor`.
 *
 * Road Mine and Oil Slick cannot be rotated and always sit at rotation 0 on a rear or utility
 * mount, so their business end (the hatch, the spill nozzle) faces positive Y, the back of
 * the car.
 */

/** Front Machine Gun: twin bright barrels over a short receiver, brass ammo box on the right. */
function frontMg(): PartArt {
  const k = new Kit();
  const base = k.block(0, 3, 3.7, 2.9, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.9, 2.1, 0, 3), 0.5);
  k.block(-0.8, -2.6, 2.5, 0.6, 0, 3.1, 'mount');
  k.block(-0.8, 3.2, 2.7, 2.6, 1.2, 5.6, 'gunmetal', { bevel: 1, r: 0.9 });
  const ammo = k.block(2.6, 3.3, 1.25, 2.5, 1.2, 7.2, 'brass', { r: 0.4 });
  k.decal(roundRect(2.6, 3.3, 0.6, 1.9, 0.2), ammo, { shade: 1 });
  for (const x of [-2.1, 0.5]) {
    k.tube(x, 1.6, x, -4.3, 1.1, 4.7, 4.7, 'iron', { tag: 'barrel' });
    k.tube(x, -4.1, x, -6, 1.3, 4.7, 4.7, 'amber', { tag: 'muzzle' });
  }
  return k.done('weapon_front_mg', 32);
}

/** Rear Sentry: a small drum auto-turret with one stubby gun and a big amber sensor eye. */
function rearMg(): PartArt {
  const k = new Kit();
  const base = k.post(0, 1, 3.9, 0, 1.4, 'mount');
  k.bolts(base, [
    [-3.1, 1],
    [3.1, 1],
    [0, 4.1],
  ]);
  k.banded(circle(0, 1.4, 3.1), 1.4, [
    [2.4, 'mount'],
    [5, 'gunmetal'],
  ]);
  k.post(0, 1.4, 3.1, 5, 6.2, 'gunmetal', { bevel: 1.4, floor: 4.8, tag: 'turret' });
  k.post(0, 2, 1.7, 6.2, 7.6, 'ledAmber', { bevel: 1.2, floor: 6, tag: 'sensor' });
  k.tube(0, -0.8, 0, -3.4, 1.3, 4.6, 4.6, 'iron', { tag: 'barrel' });
  k.tube(0, -3.2, 0, -5, 1.5, 4.6, 4.6, 'amber', { tag: 'muzzle' });
  return k.done('weapon_rear_mg', 28);
}

/** Swivel Turret: bright bolted turret ring, tall round turret with a hatch, long barrel. */
function turret(): PartArt {
  const k = new Kit();
  const ring = k.post(0, 0.6, 5.4, 0, 1.8, 'iron', { bevel: 0.7 });
  k.bolts(
    ring,
    [
      [-4.5, 0],
      [4.5, 0],
      [-2.8, -3.2],
      [2.8, -3.2],
    ],
    0.6,
    -3,
  );
  k.banded(circle(0, 2, 3.8), 1.8, [
    [3, 'mount'],
    [7.4, 'gunmetal'],
  ]);
  const top = k.post(0, 2, 3.8, 7.4, 9.2, 'gunmetal', { bevel: 1.9, floor: 7.2, tag: 'turret' });
  k.decal(circle(0.9, 3, 1.7), top, { shade: 1 });
  k.decal(annulus(0.9, 3, 1.7, 1.1), top, { shade: -2 });
  k.decal(circle(-1.9, 1.6, 0.75), top, { material: 'ledRed' });
  k.block(0, -1.5, 2.1, 1, 5.4, 9.2, 'mount', { floor: 5.2, tag: 'mantlet' });
  k.tube(0, -1.4, 0, -4.2, 1.4, 7.6, 7.6, 'iron', { tag: 'barrel' });
  k.tube(0, -4, 0, -6, 1.8, 7.6, 7.6, 'amber', { tag: 'muzzle' });
  return k.done('weapon_turret', 32);
}

/** Road Shotgun: short fat barrel flaring to a wide dark mouth, shells on the receiver. */
function shotgun(): PartArt {
  const k = new Kit();
  const base = k.block(0, 2.8, 3.6, 3, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.8, 2.2, 0, 2.8), 0.5);
  const rec = k.block(0, 3.4, 2.9, 2.4, 1.2, 5.8, 'gunmetal', { bevel: 0.9, r: 0.8 });
  for (const x of [-1.5, 0, 1.5])
    k.decal(roundRect(x, 3.6, 0.5, 1.3, 0.3), rec, { material: 'brass' });
  k.block(0, -1.8, 1.6, 0.6, 0, 2.4, 'mount');
  const flare = polygon([
    [-2.1, 1.4],
    [2.1, 1.4],
    [2.3, -1.8],
    [3.8, -4.4],
    [-3.8, -4.4],
    [-2.3, -1.8],
  ]);
  const halfAt = (y: number) => (y > -1.8 ? 2.2 : 2.2 + ((-1.8 - y) / 2.6) * 1.6);
  const barrel = k.add(flare, 'iron', 3, 6.6, {
    floor: 2.6,
    tag: 'barrel',
    height: (x, y) => 4 + 2.6 * Math.sqrt(Math.max(0.12, 1 - (x / (halfAt(y) + 0.2)) ** 2)),
  });
  k.decal(
    intersect(flare, (_x, y) => y + 3.2),
    barrel,
    { material: 'bore' },
  );
  k.add(roundRect(0, -5.2, 3.9, 0.8, 0.3), 'amber', 3, 6.8, {
    floor: 2.4,
    tag: 'muzzle',
    height: (x) => 4 + 2.8 * Math.sqrt(Math.max(0.12, 1 - (x / 4.2) ** 2)),
  });
  return k.done('weapon_shotgun', 28);
}

/** Needle Railgun: two long thin rails over six charge cells, capacitor block at the back. */
function railshot(): PartArt {
  const k = new Kit();
  const base = k.block(0, 5.6, 3.4, 3.2, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.6, 2.4, 0, 5.6), 0.5);
  const cap = k.block(0, 5.9, 3.5, 2.8, 1.2, 7.2, 'gunmetal', { bevel: 1, r: 0.9 });
  k.decal(roundRect(0, 5.9, 2.1, 1.3, 0.4), cap, { material: 'cyanGlow' });
  k.block(0, -6.6, 2.8, 0.6, 0, 3.4, 'mount');
  k.block(0, -1.4, 2.8, 0.6, 0, 3.4, 'mount');
  k.tube(0, 3.4, 0, -8, 1.3, 3.2, 3.2, 'mount', { tag: 'spine' });
  for (let i = 0; i < 6; i++) {
    const y = 1.9 - i * 1.9;
    k.add(roundRect(0, y, 1.2, 0.62, 0.2), 'cyanGlow', 3.4, 5.2, {
      floor: 3.2,
      tag: `charge${i}`,
      noShadow: true,
    });
  }
  for (const x of [-2.4, 2.4]) {
    k.tube(x, 3.4, x, -7.4, 0.95, 4.6, 4.6, 'iron', { tag: 'rail' });
    k.tube(x, -7.2, x, -9, 1.1, 4.6, 4.6, 'amber', { tag: 'muzzle' });
  }
  return k.done('weapon_railshot', 36);
}

/** Straight Rocket: one fat launch tube on two saddles, a red warhead poking out of the mouth. */
function rocket(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.6, 3.3, 4.6, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.5, 3.8, 0, 1.6), 0.5);
  k.block(0, -1.6, 3.2, 0.7, 1.2, 4.2, 'mount');
  k.block(0, 4.6, 3.2, 0.7, 1.2, 4.2, 'mount');
  const body = bar(0, 6.2, 0, -3.4, 2.9);
  const tube = k.tube(0, 6.2, 0, -3.4, 2.9, 5.4, 5.4, 'gunmetal', { web: 0.3, tag: 'tube' });
  k.decal(
    intersect(body, (_x, y) => Math.abs(y - 1.6) - 0.5),
    tube,
    { shade: -2 },
  );
  k.decal(
    intersect(body, (_x, y) => 5.6 - y),
    tube,
    { material: 'amber' },
  );
  k.tube(0, -3, 0, -4.2, 3.2, 5.4, 5.4, 'iron', { tag: 'muzzle' });
  k.tube(0, -4, 0, -5.2, 2.2, 5.4, 5.4, 'coral', { tag: 'warhead' });
  k.tube(0, -4.6, 0, -5.4, 1.6, 5.4, 5.4, 'coral', { round: true, tag: 'warhead' });
  return k.done('weapon_rocket', 32);
}

/** Seeker Missile: raised two-missile rack, white missiles with red noses, lock sensor behind. */
function homing(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.6, 4.4, 5, 0, 1.2, 'mount', { r: 1.2 });
  k.bolts(base, corners(3.5, 4.1, 0, 1.6), 0.5);
  k.block(0, 5, 2, 1.6, 1.2, 5.6, 'gunmetal', { bevel: 0.6 });
  k.post(0, 5, 1.25, 5.6, 7.2, 'ledRed', { bevel: 0.8, tag: 'sensor', floor: 5.4 });
  k.block(0, -2.6, 4.3, 0.7, 1.2, 6, 'mount');
  k.tube(0, 3.2, 0, -3, 1.2, 3.8, 6.4, 'gunmetal', { tag: 'rack' });
  for (const x of [-2.9, 2.9]) {
    k.tube(x, 4.4, x, -3.8, 1.6, 5.2, 8, 'ivory', { tag: 'missile' });
    k.tube(x, -3.6, x, -5.4, 1.55, 7.9, 8.6, 'coral', { round: true, tag: 'nose' });
    k.tube(x, 5.6, x, 4, 1.95, 4.8, 5.4, 'gunmetal');
  }
  return k.done('weapon_homing', 40);
}

/** Road Mine: dispenser box with its hatch flipped up and an armed mine waiting in the chute. */
function mine(): PartArt {
  const k = new Kit();
  const tray = k.block(0, 0, 4.8, 3.8, 0, 1.2, 'mount', { r: 0.8 });
  k.decal(
    intersect(
      subtract(roundRect(0, 1.3, 4.8, 2.5, 0.6), circle(0, 1.2, 2.9)),
      stripes(2.4, 1.2, 1, 0),
    ),
    tray,
    { material: 'hazard' },
  );
  const box = k.block(0, -2.5, 4.6, 1.3, 1.2, 5.4, 'gunmetal', { bevel: 0.9, r: 0.6 });
  k.bolts(box, [
    [-3.3, -2.5],
    [3.3, -2.5],
  ]);
  k.ramp(roundRect(0, -0.7, 4.2, 0.7, 0.2), 'iron', -1.4, 5.4, 0, 8.2, { floor: 5, tag: 'hatch' });
  const body = k.post(0, 1.2, 2.7, 1.2, 3.8, 'oil', { bevel: 1, tag: 'mine' });
  k.decal(annulus(0, 1.2, 2.3, 1.2), body, { material: 'coral' });
  k.post(0, 1.2, 1.1, 3.8, 5, 'ledAmber', { bevel: 0.7, floor: 3.6, tag: 'blink' });
  return k.done('weapon_mine', 28);
}

/** Oil Slick: orange oil drum lying across the car, black spill nozzle hanging off the back. */
function oil(): PartArt {
  const k = new Kit();
  const base = k.block(0, -0.6, 4.6, 3.2, 0, 1.2, 'mount', { r: 0.8 });
  k.bolts(base, corners(3.8, 2.5, 0, -0.6), 0.5);
  for (const x of [-2.4, 2.4]) k.block(x, -1, 0.7, 2.6, 1.2, 3.4, 'mount');
  const drum = k.tube(-4.8, -1, 4.8, -1, 2.8, 4.4, 4.4, 'amber', { web: 0.4, tag: 'drum' });
  k.decal(union(strip(-3.3, -2.3), strip(2.3, 3.3)), drum, { material: 'oil' });
  k.decal(circle(0, -1.6, 1.1), drum, { material: 'oil' });
  const nozzle = k.ramp(
    polygon([
      [-1.3, 1.2],
      [1.3, 1.2],
      [3.8, 3.9],
      [-3.8, 3.9],
    ]),
    'oil',
    1.2,
    4.4,
    3.9,
    1.8,
    { tag: 'nozzle', floor: 1 },
  );
  k.decal(roundRect(0, 3.4, 3.3, 0.6, 0.2), nozzle, { shade: 2 });
  return k.done('weapon_oil', 28);
}

/** Sticky Foam: tall pale canister feeding a wide, low spray horn with a foam-caked lip. */
function foam(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1, 4.4, 4.8, 0, 1.2, 'steelDark', { r: 1.2 });
  k.bolts(base, corners(3.5, 3.9, 0, 1), 0.5);
  const can = k.banded(circle(0, 2.9, 3), 1.2, [
    [3, 'steelDark'],
    [6.6, 'foam'],
    [7.6, 'steelDark'],
    [9.6, 'foam'],
  ]);
  k.decal(annulus(0, 2.9, 3.1, 2.1), can, { shade: -1 });
  k.post(0, 2.9, 1.2, 9.6, 10.8, 'steel', { bevel: 0.7, floor: 9.4 });
  k.tube(0, 0.6, 0, -2, 1.3, 4.2, 4.2, 'steel');
  const horn = polygon([
    [-1.4, -1.6],
    [1.4, -1.6],
    [4.6, -5],
    [-4.6, -5],
  ]);
  k.add(horn, 'gunmetal', 2.6, 5.6, {
    floor: 2.4,
    tag: 'nozzle',
    height: (x, y) => {
      const half = 1.5 + ((-1.6 - y) / 3.4) * 3.2;
      return 3.6 + 2 * Math.sqrt(Math.max(0.15, 1 - (x / (half + 0.3)) ** 2));
    },
  });
  k.add(roundRect(0, -5.4, 4.7, 0.6, 0.3), 'foam', 2.6, 6, {
    floor: 2.2,
    tag: 'muzzle',
    height: (x) => 3.6 + 2.4 * Math.sqrt(Math.max(0.15, 1 - (x / 5) ** 2)),
  });
  return k.done('weapon_foam', 36);
}

/** EMP Pulse: copper coil ring around a violet core, four charge blocks on the diagonals. */
function emp(): PartArt {
  const k = new Kit();
  const plate = k.add(
    polygon(
      [
        [-2.2, -5.2],
        [2.2, -5.2],
        [5.2, -2.2],
        [5.2, 2.2],
        [2.2, 5.2],
        [-2.2, 5.2],
        [-5.2, 2.2],
        [-5.2, -2.2],
      ],
      0.6,
    ),
    'steelDark',
    0,
    1.4,
  );
  k.bolts(plate, [
    [0, -5],
    [0, 5],
    [-5, 0],
    [5, 0],
  ]);
  const coil = k.banded(annulus(0, 0, 4.5, 2.3), 1.4, [
    [2.6, 'copper'],
    [3.2, 'steelDark'],
    [4.4, 'copper'],
    [5, 'steelDark'],
    [6.2, 'copper'],
  ]);
  k.decal(
    intersect(annulus(0, 0, 4.5, 2.3), (x, y) => Math.abs(Math.sin(Math.atan2(y, x) * 6)) - 0.35),
    coil,
    {
      shade: -1,
    },
  );
  [
    [-3.7, -3.7],
    [3.7, -3.7],
    [3.7, 3.7],
    [-3.7, 3.7],
  ].forEach(([x, y], i) => {
    k.banded(circle(x!, y!, 1.5), 1.4, [
      [5.6, 'gunmetal'],
      [7.6, 'violet'],
    ]);
    k.post(x!, y!, 1.5, 7.6, 8.2, 'violetGlow', { bevel: 1, floor: 7.4, tag: `charge${i}` });
  });
  k.banded(circle(0, 0, 2.1), 1.4, [
    [8, 'gunmetal'],
    [9.4, 'steel'],
  ]);
  k.post(0, 0, 2.1, 9.4, 11.6, 'violet', { bevel: 2, floor: 9.2, tag: 'core' });
  return k.done('weapon_emp', 32);
}

/** Tesla Arc: two tall ribbed insulators topped with fat copper ball electrodes. */
function tesla(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 3.8, 3.2, 0, 1.6, 'gunmetal', { r: 1.2, bevel: 0.6 });
  k.bolts(base, [
    [0, -2.4],
    [0, 2.4],
  ]);
  k.block(0, 0, 1.1, 1.7, 1.6, 3.8, 'mount');
  for (const x of [-2.2, 2.2]) {
    k.banded(circle(x, 0, 1.6), 1.6, [
      [3.2, 'ivory'],
      [3.9, 'mount'],
      [5.5, 'ivory'],
      [6.2, 'mount'],
      [7.8, 'ivory'],
      [8.6, 'mount'],
    ]);
    k.post(x, 0, 1.8, 8.6, 11.6, 'brass', { bevel: 1.8, floor: 8.6, tag: 'electrode' });
    k.post(x, 0, 0.85, 11.6, 12.2, 'violetGlow', { floor: 11.2, tag: 'spark', noShadow: true });
  }
  return k.done('weapon_tesla', 32);
}

/** Flame Spitter: red fuel bottle at the back, thin pipe to a scorched nozzle, pilot light. */
function flame(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.4, 3.3, 5.2, 0, 1.2, 'steelDark', { r: 1 });
  k.bolts(base, corners(2.5, 4.4, 0, 1.4), 0.5);
  k.banded(circle(0, 3.8, 2.9), 1.2, [
    [2.4, 'steelDark'],
    [8, 'coral'],
  ]);
  k.post(0, 3.8, 2.9, 8, 9.4, 'coral', { bevel: 2.4, floor: 7.8 });
  k.post(0, 3.8, 1, 9.4, 10.6, 'steel', { floor: 9 });
  k.block(0, -2.2, 1.4, 0.7, 0, 2.6, 'steelDark');
  k.tube(0, 1.6, 0, -4.4, 1.25, 3.9, 3.9, 'gunmetal');
  k.tube(0, -4, 0, -5.6, 1.9, 3.9, 3.9, 'steelDark', { tag: 'nozzle' });
  k.tube(0, -5.4, 0, -7, 2.1, 3.9, 3.9, 'amber', { tag: 'muzzle' });
  k.block(2.2, -5.8, 0.8, 0.8, 4.4, 6.2, 'hot', { floor: 4, tag: 'pilot', noShadow: true });
  return k.done('weapon_flame', 32);
}

/** Frost Cannon: blue coolant tank across the back, fat frost-white barrel, icy muzzle ring. */
function frost(): PartArt {
  const k = new Kit();
  const base = k.block(0, 2.2, 3.3, 4.4, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.5, 3.6, 0, 2.2), 0.5);
  k.block(0, -3, 2.2, 0.6, 0, 3.2, 'mount');
  const tank = k.tube(-3.7, 4.6, 3.7, 4.6, 2.3, 4.2, 4.2, 'nitro', { web: 0.6, tag: 'tank' });
  k.decal(union(strip(-3, -2.2), strip(2.2, 3)), tank, { material: 'iron' });
  k.block(0, 2.4, 1.9, 0.9, 1.2, 4.6, 'gunmetal');
  const barrel = k.tube(0, 2.6, 0, -5.2, 2.2, 4.6, 4.6, 'frost', { tag: 'barrel' });
  k.decal(
    intersect(bar(0, 2.6, 0, -5.2, 2.2), (_x, y) => Math.abs(y + 1.4) - 0.5),
    barrel,
    {
      material: 'cyan',
    },
  );
  k.tube(0, -5, 0, -7, 2.6, 4.6, 4.6, 'cyanGlow', { tag: 'muzzle' });
  return k.done('weapon_frost', 32);
}

/** Crash Hammer: a giant mallet on a sprung arm, hinged at the back, striped striking faces. */
function hammer(): PartArt {
  const k = new Kit();
  const base = k.block(0, 3.4, 4.2, 4.4, 0, 1.4, 'mount', { r: 1.2 });
  k.bolts(base, corners(3.3, 3.5, 0, 3.4), 0.6);
  for (const x of [-2.5, 2.5]) k.block(x, 6, 0.9, 1.6, 1.4, 6.2, 'gunmetal', { bevel: 0.5 });
  k.tube(-3.6, 6, 3.6, 6, 1.1, 5, 5, 'iron', { tag: 'pivot' });
  k.banded(
    circle(0, 2.2, 1.9),
    1.4,
    [
      [2.2, 'amber'],
      [2.7, 'mount'],
      [3.5, 'amber'],
      [4, 'mount'],
      [4.8, 'amber'],
    ],
    { tag: 'spring' },
  );
  k.tube(0, 6, 0, -3.6, 1.35, 5, 6.6, 'iron', { tag: 'arm', web: 0.6 });
  const head = k.tube(-5.8, -5.2, 5.8, -5.2, 2.7, 6.6, 6.6, 'gunmetal', { tag: 'head', web: 1.2 });
  k.decal(union(strip(-6, -3.9), strip(3.9, 6)), head, { material: 'hazard' });
  k.decal(intersect(union(strip(-6, -3.9), strip(3.9, 6)), stripes(1.9, 0.95, 1, 1)), head, {
    material: 'bore',
  });
  k.decal(strip(-1.5, 1.5), head, { shade: 1 });
  return k.done('weapon_hammer', 40);
}

/**
 * Side Saw: a toothed circular blade standing on edge along the car's flank, driven from a
 * motor housing with a yellow guard over its back quarter. It is the same from either side
 * mount, because the part cannot be turned.
 */
function saw(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 2.8, 4.8, 0, 1.4, 'mount', { r: 0.8 });
  k.bolts(base, [
    [0, -4],
    [0, 4],
  ]);
  const R = 6;
  const hub = 5;
  k.add(roundRect(0, 0, 0.95, 6.9, 0.2), 'blade', 1.4, hub + R + 1.4, {
    tag: 'teeth',
    height: (_x, y) => {
      const inside = Math.sqrt(Math.max(0, R * R - y * y));
      const angle = Math.atan2(inside, y);
      const tooth = ((((angle * 7) / Math.PI) % 1) + 1) % 1;
      return Math.abs(y) > R ? 2.6 : hub + inside + 1.4 * tooth;
    },
  });
  k.block(0, 0, 2.5, 2.4, 1.4, 5.8, 'gunmetal', { bevel: 0.9, r: 0.8 });
  k.tube(-2.8, 0, 2.8, 0, 1.5, hub + 0.6, hub + 0.6, 'amber', { tag: 'hub', web: 1 });
  k.add(roundRect(0, 4.9, 1.6, 1.9, 0.4), 'hazard', 1.4, 8.6, {
    tag: 'guard',
    height: (_x, y) => 3 + Math.sqrt(Math.max(0, 40 - y * y)),
  });
  return k.done('weapon_saw', 32);
}

/** Grapple Harpoon: rope spool between two flanges, launch rail, broad steel dart, red tip. */
function harpoon(): PartArt {
  const k = new Kit();
  const base = k.block(0, 2.4, 3.3, 4.4, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.5, 3.6, 0, 2.4), 0.5);
  const spool = k.tube(-2.6, 4, 2.6, 4, 2.8, 4.4, 4.4, 'rope', { tag: 'spool', web: 0.5 });
  k.decal(intersect(bar(-2.6, 4, 2.6, 4, 2.8), stripes(1.4, 0.5, 1, 0)), spool, { shade: -1 });
  for (const x of [-3.3, 3.3]) k.block(x, 4, 0.55, 2.9, 1.2, 8, 'iron', { r: 0.3 });
  k.block(0, -1.4, 1.5, 2.6, 0, 3.4, 'gunmetal', { r: 0.4, bevel: 0.5 });
  k.tube(0, 1.6, 0, -3.4, 0.85, 4.2, 4.2, 'rope', { tag: 'rope' });
  k.add(
    polygon([
      [0, -7],
      [3.7, -2.6],
      [1.2, -3.6],
      [-1.2, -3.6],
      [-3.7, -2.6],
    ]),
    'blade',
    3.8,
    5.4,
    { floor: 3.4, tag: 'dart', bevel: 0.9 },
  );
  k.add(
    polygon([
      [0, -7],
      [1.9, -4.8],
      [-1.9, -4.8],
    ]),
    'coral',
    4,
    5.8,
    { floor: 3.4, tag: 'muzzle' },
  );
  return k.done('weapon_harpoon', 36);
}

/** Air Cannon: a big drum widening to a bright open mouth, pressure bottle on its back. */
function air(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1, 4.2, 4.8, 0, 1.2, 'steelDark', { r: 1.2 });
  k.bolts(base, corners(3.3, 3.9, 0, 1), 0.5);
  k.block(0, 1, 3.4, 0.8, 1.2, 3.4, 'steelDark');
  const half = (y: number) => 3 + ((3.6 - y) / 8.2) * 1.7;
  const bell = polygon([
    [-3, 3.6],
    [3, 3.6],
    [4.7, -4.6],
    [-4.7, -4.6],
  ]);
  const drum = k.add(bell, 'gunmetal', 2.4, 10, {
    floor: 2,
    tag: 'drum',
    height: (x, y) => {
      const r = half(Math.max(-4.6, Math.min(3.6, y)));
      return 5.2 + Math.sqrt(Math.max(r * r * 0.1, r * r - x * x));
    },
  });
  k.decal(
    intersect(bell, (_x, y) => Math.abs(y - 1) - 0.6),
    drum,
    { shade: -2 },
  );
  k.decal(
    intersect(bell, (x, y) => Math.max(y + 2.6, Math.abs(x) - 3.4)),
    drum,
    { material: 'bore' },
  );
  k.add(roundRect(0, -5.3, 4.9, 0.7, 0.3), 'amber', 2, 10.4, {
    floor: 1.6,
    tag: 'muzzle',
    height: (x) => 5.2 + Math.sqrt(Math.max(2.5, 26 - x * x)),
  });
  k.tube(-2.6, 4.9, 2.6, 4.9, 1.1, 4.6, 4.6, 'steel', { round: true });
  return k.done('weapon_air', 36);
}

/** Steel Boomerang: a bright hooked blade held flat on a sprung launch arm, apex forward. */
function boomerang(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.2, 4.2, 2.6, 0, 1.4, 'steelDark', { r: 1 });
  k.bolts(base, corners(3.3, 1.8, 0, 1.2), 0.5);
  k.block(0, 1.6, 2, 1.8, 1.4, 4.6, 'gunmetal', { bevel: 0.6 });
  k.banded(circle(0, 0.6, 1.3), 1.4, [
    [5.6, 'gunmetal'],
    [6.4, 'amber'],
  ]);
  const wing = union(bar(0, -2.6, 4.9, 2.6, 1.15, true), bar(0, -2.6, -4.9, 2.6, 1.15, true));
  const blade = k.add(wing, 'blade', 6.4, 7.4, { floor: 6, tag: 'blade', bevel: 0.8 });
  k.decal(
    subtract(wing, union(bar(0, -1.8, 4.6, 3, 0.9, true), bar(0, -1.8, -4.6, 3, 0.9, true))),
    blade,
    {
      shade: 1,
    },
  );
  k.post(0, -1.2, 1.1, 7.4, 8.2, 'amber', { bevel: 0.7, floor: 7.2, tag: 'muzzle' });
  return k.done('weapon_boomerang', 32);
}

/** Arc Mortar: round bolted baseplate, fat tube raised toward the front on a bipod, shells. */
function mortar(): PartArt {
  const k = new Kit();
  const plate = k.post(0, 0.6, 7.2, 0, 1.6, 'steel', { bevel: 0.8 });
  k.decal(annulus(0, 0.6, 6.4, 5.6), plate, { shade: -2 });
  k.bolts(plate, [
    [-5.2, -3],
    [5.2, -3],
    [-5.2, 4.2],
    [5.2, 4.2],
  ]);
  k.post(0, 4.4, 2.6, 1.6, 4.6, 'steelDark', { bevel: 1 });
  for (const x of [-1, 1])
    k.tube(x * 5.2, -2.6, x * 2.4, -3.4, 0.8, 1.6, 8.4, 'steelDark', { round: true });
  const tube = k.tube(0, 4.6, 0, -4.4, 3.1, 4.6, 10.6, 'gunmetal', { tag: 'barrel' });
  k.decal(intersect(bar(0, 4.6, 0, -4.4, 3.1), stripes(3.4, 0.9, 0, 1, 0.5)), tube, { shade: -1 });
  const mouth = k.tube(0, -4.2, 0, -6.2, 3.4, 10.6, 12, 'amber', { tag: 'muzzle' });
  k.decal(ellipse(0, -5.2, 2.3, 1), mouth, { material: 'bore' });
  for (const [x, y] of [
    [4.6, 3.6],
    [-4.6, 3.6],
    [5.6, 1],
  ] as const) {
    k.banded(circle(x, y, 1.15), 1.6, [
      [4.4, 'brass'],
      [5, 'steelDark'],
    ]);
    k.post(x, y, 1.15, 5, 6.4, 'coral', { bevel: 1.1, floor: 5 });
  }
  return k.done('weapon_mortar', 44);
}

export const WEAPON_ART: PartArt[] = [
  frontMg(),
  rearMg(),
  turret(),
  shotgun(),
  railshot(),
  rocket(),
  homing(),
  mine(),
  oil(),
  foam(),
  emp(),
  tesla(),
  flame(),
  frost(),
  hammer(),
  saw(),
  harpoon(),
  air(),
  boomerang(),
  mortar(),
];
