import type { RaceEvent } from '@bolt/shared';
import { SIM_DT, TAU } from '@bolt/shared';
import { MODE_FIXED, MODE_LOOP } from '../vfx/EffectPool.js';
import {
  PAL_AMBER,
  PAL_CYAN,
  PAL_DUST,
  PAL_EMBER,
  PAL_FOAM,
  PAL_ICE,
  PAL_MINT,
  PAL_OIL,
  PAL_RED,
  PAL_SPARK,
  PAL_STEEL,
  PAL_VIOLET,
  PAL_WHITE,
  PLANE_AIR,
  PLANE_GROUND,
  SHAPE_BEAM,
  SHAPE_BOLT,
  SHAPE_CONE,
  SHAPE_DOTS,
  SHAPE_NEEDLE,
  SHAPE_RETICLE,
  SHAPE_SQUARE,
  SHAPE_STRIPES,
} from '../vfx/PixelFx.js';
import { LAYER_BODY, LAYER_FIRE, LAYER_FLASH, LAYER_SMOKE } from '../vfx/atlas.js';
import type { AnimName } from '../vfx/recipes.js';
import type { CombatStage, ProjectileView } from './stage.js';
import { STREAM_FLAME, STREAM_SAW } from './stage.js';

/**
 * The identity of each weapon (Section 13.4): how it winds up, what leaves it, what flies,
 * what the hit looks like and what stays behind. One entry per catalog weapon; a unit test
 * fails if a weapon has none or if two weapons draw the same set of effects.
 *
 * Handlers are called with `s.at` already on the right spot for `hit`, `explosion` and
 * `impact`. Everything else finds its own place from the event.
 */

type E<T extends RaceEvent['type']> = Extract<RaceEvent, { type: T }>;

export type WeaponFx = {
  /** Strip of the thing in flight. */
  projectile?: AnimName;
  /** Called while its projectile flies; returns the seconds until the next call. */
  trail?: (s: CombatStage, view: ProjectileView) => number;
  windup?: (s: CombatStage, e: E<'windup'>) => void;
  shot: (s: CombatStage, e: E<'shot'>) => void;
  beam?: (s: CombatStage, e: E<'beam'>) => void;
  area?: (s: CombatStage, e: E<'area'>) => void;
  telegraph?: (s: CombatStage, e: E<'telegraph'>) => void;
  lock?: (s: CombatStage, e: E<'lock'>) => void;
  /**
   * The contact itself. `e` is null for a strike that does no damage and so has no `hit`
   * event (the frost shell). `dir` is the heading the blow travelled along.
   */
  hit: (s: CombatStage, e: E<'hit'> | null, dir: number) => void;
  explosion?: (s: CombatStage, e: E<'explosion'>) => void;
  impact?: (s: CombatStage, e: E<'impact'>) => void;
  impulse?: (s: CombatStage, e: E<'impulse'>) => void;
};

/** A directional flash fixed to a muzzle. Returns the heading it points along. */
function muzzle(
  s: CombatStage,
  e: { car: number; part: number },
  anim: AnimName,
  barrel = 0,
  layer = -1,
): number {
  const heading = s.atMuzzle(e.car, e.part, barrel);
  const slot = s.onCar(s.a[anim], s.at, layer);
  if (slot >= 0) {
    s.pool.aim(slot, heading);
    if (s.reduceFlashes && s.atlas.manifest.anims[anim]!.blend === 'add') s.pool.alpha[slot] = 0.6;
  }
  return heading;
}

/** A spent case flicked out to the side of the gun: it arcs, bounces and lies on the road. */
function casing(s: CombatStage, heading: number, side: number): void {
  const at = s.at;
  const slot = s.pool.spawn(s.a.casing, at.x, at.y);
  if (slot < 0) return;
  const out = heading + (Math.PI / 2) * side + (s.fx.r() - 0.5) * 0.6;
  s.pool.vx[slot] = Math.sin(out) * 55 + at.vx * 0.8;
  s.pool.vy[slot] = -Math.cos(out) * 55 + at.vy * 0.8;
  s.pool.z[slot] = 8;
  s.pool.vz[slot] = 70 + s.fx.r() * 40;
  s.pool.gravity[slot] = 330;
  s.pool.bounce[slot] = 0.4;
  s.pool.mode[slot] = MODE_LOOP;
  s.pool.life[slot] = 0.7;
  s.pool.fade[slot] = 0.2;
}

/** Light a muzzle throws on the road and on nearby armor for about a tenth of a second. */
function muzzleLight(s: CombatStage, tint: number, big: boolean): void {
  s.fx.glow(
    big ? s.a.glow_m : s.a.glow_s,
    s.at.x,
    s.at.y,
    tint,
    big ? 0.7 : 0.4,
    big ? 0.12 : 0.08,
  );
}

function smokeTrail(s: CombatStage, view: ProjectileView, tint: number, alpha: number): void {
  const back = view.heading + Math.PI;
  s.fx.puff(
    view.x + Math.sin(back) * 9,
    view.y - Math.cos(back) * 9,
    Math.sin(back) * 20,
    -Math.cos(back) * 20,
    tint,
    alpha,
    true,
  );
}

const none = (): void => {};

/** The three bullet guns share a primitive and nothing else: flash, round and hit all differ. */
const frontMg: WeaponFx = {
  projectile: 'tracer_mg',
  shot(s, e) {
    s.fx.seed(e.id);
    // Two barrels fire in turn: five alternating flashes over 0.4 s.
    const heading = muzzle(s, e, 'muzzle_mg', e.n % 2);
    muzzleLight(s, 0xffc070, false);
    casing(s, heading, e.n % 2 === 0 ? -1 : 1);
    s.kickPart(e.car, e.part, 1);
  },
  hit(s, e, dir) {
    // Tiny steel sparks and a chip of paint: the smallest hit in the game.
    s.fx.kinetic(s.at, dir, PAL_SPARK, 2);
    void e;
  },
  impact(s) {
    s.fx.sparks(4, s.at, 40, 120, PAL_SPARK, TAU, 0, 40);
    s.pool.spawn(s.a.chip_puff, s.at.x, s.at.y);
  },
};

const rearSentry: WeaponFx = {
  projectile: 'tracer_sentry',
  windup(s, e) {
    // The mechanical pivot: the drum swings onto its target while its amber eye blinks.
    const seconds = e.ticks * SIM_DT;
    s.swingPart(e.car, e.part, -0.5, 0, seconds);
    s.atMuzzle(e.car, e.part);
    for (let i = 0; i < 3; i++) {
      const slot = s.onCar(s.a.aim_dot, s.at);
      if (slot < 0) continue;
      s.pool.tint[slot] = 0xffc060;
      s.pool.delay[slot] = (i * seconds) / 3;
      s.pool.life[slot] = seconds / 5;
    }
  },
  shot(s, e) {
    s.fx.seed(e.id);
    const heading = muzzle(s, e, 'muzzle_sentry');
    muzzleLight(s, 0xffb454, false);
    // A shower of cases trails behind the car.
    casing(s, heading, 1);
    casing(s, heading, -1);
    s.kickPart(e.car, e.part, 1);
  },
  hit(s, e, dir) {
    // Crisp flecks thrown hard back the way the round came, amber not white.
    s.fx.flash(s.a.flash_s, s.at, 1.4);
    s.fx.sparks(9, s.at, 110, 240, PAL_AMBER, 0.9, dir + Math.PI, 30);
    s.pool.spawn(s.a.chip_puff, s.at.x, s.at.y);
    void e;
  },
  impact(s) {
    s.fx.sparks(4, s.at, 40, 120, PAL_AMBER, TAU, 0, 40);
  },
};

const turret: WeaponFx = {
  projectile: 'tracer_turret',
  lock(s, e) {
    // The short red aim tick: a dot on the target and a dotted sight line from the barrel.
    const target = s.cars[e.target];
    if (!target?.present) return;
    s.atLocal(e.target, 0, 0, 10);
    const slot = s.onCar(s.a.aim_dot, s.at);
    if (slot >= 0) {
      s.pool.mode[slot] = MODE_LOOP;
      s.pool.life[slot] = 0.5;
    }
  },
  shot(s, e) {
    s.fx.seed(e.id);
    const heading = muzzle(s, e, 'muzzle_turret');
    muzzleLight(s, 0xff8a5a, false);
    casing(s, heading, 1);
    // The two-pixel barrel kick.
    s.kickPart(e.car, e.part, 2);
  },
  hit(s, e) {
    // A compact orange blast with a ring of round chips.
    s.fx.compactBlast(s.at, e ? e.id : 1);
  },
  impact(s, e) {
    s.fx.compactBlast(s.at, e.id);
  },
};

const shotgun: WeaponFx = {
  projectile: 'pellet',
  shot(s, e) {
    // Eight pellets leave on one tick; the huge flash is drawn once, for the first.
    if (e.n !== 0) return;
    s.fx.seed(e.id);
    const heading = muzzle(s, e, 'muzzle_shotgun');
    muzzleLight(s, 0xffd08a, true);
    s.kickPart(e.car, e.part, 3);
    s.recoilCar(e.car, -Math.sin(heading), Math.cos(heading), 1);
    s.fx.sparks(8, s.at, 120, 260, PAL_SPARK, 1.1, heading, 20);
    const at = s.at;
    s.fx.puff(
      at.x + Math.sin(heading) * 8,
      at.y - Math.cos(heading) * 8,
      at.vx * 0.6 + Math.sin(heading) * 30,
      at.vy * 0.6 - Math.cos(heading) * 30,
      0xc4cad8,
      0.6,
      false,
    );
    if (e.car === s.you) s.host.kick(1, 0.06);
  },
  hit(s, e, dir) {
    // Several separate small impacts in a fan: each pellet gets its own puff, and no big star.
    s.fx.sparks(3, s.at, 60, 150, PAL_SPARK, 1.8, dir + Math.PI, 40);
    const slot = s.pool.spawn(s.a.chip_puff, s.at.x, s.at.y);
    if (slot >= 0) s.pool.delay[slot] = s.fx.r() * 0.05;
    s.px.pixel(s.at.x, s.at.y, 0, 0, 0.09, PAL_WHITE, 1, 0, 0, 0, 0, -1, 2);
    void e;
  },
  impact(s) {
    s.fx.sparks(2, s.at, 40, 100, PAL_SPARK, TAU, 0, 30);
  },
};

const railgun: WeaponFx = {
  windup(s, e) {
    // Six cells climb the rails as the charge builds.
    s.chargePart(e.car, e.part, e.ticks * SIM_DT);
  },
  shot(s, e) {
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    s.onCar(s.a.flash_cyan, s.at, LAYER_FLASH);
    s.fx.glow(s.a.glow_m, s.at.x, s.at.y, 0x7fe9f5, 0.9, 0.16);
    s.kickPart(e.car, e.part, 4);
    s.recoilCar(e.car, -Math.sin(heading), Math.cos(heading), 1);
    if (e.car === s.you) s.host.kick(1, 0.07);
  },
  beam(s, e) {
    // The sharp cyan shot: an instant line from the muzzle, gone in a quarter of a second.
    s.fx.seed(e.id);
    const px = s.px;
    s.atMuzzle(e.car, e.part);
    const slot = px.shape(SHAPE_BEAM, PLANE_AIR, 0.26, PAL_CYAN, e.id);
    px.sx0[slot] = s.at.ox;
    px.sy0[slot] = s.at.oy;
    px.sFollow0[slot] = e.car;
    const fromX = s.at.x;
    const fromY = s.at.y;
    if (e.hit >= 0) {
      s.atCar(e.hit, e.toX, e.toY, e.tick);
      px.sx1[slot] = s.at.ox;
      px.sy1[slot] = s.at.oy;
      px.sFollow1[slot] = e.hit;
    } else {
      px.sx1[slot] = e.toX;
      px.sy1[slot] = e.toY;
    }
    px.sA[slot] = 1;
    // Cyan flecks hang along the path for a moment.
    const toX = e.hit >= 0 ? s.at.x : e.toX;
    const toY = e.hit >= 0 ? s.at.y : e.toY;
    for (let i = 0; i < px.scaled(10); i++) {
      const k = s.fx.r();
      px.pixel(
        fromX + (toX - fromX) * k,
        fromY + (toY - fromY) * k,
        (s.fx.r() - 0.5) * 30,
        (s.fx.r() - 0.5) * 30,
        0.25 + s.fx.r() * 0.25,
        PAL_CYAN,
        1,
        0,
        0,
        2,
      );
    }
  },
  hit(s, e, dir) {
    // A needle-thin slash across the panel and a concentric square pulse.
    const px = s.px;
    const at = s.at;
    const fx = Math.sin(dir) * 13;
    const fy = -Math.cos(dir) * 13;
    const slash = px.shape(SHAPE_NEEDLE, PLANE_AIR, 0.22, PAL_CYAN, 1);
    px.sx0[slash] = at.ox - fx;
    px.sy0[slash] = at.oy - fy;
    px.sx1[slash] = at.ox + fx;
    px.sy1[slash] = at.oy + fy;
    px.sFollow0[slash] = at.follow;
    px.sFollow1[slash] = at.follow;
    for (let i = 0; i < 2; i++) {
      const square = px.shape(SHAPE_SQUARE, PLANE_AIR, 0.24, PAL_CYAN, 1);
      px.sx0[square] = at.follow >= 0 ? at.ox : at.x;
      px.sy0[square] = at.follow >= 0 ? at.oy : at.y;
      px.sFollow0[square] = at.follow;
      px.sA[square] = 2;
      px.sB[square] = 10 + i * 6;
      px.sDelay[square] = i * 0.07;
    }
    s.fx.sparks(8, at, 80, 200, PAL_CYAN, 1.4, dir, 0);
    s.fx.glow(s.a.glow_s, at.x, at.y, 0x7fe9f5, 0.8, 0.14);
    void e;
  },
};

const rocket: WeaponFx = {
  projectile: 'rocket',
  trail(s, view) {
    // Intermittent smoke: two puffs, a gap, two puffs. The flame flickers on its own clock.
    if (Math.floor(s.clock * 12) % 3 !== 2) smokeTrail(s, view, 0xc4cad8, 0.6);
    const back = view.heading + Math.PI;
    s.px.pixel(
      view.x + Math.sin(back) * 10,
      view.y - Math.cos(back) * 10,
      Math.sin(back) * 30,
      -Math.cos(back) * 30,
      0.2,
      PAL_EMBER,
      1,
      0,
      0,
      2,
    );
    return 0.035;
  },
  shot(s, e) {
    s.fx.seed(e.id);
    const heading = muzzle(s, e, 'backblast', 0, LAYER_FIRE);
    muzzleLight(s, 0xffb060, true);
    s.pool.spawn(s.a.launch_puff, s.at.x, s.at.y);
    s.kickPart(e.car, e.part, 3);
    s.recoilCar(e.car, -Math.sin(heading), Math.cos(heading), 1);
  },
  hit: none,
  explosion(s, e) {
    s.fx.rocketBlast(s.at, Math.max(30, e.radius), e.id);
  },
  impact(s, e) {
    // A rocket that ends without a blast (out of range): a pop of smoke where it died.
    if (e.on === 'expired' || e.on === 'caught') s.fx.popBurst(s.at, PAL_SPARK, e.id);
  },
};

const seeker: WeaponFx = {
  projectile: 'missile',
  trail(s, view) {
    // The swerving pixel exhaust: a dotted line that keeps the curve the missile flew.
    const back = view.heading + Math.PI;
    s.px.pixel(
      view.x + Math.sin(back) * 8,
      view.y - Math.cos(back) * 8,
      0,
      0,
      0.5,
      PAL_RED,
      1,
      0,
      0,
      0,
      0,
      -1,
      2,
    );
    if (Math.floor(s.clock * 20) % 2 === 0) smokeTrail(s, view, 0xf2f4fa, 0.45);
    return 0.03;
  },
  lock(s, e) {
    // Small red target brackets close on the car and stay while the lock holds.
    s.setLock(e.car, e.part, e.target, true);
  },
  shot(s, e) {
    s.fx.seed(e.id);
    muzzle(s, e, 'backblast', e.n % 2, LAYER_FIRE);
    muzzleLight(s, 0xff9ac0, false);
    s.kickPart(e.car, e.part, 2);
  },
  hit: none,
  explosion(s, e) {
    // A direct hit reports no splash radius; the bloom has its own size.
    s.fx.bloomBlast(s.at, Math.max(26, e.radius), e.id);
  },
  impact(s, e) {
    if (e.on !== 'wall' && e.on !== 'obstacle') s.fx.popBurst(s.at, PAL_RED, e.id);
    else s.fx.bloomBlast(s.at, 24, e.id);
  },
};

const mine: WeaponFx = {
  shot(s, e) {
    // The hatch pops: a small ring of smoke under the tail and the clack of the door.
    s.fx.seed(e.id);
    s.atMuzzle(e.car, e.part);
    s.pool.spawn(s.a.launch_puff, s.at.x, s.at.y);
    s.fx.sparks(3, s.at, 30, 90, PAL_STEEL, TAU, 0, 40);
    s.kickPart(e.car, e.part, 2);
  },
  hit(s, e, dir) {
    // The flash is at axle height, under the car; the thump itself is the `explosion`.
    s.fx.sparks(6, s.at, 60, 160, PAL_SPARK, TAU, dir, 50);
    void e;
  },
  explosion(s, e) {
    s.fx.mineThump(s.at, Math.max(18, e.radius), e.id);
  },
};

const oil: WeaponFx = {
  shot(s, e) {
    // A sloshing black-blue spill from the rear nozzle. No flash, no light.
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    const at = s.at;
    for (let i = 0; i < s.px.scaled(14); i++) {
      const a = heading + (s.fx.r() - 0.5) * 1.5;
      const v = 40 + s.fx.r() * 90;
      s.px.pixel(
        at.x,
        at.y,
        Math.sin(a) * v + at.vx * 0.4,
        -Math.cos(a) * v + at.vy * 0.4,
        0.3 + s.fx.r() * 0.25,
        PAL_OIL,
        2,
        30 + s.fx.r() * 50,
        280,
        1,
        4,
        -1,
        2,
      );
    }
    s.kickPart(e.car, e.part, 1);
  },
  hit: none,
};

const foam: WeaponFx = {
  projectile: 'foam_glob',
  trail(s, view) {
    // Thick pale pellets follow the glob along its arc and stick where they land.
    const slot = s.pool.spawn(
      s.a.foam_bit,
      view.x + (s.fx.r() - 0.5) * 6,
      view.y + (s.fx.r() - 0.5) * 6,
    );
    if (slot >= 0) {
      s.pool.mode[slot] = MODE_FIXED;
      s.pool.frame0[slot] = Math.floor(s.fx.r() * 4);
      s.pool.z[slot] = view.z;
      s.pool.vz[slot] = -10;
      s.pool.gravity[slot] = 220;
      s.pool.vx[slot] = view.bvx * 0.6;
      s.pool.vy[slot] = view.bvy * 0.6;
      s.pool.life[slot] = 0.6;
      s.pool.fade[slot] = 0.2;
      s.pool.stopOnGround(slot);
    }
    return 0.05;
  },
  shot(s, e) {
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    const at = s.at;
    s.fx.puff(
      at.x,
      at.y,
      at.vx * 0.5 + Math.sin(heading) * 40,
      at.vy * 0.5 - Math.cos(heading) * 40,
      0xfffdf2,
      0.9,
      true,
    );
    for (let i = 0; i < s.px.scaled(6); i++) {
      const a = heading + (s.fx.r() - 0.5) * 0.9;
      s.px.pixel(
        at.x,
        at.y,
        Math.sin(a) * 90 + at.vx,
        -Math.cos(a) * 90 + at.vy,
        0.3,
        PAL_FOAM,
        1,
        60,
        260,
        1,
        5,
        -1,
        2,
      );
    }
    s.kickPart(e.car, e.part, 2);
  },
  telegraph(s, e) {
    // The landing marker: a pale dotted circle of the puddle's own size.
    const px = s.px;
    const slot = px.shape(SHAPE_DOTS, PLANE_GROUND, e.ticks * SIM_DT, PAL_FOAM, e.id);
    px.sx0[slot] = e.x;
    px.sy0[slot] = e.y;
    px.sA[slot] = e.radius;
  },
  hit: none,
  impact(s, e) {
    // The glob lands: an elastic splat with strands, and bits thrown clear.
    s.fx.seed(e.id);
    s.pool.spawn(s.a.foam_splat, s.at.x, s.at.y, LAYER_BODY);
    s.fx.debris([s.a.foam_bit], 8, s.at, 40, 120, 80);
  },
};

const emp: WeaponFx = {
  windup(s, e) {
    // Four diagonal segments light in turn around the emitter.
    s.chargePart(e.car, e.part, e.ticks * SIM_DT);
  },
  shot(s, e) {
    s.atMuzzle(e.car, e.part);
    s.onCar(s.a.flash_violet, s.at, LAYER_FLASH);
  },
  area(s, e) {
    // The pulse: cyan and violet rings out to its true range. No fireball.
    const car = s.cars[e.car];
    s.atWorld(car?.present ? car.x : e.x, car?.present ? car.y - 6 : e.y);
    s.fx.empBurst(s.at, e.range, e.id);
  },
  hit: none,
};

const tesla: WeaponFx = {
  shot: none,
  beam(s, e) {
    // Lightning snaps from each electrode to the point it found on the other car.
    s.fx.seed(e.id);
    const px = s.px;
    for (let barrel = 0; barrel < 2; barrel++) {
      s.atMuzzle(e.car, e.part, barrel);
      const slot = px.shape(
        SHAPE_BOLT,
        PLANE_AIR,
        barrel === 0 ? 0.24 : 0.16,
        PAL_VIOLET,
        e.id * 7 + barrel,
      );
      px.sx0[slot] = s.at.ox;
      px.sy0[slot] = s.at.oy;
      px.sFollow0[slot] = e.car;
      if (barrel === 0) {
        s.onCar(s.a.flash_violet, s.at, LAYER_FLASH);
        s.fx.glow(s.a.glow_s, s.at.x, s.at.y, 0xc9a4ff, 0.8, 0.2);
      }
      if (e.hit >= 0) {
        s.atCar(e.hit, e.toX, e.toY, e.tick);
        px.sx1[slot] = s.at.ox;
        px.sy1[slot] = s.at.oy;
        px.sFollow1[slot] = e.hit;
      } else {
        px.sx1[slot] = e.toX;
        px.sy1[slot] = e.toY;
      }
      px.sA[slot] = barrel === 0 ? 7 : 4;
    }
  },
  hit(s, e, dir) {
    // A bright irregular fork and tiny violet sparks on the component it struck.
    s.onCar(s.a.zap, s.at, LAYER_FLASH);
    s.fx.sparks(9, s.at, 40, 150, PAL_VIOLET, TAU, dir, 0);
    s.fx.glow(s.a.glow_s, s.at.x, s.at.y, 0xc9a4ff, 0.9, 0.2);
    void e;
  },
};

const flame: WeaponFx = {
  shot(s, e) {
    // The nozzle glows red before the jet.
    s.atMuzzle(e.car, e.part);
    s.fx.glow(s.a.glow_s, s.at.x, s.at.y, 0xff5d3c, 1, 0.3);
    s.kickPart(e.car, e.part, 1);
  },
  area(s, e) {
    // Staccato orange jets for as long as the cone burns.
    s.stream(STREAM_FLAME, e.car, e.part, e.ticks * SIM_DT, e.dir, e.half, e.range, e.id);
  },
  hit(s, e) {
    // Fire takes hold of the panel: a lick of flame and embers where it burns.
    const slot = s.onCar(s.a.flame_lick, s.at, LAYER_FIRE);
    if (slot >= 0) s.pool.life[slot] = 0.5;
    s.fx.embers(4, s.at, 6);
    void e;
  },
};

const frost: WeaponFx = {
  projectile: 'frost_ball',
  trail(s, view) {
    // A cold wake: mist and a glint or two.
    const slot = s.pool.spawn(s.a.frost_mist, view.x, view.y, LAYER_SMOKE);
    if (slot >= 0) s.pool.alpha[slot] = 0.7;
    s.px.pixel(
      view.x + (s.fx.r() - 0.5) * 6,
      view.y + (s.fx.r() - 0.5) * 6,
      0,
      0,
      0.25,
      PAL_ICE,
      1,
      0,
      0,
      0,
    );
    return 0.04;
  },
  shot(s, e) {
    // The barrel frosts over: mist rolls off the muzzle ring.
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    const at = s.at;
    for (let i = 0; i < 3; i++) {
      const slot = s.pool.spawn(
        s.a.frost_mist,
        at.x + (s.fx.r() - 0.5) * 6,
        at.y + (s.fx.r() - 0.5) * 6,
        LAYER_SMOKE,
      );
      if (slot < 0) continue;
      s.pool.vx[slot] = at.vx * 0.7 + Math.sin(heading) * 30;
      s.pool.vy[slot] = at.vy * 0.7 - Math.cos(heading) * 30;
      s.pool.drag[slot] = 2;
    }
    s.fx.glow(s.a.glow_s, at.x, at.y, 0x9fe8ff, 0.8, 0.14);
    s.kickPart(e.car, e.part, 2);
  },
  hit(s, e, dir) {
    // Cyan crystalline shatter: straight spokes and diamond shards, nothing round or warm.
    s.onCar(s.a.ice_burst, s.at, LAYER_FIRE);
    s.fx.debris([s.a.ice_shard_a, s.a.ice_shard_b], 9, s.at, 60, 190, 100);
    s.fx.sparks(8, s.at, 60, 170, PAL_ICE, TAU, dir, 30);
    s.fx.glow(s.a.glow_m, s.at.x, s.at.y, 0x9fe8ff, 0.8, 0.2);
    void e;
  },
  impact(s, e) {
    if (e.on === 'expired') return;
    s.pool.spawn(s.a.ice_burst, s.at.x, s.at.y, LAYER_FIRE);
    s.fx.debris([s.a.ice_shard_a, s.a.ice_shard_b], 6, s.at, 50, 150, 90);
  },
};

const hammer: WeaponFx = {
  windup(s, e) {
    // The arm draws back against its spring.
    s.swingPart(e.car, e.part, 0, -0.75, e.ticks * SIM_DT);
  },
  shot(s, e) {
    // Release: forward through the rest position, then it settles.
    s.swingPart(e.car, e.part, 0.55, 0, 0.3);
    s.kickPart(e.car, e.part, -3);
  },
  hit(s, e, dir) {
    // The oversized clang.
    s.fx.flash(s.a.clang, s.at);
    s.fx.sparks(14, s.at, 100, 280, PAL_SPARK, TAU, dir, 70);
    s.fx.debris([s.a.shard_a, s.a.shard_d], 5, s.at, 70, 180, 110, 1.8, dir);
    s.fx.glow(s.a.glow_m, s.at.x, s.at.y, 0xffe9a0, 0.9, 0.14);
    void e;
  },
  impulse(s, e) {
    // The shock stripe: three bars running the way the car was knocked.
    const car = s.cars[e.car];
    if (!car?.present) return;
    const m = Math.hypot(e.dx, e.dy) || 1;
    const px = s.px;
    const slot = px.shape(SHAPE_STRIPES, PLANE_AIR, 0.26, PAL_WHITE, e.id);
    px.sx0[slot] = car.x;
    px.sy0[slot] = car.y - 5;
    px.sx1[slot] = car.x + (e.dx / m) * 34;
    px.sy1[slot] = car.y - 5 + (e.dy / m) * 34;
  },
};

const saw: WeaponFx = {
  shot(s, e) {
    // Each bite: a third of a second of sparks streaming off the blade.
    s.stream(STREAM_SAW, e.car, e.part, 0.32, e.dir, 0.4, 0, e.id);
    s.atMuzzle(e.car, e.part);
    s.fx.flash(s.a.flash_s, s.at, 1.2);
  },
  hit(s, e, dir) {
    // Scraping flecks and a bright scratch along the panel. No star, no fire.
    const at = s.at;
    const car = s.cars[at.follow];
    const along = car ? car.frameHeading : dir;
    for (let i = -3; i <= 3; i++)
      s.px.pixel(
        at.ox + Math.sin(along) * i * 2,
        at.oy - Math.cos(along) * i * 2,
        0,
        0,
        0.35 + Math.abs(i) * 0.02,
        PAL_STEEL,
        1,
        0,
        0,
        0,
        0,
        at.follow,
      );
    s.fx.sparks(6, at, 60, 160, PAL_STEEL, 1.2, along + Math.PI, 40);
    void e;
  },
};

const harpoon: WeaponFx = {
  projectile: 'harpoon',
  shot(s, e) {
    // The spool spins and the dart goes; its rope is drawn from the muzzle while it flies.
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    s.pool.spawn(s.a.chip_puff, s.at.x, s.at.y);
    s.fx.sparks(4, s.at, 60, 150, PAL_STEEL, 0.8, heading, 20);
    s.kickPart(e.car, e.part, 3);
  },
  hit(s, e, dir) {
    s.fx.sparks(5, s.at, 40, 120, PAL_STEEL, TAU, dir, 40);
    void e;
  },
  impact(s) {
    s.fx.sparks(5, s.at, 40, 130, PAL_STEEL, TAU, 0, 40);
    s.pool.spawn(s.a.chip_puff, s.at.x, s.at.y);
  },
};

const air: WeaponFx = {
  shot: none,
  area(s, e) {
    // The aperture opens: a fan of pale pixels and a pressure wave down the cone.
    s.fx.seed(e.id);
    const heading = muzzle(s, e, 'muzzle_air');
    const at = s.at;
    const px = s.px;
    const slot = px.shape(SHAPE_CONE, PLANE_AIR, 0.36, PAL_WHITE, e.id);
    px.sx0[slot] = at.x;
    px.sy0[slot] = at.y;
    px.sA[slot] = heading;
    px.sB[slot] = e.half;
    px.sC[slot] = e.range;
    for (let i = 0; i < s.pool.scaled(7); i++) {
      const a = heading + (s.fx.r() - 0.5) * 2 * e.half;
      const v = (e.range / 0.3) * (0.5 + s.fx.r() * 0.5);
      const puff = s.fx.puff(
        at.x,
        at.y,
        Math.sin(a) * v + at.vx * 0.5,
        -Math.cos(a) * v + at.vy * 0.5,
        0xdfe4ee,
        0.6,
        i % 2 === 0,
      );
      if (puff >= 0) s.pool.drag[puff] = 3.6;
    }
    s.kickPart(e.car, e.part, 2);
  },
  hit(s, e, dir) {
    // Dust thrown off the target and its suspension bounces: a shove, not a wound.
    s.fx.dustDisc(7, s.at, 90, true);
    s.fx.ring(s.at.x, s.at.y, 5, 26, 0.22, PAL_DUST, 10);
    void e;
    void dir;
  },
};

const boomerang: WeaponFx = {
  projectile: 'boomerang',
  trail(s, view) {
    // The bright outer edge leaves a short arc of glints; on the way home it rings.
    s.px.pixel(view.x, view.y, 0, 0, 0.1, PAL_STEEL, 1, 0, 0, 0, 0, -1, 2);
    const launchX = view.x - view.launchX;
    const launchY = view.y - view.launchY;
    const homing = view.bvx * launchX + view.bvy * launchY < 0;
    if (homing && !view.returning) {
      view.returning = true;
      // The turn: a ring and staggered ricochet ticks.
      s.fx.ring(view.x, view.y, 3, 16, 0.2, PAL_STEEL, 8, 0, PLANE_AIR);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        s.px.pixel(
          view.x + Math.cos(a) * 6,
          view.y + Math.sin(a) * 6,
          Math.cos(a) * 60,
          Math.sin(a) * 60,
          0.12 + i * 0.05,
          PAL_WHITE,
          2,
          0,
          0,
          2,
        );
      }
    }
    return 0.03;
  },
  shot(s, e) {
    s.fx.seed(e.id);
    const heading = s.atMuzzle(e.car, e.part);
    s.fx.sparks(3, s.at, 60, 140, PAL_STEEL, 0.8, heading, 0);
    s.kickPart(e.car, e.part, 2);
  },
  hit(s, e, dir) {
    // A glancing steel slash across the panel.
    let heading = dir;
    if (e && e.projectile > 0) {
      const view = s.projectile(e.projectile);
      if (view) heading = view.heading;
    }
    const slot = s.onCar(s.a.slash, s.at, LAYER_FLASH);
    if (slot >= 0) s.pool.aim(slot, heading);
    s.fx.sparks(7, s.at, 80, 200, PAL_STEEL, 0.9, heading, 30);
  },
  impact(s, e) {
    // Caught: the blade claps back into its arm.
    s.fx.sparks(e.on === 'caught' ? 4 : 6, s.at, 40, 130, PAL_STEEL, TAU, 0, 30);
    if (e.on === 'caught') s.fx.flash(s.a.flash_s, s.at, 1.5);
  },
};

const mortar: WeaponFx = {
  projectile: 'shell',
  trail(s, view) {
    // A thin smoke thread marks the arc.
    const slot = s.pool.spawn(s.a.puff_s, view.x, view.y, LAYER_SMOKE);
    if (slot >= 0) {
      s.pool.z[slot] = view.z;
      s.pool.tint[slot] = 0x8b93a8;
      s.pool.alpha[slot] = 0.5;
    }
    return 0.07;
  },
  lock(s, e) {
    const target = s.cars[e.target];
    if (!target?.present) return;
    s.atLocal(e.target, 0, 0, 10);
    const slot = s.onCar(s.a.aim_dot, s.at);
    if (slot >= 0) {
      s.pool.mode[slot] = MODE_LOOP;
      s.pool.life[slot] = 0.3;
    }
  },
  shot(s, e) {
    // The tube thumps: a ring of smoke at its mouth and the barrel settles back.
    s.fx.seed(e.id);
    s.atMuzzle(e.car, e.part);
    const at = s.at;
    s.onCar(s.a.flash_s, at, LAYER_FLASH);
    s.pool.spawn(s.a.launch_puff, at.x, at.y);
    for (let i = 0; i < 3; i++) {
      const puff = s.fx.puff(
        at.x + (s.fx.r() - 0.5) * 6,
        at.y,
        at.vx * 0.4,
        at.vy * 0.4,
        0xc4cad8,
        0.7,
        i > 0,
      );
      if (puff >= 0) {
        s.pool.vz[puff] = 40 + i * 20;
        s.pool.z[puff] = 6;
      }
    }
    muzzleLight(s, 0xffc070, true);
    s.kickPart(e.car, e.part, 3);
    s.recoilCar(e.car, 0, 1, 1);
  },
  telegraph(s, e) {
    // The segmented reticle: its ring is the countdown to the shell.
    const px = s.px;
    const slot = px.shape(SHAPE_RETICLE, PLANE_GROUND, e.ticks * SIM_DT, PAL_RED, e.id);
    px.sx0[slot] = e.x;
    px.sy0[slot] = e.y;
    px.sA[slot] = e.radius;
  },
  hit: none,
  explosion(s, e) {
    s.fx.mortarBlast(s.at, Math.max(50, e.radius), e.id);
  },
};

/** Ramming and bladed hubs: metal on metal, scaled by how hard it was. */
const ram: WeaponFx = {
  shot: none,
  hit(s, e, dir) {
    const power = e ? Math.min(1, (e.damage + e.chassis + e.armor) / 26) : 0.5;
    s.fx.flash(s.a.flash_s, s.at);
    s.fx.sparks(
      6 + Math.round(power * 10),
      s.at,
      60,
      150 + power * 120,
      PAL_SPARK,
      2.6,
      dir + Math.PI,
      60,
    );
    if (power > 0.35)
      s.fx.debris(
        [s.a.shard_b, s.a.shard_d, s.a.chip_round],
        2 + Math.round(power * 4),
        s.at,
        50,
        150,
        100,
      );
    s.pool.spawn(s.a.chip_puff, s.at.x, s.at.y);
  },
};

/** The Missile Interceptor's shot and the Mine Sweeper's: thin, quick, and not a weapon's. */
const interceptor: WeaponFx = {
  shot: none,
  beam(s, e) {
    s.fx.seed(e.id);
    s.atMuzzle(e.car, e.part);
    s.onCar(s.a.flash_mint, s.at, LAYER_FLASH);
    s.kickPart(e.car, e.part, 2);
    const px = s.px;
    const slot = px.shape(SHAPE_BEAM, PLANE_AIR, 0.14, PAL_MINT, e.id);
    px.sx0[slot] = s.at.ox;
    px.sy0[slot] = s.at.oy;
    px.sFollow0[slot] = e.car;
    px.sx1[slot] = e.toX;
    px.sy1[slot] = e.toY;
    px.sA[slot] = 0;
  },
  hit: none,
};

const sweeper: WeaponFx = {
  shot: none,
  beam(s, e) {
    s.fx.seed(e.id);
    s.atMuzzle(e.car, e.part);
    const px = s.px;
    const slot = px.shape(SHAPE_BOLT, PLANE_AIR, 0.14, PAL_AMBER, e.id);
    px.sx0[slot] = s.at.ox;
    px.sy0[slot] = s.at.oy;
    px.sFollow0[slot] = e.car;
    px.sx1[slot] = e.toX;
    px.sy1[slot] = e.toY;
    px.sA[slot] = 2;
    s.fx.sparks(4, s.at, 40, 110, PAL_AMBER, 1.2, 0, 0);
  },
  hit: none,
};

/** Anything that is not in the table: a plain kinetic impact, so nothing is ever invisible. */
export const GENERIC_FX: WeaponFx = {
  shot: none,
  hit(s, e, dir) {
    s.fx.kinetic(s.at, dir);
    void e;
  },
  impact(s) {
    s.fx.sparks(4, s.at, 40, 120, PAL_SPARK, TAU, 0, 40);
  },
};

export const WEAPON_FX: Readonly<Record<string, WeaponFx>> = {
  weapon_front_mg: frontMg,
  weapon_rear_mg: rearSentry,
  weapon_turret: turret,
  weapon_shotgun: shotgun,
  weapon_railshot: railgun,
  weapon_rocket: rocket,
  weapon_homing: seeker,
  weapon_mine: mine,
  weapon_oil: oil,
  weapon_foam: foam,
  weapon_emp: emp,
  weapon_tesla: tesla,
  weapon_flame: flame,
  weapon_frost: frost,
  weapon_hammer: hammer,
  weapon_saw: saw,
  weapon_harpoon: harpoon,
  weapon_air: air,
  weapon_boomerang: boomerang,
  weapon_mortar: mortar,
  ram,
  tires_blades: ram,
  defense_antimissile: interceptor,
  defense_minesweeper: sweeper,
};
