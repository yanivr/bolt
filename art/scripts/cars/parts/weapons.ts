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
 * The twenty weapons of Section 11.5, in pale gunmetal with warm tips.
 *
 * Hero pass. Each weapon is written at about the size of its catalog footprint and finished
 * some 15 to 20 percent larger (`HERO`), with barrels, nozzles and rails that run well past
 * the base it stands on and may overhang its mount. Each has one exaggerated shape that names
 * it from its outline alone, listed above its function. The business end points toward
 * negative Y, quarter turn 0, and carries the brightest accent, so the way a weapon was
 * turned can be read at a glance.
 *
 * Every weapon marks where its shots start (`muzzle`, one per barrel in firing order); the
 * turret also marks the axis its head turns about (`pivot`). The elements Section 13.4
 * animates keep their tags: `muzzle`, `barrel`, `charge0..`, `hatch`, `spool`, `nozzle`,
 * `pilot`, `arm`, `spring`, `teeth`, `sensor`, `blink`.
 *
 * Road Mine and Oil Slick have a fixed facing, quarter turn 2: they are modelled like every
 * other weapon, business end toward negative Y, and the turn points it behind the car. The
 * Side Saw's fixed facing is outward: its blade is toward negative Y and the turn swings it
 * out over the flank it is mounted on.
 */

/** How much larger than written a weapon is drawn. */
const HERO = 1.18;

/** Front Machine Gun. Signature: twin long barrels beside a fat brass ammo box. */
function frontMg(): PartArt {
  const k = new Kit();
  const base = k.block(0, 3.2, 3.8, 3, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(3, 2.2, 0, 3.2), 0.5);
  k.block(-0.9, -3, 2.6, 0.6, 0, 3.3, 'mount');
  const rec = k.block(-0.9, 3.2, 2.7, 2.7, 1.2, 5.9, 'gunmetal', { bevel: 1, r: 0.9 });
  k.decal(roundRect(-0.9, 4.4, 1.7, 0.5, 0.2), rec, { shade: -2 });
  const ammo = k.block(2.9, 2.9, 1.45, 2.9, 1.2, 8, 'brass', { r: 0.4 });
  k.decal(roundRect(2.9, 2.9, 0.7, 2.2, 0.2), ammo, { shade: 1 });
  k.decal(roundRect(2.9, 2.9, 1.45, 0.35, 0), ammo, { shade: -2 });
  for (const x of [-2.3, 0.5]) {
    const barrel = k.tube(x, 1.4, x, -7.8, 1.05, 4.9, 4.9, 'iron', { tag: 'barrel' });
    k.decal(intersect(bar(x, 0.4, x, -3, 1.05), stripes(1.3, 0.55, 0, 1)), barrel, { shade: -2 });
    k.tube(x, -7.5, x, -9.4, 1.35, 4.9, 4.9, 'amber', { tag: 'muzzle' });
    k.muzzle(x, -9.4, 4.9);
  }
  return k.done('weapon_front_mg', 44, { scale: HERO });
}

/** Rear Sentry. Signature: a round drum with one big amber eye and a single stub gun. */
function rearMg(): PartArt {
  const k = new Kit();
  const base = k.post(0, 1, 4, 0, 1.4, 'mount');
  k.bolts(base, [
    [-3.2, 1],
    [3.2, 1],
    [0, 4.2],
  ]);
  k.banded(circle(0, 1.2, 3.3), 1.4, [
    [2.4, 'mount'],
    [5.2, 'gunmetal'],
  ]);
  k.post(0, 1.2, 3.3, 5.2, 6.4, 'gunmetal', { bevel: 1.5, floor: 5, tag: 'turret' });
  k.post(0, 1.9, 2.1, 6.4, 8.2, 'ledAmber', { bevel: 1.4, floor: 6.2, tag: 'sensor' });
  k.post(0, 1.9, 0.8, 8.2, 8.6, 'bore', { floor: 8, noShadow: true });
  k.block(0, -1.9, 1.7, 0.7, 2.4, 6, 'mount', { floor: 2.2 });
  k.tube(0, -1.2, 0, -6.4, 1.25, 4.5, 4.5, 'iron', { tag: 'barrel' });
  k.tube(0, -6.1, 0, -8, 1.6, 4.5, 4.5, 'amber', { tag: 'muzzle' });
  k.muzzle(0, -8, 4.5);
  return k.done('weapon_rear_mg', 40, { scale: HERO });
}

/** Swivel Turret. Signature: a tall domed turret on a bright ring, one long cannon. */
function turret(): PartArt {
  const k = new Kit();
  const ring = k.post(0, 0.8, 5.6, 0, 1.8, 'iron', { bevel: 0.7 });
  k.bolts(
    ring,
    [
      [-4.7, 0.8],
      [4.7, 0.8],
      [-3, -3.2],
      [3, -3.2],
      [-3, 4.8],
      [3, 4.8],
    ],
    0.6,
    -3,
  );
  k.banded(circle(0, 1.2, 4), 1.8, [
    [3, 'mount'],
    [7.6, 'gunmetal'],
  ]);
  const top = k.post(0, 1.2, 4, 7.6, 9.8, 'gunmetal', { bevel: 2.2, floor: 7.4, tag: 'turret' });
  k.decal(circle(1, 2.4, 1.8), top, { shade: 1 });
  k.decal(annulus(1, 2.4, 1.8, 1.2), top, { shade: -2 });
  k.decal(circle(-2, 0.8, 0.8), top, { material: 'ledRed' });
  k.block(0, -2.6, 2.3, 1.1, 5.4, 9.4, 'mount', { floor: 5.2, tag: 'mantlet' });
  k.tube(0, -2.4, 0, -8.4, 1.35, 7.6, 7.6, 'iron', { tag: 'barrel' });
  k.tube(0, -5.2, 0, -6.2, 1.7, 7.6, 7.6, 'gunmetal', { tag: 'barrel' });
  k.tube(0, -8.1, 0, -10.4, 1.9, 7.6, 7.6, 'amber', { tag: 'muzzle' });
  k.muzzle(0, -10.4, 7.6);
  k.pivot(0, 1.2, 3);
  return k.done('weapon_turret', 52, { scale: 1.14 });
}

/** Road Shotgun. Signature: a short fat barrel that opens into a very wide flared mouth. */
function shotgun(): PartArt {
  const k = new Kit();
  const base = k.block(0, 3, 3.6, 3, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.8, 2.2, 0, 3), 0.5);
  const rec = k.block(0, 3.6, 3, 2.5, 1.2, 6, 'gunmetal', { bevel: 0.9, r: 0.8 });
  for (const x of [-1.6, 0, 1.6])
    k.decal(roundRect(x, 3.8, 0.55, 1.4, 0.3), rec, { material: 'brass' });
  k.block(0, -1.4, 1.8, 0.6, 0, 2.6, 'mount');
  const flare = polygon([
    [-2.2, 1.6],
    [2.2, 1.6],
    [2.4, -2],
    [4.9, -6],
    [-4.9, -6],
    [-2.4, -2],
  ]);
  const halfAt = (y: number) => (y > -2 ? 2.3 : 2.3 + ((-2 - y) / 4) * 2.6);
  const barrel = k.add(flare, 'iron', 3, 6.8, {
    floor: 2.6,
    tag: 'barrel',
    height: (x, y) => 4 + 2.8 * Math.sqrt(Math.max(0.12, 1 - (x / (halfAt(y) + 0.2)) ** 2)),
  });
  k.decal(
    intersect(flare, (_x, y) => y + 3.8),
    barrel,
    { material: 'bore' },
  );
  k.decal(
    intersect(flare, (_x, y) => Math.abs(y + 0.6) - 0.45),
    barrel,
    { shade: -2 },
  );
  k.add(roundRect(0, -6.7, 5.1, 0.8, 0.3), 'amber', 3, 7.2, {
    floor: 2.4,
    tag: 'muzzle',
    height: (x) => 4 + 3.1 * Math.sqrt(Math.max(0.12, 1 - (x / 5.5) ** 2)),
  });
  k.muzzle(0, -7.4, 5);
  return k.done('weapon_shotgun', 40, { scale: HERO });
}

/** Needle Railgun. Signature: two very long thin rails over a row of glowing charge cells. */
function railshot(): PartArt {
  const k = new Kit();
  const base = k.block(0, 5.8, 3.4, 3.2, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.6, 2.4, 0, 5.8), 0.5);
  const cap = k.block(0, 6.2, 3.6, 2.9, 1.2, 7.6, 'gunmetal', { bevel: 1, r: 0.9 });
  k.decal(roundRect(0, 6.2, 2.2, 1.4, 0.4), cap, { material: 'cyanGlow' });
  k.block(0, -8.6, 2.9, 0.6, 0, 3.4, 'mount');
  k.block(0, -2.4, 2.9, 0.6, 0, 3.4, 'mount');
  k.tube(0, 3.6, 0, -10.4, 1.3, 3.2, 3.2, 'mount', { tag: 'spine' });
  for (let i = 0; i < 6; i++) {
    const y = 2 - i * 2.3;
    k.add(roundRect(0, y, 1.2, 0.75, 0.2), 'cyanGlow', 3.4, 5.2, {
      floor: 3.2,
      tag: `charge${i}`,
      noShadow: true,
    });
  }
  for (const x of [-2.5, 2.5]) {
    k.tube(x, 3.6, x, -11, 0.9, 4.7, 4.7, 'iron', { tag: 'rail' });
    k.tube(x, -10.7, x, -12.6, 1.1, 4.7, 4.7, 'amber', { tag: 'muzzle' });
  }
  k.muzzle(0, -12.6, 4.7);
  return k.done('weapon_railshot', 46, { scale: 1.12 });
}

/** Straight Rocket. Signature: one fat launch tube with a big red warhead out of its mouth. */
function rocket(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.8, 3.3, 4.6, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.5, 3.8, 0, 1.8), 0.5);
  k.block(0, -1.4, 3.4, 0.7, 1.2, 4.2, 'mount');
  k.block(0, 4.8, 3.4, 0.7, 1.2, 4.2, 'mount');
  const body = bar(0, 6.6, 0, -3.6, 3.1);
  const tube = k.tube(0, 6.6, 0, -3.6, 3.1, 5.6, 5.6, 'gunmetal', { web: 0.3, tag: 'tube' });
  k.decal(
    intersect(body, (_x, y) => Math.abs(y - 1.8) - 0.5),
    tube,
    { shade: -2 },
  );
  k.decal(
    intersect(body, (_x, y) => 5.7 - y),
    tube,
    { material: 'amber' },
  );
  k.tube(0, -3.2, 0, -4.6, 3.4, 5.6, 5.6, 'iron', { tag: 'muzzle' });
  // The warhead: a red cone, widest where it leaves the tube.
  const nose = polygon([
    [-2.5, -4.4],
    [2.5, -4.4],
    [1.5, -7.2],
    [0, -8.8],
    [-1.5, -7.2],
  ]);
  const noseHalf = (y: number) => Math.max(0.5, 2.6 * Math.min(1, (y + 9) / 3.6));
  const warhead = k.add(nose, 'coral', 3.6, 8.2, {
    floor: 3.2,
    tag: 'warhead',
    height: (x, y) => {
      const r = noseHalf(y);
      return 5.6 + Math.sqrt(Math.max(r * r * 0.1, r * r - x * x));
    },
  });
  k.decal(
    intersect(nose, (_x, y) => Math.abs(y + 5.4) - 0.4),
    warhead,
    { material: 'ivory' },
  );
  k.muzzle(0, -4.6, 5.6);
  return k.done('weapon_rocket', 40, { scale: HERO });
}

/** Seeker Missile. Signature: a raised rack of two white missiles with red noses. */
function homing(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.8, 4.4, 5, 0, 1.2, 'mount', { r: 1.2 });
  k.bolts(base, corners(3.5, 4.1, 0, 1.8), 0.5);
  k.block(0, 5.4, 2.1, 1.6, 1.2, 5.6, 'gunmetal', { bevel: 0.6 });
  k.post(0, 5.4, 1.35, 5.6, 7.4, 'ledRed', { bevel: 0.8, tag: 'sensor', floor: 5.4 });
  k.block(0, -2.6, 4.4, 0.7, 1.2, 6.2, 'mount');
  k.tube(0, 3.4, 0, -3, 1.2, 3.8, 6.6, 'gunmetal', { tag: 'rack' });
  for (const x of [-3, 3]) {
    const missile = k.tube(x, 4.8, x, -5, 1.7, 5.2, 8.6, 'ivory', { tag: 'missile' });
    k.decal(
      intersect(bar(x, 4.8, x, -5, 1.7), (_x, y) => Math.abs(y - 1.2) - 0.45),
      missile,
      { material: 'coral' },
    );
    k.tube(x, -4.8, x, -7.2, 1.65, 8.5, 9.4, 'coral', { round: true, tag: 'nose' });
    k.tube(x, 6, x, 4.4, 2.1, 4.8, 5.4, 'gunmetal');
    k.muzzle(x, -7.2, 9.2);
  }
  return k.done('weapon_homing', 50, { scale: 1.14 });
}

/** Road Mine. Signature: a fat armed mine, red ring and amber blinker, in an open chute. */
function mine(): PartArt {
  const k = new Kit();
  const tray = k.block(0, 0, 4.8, 3.8, 0, 1.2, 'mount', { r: 0.8 });
  k.decal(
    intersect(
      subtract(roundRect(0, -1.3, 4.8, 2.5, 0.6), circle(0, -1.2, 3.4)),
      stripes(2.4, 1.2, 1, 0),
    ),
    tray,
    { material: 'hazard' },
  );
  const box = k.block(0, 2.7, 4.6, 1.1, 1.2, 4.4, 'gunmetal', { bevel: 0.8, r: 0.6 });
  k.bolts(box, [
    [-3.3, 2.7],
    [3.3, 2.7],
  ]);
  // The hatch stands open behind the mine, low enough never to hide it.
  k.ramp(roundRect(0, 1.5, 4.2, 0.5, 0.2), 'iron', 1, 5.6, 2, 4.4, { floor: 4, tag: 'hatch' });
  const body = k.post(0, -1.2, 3.3, 1.2, 4.6, 'oil', { bevel: 1.1, tag: 'mine' });
  k.decal(annulus(0, -1.2, 2.9, 1.6), body, { material: 'coral' });
  for (const [x, y] of [
    [-3.1, -1.2],
    [3.1, -1.2],
    [0, -4.3],
  ] as const)
    k.post(x, y, 0.7, 1.2, 5.2, 'iron', { tag: 'mine' });
  k.post(0, -1.2, 1.4, 4.6, 6.2, 'ledAmber', { bevel: 0.8, floor: 4.4, tag: 'blink' });
  k.muzzle(0, -4.6, 1.2);
  return k.done('weapon_mine', 28, { scale: 1.14 });
}

/** Oil Slick. Signature: a black drum with amber bands lying across a wide spill fan. */
function oil(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0.8, 4.6, 3, 0, 1.2, 'mount', { r: 0.8 });
  k.bolts(base, corners(3.8, 2.3, 0, 0.8), 0.5);
  for (const x of [-2.6, 2.6]) k.block(x, 1.2, 0.7, 2.6, 1.2, 3.4, 'mount');
  const drum = k.tube(-5, 1.2, 5, 1.2, 3, 4.6, 4.6, 'oil', { web: 0.4, tag: 'drum' });
  k.decal(union(strip(-4.2, -2.6), strip(2.6, 4.2)), drum, { material: 'amber' });
  k.decal(circle(0, 1.4, 1.3), drum, { material: 'ivory' });
  k.decal(circle(0, 1.4, 0.6), drum, { material: 'oil' });
  for (const x of [-5.2, 5.2]) k.tube(x - 0.3, 1.2, x + 0.3, 1.2, 3.2, 4.6, 4.6, 'iron');
  const fan = polygon([
    [-1.4, -1.2],
    [1.4, -1.2],
    [4.6, -4.8],
    [-4.6, -4.8],
  ]);
  const nozzle = k.ramp(fan, 'gunmetal', -4.8, 1.6, -1.2, 4.4, { tag: 'nozzle', floor: 1 });
  k.decal(roundRect(0, -4.3, 4.2, 0.7, 0.2), nozzle, { material: 'oil' });
  k.add(ellipse(0, -5.6, 2.4, 1), 'oil', 0, 1.1, { tag: 'nozzle', noShadow: true });
  k.muzzle(0, -4.8, 1.6);
  return k.done('weapon_oil', 36, { scale: 1.14 });
}

/** Sticky Foam. Signature: a tall pale canister feeding a wide, low spray horn. */
function foam(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.2, 4.4, 4.8, 0, 1.2, 'steelDark', { r: 1.2 });
  k.bolts(base, corners(3.5, 3.9, 0, 1.2), 0.5);
  const can = k.banded(circle(0, 3.2, 3.2), 1.2, [
    [3, 'steelDark'],
    [6.8, 'foam'],
    [7.8, 'steelDark'],
    [10.2, 'foam'],
  ]);
  k.decal(annulus(0, 3.2, 3.3, 2.3), can, { shade: -1 });
  k.post(0, 3.2, 1.3, 10.2, 11.6, 'steel', { bevel: 0.7, floor: 10 });
  k.tube(0, 0.8, 0, -2.2, 1.4, 4.2, 4.2, 'steel');
  const horn = polygon([
    [-1.5, -1.8],
    [1.5, -1.8],
    [5.2, -6],
    [-5.2, -6],
  ]);
  k.add(horn, 'gunmetal', 2.6, 5.8, {
    floor: 2.4,
    tag: 'nozzle',
    height: (x, y) => {
      const half = 1.6 + ((-1.8 - y) / 4.2) * 3.7;
      return 3.6 + 2.2 * Math.sqrt(Math.max(0.15, 1 - (x / (half + 0.3)) ** 2));
    },
  });
  k.add(roundRect(0, -6.5, 5.3, 0.7, 0.3), 'foam', 2.6, 6.2, {
    floor: 2.2,
    tag: 'muzzle',
    height: (x) => 3.6 + 2.6 * Math.sqrt(Math.max(0.15, 1 - (x / 5.6) ** 2)),
  });
  k.muzzle(0, -7.2, 4.4);
  return k.done('weapon_foam', 42, { scale: 1.14 });
}

/** EMP Pulse. Signature: a copper coil ring around a tall violet core, four charge posts. */
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
  const coil = k.banded(annulus(0, 0, 4.6, 2.3), 1.4, [
    [2.6, 'copper'],
    [3.2, 'steelDark'],
    [4.4, 'copper'],
    [5, 'steelDark'],
    [6.4, 'copper'],
  ]);
  k.decal(
    intersect(annulus(0, 0, 4.6, 2.3), (x, y) => Math.abs(Math.sin(Math.atan2(y, x) * 6)) - 0.35),
    coil,
    {
      shade: -1,
    },
  );
  [
    [-3.8, -3.8],
    [3.8, -3.8],
    [3.8, 3.8],
    [-3.8, 3.8],
  ].forEach(([x, y], i) => {
    k.banded(circle(x!, y!, 1.5), 1.4, [
      [5.8, 'gunmetal'],
      [7.8, 'violet'],
    ]);
    k.post(x!, y!, 1.5, 7.8, 8.6, 'violetGlow', { bevel: 1, floor: 7.6, tag: `charge${i}` });
  });
  k.banded(circle(0, 0, 2.2), 1.4, [
    [8.4, 'gunmetal'],
    [9.8, 'iron'],
  ]);
  k.post(0, 0, 2.2, 9.8, 13, 'violet', { bevel: 2.2, floor: 9.6, tag: 'core' });
  k.post(0, 0, 0.9, 13, 13.6, 'violetGlow', { floor: 12.6, tag: 'core', noShadow: true });
  k.muzzle(0, 0, 13);
  return k.done('weapon_emp', 38, { scale: 1.12 });
}

/** Tesla Arc. Signature: two tall ribbed insulators topped with fat brass ball electrodes. */
function tesla(): PartArt {
  const k = new Kit();
  const base = k.block(0, 0, 4, 3.3, 0, 1.6, 'gunmetal', { r: 1.2, bevel: 0.6 });
  k.bolts(base, [
    [0, -2.5],
    [0, 2.5],
  ]);
  k.block(0, 0, 1.1, 1.8, 1.6, 4, 'mount');
  for (const x of [-2.4, 2.4]) {
    k.banded(circle(x, 0, 1.6), 1.6, [
      [3.4, 'ivory'],
      [4.1, 'mount'],
      [5.9, 'ivory'],
      [6.6, 'mount'],
      [8.4, 'ivory'],
      [9.2, 'mount'],
    ]);
    k.post(x, 0, 2.1, 9.2, 12.8, 'brass', { bevel: 2.1, floor: 9.2, tag: 'electrode' });
    k.post(x, 0, 0.9, 12.8, 13.6, 'violetGlow', { floor: 12.4, tag: 'spark', noShadow: true });
    k.muzzle(x, 0, 13);
  }
  return k.done('weapon_tesla', 44, { scale: 1.16 });
}

/** Flame Spitter. Signature: a red fuel bottle and a long thin lance with a lit pilot. */
function flame(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.8, 3.3, 5, 0, 1.2, 'steelDark', { r: 1 });
  k.bolts(base, corners(2.5, 4.2, 0, 1.8), 0.5);
  k.banded(circle(0, 4.2, 3.1), 1.2, [
    [2.4, 'steelDark'],
    [8.4, 'coral'],
  ]);
  const cap = k.post(0, 4.2, 3.1, 8.4, 10, 'coral', { bevel: 2.6, floor: 8.2 });
  k.decal(annulus(0, 4.2, 3.2, 2.4), cap, { material: 'ivory' });
  k.post(0, 4.2, 1.1, 10, 11.4, 'steel', { floor: 9.6 });
  k.block(0, -2.4, 1.5, 0.7, 0, 2.8, 'steelDark');
  k.block(0, -6.4, 1.3, 0.6, 0, 2.8, 'steelDark');
  k.tube(0, 1.8, 0, -7.4, 1.15, 4, 4, 'gunmetal', { tag: 'barrel' });
  k.tube(0, -7, 0, -9, 1.9, 4, 4, 'steelDark', { tag: 'nozzle' });
  k.tube(0, -8.8, 0, -10.4, 2.2, 4, 4, 'amber', { tag: 'muzzle' });
  k.block(2.2, -9.2, 0.9, 0.9, 4.4, 6.6, 'hot', { floor: 4, tag: 'pilot', noShadow: true });
  k.muzzle(0, -10.4, 4);
  return k.done('weapon_flame', 44, { scale: 1.14 });
}

/** Frost Cannon. Signature: a fat frost-white barrel with a wide glowing ice ring. */
function frost(): PartArt {
  const k = new Kit();
  const base = k.block(0, 2.4, 3.3, 4.4, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.5, 3.6, 0, 2.4), 0.5);
  k.block(0, -3.4, 2.3, 0.6, 0, 3.2, 'mount');
  const tank = k.tube(-3.8, 5, 3.8, 5, 2.4, 4.4, 4.4, 'nitro', { web: 0.6, tag: 'tank' });
  k.decal(union(strip(-3.3, -2.4), strip(2.4, 3.3)), tank, { material: 'iron' });
  k.block(0, 2.6, 2, 0.9, 1.2, 4.8, 'gunmetal');
  const barrel = k.tube(0, 2.8, 0, -6.6, 2.1, 4.8, 4.8, 'frost', { tag: 'barrel' });
  k.decal(
    intersect(bar(0, 2.8, 0, -6.6, 2.3), (_x, y) => Math.abs(y + 0.4) - 0.5),
    barrel,
    {
      material: 'cyan',
    },
  );
  k.decal(
    intersect(bar(0, 2.8, 0, -6.6, 2.3), (_x, y) => Math.abs(y + 3.6) - 0.5),
    barrel,
    {
      material: 'cyan',
    },
  );
  k.tube(0, -6.4, 0, -8.8, 2.7, 4.8, 4.8, 'cyanGlow', { tag: 'muzzle' });
  k.tube(0, -8.6, 0, -9.2, 1.9, 4.8, 4.8, 'bore', { tag: 'muzzle', noShadow: true });
  k.muzzle(0, -9.2, 4.8);
  return k.done('weapon_frost', 42, { scale: 1.14 });
}

/** Crash Hammer. Signature: a giant striped mallet head across the front of a sprung arm. */
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
  k.tube(0, 6, 0, -4.2, 1.35, 5, 6.8, 'iron', { tag: 'arm', web: 0.6 });
  const head = k.tube(-6.4, -6, 6.4, -6, 3, 6.8, 6.8, 'gunmetal', { tag: 'head', web: 1.2 });
  k.decal(union(strip(-6.6, -4.1), strip(4.1, 6.6)), head, { material: 'hazard' });
  k.decal(intersect(union(strip(-6.6, -4.1), strip(4.1, 6.6)), stripes(1.9, 0.95, 1, 1)), head, {
    material: 'bore',
  });
  k.decal(strip(-1.6, 1.6), head, { shade: 1 });
  k.muzzle(0, -9, 6.8);
  return k.done('weapon_hammer', 46, { scale: 1.1 });
}

/**
 * Side Saw. Signature: a toothed circular blade lying flat and reaching well out past the
 * car's flank, from under a yellow guard on its motor. The blade is toward negative Y; the
 * part's fixed facing turns that outward on whichever side it is mounted.
 */
function saw(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.2, 5.4, 1.8, 0, 1.4, 'mount', { r: 0.8 });
  k.bolts(base, [
    [-4.4, 1.2],
    [4.4, 1.2],
  ]);
  const R = 5.6;
  const cy = -3.4;
  const toothed = (x: number, y: number) => {
    const dx = x;
    const dy = y - cy;
    const angle = Math.atan2(dy, dx);
    const tooth = ((((angle * 8) / Math.PI) % 1) + 1) % 1;
    return Math.hypot(dx, dy) - (R - 1.5 * tooth);
  };
  const blade = k.add(toothed, 'blade', 2.6, 3.4, { tag: 'teeth', floor: 2.2 });
  k.decal(annulus(0, cy, 3.6, 3), blade, { shade: -2 });
  k.decal(circle(0, cy, 1.9), blade, { shade: -1 });
  k.post(0, cy, 1.5, 3.4, 4.6, 'amber', { bevel: 0.8, floor: 3.2, tag: 'hub' });
  k.block(0, 1.4, 3.6, 1.7, 1.4, 5.6, 'gunmetal', { bevel: 0.9, r: 0.8 });
  k.tube(0, 1, 0, cy, 1.2, 4.2, 4.2, 'gunmetal', { tag: 'arm' });
  // The guard: a yellow hood over the half of the blade nearest the car.
  const hood = intersect(circle(0, cy, R + 0.5), (_x, y) => -0.9 - y);
  k.add(hood, 'hazard', 3.6, 5.2, { floor: 3.4, tag: 'guard', bevel: 0.7 });
  k.decal(intersect(hood, stripes(2.6, 1.3, 1, 0)), 'guard', { material: 'bore' });
  k.muzzle(0, cy - R, 3);
  return k.done('weapon_saw', 34, { scale: 1.1 });
}

/** Grapple Harpoon. Signature: a broad barbed dart on a long shaft ahead of a rope spool. */
function harpoon(): PartArt {
  const k = new Kit();
  const base = k.block(0, 2.6, 3.3, 4.4, 0, 1.2, 'mount', { r: 1 });
  k.bolts(base, corners(2.5, 3.6, 0, 2.6), 0.5);
  const spool = k.tube(-2.7, 4.4, 2.7, 4.4, 3, 4.6, 4.6, 'rope', { tag: 'spool', web: 0.5 });
  k.decal(intersect(bar(-2.7, 4.4, 2.7, 4.4, 3), stripes(1.4, 0.5, 1, 0)), spool, { shade: -1 });
  for (const x of [-3.4, 3.4]) k.block(x, 4.4, 0.55, 3.1, 1.2, 8.4, 'iron', { r: 0.3 });
  k.block(0, -1.2, 1.6, 2.8, 0, 3.4, 'gunmetal', { r: 0.4, bevel: 0.5 });
  k.tube(0, 1.8, 0, -6, 0.8, 4.2, 4.2, 'iron', { tag: 'rope' });
  k.add(
    polygon([
      [0, -10.6],
      [4.4, -4.6],
      [1.3, -6],
      [-1.3, -6],
      [-4.4, -4.6],
    ]),
    'blade',
    3.8,
    5.4,
    { floor: 3.4, tag: 'dart', bevel: 0.9 },
  );
  k.add(
    polygon([
      [0, -10.6],
      [2.2, -7.8],
      [-2.2, -7.8],
    ]),
    'coral',
    4,
    5.8,
    { floor: 3.4, tag: 'muzzle' },
  );
  k.muzzle(0, -10.6, 4.4);
  return k.done('weapon_harpoon', 42, { scale: 1.14 });
}

/** Air Cannon. Signature: a big drum that widens to a bright open bell mouth. */
function air(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.2, 4.2, 4.8, 0, 1.2, 'steelDark', { r: 1.2 });
  k.bolts(base, corners(3.3, 3.9, 0, 1.2), 0.5);
  k.block(0, 1.2, 3.6, 0.8, 1.2, 3.4, 'steelDark');
  const half = (y: number) => 3 + ((3.8 - y) / 9.4) * 2.6;
  const bell = polygon([
    [-3, 3.8],
    [3, 3.8],
    [5.6, -5.6],
    [-5.6, -5.6],
  ]);
  const drum = k.add(bell, 'gunmetal', 2.4, 11, {
    floor: 2,
    tag: 'drum',
    height: (x, y) => {
      const r = half(Math.max(-5.6, Math.min(3.8, y)));
      return 5.4 + Math.sqrt(Math.max(r * r * 0.1, r * r - x * x));
    },
  });
  k.decal(
    intersect(bell, (_x, y) => Math.abs(y - 1.2) - 0.6),
    drum,
    { shade: -2 },
  );
  k.decal(
    intersect(bell, (x, y) => Math.max(y + 3.2, Math.abs(x) - 4.2)),
    drum,
    { material: 'bore' },
  );
  k.add(roundRect(0, -6.3, 5.8, 0.7, 0.3), 'amber', 2, 11.6, {
    floor: 1.6,
    tag: 'muzzle',
    height: (x) => 5.4 + Math.sqrt(Math.max(3, 36 - x * x)),
  });
  k.tube(-2.8, 5.2, 2.8, 5.2, 1.3, 4.8, 4.8, 'steel', { round: true });
  k.muzzle(0, -7, 5.4);
  return k.done('weapon_air', 44, { scale: 1.12 });
}

/** Steel Boomerang. Signature: a wide bright V blade held flat above a launch arm. */
function boomerang(): PartArt {
  const k = new Kit();
  const base = k.block(0, 1.4, 4.2, 2.6, 0, 1.4, 'steelDark', { r: 1 });
  k.bolts(base, corners(3.3, 1.8, 0, 1.4), 0.5);
  k.block(0, 1.8, 2.1, 1.9, 1.4, 4.8, 'gunmetal', { bevel: 0.6 });
  k.banded(circle(0, 0.6, 1.4), 1.4, [
    [5.8, 'gunmetal'],
    [6.6, 'amber'],
  ]);
  const wing = union(bar(0, -3.6, 6.2, 2.8, 1.35, true), bar(0, -3.6, -6.2, 2.8, 1.35, true));
  const blade = k.add(wing, 'blade', 6.6, 7.6, { floor: 6.2, tag: 'blade', bevel: 0.8 });
  k.decal(
    subtract(wing, union(bar(0, -2.6, 5.8, 3.3, 1.05, true), bar(0, -2.6, -5.8, 3.3, 1.05, true))),
    blade,
    {
      shade: 1,
    },
  );
  k.post(0, -2, 1.3, 7.6, 8.6, 'amber', { bevel: 0.8, floor: 7.4, tag: 'muzzle' });
  k.muzzle(0, -4.9, 7.1);
  return k.done('weapon_boomerang', 40, { scale: 1.14 });
}

/** Arc Mortar. Signature: a fat tube raised on a bipod over a round baseplate, shells beside. */
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
  const tube = k.tube(0, 4.6, 0, -4.8, 3.3, 4.6, 11.4, 'gunmetal', { tag: 'barrel' });
  k.decal(intersect(bar(0, 4.6, 0, -4.8, 3.3), stripes(3.4, 0.9, 0, 1, 0.5)), tube, { shade: -1 });
  const mouth = k.tube(0, -4.6, 0, -6.8, 3.7, 11.4, 13, 'amber', { tag: 'muzzle' });
  k.decal(ellipse(0, -5.7, 2.5, 1.1), mouth, { material: 'bore' });
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
  k.muzzle(0, -6.8, 12.2);
  return k.done('weapon_mortar', 52, { scale: 1.08 });
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
