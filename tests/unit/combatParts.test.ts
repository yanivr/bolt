import { ACCESSORIES, DEFENSE_LIST, UTILITY_LIST, WEAPON_LIST } from '@bolt/content';
import type { CombatCar, RaceEnvironment } from '@bolt/shared';
import {
  BEHAVIOR_KIND,
  BODY_HIT_SHARE,
  CC_IMMUNITY_SECONDS,
  CHASSIS_DAMAGE_SHARE,
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_STEERING,
  HAZARD_REVEAL_RANGE,
  MODULE_COOLDOWN,
  RIVAL_TRACK_RANGE,
  SIM_DT,
  STEERING_LIMP_SCALE,
  applyEmp,
  applyImpulse,
  applyStatus,
  compileModules,
  computeEffects,
  hasStatus,
  repairComponent,
  rivalTracked,
  statusMagnitude,
  ticksOf,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { Duel, TestCar, TestPart } from '../helpers/combat.js';
import { GO, componentDamageBy, damageBy, duel, hitAt } from '../helpers/combat.js';
import { RAIN } from '../helpers/rig.js';

/**
 * Sections 11.5 to 11.7: all sixty weapons, defenses and utilities in a race. Every part has
 * at least one test of the thing it is for (`behavior`) and one of a limit or of what answers
 * it (`limit`): ammunition, cooldown, arc, range, a counter. The table at the end fails when
 * a catalog part has neither.
 */

const covered = new Map<string, { behavior: number; limit: number }>();
function mark(id: string, kind: 'behavior' | 'limit'): string {
  const def = ACCESSORIES[id];
  if (!def) throw new Error(`${id} is not a catalog part`);
  const entry = covered.get(id) ?? { behavior: 0, limit: 0 };
  entry[kind]++;
  covered.set(id, entry);
  return def.displayName;
}
/** A test of what the part is for. */
function behavior(id: string, title: string, fn: () => void): void {
  it(`${mark(id, 'behavior')}: ${title}`, fn);
}
/** A test of a limit of the part, or of an interaction with something that answers it. */
function limit(id: string, title: string, fn: () => void): void {
  it(`${mark(id, 'limit')}: ${title}`, fn);
}

const BEETLE: TestCar = { chassis: 'chassis_beetle' };
/** A car that lays mines from its tail on the primary button. */
const layer: TestCar = { parts: [{ id: 'weapon_mine', mount: 'rear_utility', turn: 2, fire: 0 }] };
const FL = COMPONENT_FIRST_WHEEL;
const FR = COMPONENT_FIRST_WHEEL + 1;

/** A car with one weapon on its front roof mount, on the primary button. */
function armed(id: string, extra: TestPart[] = []): TestCar {
  return { parts: [{ id, mount: 'roof_front', fire: 0 }, ...extra] };
}
/** A car with one weapon on its rear utility mount, facing back, on the primary button. */
function rearArmed(id: string): TestCar {
  return { parts: [{ id, mount: 'rear_utility', turn: 2, fire: 0 }] };
}
/** Readies every module of a car again, to test a sequence without waiting out cooldowns. */
function ready(car: CombatCar): void {
  for (const module of car.modules) module.cooldown = 0;
  car.session.motion.batteryEnergy = car.session.params.power.capacity;
  car.session.motion.coreHeat = 0;
}
/** Car B lays a mine where it stands and drives well clear; the mine is armed on return. */
function layMine(d: Duel) {
  d.fire(1);
  const mine = d.race.hazards
    .filter((h) => h.active && h.kind === 'mine')
    .sort((x, y) => y.id - x.id)[0];
  if (!mine) throw new Error('no mine was laid');
  d.placeB(11000 - mine.x + 600);
  d.step(20);
  return mine;
}
/** Takes the firing car out of the way once it has dropped something. */
function stepAside(d: Duel): void {
  d.a.session.motion.x -= 800;
  d.a.prevX = d.a.session.motion.x;
}
function speedOf(car: CombatCar): number {
  return Math.hypot(car.session.motion.velocityX, car.session.motion.velocityY);
}
function distance(d: Duel): number {
  return Math.hypot(
    d.a.session.motion.x - d.b.session.motion.x,
    d.a.session.motion.y - d.b.session.motion.y,
  );
}

describe('every part compiles from its catalog params (Section 11.8)', () => {
  it('maps every active behavior id to a primitive and reads every number from params', () => {
    for (const def of [...WEAPON_LIST, ...DEFENSE_LIST, ...UTILITY_LIST]) {
      const d = duel({ parts: [{ id: def.id, fire: def.category === 'weapon' ? 0 : undefined }] });
      const spec = d.a.specs[0]!;
      expect(spec.id).toBe(def.id);
      if (def.category === 'weapon') expect(spec.kind, def.id).not.toBe('passive');
      if (
        def.triggerMode !== 'passive' &&
        def.behaviorId !== 'shifting_ballast' &&
        def.behaviorId !== 'active_downforce'
      )
        expect(BEHAVIOR_KIND[def.behaviorId], `${def.id} ${def.behaviorId}`).toBeDefined();
    }
    // Twenty weapons on eighteen primitives: the three bullet guns differ in how they aim.
    const kinds = WEAPON_LIST.map((w) => BEHAVIOR_KIND[w.behaviorId]);
    expect(new Set(kinds).size).toBe(18);
    expect(new Set(WEAPON_LIST.map((w) => w.behaviorId)).size).toBe(20);
  });

  it('fails loudly on a part whose params are missing a number its behavior needs', () => {
    const d = duel(armed('weapon_rocket'));
    const placed = d.a.build.parts[0]!;
    const broken = {
      ...placed,
      def: { ...placed.def, params: { ...placed.def.params, splashRadius: 'wide' } },
    };
    expect(() => compileModules({ ...d.a.build, parts: [broken] }, d.a.totals)).toThrow(
      /splashRadius/,
    );
  });
});

// ================================================================================================
describe('weapons (Sections 8.3, 11.5)', () => {
  // --- Front Machine Gun --------------------------------------------------------------------
  behavior('weapon_front_mg', 'a five-round burst over 0.4 s, 3 damage a round', () => {
    const d = duel(armed('weapon_front_mg'));
    d.fire(0, 0, 25);
    const shots = d.of('shot', 0);
    expect(shots).toHaveLength(5);
    expect(shots.map((s) => s.n)).toEqual([0, 1, 2, 3, 4]);
    expect(shots[4]!.tick - shots[0]!.tick).toBe(12);
    const hits = d.of('hit', 1);
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.cls === 'bullet' && h.damage === 3)).toBe(true);
    expect(componentDamageBy(d, 'weapon_front_mg')).toBe(15);
  });
  limit(
    'weapon_front_mg',
    'aims only inside its 85-degree cone, reaches 220, and reloads for 1.4 s',
    () => {
      const wide = duel(armed('weapon_front_mg'), BEETLE, { ahead: 60, aside: 110 });
      wide.fire(0, 0, 25);
      expect(wide.of('shot')).toHaveLength(5);
      expect(wide.of('hit', 1)).toEqual([]);
      // Fired straight ahead, not at a target outside the cone.
      const facing = wide.a.session.motion.headingRad;
      expect(Math.abs(wide.of('shot')[0]!.dir - facing)).toBeLessThan(0.08);

      const far = duel(armed('weapon_front_mg'), BEETLE, { ahead: 300 });
      far.fire(0, 0, 25);
      expect(far.of('hit', 1)).toEqual([]);
      expect(far.of('impact').every((e) => e.on === 'expired')).toBe(true);

      const d = duel(armed('weapon_front_mg'));
      d.fire(0, 0, 10);
      d.fire(0);
      expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['cooldown']);
      expect(d.module(d.a, 'weapon_front_mg').module.cooldownTotal).toBe(ticksOf(1.4));
      // Catalog 0.7.0: a magazine of twelve bursts a race, one spent by each burst.
      expect(d.module(d.a, 'weapon_front_mg').module.charges).toBe(11);
      const e = duel(armed('weapon_front_mg'));
      for (let i = 0; i < 12; i++) e.fire(0, 0, ticksOf(1.5));
      expect(e.module(e.a, 'weapon_front_mg').module.charges).toBe(0);
      e.fire(0);
      expect(e.of('refused', 0).map((x) => x.reason)).toContain('no_ammo');
    },
  );

  // --- Rear Sentry ----------------------------------------------------------------------------
  const sentry: TestCar = { parts: [{ id: 'weapon_rear_mg', mount: 'roof_mid', turn: 2 }] };
  behavior(
    'weapon_rear_mg',
    'fires a four-round burst by itself at a car in the 90 degrees behind it',
    () => {
      const d = duel(sentry, BEETLE, { ahead: -130 });
      d.step(40);
      expect(d.of('windup', 0)).toHaveLength(1);
      const shots = d.of('shot', 0);
      expect(shots).toHaveLength(4);
      // It pivots first: the burst starts a quarter of a second after it sees the target.
      expect(shots[0]!.tick - d.of('windup', 0)[0]!.tick).toBe(ticksOf(0.25));
      expect(componentDamageBy(d, 'weapon_rear_mg')).toBe(12);
      // Rearward: opposite to the car's heading.
      expect(Math.abs(Math.cos(shots[0]!.dir - d.a.session.motion.headingRad) + 1)).toBeLessThan(
        0.02,
      );
    },
  );
  limit(
    'weapon_rear_mg',
    'ignores a car ahead or out of range, and waits 3.2 s between bursts',
    () => {
      const ahead = duel(sentry, BEETLE, { ahead: 130 });
      ahead.step(200);
      expect(ahead.of('shot')).toEqual([]);
      const far = duel(sentry, BEETLE, { ahead: -320 });
      far.step(200);
      expect(far.of('shot')).toEqual([]);
      const d = duel(sentry, BEETLE, { ahead: -130 });
      d.step(220);
      const starts = d.of('windup', 0).map((e) => e.tick);
      expect(starts.length).toBe(3);
      expect(starts[1]! - starts[0]!).toBe(ticksOf(3.2));
    },
  );

  // --- Swivel Turret ----------------------------------------------------------------------------
  const turret: TestCar = { parts: [{ id: 'weapon_turret', mount: 'roof_front', fire: 'auto' }] };
  behavior(
    'weapon_turret',
    'turns onto a car beside it, locks, and puts 18 damage on it in three rounds',
    () => {
      const d = duel(turret, BEETLE, { ahead: 14, aside: 110 });
      d.step(70);
      const lock = d.of('lock', 0)[0]!;
      expect(lock.locked).toBe(true);
      // 90 degrees at 120 degrees a second, less the 6-degree tolerance: 0.7 s.
      expect(lock.tick).toBeGreaterThanOrEqual(20);
      expect(lock.tick).toBeLessThanOrEqual(24);
      expect(d.of('shot', 0)).toHaveLength(3);
      expect(componentDamageBy(d, 'weapon_turret')).toBe(18);
      expect(d.module(d.a, 'weapon_turret').module.aim).toBeCloseTo(Math.PI / 2, 1);
    },
  );
  limit(
    'weapon_turret',
    'traverses at 120 degrees a second and no faster: a car behind takes 1.45 s',
    () => {
      const d = duel(turret, BEETLE, { ahead: -150 });
      const module = d.module(d.a, 'weapon_turret').module;
      let last = module.aim;
      for (let i = 0; i < 60; i++) {
        d.step(1);
        expect(Math.abs(module.aim - last)).toBeLessThanOrEqual((120 * Math.PI) / 180 / 30 + 1e-9);
        last = module.aim;
      }
      const lock = d.of('lock', 0)[0]!;
      expect(lock.tick).toBeGreaterThanOrEqual(43);
      expect(lock.tick).toBeLessThanOrEqual(46);
      // Out of range it never locks and, on auto, never fires.
      const far = duel(turret, BEETLE, { ahead: 320 });
      far.step(120);
      expect(far.of('lock')).toEqual([]);
      expect(far.of('shot')).toEqual([]);
    },
  );

  // --- Road Shotgun -----------------------------------------------------------------------------
  behavior('weapon_shotgun', 'eight pellets at once, 3 damage each up close', () => {
    const d = duel(armed('weapon_shotgun'), BEETLE, { ahead: 70 });
    d.fire(0, 0, 10);
    const shots = d.of('shot', 0);
    expect(shots).toHaveLength(8);
    expect(new Set(shots.map((s) => s.tick)).size).toBe(1);
    // A 40-degree fan.
    expect(shots[7]!.dir - shots[0]!.dir).toBeCloseTo((35 * Math.PI) / 180, 6);
    expect(d.of('hit', 1)).toHaveLength(8);
    expect(componentDamageBy(d, 'weapon_shotgun')).toBeCloseTo(24, 6);
  });
  limit('weapon_shotgun', 'falls off with distance and reaches only 110', () => {
    const mid = duel(armed('weapon_shotgun'), BEETLE, { ahead: 150 });
    mid.fire(0, 0, 12);
    const hits = mid.of('hit', 1);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(8);
    expect(hits.every((h) => h.damage < 2.4 && h.damage >= 3 * 0.4 - 1e-9)).toBe(true);
    const far = duel(armed('weapon_shotgun'), BEETLE, { ahead: 190 });
    far.fire(0, 0, 12);
    expect(far.of('hit', 1)).toEqual([]);
    expect(far.module(far.a, 'weapon_shotgun').module.cooldownTotal).toBe(ticksOf(4));
  });

  // --- Needle Railgun ---------------------------------------------------------------------------
  behavior(
    'weapon_railshot',
    'charges visibly for 0.8 s, then one instant 27-damage hit that pierces',
    () => {
      const d = duel(armed('weapon_railshot'), BEETLE, { ahead: 300 });
      d.fire(0, 0, 30);
      const windup = d.of('windup', 0)[0]!;
      expect(windup.ticks).toBe(ticksOf(0.8));
      const beam = d.of('beam', 0)[0]!;
      expect(beam.tick - windup.tick).toBe(ticksOf(0.8));
      expect(beam.hit).toBe(1);
      const hit = d.of('hit', 1)[0]!;
      expect(hit).toMatchObject({
        cls: 'heavy',
        weapon: 'weapon_railshot',
        component: COMPONENT_ENGINE,
      });
      // 27 into the engine and half as much again into the module next to it.
      expect(hit.damage).toBeCloseTo(27 * 1.5, 6);
      expect(hit.chassis).toBeCloseTo(27 * CHASSIS_DAMAGE_SHARE, 6);
      expect(d.b.components.filter((c) => c.integrity < c.maxIntegrity)).toHaveLength(2);
      expect(hit.tick).toBe(beam.tick);
    },
  );
  limit(
    'weapon_railshot',
    'five shots a match, a 20-degree cone, and an EMP mid-charge wastes the shot',
    () => {
      const d = duel(armed('weapon_railshot'), BEETLE, { ahead: 300 });
      for (let i = 0; i < 5; i++) {
        ready(d.a);
        d.fire(0, 0, 30);
      }
      expect(d.of('beam')).toHaveLength(5);
      ready(d.a);
      d.fire(0);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('no_ammo');
      expect(d.module(d.a, 'weapon_railshot').module.charges).toBe(0);

      const wide = duel(armed('weapon_railshot'), BEETLE, { ahead: 200, aside: 80 });
      wide.fire(0, 0, 30);
      expect(wide.of('beam')[0]!.hit).toBe(-1);

      const cut = duel(armed('weapon_railshot'), BEETLE, { ahead: 300 });
      cut.fire(0, 0, 6);
      applyEmp(cut.race, cut.a, 30, 1);
      cut.step(40);
      expect(cut.of('beam')).toEqual([]);
      expect(cut.module(cut.a, 'weapon_railshot').module.charges).toBe(4);
    },
  );

  // --- Straight Rocket --------------------------------------------------------------------------
  behavior('weapon_rocket', 'a rocket that flies straight and bursts for 22', () => {
    const d = duel(armed('weapon_rocket'), BEETLE, { ahead: 150 });
    d.fire(0, 0, 20);
    const shot = d.of('shot', 0)[0]!;
    expect(shot.projectile).toBeGreaterThan(0);
    const hit = d.of('hit', 1)[0]!;
    expect(hit).toMatchObject({ cls: 'direct', damage: 22, projectile: shot.projectile });
    // 380 px/s over about 100 px: it is seen in flight for a quarter of a second.
    expect(hit.tick - shot.tick).toBeGreaterThanOrEqual(6);
    expect(hit.tick - shot.tick).toBeLessThanOrEqual(10);
    const blast = d.of('explosion')[0]!;
    expect(blast).toMatchObject({
      weapon: 'weapon_rocket',
      radius: 34,
      projectile: shot.projectile,
    });
    expect(blast.tick).toBe(hit.tick);
  });
  limit(
    'weapon_rocket',
    'does not steer, splashes a car near the blast for less than 6, and carries five',
    () => {
      const miss = duel(armed('weapon_rocket'), BEETLE, { ahead: 150, aside: 60 });
      miss.fire(0, 0, 40);
      expect(miss.of('hit', 1)).toEqual([]);

      const near = duel(armed('weapon_rocket'), BEETLE, {
        ahead: 100,
        aside: 40,
        posts: [{ ahead: 100, radius: 10 }],
      });
      near.fire(0, 0, 20);
      const splash = near.of('hit', 1);
      expect(splash).toHaveLength(1);
      expect(splash[0]!.damage).toBeGreaterThan(0);
      expect(splash[0]!.damage).toBeLessThan(6);

      const d = duel(armed('weapon_rocket'), BEETLE, { ahead: 150 });
      for (let i = 0; i < 6; i++) {
        ready(d.a);
        d.fire(0, 0, 2);
      }
      expect(d.of('shot')).toHaveLength(5);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('no_ammo');
    },
  );

  // --- Seeker Missile -----------------------------------------------------------------------------
  behavior('weapon_homing', 'locks in 0.6 s, warns its target, and steers onto it for 20', () => {
    const d = duel(armed('weapon_homing'), BEETLE, { ahead: 150, aside: 70 });
    d.step(ticksOf(0.6) - 1);
    expect(d.of('lock')).toEqual([]);
    d.step(2);
    expect(d.of('lock', 0)[0]).toMatchObject({ locked: true, target: 1 });
    // The target is told it is locked (Section 8.4), before anything is fired.
    expect(d.of('warning', 1).map((e) => e.kind)).toEqual(['lock']);
    d.fire(0, 0, 40);
    const hit = d.of('hit', 1)[0]!;
    expect(hit).toMatchObject({ weapon: 'weapon_homing', damage: 20 });
    // It had to turn: a straight shot from here misses by 70 pixels.
    expect(d.of('warning', 1).map((e) => e.kind)).toContain('missile');
    const incoming = d.of('warning', 1).find((e) => e.kind === 'missile')!;
    expect(hit.tick - incoming.tick).toBeLessThanOrEqual(ticksOf(0.5) + 1);
    expect(d.of('explosion')).toHaveLength(1);
  });
  limit(
    'weapon_homing',
    'unlocked it flies straight; no lock beyond 220 or outside its cone; three a match',
    () => {
      const dumb = duel(armed('weapon_homing'), BEETLE, { ahead: 150, aside: 70 });
      dumb.fire(0, 0, 60);
      expect(dumb.of('shot')).toHaveLength(1);
      expect(dumb.of('hit', 1)).toEqual([]);

      const far = duel(armed('weapon_homing'), BEETLE, { ahead: 320 });
      far.step(60);
      expect(far.of('lock')).toEqual([]);
      const behind = duel(armed('weapon_homing'), BEETLE, { ahead: -120 });
      behind.step(60);
      expect(behind.of('lock')).toEqual([]);

      const d = duel(armed('weapon_homing'), BEETLE, { ahead: 150 });
      for (let i = 0; i < 4; i++) {
        ready(d.a);
        d.fire(0, 0, 2);
      }
      expect(d.of('shot')).toHaveLength(3);
      expect(d.module(d.a, 'weapon_homing').module.cooldownTotal).toBe(ticksOf(9));
    },
  );

  // --- Road Mine ----------------------------------------------------------------------------------
  behavior(
    'weapon_mine',
    'drops behind, arms after 0.6 s, and hits whoever drives over it for 13 and a slow',
    () => {
      const d = duel(rearArmed('weapon_mine'), BEETLE, { ahead: -300 });
      d.fire(0);
      const placed = d.of('hazard')[0]!;
      expect(placed).toMatchObject({ kind: 'mine', state: 'placed', by: 0 });
      // Behind the car: east of it when it faces west.
      expect(placed.x).toBeGreaterThan(d.a.session.motion.x + 20);
      stepAside(d);
      // Not live yet: a car on top of it now is safe.
      d.placeB(-(placed.x - 11000));
      d.step(5);
      expect(d.of('hit', 1)).toEqual([]);
      d.placeB(-300);
      d.step(ticksOf(0.6));
      expect(d.of('hazard').map((e) => e.state)).toEqual(['placed', 'armed']);
      // Its engine, 29 pixels behind its centre, passes over the mine.
      d.placeB(-(placed.x - 29 - 11000));
      d.step(2);
      expect(d.of('hazard').at(-1)).toMatchObject({ state: 'triggered', car: 1 });
      expect(componentDamageBy(d, 'weapon_mine')).toBe(13);
      expect(statusMagnitude(d.b, 'slow')).toBe(0.3);
      expect(d.b.statusTicks[0]).toBeGreaterThan(ticksOf(1.2) - 3);
      expect(d.of('explosion')).toHaveLength(1);
    },
  );
  limit(
    'weapon_mine',
    'six mines a layer and six live a racer: a seventh replaces the oldest',
    () => {
      const d = duel(
        {
          parts: [
            { id: 'weapon_mine', mount: 'rear_utility', turn: 2, fire: 0 },
            { id: 'weapon_mine', mount: 'roof_mid', turn: 2, fire: 1 },
          ],
        },
        BEETLE,
        { ahead: 300 },
      );
      for (let i = 0; i < 6; i++) {
        ready(d.a);
        d.a.session.motion.x -= 60;
        d.fire(0, 0);
      }
      ready(d.a);
      d.fire(0);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('no_ammo');
      const live = () => d.race.hazards.filter((h) => h.active && h.kind === 'mine');
      expect(live()).toHaveLength(6);
      const oldest = Math.min(...live().map((h) => h.id));
      // The second layer has its own six, but the car may only have six on the road.
      d.a.session.motion.x -= 60;
      d.fire(0, 1);
      expect(live()).toHaveLength(6);
      expect(live().some((h) => h.id === oldest)).toBe(false);
      expect(d.of('hazard').some((e) => e.hazard === oldest && e.state === 'expired')).toBe(true);
    },
  );

  // --- Oil Slick ----------------------------------------------------------------------------------
  behavior(
    'weapon_oil',
    'lays a 90-pixel strip that takes 45 percent of grip for 2.5 s, and does no damage',
    () => {
      const d = duel(rearArmed('weapon_oil'), BEETLE, { ahead: -300 });
      d.fire(0);
      const strip = d.race.hazards.find((h) => h.active)!;
      expect(strip.kind).toBe('oil');
      expect(strip.halfLength).toBe(45);
      expect(strip.radius).toBe(13);
      stepAside(d);
      d.placeB(-(strip.x - 11000));
      d.step(2);
      expect(statusMagnitude(d.b, 'grip')).toBe(0.45);
      computeEffects(d.b);
      expect(d.b.session.effects.grip).toBeCloseTo(0.55, 9);
      expect(d.of('hit')).toEqual([]);
      // Off the oil the slide lasts 2.5 seconds more.
      d.placeB(-600);
      d.step(ticksOf(2.5) - 3);
      expect(hasStatus(d.b, 'grip')).toBe(true);
      d.step(4);
      expect(hasStatus(d.b, 'grip')).toBe(false);
    },
  );
  limit('weapon_oil', 'only catches a car that crosses it, and is gone after 8 s', () => {
    const d = duel(rearArmed('weapon_oil'), BEETLE, { ahead: -300 });
    d.fire(0);
    const strip = d.race.hazards.find((h) => h.active)!;
    stepAside(d);
    d.placeB(-(strip.x - 11000), 40);
    d.step(5);
    expect(hasStatus(d.b, 'grip')).toBe(false);
    d.step(ticksOf(8));
    d.placeB(-(strip.x - 11000));
    d.step(5);
    expect(hasStatus(d.b, 'grip')).toBe(false);
    expect(d.module(d.a, 'weapon_oil').module.charges).toBe(-1);
  });

  // --- Sticky Foam --------------------------------------------------------------------------------
  behavior('weapon_foam', 'lobs a puddle 120 ahead that slows a car in it by 20 percent', () => {
    const d = duel(armed('weapon_foam'), BEETLE, { ahead: 140 });
    d.fire(0);
    const mark = d.of('telegraph', 0)[0]!;
    expect(mark).toMatchObject({ weapon: 'weapon_foam', radius: 30, ticks: ticksOf(0.5) });
    // 120 pixels past the muzzle.
    expect(11000 - mark.x).toBeGreaterThan(130);
    expect(11000 - mark.x).toBeLessThan(150);
    expect(d.of('hazard')).toEqual([]);
    d.step(ticksOf(0.5));
    expect(d.of('hazard')[0]).toMatchObject({ kind: 'foam', state: 'placed' });
    d.step(2);
    expect(statusMagnitude(d.b, 'slow')).toBe(0.2);
    expect(d.of('hit')).toEqual([]);
    computeEffects(d.b);
    expect(Number.isFinite(d.b.session.effects.speedCap)).toBe(true);
  });
  limit(
    'weapon_foam',
    'lands where it was aimed, not where the rival is, and dries up in 6 s',
    () => {
      const short = duel(armed('weapon_foam'), BEETLE, { ahead: 70 });
      short.fire(0, 0, 30);
      expect(hasStatus(short.b, 'slow')).toBe(false);
      const d = duel(armed('weapon_foam'), BEETLE, { ahead: 300 });
      d.fire(0, 0, ticksOf(0.5) + ticksOf(6) + 2);
      expect(d.race.hazards.filter((h) => h.active)).toEqual([]);
    },
  );

  // --- EMP Pulse ----------------------------------------------------------------------------------
  const empTarget: TestCar = {
    parts: [{ id: 'weapon_front_mg', mount: 'roof_front', fire: 0 }, 'utility_fan'],
  };
  behavior(
    'weapon_emp',
    'charges for 0.6 s, then shuts down electronics within 135 for 1.5 s',
    () => {
      const d = duel(armed('weapon_emp'), empTarget, { ahead: 10, aside: 90 });
      d.fire(0);
      expect(d.of('windup', 0)[0]!.ticks).toBe(ticksOf(0.6));
      d.step(ticksOf(0.6));
      expect(d.of('area', 0)[0]).toMatchObject({ weapon: 'weapon_emp', range: 135, half: Math.PI });
      expect(d.b.statusTicks[3]).toBeGreaterThanOrEqual(ticksOf(1.5) - 3);
      // Weapons are down and say so; powered equipment gets nothing.
      d.fire(1);
      expect(d.of('refused', 1).map((e) => e.reason)).toEqual(['jammed']);
      expect(d.of('shot', 1)).toEqual([]);
      expect(d.b.session.effects.auxLimit).toBe(0);
      expect(d.b.session.telemetry.auxSupply).toBe(0);
      expect(d.of('hit')).toEqual([]);
      d.step(ticksOf(1.5));
      expect(hasStatus(d.b, 'emp')).toBe(false);
      d.fire(1, 0, 5);
      expect(d.of('shot', 1).length).toBeGreaterThan(0);
    },
  );
  limit(
    'weapon_emp',
    'reaches 135 and no further, takes 30 energy, and comes back after 13 s',
    () => {
      const far = duel(armed('weapon_emp'), empTarget, { ahead: 10, aside: 190 });
      far.fire(0, 0, 30);
      expect(hasStatus(far.b, 'emp')).toBe(false);
      const d = duel(armed('weapon_emp'), empTarget, { ahead: 10, aside: 90 });
      const battery = d.a.session.motion.batteryEnergy;
      d.fire(0, 0, 30);
      expect(battery - d.a.session.motion.batteryEnergy).toBeGreaterThan(15);
      const module = d.module(d.a, 'weapon_emp').module;
      expect(module.cooldownTotal).toBe(ticksOf(13));
      // Ready again in time but short of power: the pulse needs 30.
      module.cooldown = 0;
      d.a.session.motion.batteryEnergy = 12;
      d.fire(0);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('low_power');
    },
  );

  // --- Tesla Arc ----------------------------------------------------------------------------------
  const tesla: TestCar = { parts: [{ id: 'weapon_tesla', mount: 'roof_front' }] };
  behavior(
    'weapon_tesla',
    'strikes a car within 70 by itself: 12 damage and 0.6 s of jammed systems',
    () => {
      const d = duel(tesla, empTarget, { ahead: 10, aside: 80 });
      d.step(2);
      const arc = d.of('beam', 0)[0]!;
      expect(arc).toMatchObject({ weapon: 'weapon_tesla', hit: 1 });
      expect(componentDamageBy(d, 'weapon_tesla')).toBe(12);
      expect(d.b.statusTicks[4]).toBeGreaterThan(ticksOf(0.6) - 3);
      d.fire(1);
      expect(d.of('refused', 1).map((e) => e.reason)).toEqual(['jammed']);
      // A module delay, not an EMP: powered equipment keeps running.
      expect(hasStatus(d.b, 'emp')).toBe(false);
      expect(d.b.session.effects.auxLimit).toBe(1);
    },
  );
  limit(
    'weapon_tesla',
    'reaches 70 in the dry and a quarter further on a wet road, every 6 s',
    () => {
      const at = (env?: RaceEnvironment) => {
        const d = duel(tesla, BEETLE, { ahead: 10, aside: 100, env });
        d.step(5);
        return d.of('beam').length;
      };
      expect(at()).toBe(0);
      expect(at(RAIN)).toBe(1);
      const d = duel(tesla, BEETLE, { ahead: 10, aside: 80 });
      d.step(ticksOf(6) + 5);
      const arcs = d.of('beam', 0);
      expect(arcs).toHaveLength(2);
      expect(arcs[1]!.tick - arcs[0]!.tick).toBe(ticksOf(6));
    },
  );

  // --- Flame Spitter ------------------------------------------------------------------------------
  behavior(
    'weapon_flame',
    'two seconds of flame: 14 burn damage in pulses and 20 heat into the target',
    () => {
      const d = duel(armed('weapon_flame'), BEETLE, { ahead: 75 });
      d.fire(0);
      expect(d.of('area', 0)[0]).toMatchObject({
        weapon: 'weapon_flame',
        range: 90,
        ticks: ticksOf(2),
      });
      d.step(ticksOf(2) - 3);
      // Still burning in the cone: heat has gone in, less what the parked car shed meanwhile.
      expect(d.b.session.motion.coreHeat).toBeGreaterThan(11);
      expect(d.b.session.motion.coreHeat).toBeLessThan(20);
      d.step(30);
      const burns = d.of('hit', 1);
      expect(burns.every((h) => h.cls === 'burn' && h.weapon === 'weapon_flame')).toBe(true);
      expect(burns.length).toBeGreaterThanOrEqual(6);
      // 14 over the two seconds, plus the 0.3 s it keeps burning after.
      expect(componentDamageBy(d, 'weapon_flame')).toBeGreaterThan(14 - 0.3);
      expect(componentDamageBy(d, 'weapon_flame')).toBeLessThan(14 + 7 * 0.3 + 0.3);
      expect(hasStatus(d.b, 'burn')).toBe(false);
    },
  );
  limit('weapon_flame', 'reaches only 90, and heats its own car by 9 a use', () => {
    const d = duel(armed('weapon_flame'), BEETLE, { ahead: 180 });
    const heat = d.a.session.motion.coreHeat;
    d.fire(0);
    expect(d.a.session.motion.coreHeat - heat).toBeGreaterThan(8);
    d.step(70);
    expect(d.of('hit', 1)).toEqual([]);
    expect(hasStatus(d.b, 'burn')).toBe(false);
    expect(d.b.session.motion.coreHeat).toBeLessThan(1);
  });

  // --- Frost Cannon -------------------------------------------------------------------------------
  behavior(
    'weapon_frost',
    'a cold shell: 20 percent less grip for 2.5 s, no damage, and frost left on the road',
    () => {
      const d = duel(armed('weapon_frost'), BEETLE, { ahead: 150 });
      d.fire(0, 0, 15);
      expect(statusMagnitude(d.b, 'grip')).toBe(0.2);
      expect(d.of('status', 1)[0]).toMatchObject({
        family: 'grip',
        state: 'applied',
        ticks: ticksOf(2.5),
      });
      expect(d.of('hit')).toEqual([]);
      expect(d.b.chassis).toBe(d.b.chassisMax);
      const patch = d.race.hazards.find((h) => h.active)!;
      expect(patch).toMatchObject({ kind: 'frost', radius: 26 });
    },
  );
  limit('weapon_frost', 'puts a burning car out, and its patch is wider on a wet road', () => {
    const d = duel(armed('weapon_frost'), BEETLE, { ahead: 150 });
    applyStatus(d.race, d.b, 'burn', 7, 200, 0);
    d.fire(0, 0, 15);
    expect(hasStatus(d.b, 'burn')).toBe(false);
    const wet = duel(armed('weapon_frost'), BEETLE, { ahead: 150, env: RAIN });
    wet.fire(0, 0, 15);
    expect(wet.race.hazards.find((h) => h.active)!.radius).toBeCloseTo(26 * 1.3, 9);
    // A miss still leaves its patch, where the shell came down at the end of its reach.
    const miss = duel(armed('weapon_frost'), BEETLE, { ahead: 150, aside: 120 });
    miss.fire(0, 0, 30);
    expect(hasStatus(miss.b, 'grip')).toBe(false);
    expect(miss.race.hazards.filter((h) => h.active && h.kind === 'frost')).toHaveLength(1);
  });

  // --- Crash Hammer -------------------------------------------------------------------------------
  behavior(
    'weapon_hammer',
    'draws back for a quarter second, then 24 damage and a sideways knock',
    () => {
      const d = duel(armed('weapon_hammer'), BEETLE, { ahead: 85, aside: 18 });
      d.fire(0);
      expect(d.of('windup', 0)[0]!.ticks).toBe(ticksOf(0.25));
      expect(d.of('hit', 1)).toEqual([]);
      d.step(ticksOf(0.25));
      const hit = d.of('hit', 1)[0]!;
      expect(hit).toMatchObject({ cls: 'heavy', damage: 24, weapon: 'weapon_hammer' });
      const shove = d.of('impulse', 1)[0]!;
      // The target is to the right of the hammer (toward -y when heading west): knocked further right.
      expect(shove.dy).toBeLessThan(-100);
      expect(Math.abs(shove.dx)).toBeLessThan(5);
      expect(hasStatus(d.b, 'immune')).toBe(true);
      expect(hasStatus(d.b, 'emp')).toBe(false);
    },
  );
  limit(
    'weapon_hammer',
    'reaches 110 and no further, and cannot knock the same car twice inside 2 s',
    () => {
      const far = duel(armed('weapon_hammer'), BEETLE, { ahead: 190 });
      far.fire(0, 0, 20);
      expect(far.of('hit', 1)).toEqual([]);
      const d = duel(
        {
          parts: [
            { id: 'weapon_hammer', mount: 'roof_front', fire: 0 },
            { id: 'weapon_hammer', mount: 'roof_mid', fire: 1 },
          ],
        },
        BEETLE,
        { ahead: 85, aside: 18 },
      );
      d.fire(0, 0, 10);
      d.b.session.motion.velocityX = 0;
      d.b.session.motion.velocityY = 0;
      d.placeB(85, 18);
      d.fire(0, 1, 12);
      // The second blow still does its damage; the shove is refused.
      expect(d.of('hit', 1).filter((h) => h.weapon === 'weapon_hammer')).toHaveLength(2);
      expect(d.of('impulse', 1)).toHaveLength(1);
      expect(d.of('status', 1).some((e) => e.family === 'immune' && e.state === 'blocked')).toBe(
        true,
      );
      expect(ticksOf(CC_IMMUNITY_SECONDS)).toBe(60);
    },
  );

  // --- Side Saw -----------------------------------------------------------------------------------
  const saw: TestCar = { parts: [{ id: 'weapon_saw', mount: 'right_front', turn: 1 }] };
  behavior('weapon_saw', 'bites a car rubbing its side for 7, by itself', () => {
    const d = duel(saw, BEETLE, { ahead: 10, aside: 50 });
    d.step(3);
    expect(d.of('shot', 0)).toHaveLength(1);
    const hit = d.of('hit', 1)[0]!;
    expect(hit).toMatchObject({ weapon: 'weapon_saw', cls: 'direct', damage: 7 });
    // The struck car is to the saw's right, so it is hit on its own left side.
    expect(d.b.components[hit.component]!.x).toBeLessThan(0);
  });
  limit('weapon_saw', 'guards one side only, needs contact, and bites once every 3 s', () => {
    const wrongSide = duel(saw, BEETLE, { ahead: 10, aside: -50 });
    wrongSide.step(100);
    expect(wrongSide.of('shot')).toEqual([]);
    const apart = duel(saw, BEETLE, { ahead: 10, aside: 75 });
    apart.step(100);
    expect(apart.of('shot')).toEqual([]);
    const d = duel(saw, BEETLE, { ahead: 10, aside: 50 });
    d.step(200);
    const bites = d.of('shot', 0).map((e) => e.tick);
    expect(bites).toHaveLength(3);
    expect(bites[1]! - bites[0]!).toBe(ticksOf(3));
  });

  // --- Grapple Harpoon ----------------------------------------------------------------------------
  behavior(
    'weapon_harpoon',
    'hooks a car and drags the two together for 2 s, with no damage and no stun',
    () => {
      const d = duel(
        armed('weapon_harpoon'),
        { chassis: 'chassis_beetle' },
        { ahead: 160, aside: 20 },
      );
      // The same two cars with no harpoon thrown, to see what the line alone does.
      const loose = duel(
        armed('weapon_harpoon'),
        { chassis: 'chassis_beetle' },
        { ahead: 160, aside: 20 },
      );
      loose.step(15);
      d.fire(0, 0, 12);
      expect(d.of('tether', 0)[0]).toMatchObject({ state: 'attached', target: 1 });
      const before = distance(d);
      // Both roll free, so the pull shows.
      const free = { brake: 0, coast: true };
      d.step(40, free, free);
      loose.step(40, free, free);
      expect(distance(d)).toBeLessThan(before - 20);
      const pulledA = loose.a.session.motion.x - d.a.session.motion.x;
      const pulledB = d.b.session.motion.x - loose.b.session.motion.x;
      // The thrower is drawn forward and the target back; the thrower less, at 35 percent.
      expect(pulledA).toBeGreaterThan(5);
      expect(pulledB).toBeGreaterThan(pulledA);
      expect(d.of('hit')).toEqual([]);
      expect(hasStatus(d.b, 'emp') || hasStatus(d.b, 'jam') || hasStatus(d.b, 'immune')).toBe(
        false,
      );
      d.step(30);
      expect(d.of('tether', 0).map((e) => e.state)).toEqual(['attached', 'released']);
      expect(d.of('tether', 0)[1]!.tick - d.of('tether', 0)[0]!.tick).toBe(ticksOf(2));
    },
  );
  limit('weapon_harpoon', 'misses outside its 30-degree cone and the line parts at 260', () => {
    const wide = duel(armed('weapon_harpoon'), BEETLE, { ahead: 140, aside: 90 });
    wide.fire(0, 0, 30);
    expect(wide.of('tether')).toEqual([]);
    expect(wide.of('impact')[0]!.on).toBe('expired');
    const d = duel(armed('weapon_harpoon'), BEETLE, { ahead: 160, aside: 20 });
    d.fire(0, 0, 12);
    d.placeB(420);
    d.step(2);
    expect(d.of('tether', 0).map((e) => e.state)).toEqual(['attached', 'released']);
    expect(d.module(d.a, 'weapon_harpoon').module.cooldownTotal).toBe(ticksOf(8));
  });

  // --- Air Cannon ---------------------------------------------------------------------------------
  behavior('weapon_air', 'a blast that shoves a car in its cone away, for almost no damage', () => {
    const d = duel(armed('weapon_air'), BEETLE, { ahead: 85 });
    d.fire(0);
    expect(d.of('area', 0)[0]).toMatchObject({ weapon: 'weapon_air', range: 110 });
    expect(componentDamageBy(d, 'weapon_air')).toBe(2);
    const shove = d.of('impulse', 1)[0]!;
    // Away from the muzzle: west. Strongest at the mouth, about 85 percent of 170 from here.
    expect(shove.dx).toBeLessThan(-120);
    expect(shove.dx).toBeGreaterThan(-170);
    expect(d.b.session.motion.x).toBeLessThan(11000 - 85 - 3);
  });
  limit(
    'weapon_air',
    'does nothing outside its 60-degree cone, and throws a rocket off its line',
    () => {
      const wide = duel(armed('weapon_air'), BEETLE, { ahead: 50, aside: 90 });
      wide.fire(0, 0, 10);
      expect(wide.of('impulse')).toEqual([]);
      expect(wide.of('hit')).toEqual([]);

      // The other car fires a rocket straight back at the air cannon.
      const d = duel(armed('weapon_air'), armed('weapon_rocket'), { ahead: 330, turnB: Math.PI });
      d.fire(1, 0, 10);
      const rocket = d.race.projectiles.find((p) => p.active)!;
      expect(rocket.kind).toBe('rocket');
      const closing = rocket.vx;
      expect(closing).toBeGreaterThan(10);
      while (Math.abs(rocket.x - d.a.session.motion.x) > 110) d.step(1);
      d.fire(0);
      expect(rocket.vx).toBeLessThan(closing - 3);
    },
  );

  // --- Steel Boomerang ----------------------------------------------------------------------------
  behavior('weapon_boomerang', 'flies out and comes back, 12 damage on each leg', () => {
    const d = duel(armed('weapon_boomerang'), BEETLE, { ahead: 130 });
    d.fire(0, 0, 60);
    const hits = d.of('hit', 1);
    expect(hits.map((h) => h.damage)).toEqual([12, 12]);
    expect(hits[1]!.tick).toBeGreaterThan(hits[0]!.tick + 5);
    // Out through the tail, back through the nose.
    expect(hits[0]!.component).toBe(COMPONENT_ENGINE);
    expect(hits[1]!.component).toBe(COMPONENT_STEERING);
    expect(d.of('impact').at(-1)).toMatchObject({ on: 'caught' });
  });
  limit(
    'weapon_boomerang',
    'one hit a leg however long it overlaps, and a catch gives 2 s of reload back',
    () => {
      const d = duel(armed('weapon_boomerang'), BEETLE, { ahead: 130 });
      d.fire(0);
      const module = d.module(d.a, 'weapon_boomerang').module;
      let caughtAt = 0;
      let before = 0;
      for (let i = 0; i < 80 && caughtAt === 0; i++) {
        before = module.cooldown;
        d.step(1);
        if (d.of('impact').some((e) => e.on === 'caught')) caughtAt = d.race.tick;
      }
      expect(caughtAt).toBeGreaterThan(0);
      expect(d.of('hit', 1)).toHaveLength(2);
      // The tick's own count, and two seconds handed back.
      expect(before - module.cooldown).toBe(ticksOf(2) + 1);
      // Thrown at nothing, it still comes home.
      const empty = duel(armed('weapon_boomerang'), BEETLE, { ahead: 130, aside: 200 });
      empty.fire(0, 0, 70);
      expect(empty.of('hit')).toEqual([]);
      expect(empty.of('impact').at(-1)!.on).toBe('caught');
    },
  );

  // --- Arc Mortar ---------------------------------------------------------------------------------
  const mortar: TestCar = { parts: [{ id: 'weapon_mortar', mount: 'roof_mid', fire: 'auto' }] };
  behavior(
    'weapon_mortar',
    'locks, paints a reticle, and 1.4 s later bursts for 25 at the centre',
    () => {
      const d = duel(mortar, BEETLE, { ahead: 220 });
      d.step(ticksOf(0.4) + 2);
      expect(d.of('lock', 0)[0]).toMatchObject({ locked: true });
      const reticle = d.of('telegraph', 0)[0]!;
      expect(reticle).toMatchObject({ weapon: 'weapon_mortar', radius: 60, ticks: ticksOf(1.4) });
      expect(reticle.x).toBeCloseTo(d.b.session.motion.x, 6);
      expect(d.of('explosion')).toEqual([]);
      d.step(ticksOf(1.4));
      const blast = d.of('explosion')[0]!;
      expect(blast.tick - reticle.tick).toBe(ticksOf(1.4));
      const hit = d.of('hit', 1)[0]!;
      expect(hit).toMatchObject({ cls: 'heavy', weapon: 'weapon_mortar', component: -1 });
      // Dead centre on the roof, clear of every component: the full 25 lands on bare body,
      // which passes the chassis share and the body share of it to the chassis.
      expect(hit.chassis).toBeCloseTo(25 * (CHASSIS_DAMAGE_SHARE + BODY_HIT_SHARE), 6);
    },
  );
  limit(
    'weapon_mortar',
    'cannot fire closer than 90, fades to 8 at the edge, can be dodged, and carries three',
    () => {
      const close = duel(mortar, BEETLE, { ahead: 80 });
      close.step(120);
      expect(close.of('lock')).toEqual([]);
      expect(close.of('telegraph')).toEqual([]);

      const edge = duel(mortar, BEETLE, { ahead: 220 });
      edge.step(ticksOf(0.4) + 3);
      edge.placeB(220, 60);
      edge.step(ticksOf(1.4));
      const graze = edge.of('hit', 1)[0]!;
      expect(graze.damage).toBeGreaterThan(8);
      expect(graze.damage).toBeLessThan(18);

      const dodge = duel(mortar, BEETLE, { ahead: 220 });
      dodge.step(ticksOf(0.4) + 3);
      dodge.placeB(220, 110);
      dodge.step(ticksOf(1.4));
      expect(dodge.of('explosion')).toHaveLength(1);
      expect(dodge.of('hit', 1)).toEqual([]);

      const d = duel(mortar, BEETLE, { ahead: 220 });
      for (let i = 0; i < 5; i++) {
        ready(d.a);
        d.step(ticksOf(0.4) + 3);
      }
      expect(d.of('telegraph')).toHaveLength(3);
      expect(d.module(d.a, 'weapon_mortar').module.charges).toBe(0);
    },
  );
});

// ================================================================================================
describe('defenses (Section 11.6)', () => {
  const rearPlate = (id: string): TestCar => ({ parts: [{ id, mount: 'rear_utility', turn: 2 }] });

  behavior(
    'defense_light_plate',
    'adds 25 armor to the arc it faces and takes hits there first',
    () => {
      const d = duel(BEETLE, rearPlate('defense_light_plate'));
      expect(d.b.armor).toEqual([0, 0, 25, 0]);
      // A whole plate stops the hit outright.
      expect(hitAt(d, d.b, 0, 34, 10)).toMatchObject({ armor: 10, damage: 0, chassis: 0 });
      expect(d.b.armor[2]).toBe(15);
      // A worn plate lets a share through: at 60 percent it stops 80 percent of the hit.
      const second = hitAt(d, d.b, 0, 34, 10);
      expect(second.armor).toBeCloseTo(8, 9);
      expect(second.damage).toBeCloseTo(2, 9);
      const third = hitAt(d, d.b, 0, 34, 10);
      expect(third.armor).toBeLessThan(second.armor);
      expect(third.damage).toBeGreaterThan(second.damage);
      // Armor is a pool of its own: it never goes below nothing.
      hitAt(d, d.b, 0, 34, 10);
      expect(d.b.armor[2]).toBe(0);
      expect(hitAt(d, d.b, 0, 34, 10)).toMatchObject({ armor: 0, damage: 10 });
    },
  );
  limit('defense_light_plate', 'protects only that arc, whichever way it is turned', () => {
    const d = duel(BEETLE, rearPlate('defense_light_plate'));
    expect(hitAt(d, d.b, 0, -34, 10).armor).toBe(0);
    expect(hitAt(d, d.b, 24, 0, 10).armor).toBe(0);
    const side = duel(BEETLE, {
      parts: [{ id: 'defense_light_plate', mount: 'right_front', turn: 1 }],
    });
    expect(side.b.armor).toEqual([0, 25, 0, 0]);
  });

  behavior(
    'defense_heavy_plate',
    'adds 75 armor: three rockets on the tail and the car behind it is barely marked',
    () => {
      const d = duel(armed('weapon_rocket'), rearPlate('defense_heavy_plate'), { ahead: 150 });
      for (let i = 0; i < 3; i++) {
        ready(d.a);
        d.fire(0, 0, 14);
      }
      expect(d.of('hit', 1)).toHaveLength(3);
      const hits = d.of('hit', 1);
      expect(hits[0]).toMatchObject({ armor: 22, damage: 0, chassis: 0 });
      const stopped = hits.reduce((sum, h) => sum + h.armor, 0);
      expect(stopped).toBeGreaterThan(66 * 0.85);
      expect(d.b.armor[2]).toBeCloseTo(75 - stopped, 9);
      // 66 damage arrived; the chassis took under 4 of it.
      expect(d.b.chassisMax - d.b.chassis).toBeLessThan(4);
    },
  );
  limit('defense_heavy_plate', 'is 145 kg of plate, and a railgun goes half through it', () => {
    const bare = duel(BEETLE, { parts: [] });
    const plated = duel(BEETLE, rearPlate('defense_heavy_plate'));
    expect(plated.b.session.params.massKg - bare.b.session.params.massKg).toBe(145);
    const d = duel(armed('weapon_railshot'), rearPlate('defense_heavy_plate'), { ahead: 300 });
    d.fire(0, 0, 30);
    const hit = d.of('hit', 1)[0]!;
    expect(hit.armor).toBeCloseTo(13.5, 6);
    expect(hit.damage).toBeGreaterThan(13);
  });

  behavior('defense_front_bumper', 'cuts the damage of a head-on ram by 35 percent', () => {
    const bare = duel(BEETLE, { parts: [] });
    const guarded = duel(BEETLE, {
      parts: [{ id: 'defense_front_bumper', mount: 'front_utility' }],
    });
    // Struck on the corner of the nose, clear of the bumper itself.
    const plain = hitAt(bare, bare.b, -20, -30, 20, 'ram');
    const cut = hitAt(guarded, guarded.b, -20, -30, 20, 'ram');
    expect(cut.damage + cut.chassis).toBeCloseTo((plain.damage + plain.chassis) * 0.65, 6);
  });
  limit(
    'defense_front_bumper',
    'does nothing for a hit from behind or for anything that is not a ram',
    () => {
      const d = duel(BEETLE, { parts: [{ id: 'defense_front_bumper', mount: 'front_utility' }] });
      const rear = hitAt(d, d.b, -20, 30, 20, 'ram');
      expect(rear.damage).toBe(20);
      const shot = hitAt(d, d.b, -20, -30, 20, 'direct');
      expect(shot.damage).toBe(20);
    },
  );

  behavior('defense_rear_bumper', 'cuts the damage of being hit from behind by 30 percent', () => {
    const d = duel(BEETLE, { parts: [{ id: 'defense_rear_bumper', mount: 'roof_mid', turn: 2 }] });
    const hit = hitAt(d, d.b, -20, 30, 20, 'ram');
    expect(hit.damage).toBeCloseTo(14, 6);
    expect(hit.chassis).toBeCloseTo(14 * CHASSIS_DAMAGE_SHARE, 6);
  });
  limit('defense_rear_bumper', 'helps only at the back', () => {
    const d = duel(BEETLE, { parts: [{ id: 'defense_rear_bumper', mount: 'roof_mid', turn: 2 }] });
    expect(hitAt(d, d.b, -20, -30, 20, 'ram').damage).toBe(20);
    expect(hitAt(d, d.b, -20, 30, 20, 'direct').damage).toBe(20);
  });

  behavior('defense_side_panels', 'puts 40 armor on each side of the car from one mount', () => {
    const d = duel(BEETLE, { parts: [{ id: 'defense_side_panels', mount: 'left_rear', turn: 3 }] });
    expect(d.b.armor).toEqual([0, 40, 0, 40]);
    expect(hitAt(d, d.b, 24, 0, 15)).toMatchObject({ armor: 15, damage: 0 });
    expect(hitAt(d, d.b, -24, 0, 15)).toMatchObject({ armor: 15, damage: 0 });
  });
  limit('defense_side_panels', 'does nothing for the nose or the tail', () => {
    const d = duel(BEETLE, { parts: [{ id: 'defense_side_panels', mount: 'left_rear', turn: 3 }] });
    expect(hitAt(d, d.b, 0, -34, 15).armor).toBe(0);
    expect(hitAt(d, d.b, 0, 34, 15).armor).toBe(0);
  });

  behavior('defense_wheel_cage', 'wheels take 45 percent less', () => {
    const d = duel(BEETLE, {
      chassis: 'chassis_beetle',
      parts: [{ id: 'defense_wheel_cage', mount: 'roof_mid' }],
    });
    const hit = hitAt(d, d.b, -14, -24, 20);
    expect(hit.component).toBe(FL);
    expect(hit.damage).toBeCloseTo(11, 6);
    // The chassis behind the wheel is not protected by a cage round the wheel.
    expect(hit.chassis).toBeCloseTo(20 * CHASSIS_DAMAGE_SHARE, 6);
  });
  limit('defense_wheel_cage', 'does nothing for the engine', () => {
    const d = duel(BEETLE, {
      chassis: 'chassis_beetle',
      parts: [{ id: 'defense_wheel_cage', mount: 'roof_mid' }],
    });
    expect(hitAt(d, d.b, 0, 29, 20)).toMatchObject({ component: COMPONENT_ENGINE, damage: 20 });
  });

  behavior('defense_engine_case', 'the engine takes 40 percent less', () => {
    const d = duel(BEETLE, {
      chassis: 'chassis_beetle',
      parts: [{ id: 'defense_engine_case', mount: 'roof_mid' }],
    });
    const hit = hitAt(d, d.b, 0, 29, 20);
    expect(hit.component).toBe(COMPONENT_ENGINE);
    expect(hit.damage).toBeCloseTo(12, 6);
  });
  limit('defense_engine_case', 'does nothing for a wheel', () => {
    const d = duel(BEETLE, {
      chassis: 'chassis_beetle',
      parts: [{ id: 'defense_engine_case', mount: 'roof_mid' }],
    });
    expect(hitAt(d, d.b, -14, -24, 20)).toMatchObject({ component: FL, damage: 20 });
  });

  behavior('defense_ceramic', 'bullets do 45 percent less', () => {
    const bare = duel(armed('weapon_front_mg'), { parts: [] });
    const tiled = duel(armed('weapon_front_mg'), {
      parts: [{ id: 'defense_ceramic', mount: 'roof_front' }],
    });
    bare.fire(0, 0, 25);
    tiled.fire(0, 0, 25);
    expect(damageBy(tiled, 'weapon_front_mg')).toBeCloseTo(
      damageBy(bare, 'weapon_front_mg') * 0.55,
      6,
    );
  });
  limit(
    'defense_ceramic',
    'is brittle: a ram does 10 percent more, and a rocket is no bullet',
    () => {
      const d = duel(BEETLE, { parts: [{ id: 'defense_ceramic', mount: 'roof_front' }] });
      expect(hitAt(d, d.b, -20, 30, 20, 'ram').damage).toBeCloseTo(22, 6);
      expect(hitAt(d, d.b, 20, 30, 20, 'direct').damage).toBe(20);
    },
  );

  behavior('defense_breakaway', 'soaks up the first 35 damage, then falls away', () => {
    const d = duel(BEETLE, { parts: ['defense_breakaway'] });
    expect(hitAt(d, d.b, 0, 34, 20)).toMatchObject({ absorbed: 20, damage: 0, chassis: 0 });
    const second = hitAt(d, d.b, 0, 34, 20);
    expect(second.absorbed).toBe(15);
    expect(second.damage + second.chassis).toBeGreaterThan(0);
    expect(d.of('shield', 1)).toMatchObject([{ state: 'broken' }]);
  });
  limit('defense_breakaway', 'works once a match', () => {
    const d = duel(BEETLE, { parts: ['defense_breakaway'] });
    hitAt(d, d.b, 0, 34, 40);
    const module = d.module(d.b, 'defense_breakaway').module;
    expect(module.pool).toBe(0);
    expect(module.charges).toBe(0);
    d.step(600);
    expect(hitAt(d, d.b, 0, 34, 10).absorbed).toBe(0);
  });

  behavior(
    'defense_composite',
    'every ordinary direct hit does 18 percent less, bullets included',
    () => {
      const d = duel(BEETLE, { parts: ['defense_composite'] });
      expect(hitAt(d, d.b, -20, 30, 20, 'direct').damage).toBeCloseTo(16.4, 6);
      expect(hitAt(d, d.b, 20, 30, 10, 'bullet').damage).toBeCloseTo(8.2, 6);
    },
  );
  limit('defense_composite', 'does nothing against a heavy hit, a ram or fire', () => {
    const d = duel(BEETLE, { parts: ['defense_composite'] });
    expect(hitAt(d, d.b, -20, 30, 20, 'heavy').damage).toBe(20);
    expect(hitAt(d, d.b, 20, 30, 10, 'ram').damage).toBe(10);
    expect(hitAt(d, d.b, 20, -30, 10, 'burn', { bypass: true }).damage).toBe(10);
  });

  behavior('defense_energy_shield', 'takes up to 25 from one hit, then is back after 12 s', () => {
    const d = duel(BEETLE, { parts: ['defense_energy_shield'] });
    const shield = d.module(d.b, 'defense_energy_shield').module;
    expect(shield.pool).toBe(25);
    expect(hitAt(d, d.b, 0, 34, 20)).toMatchObject({ shield: 20, damage: 0, chassis: 0 });
    // One hit and it is down, however little of it was used.
    expect(shield.pool).toBe(0);
    expect(hitAt(d, d.b, 0, 34, 20).shield).toBe(0);
    d.step(ticksOf(12) - 1);
    expect(shield.pool).toBe(0);
    d.step(1);
    expect(shield.pool).toBe(25);
    expect(d.of('shield', 1).map((e) => e.state)).toEqual(['down', 'up']);
    expect(hitAt(d, d.b, 0, 34, 40)).toMatchObject({ shield: 25 });
  });
  limit('defense_energy_shield', 'an EMP drops it, and it does not recharge without power', () => {
    const d = duel(BEETLE, { parts: ['defense_energy_shield'] });
    const shield = d.module(d.b, 'defense_energy_shield').module;
    applyEmp(d.race, d.b, 45, 0);
    expect(shield.pool).toBe(0);
    expect(
      d.of('shield', 1).length + d.race.events.filter((e) => e.type === 'shield').length,
    ).toBeGreaterThan(0);
    expect(hitAt(d, d.b, 0, 34, 20).shield).toBe(0);
    // While the EMP lasts the recharge does not run.
    const waiting = shield.cooldown;
    d.step(40);
    expect(shield.cooldown).toBe(waiting);
    d.step(10);
    expect(shield.cooldown).toBeLessThan(waiting);

    // More draw than the car generates, and an empty battery: the shield waits for power.
    const starved = duel(BEETLE, {
      parts: [
        'defense_energy_shield',
        'utility_fan',
        'utility_gyro',
        'utility_traction',
        'utility_spoiler',
        'utility_targeting',
      ],
    });
    const hungry = starved.module(starved.b, 'defense_energy_shield').module;
    hitAt(starved, starved.b, 0, 34, 20);
    starved.b.session.motion.batteryEnergy = 0;
    starved.step(1);
    expect(starved.b.session.telemetry.lowPower).toBe(true);
    const held = hungry.cooldown;
    starved.step(30);
    expect(hungry.cooldown).toBe(held);
  });

  behavior('defense_faraday', 'an EMP lasts 70 percent less', () => {
    const bare = duel(BEETLE, { parts: [] });
    const caged = duel(BEETLE, { parts: ['defense_faraday'] });
    applyEmp(bare.race, bare.b, 45, 0);
    applyEmp(caged.race, caged.b, 45, 0);
    expect(bare.b.statusTicks[3]).toBe(45);
    expect(caged.b.statusTicks[3]).toBe(Math.round(45 * 0.3));
  });
  limit('defense_faraday', 'shortens a Tesla jam too, and stops no damage', () => {
    const d = duel(
      { parts: [{ id: 'weapon_tesla', mount: 'roof_front' }] },
      { parts: ['defense_faraday'] },
      {
        ahead: 10,
        aside: 80,
      },
    );
    d.step(2);
    expect(d.b.statusTicks[4]).toBeLessThanOrEqual(Math.round(ticksOf(0.6) * 0.3));
    expect(componentDamageBy(d, 'weapon_tesla')).toBe(12);
  });

  behavior('defense_heatguard', 'heat that a weapon puts into the car is cut by 55 percent', () => {
    const heatOf = (parts: TestPart[]) => {
      const d = duel(armed('weapon_flame'), { parts }, { ahead: 85 });
      // Cooling is taken out of it, so only what the flame put in is compared.
      d.b.session.params = {
        ...d.b.session.params,
        heat: { ...d.b.session.params.heat, cooling: 0, enginePerSecond: 0 },
      };
      d.fire(0, 0, 70);
      return d.b.session.motion.coreHeat;
    };
    const bare = heatOf([]);
    expect(bare).toBeCloseTo(20, 1);
    expect(heatOf(['defense_heatguard'])).toBeCloseTo(bare * 0.45, 1);
  });
  limit('defense_heatguard', 'does not stop the burn itself', () => {
    const bare = duel(armed('weapon_flame'), { parts: [] }, { ahead: 85 });
    const guarded = duel(armed('weapon_flame'), { parts: ['defense_heatguard'] }, { ahead: 85 });
    bare.fire(0, 0, 80);
    guarded.fire(0, 0, 80);
    expect(componentDamageBy(guarded, 'weapon_flame')).toBeCloseTo(
      componentDamageBy(bare, 'weapon_flame'),
      6,
    );
  });

  const intercepted: TestCar = { parts: [{ id: 'defense_antimissile', mount: 'roof_front' }] };
  behavior('defense_antimissile', 'shoots down a guided missile homing on its car', () => {
    const d = duel(armed('weapon_homing'), intercepted, { ahead: 190 });
    d.step(ticksOf(0.6) + 1);
    const battery = d.b.session.motion.batteryEnergy;
    d.fire(0, 0, 40);
    expect(d.of('hit', 1)).toEqual([]);
    expect(d.of('impact').at(-1)).toMatchObject({ on: 'intercepted', weapon: 'weapon_homing' });
    expect(d.of('beam', 1)[0]).toMatchObject({ weapon: 'defense_antimissile' });
    // It costs 6 energy to fire.
    expect(d.b.session.motion.batteryEnergy).toBeLessThanOrEqual(battery - 6 + 40 * 10 * SIM_DT);
    expect(d.module(d.b, 'defense_antimissile').module.state).toBe(MODULE_COOLDOWN);
  });
  limit(
    'defense_antimissile',
    'one every 14 s, and nothing at all against an unguided rocket',
    () => {
      const d = duel(armed('weapon_homing'), intercepted, { ahead: 190 });
      d.step(ticksOf(0.6) + 1);
      d.fire(0, 0, 40);
      d.a.modules[0]!.cooldown = 0;
      d.step(ticksOf(0.6) + 1);
      d.fire(0, 0, 40);
      expect(d.of('hit', 1).filter((h) => h.weapon === 'weapon_homing')).toHaveLength(1);
      expect(d.module(d.b, 'defense_antimissile').module.cooldownTotal).toBe(ticksOf(14));

      const rocket = duel(armed('weapon_rocket'), intercepted, { ahead: 150 });
      rocket.fire(0, 0, 20);
      expect(rocket.of('hit', 1)).toHaveLength(1);
      expect(rocket.of('impact').some((e) => e.on === 'intercepted')).toBe(false);
    },
  );

  const sweeper: TestCar = { parts: [{ id: 'defense_minesweeper', mount: 'front_utility' }] };
  behavior('defense_minesweeper', 'clears a trap just ahead of the car', () => {
    const d = duel(sweeper, layer, { ahead: 200 });
    const mine = layMine(d);
    // Out of reach: nothing happens.
    expect(mine.active).toBe(true);
    d.a.session.motion.x = mine.x + 70;
    d.step(2);
    expect(mine.active).toBe(false);
    expect(d.of('hazard').at(-1)).toMatchObject({ kind: 'mine', state: 'cleared', car: 0 });
    expect(d.of('beam', 0)[0]).toMatchObject({ weapon: 'defense_minesweeper' });
    expect(d.of('hit')).toEqual([]);
  });
  limit('defense_minesweeper', 'one trap every 8 s, and only in the 70 degrees ahead', () => {
    const d = duel(sweeper, layer, { ahead: 200 });
    const first = layMine(d);
    d.a.session.motion.x = first.x + 70;
    d.step(2);
    expect(first.active).toBe(false);
    // A second mine at once is not cleared: the sweeper is still resetting.
    ready(d.b);
    d.placeB(450);
    const second = layMine(d);
    d.a.session.motion.x = second.x + 70;
    d.step(5);
    expect(second.active).toBe(true);
    expect(d.module(d.a, 'defense_minesweeper').module.cooldownTotal).toBe(ticksOf(8));

    const behind = duel(sweeper, layer, { ahead: 200 });
    const mine = layMine(behind);
    behind.a.session.motion.x = mine.x - 70;
    behind.step(3);
    expect(mine.active).toBe(true);
  });

  behavior('defense_fireproof', 'burn damage is cut by 60 percent', () => {
    const bare = duel(armed('weapon_flame'), { parts: [] }, { ahead: 85 });
    const lined = duel(armed('weapon_flame'), { parts: ['defense_fireproof'] }, { ahead: 85 });
    bare.fire(0, 0, 80);
    lined.fire(0, 0, 80);
    expect(damageBy(lined, 'weapon_flame')).toBeCloseTo(damageBy(bare, 'weapon_flame') * 0.4, 6);
  });
  limit('defense_fireproof', 'the heat still gets in', () => {
    const d = duel(armed('weapon_flame'), { parts: ['defense_fireproof'] }, { ahead: 85 });
    d.b.session.params = {
      ...d.b.session.params,
      heat: { ...d.b.session.params.heat, cooling: 0, enginePerSecond: 0 },
    };
    d.fire(0, 0, 70);
    expect(d.b.session.motion.coreHeat).toBeCloseTo(20, 1);
  });

  behavior('defense_oilproof', 'an oil slick costs 70 percent less grip', () => {
    const d = duel(rearArmed('weapon_oil'), { parts: ['defense_oilproof'] }, { ahead: -300 });
    d.fire(0);
    const strip = d.race.hazards.find((h) => h.active)!;
    stepAside(d);
    d.placeB(-(strip.x - 11000));
    d.step(2);
    expect(statusMagnitude(d.b, 'grip')).toBeCloseTo(0.45 * 0.3, 9);
  });
  limit('defense_oilproof', 'does nothing against frost', () => {
    const d = duel(armed('weapon_frost'), { parts: ['defense_oilproof'] }, { ahead: 150 });
    d.fire(0, 0, 15);
    expect(statusMagnitude(d.b, 'grip')).toBe(0.2);
  });

  behavior('defense_damper', 'the car is knocked 35 percent less far', () => {
    const bare = duel(BEETLE, { parts: [] });
    const damped = duel(BEETLE, { parts: ['defense_damper'] });
    applyImpulse(bare.race, bare.b, 0, -100, 0, 'test', false);
    applyImpulse(damped.race, damped.b, 0, -100, 0, 'test', false);
    // Per kilogram: the dampers themselves weigh 92 kg, which also counts.
    const perMass = (d: Duel) =>
      Math.abs(d.b.session.motion.velocityY) /
      Math.min(1.5, Math.max(0.6, 393 / d.b.session.params.massKg));
    expect(perMass(damped)).toBeCloseTo(perMass(bare) * 0.65, 6);
  });
  limit('defense_damper', 'takes 15 percent off a ram and nothing off a bullet', () => {
    const d = duel(BEETLE, { parts: ['defense_damper'] });
    expect(hitAt(d, d.b, -20, 30, 20, 'ram').damage).toBeCloseTo(17, 6);
    expect(hitAt(d, d.b, 20, 30, 20, 'bullet').damage).toBe(20);
  });

  behavior('defense_steer_assist', 'damaged steering costs 60 percent less response', () => {
    const bare = duel(BEETLE, { parts: [] });
    const assisted = duel(BEETLE, { parts: ['defense_steer_assist'] });
    for (const d of [bare, assisted]) {
      repairComponent(d.race, d.b, COMPONENT_STEERING, -100);
      computeEffects(d.b);
    }
    expect(bare.b.session.effects.steerScale).toBe(STEERING_LIMP_SCALE);
    expect(1 - assisted.b.session.effects.steerScale).toBeCloseTo(
      (1 - STEERING_LIMP_SCALE) * 0.4,
      9,
    );
    expect(assisted.b.session.effects.steerLag).toBeCloseTo(
      bare.b.session.effects.steerLag * 0.4,
      9,
    );
  });
  limit(
    'defense_steer_assist',
    'does nothing until the steering is hit, and nothing for a wheel',
    () => {
      const d = duel(BEETLE, { parts: ['defense_steer_assist'] });
      computeEffects(d.b);
      expect(d.b.session.effects.steerScale).toBe(1);
      const bare = duel(BEETLE, { parts: [] });
      for (const car of [d.b, bare.b]) {
        car.components[FL]!.integrity = 0;
        computeEffects(car);
      }
      expect(d.b.session.effects.grip).toBe(bare.b.session.effects.grip);
    },
  );

  behavior('defense_reactive', 'takes 40 percent off the first heavy hit', () => {
    const d = duel(BEETLE, { parts: ['defense_reactive'] });
    const hit = hitAt(d, d.b, -20, 30, 30, 'heavy');
    expect(hit.absorbed).toBeCloseTo(12, 6);
    expect(hit.damage).toBeCloseTo(18, 6);
    expect(d.module(d.b, 'defense_reactive').module.state).toBe(MODULE_COOLDOWN);
  });
  limit(
    'defense_reactive',
    'ordinary hits pass straight through, and it needs 16 s between heavy ones',
    () => {
      const d = duel(BEETLE, { parts: ['defense_reactive'] });
      const module = d.module(d.b, 'defense_reactive').module;
      expect(hitAt(d, d.b, -20, 30, 15)).toMatchObject({ absorbed: 0, damage: 15 });
      expect(module.cooldown).toBe(0);
      hitAt(d, d.b, -20, 30, 30, 'heavy');
      expect(hitAt(d, d.b, 20, 30, 30, 'heavy').absorbed).toBe(0);
      d.step(ticksOf(16));
      expect(hitAt(d, d.b, 20, -30, 30, 'heavy').absorbed).toBeCloseTo(12, 6);
    },
  );
});

// ================================================================================================
describe('utilities (Sections 8.2, 11.7)', () => {
  // --- Spare Wheel ----------------------------------------------------------------------------------
  behavior('utility_spare', 'replaces the most damaged wheel after a one-second action', () => {
    const d = duel({
      chassis: 'chassis_beetle',
      parts: [{ id: 'utility_spare', mount: 'left_utility' }],
    });
    repairComponent(d.race, d.a, FR, -90);
    repairComponent(d.race, d.a, FL, -50);
    d.use(0);
    expect(d.of('utility', 0)[0]).toMatchObject({
      utility: 'utility_spare',
      state: 'started',
      value: FR,
    });
    // Section 8.2: fitting it costs 20 percent of acceleration for a second.
    expect(statusMagnitude(d.a, 'refit')).toBe(0.2);
    computeEffects(d.a);
    expect(d.a.session.effects.drive).toBeLessThanOrEqual(0.8);
    d.step(ticksOf(1) - 4);
    expect(d.a.components[FR]!.integrity).toBe(10);
    d.step(2);
    expect(d.a.components[FR]!.integrity).toBe(100);
    expect(d.a.components[FL]!.integrity).toBe(50);
    expect(d.a.session.wheelIntegrity[1]).toBe(100);
    expect(d.of('utility', 0).map((e) => e.state)).toEqual(['started', 'done']);
    expect(d.of('component', 0).at(-1)).toMatchObject({
      component: FR,
      repaired: true,
      condition: 'healthy',
    });
  });
  limit(
    'utility_spare',
    'fits the wheel picked on the silhouette, is used up once, and is kept when not needed',
    () => {
      const d = duel({
        chassis: 'chassis_beetle',
        parts: [{ id: 'utility_spare', mount: 'left_utility' }],
      });
      d.use(0);
      expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['not_needed']);
      expect(d.a.modules[0]!.charges).toBe(1);
      d.a.components[FR]!.integrity = 10;
      d.a.components[FL]!.integrity = 50;
      d.use(0, 0, ticksOf(1), FL + 1);
      expect(d.a.components[FL]!.integrity).toBe(100);
      expect(d.a.components[FR]!.integrity).toBe(10);
      expect(d.a.modules[0]!.charges).toBe(0);
      d.step(90);
      d.use(0);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('no_ammo');
    },
  );

  // --- Repair Kit -----------------------------------------------------------------------------------
  const kits: TestCar = {
    chassis: 'chassis_beetle',
    parts: [
      { id: 'utility_repair', mount: 'left_utility' },
      { id: 'utility_repair', mount: 'right_utility' },
    ],
  };
  behavior(
    'utility_repair',
    'restores 40 integrity after 1.3 s, to the worst critical core part by default',
    () => {
      const d = duel(kits, kits);
      d.a.components[COMPONENT_ENGINE]!.integrity = 15;
      d.a.components[FL]!.integrity = 18;
      d.use(0);
      expect(d.of('utility', 0)[0]).toMatchObject({ state: 'started', value: COMPONENT_ENGINE });
      d.step(ticksOf(1.3) - 4);
      expect(d.a.components[COMPONENT_ENGINE]!.integrity).toBe(15);
      d.step(2);
      expect(d.a.components[COMPONENT_ENGINE]!.integrity).toBe(55);
      expect(d.a.modules[0]!.charges).toBe(0);
      expect(d.a.modules[1]!.charges).toBe(1);
      // Section 19.2: one driver's repair never touches the other's inventory.
      expect(d.b.modules.map((m) => m.charges)).toEqual([1, 1]);
      expect(d.b.components.every((c) => c.integrity === c.maxIntegrity)).toBe(true);
    },
  );
  limit(
    'utility_repair',
    'cannot be spammed, never overfills, and an EMP interrupts it without taking the kit',
    () => {
      const d = duel(kits);
      d.a.components[COMPONENT_ENGINE]!.integrity = 15;
      d.a.components[FL]!.integrity = 80;
      d.use(0);
      // The second kit at once: refused while a repair is under way.
      d.use(0, 1);
      expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['busy']);
      d.step(ticksOf(1.3) + ticksOf(2));
      // A chosen part, and no more than it can hold.
      d.use(0, 1, ticksOf(1.3), FL + 1);
      expect(d.a.components[FL]!.integrity).toBe(100);
      expect(d.a.modules.map((m) => m.charges)).toEqual([0, 0]);

      const cut = duel(kits);
      cut.a.components[COMPONENT_ENGINE]!.integrity = 15;
      cut.use(0, 0, 5);
      applyEmp(cut.race, cut.a, 30, 1);
      cut.step(2);
      expect(cut.of('utility', 0).map((e) => e.state)).toEqual(['started', 'interrupted']);
      expect(cut.a.modules[0]!.charges).toBe(1);
      expect(cut.a.components[COMPONENT_ENGINE]!.integrity).toBe(15);
      // Section 8.2: recovery items can be disrupted but not robbed. It works afterwards.
      cut.step(ticksOf(1) + ticksOf(CC_IMMUNITY_SECONDS));
      cut.use(0, 0, ticksOf(1.3));
      expect(cut.a.components[COMPONENT_ENGINE]!.integrity).toBe(55);
    },
  );

  // --- Cooling Fan and Racing Radiator --------------------------------------------------------------
  const cooling = (parts: TestPart[], emp = false) => {
    const d = duel({ chassis: 'chassis_beetle', parts });
    d.a.session.motion.coreHeat = 60;
    if (emp) applyStatus(d.race, d.a, 'emp', 1, 30, 1);
    d.step(1);
    return d.a.session.telemetry.heatCooling;
  };
  behavior('utility_fan', 'adds 4 cooling while it has power', () => {
    const bare = cooling([]);
    expect(cooling([{ id: 'utility_fan', mount: 'left_utility' }]) / bare).toBeCloseTo(12 / 8, 6);
  });
  limit('utility_fan', 'stops cooling when an EMP has its power', () => {
    const bare = cooling([]);
    expect(cooling([{ id: 'utility_fan', mount: 'left_utility' }], true)).toBeCloseTo(bare, 6);
  });
  behavior('utility_radiator', 'adds 9 cooling with no power needed', () => {
    const bare = cooling([]);
    expect(cooling([{ id: 'utility_radiator', mount: 'roof_mid' }]) / bare).toBeCloseTo(17 / 8, 6);
  });
  limit('utility_radiator', 'keeps cooling through an EMP, unlike the fan', () => {
    const powered = cooling([{ id: 'utility_radiator', mount: 'roof_mid' }]);
    expect(cooling([{ id: 'utility_radiator', mount: 'roof_mid' }], true)).toBeCloseTo(powered, 6);
  });

  // --- Extra Battery, Auxiliary Generator, Burst Capacitor --------------------------------------
  behavior(
    'utility_battery',
    'stores 65 more energy: two EMP pulses where the stock battery holds one',
    () => {
      const d = duel({
        parts: [{ id: 'weapon_emp', mount: 'roof_front', fire: 0 }, 'utility_battery'],
      });
      expect(d.a.session.params.power.capacity).toBe(105);
      expect(d.a.session.motion.batteryEnergy).toBe(105);
      d.fire(0);
      d.a.modules[0]!.cooldown = 0;
      d.a.modules[0]!.phase = 0;
      d.fire(0);
      expect(d.of('windup', 0)).toHaveLength(2);
    },
  );
  limit(
    'utility_battery',
    'stores, never generates; and a destroyed battery takes its charge with it',
    () => {
      const d = duel({ parts: ['utility_battery'] });
      expect(d.a.session.params.power.generation).toBe(10);
      repairComponent(d.race, d.a, d.module(d.a, 'utility_battery').component, -200);
      expect(d.a.session.params.power.capacity).toBe(40);
      d.step(1);
      expect(d.a.session.motion.batteryEnergy).toBeLessThanOrEqual(40);
      expect(d.a.session.params.massKg).toBe(d.a.baseParams.massKg);
    },
  );

  behavior('utility_generator', 'generates 12 more power a second', () => {
    const refill = (parts: TestPart[]) => {
      const d = duel({ parts });
      d.a.session.motion.batteryEnergy = 0;
      d.step(30);
      return d.a.session.motion.batteryEnergy;
    };
    expect(refill([])).toBeCloseTo(10, 6);
    expect(refill(['utility_generator'])).toBeCloseTo(22, 6);
  });
  limit('utility_generator', 'makes 3 heat a second for it', () => {
    const d = duel({ parts: ['utility_generator'] });
    const bare = duel({ parts: [] });
    d.step(1);
    bare.step(1);
    expect(
      d.a.session.telemetry.heatProduction - bare.a.session.telemetry.heatProduction,
    ).toBeCloseTo(3, 6);
  });

  behavior(
    'utility_capacitor',
    'holds 30 energy for a big shot when the battery cannot pay',
    () => {
      const d = duel({
        parts: [{ id: 'weapon_emp', mount: 'roof_front', fire: 0 }, 'utility_capacitor'],
      });
      expect(d.a.reserve).toBe(30);
      d.a.session.motion.batteryEnergy = 4;
      d.fire(0);
      expect(d.of('windup', 0)).toHaveLength(1);
      expect(d.a.reserve).toBe(0);
      // The battery was not asked for more than the capacitor could not cover.
      expect(d.a.session.motion.batteryEnergy).toBeGreaterThan(3);
    },
  );
  limit(
    'utility_capacitor',
    'is for bursts only (6 energy or more), and refills from the battery at 5 a second',
    () => {
      const d = duel({
        parts: [{ id: 'weapon_front_mg', mount: 'roof_front', fire: 0 }, 'utility_capacitor'],
      });
      d.a.session.motion.batteryEnergy = 0;
      d.fire(0);
      // The gun takes 2 a burst: too small to call on the reserve.
      expect(d.of('refused', 0)[0]!.reason).toBe('low_power');
      expect(d.a.reserve).toBe(30);

      const refill = duel({ parts: ['utility_capacitor'] });
      refill.a.reserve = 0;
      refill.step(30);
      expect(refill.a.reserve).toBeCloseTo(5, 6);
      // Never from a battery that is nearly flat.
      refill.a.reserve = 0;
      refill.a.session.motion.batteryEnergy = 2;
      refill.step(3);
      expect(refill.a.reserve).toBe(0);
    },
  );

  // --- Nitro Tank and Emergency Booster ---------------------------------------------------------
  const sprint = (parts: TestPart[], press: boolean) => {
    const d = duel({ chassis: 'chassis_beetle', parts }, BEETLE, { ahead: 0, aside: 250 });
    d.step(30, GO);
    if (press) d.step(2, { ...GO, use: 1 });
    else d.step(2, GO);
    d.step(43, GO);
    return d;
  };
  behavior('utility_nitro', 'a 1.5-second burst of 60 percent more engine force', () => {
    const d = sprint([{ id: 'utility_nitro', mount: 'left_utility' }], true);
    const plain = sprint([{ id: 'utility_nitro', mount: 'left_utility' }], false);
    expect(d.of('utility', 0)[0]).toMatchObject({ state: 'started', value: ticksOf(1.5) });
    expect(d.of('status', 0)[0]).toMatchObject({ family: 'boost', ticks: ticksOf(1.5) });
    expect(d.of('status', 0)[0]!.magnitude).toBeCloseTo(0.6, 9);
    expect(speedOf(d.a)).toBeGreaterThan(speedOf(plain.a) * 1.1);
    expect(d.a.modules[0]!.charges).toBe(1);
  });
  limit('utility_nitro', 'two bursts a match, 6 heat each, and one at a time', () => {
    const d = duel({
      chassis: 'chassis_beetle',
      parts: [{ id: 'utility_nitro', mount: 'left_utility' }],
    });
    const heat = d.a.session.motion.coreHeat;
    d.use(0);
    expect(d.a.session.motion.coreHeat - heat).toBeGreaterThan(5);
    d.use(0);
    expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['busy']);
    expect(d.a.modules[0]!.charges).toBe(1);
    d.step(ticksOf(1.5));
    d.use(0, 0, ticksOf(1.5));
    d.use(0);
    expect(d.of('refused', 0).at(-1)!.reason).toBe('no_ammo');
    expect(d.a.modules[0]!.charges).toBe(0);
  });

  behavior('utility_overdrive', 'two seconds of 50 percent more torque', () => {
    const d = sprint([{ id: 'utility_overdrive', mount: 'left_utility' }], true);
    const plain = sprint([{ id: 'utility_overdrive', mount: 'left_utility' }], false);
    expect(d.of('status', 0)[0]).toMatchObject({
      family: 'boost',
      magnitude: 0.5,
      ticks: ticksOf(2),
    });
    expect(speedOf(d.a)).toBeGreaterThan(speedOf(plain.a) * 1.08);
  });
  limit('utility_overdrive', 'adds 28 heat a use and needs 15 s between uses', () => {
    const d = duel({
      chassis: 'chassis_beetle',
      parts: [{ id: 'utility_overdrive', mount: 'left_utility' }],
    });
    d.use(0);
    expect(d.a.session.motion.coreHeat).toBeGreaterThan(27);
    d.step(ticksOf(2) + 5);
    d.use(0);
    expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['cooldown']);
    d.step(ticksOf(15));
    d.use(0);
    expect(d.of('utility', 0).filter((e) => e.state === 'started')).toHaveLength(2);
    // No charges to run out of.
    expect(d.a.modules[0]!.charges).toBe(-1);
  });

  // --- Powered handling aids: Traction Computer, Gyro Stabilizer, Active Wing -------------------
  const powered = (id: string, emp: boolean) => {
    const d = duel({ parts: [id] });
    if (emp) applyStatus(d.race, d.a, 'emp', 1, 30, 1);
    d.step(2);
    return d.a.session.scratch.power;
  };
  behavior('utility_traction', 'keeps 12 percent more grip in a slide while it has power', () => {
    expect(powered('utility_traction', false).slipRecoveryAdd).toBeCloseTo(0.12, 9);
    expect(powered('utility_traction', false).stabilityAdd).toBe(4);
  });
  limit('utility_traction', 'gives nothing while an EMP has it down', () => {
    expect(powered('utility_traction', true).slipRecoveryAdd).toBe(0);
  });
  behavior('utility_gyro', 'adds 16 stability while it has power', () => {
    expect(powered('utility_gyro', false).stabilityAdd).toBe(16);
  });
  limit(
    'utility_gyro',
    'gives nothing while an EMP has it down, and nothing once destroyed',
    () => {
      expect(powered('utility_gyro', true).stabilityAdd).toBe(0);
      const d = duel({ parts: ['utility_gyro'] });
      repairComponent(d.race, d.a, d.module(d.a, 'utility_gyro').component, -200);
      d.step(2);
      expect(d.a.session.scratch.power.stabilityAdd).toBe(0);
      expect(d.a.session.params.power.consumers).toEqual([]);
    },
  );
  behavior('utility_spoiler', 'adds downforce and 5 stability while it has power', () => {
    expect(powered('utility_spoiler', false).downforce).toBeCloseTo(0.1, 9);
    expect(powered('utility_spoiler', false).stabilityAdd).toBe(5);
  });
  limit(
    'utility_spoiler',
    'gives nothing while an EMP has it down, and still costs its drag',
    () => {
      expect(powered('utility_spoiler', true).downforce).toBe(0);
      const d = duel({ parts: ['utility_spoiler'] });
      const bare = duel({ parts: [] });
      expect(d.a.session.params.dragQuadratic / bare.a.session.params.dragQuadratic).toBeCloseTo(
        1.04,
        6,
      );
    },
  );
  behavior('utility_ballast', 'gives 5 percent more grip at full lock and 8 stability', () => {
    const d = duel({ parts: ['utility_ballast'] });
    const bare = duel({ parts: [] });
    expect(d.a.session.params.corneringGrip).toBeCloseTo(0.05, 9);
    expect(d.a.session.params.stability - bare.a.session.params.stability).toBeGreaterThan(0);
  });
  limit('utility_ballast', 'is 90 kg everywhere else, and dead weight once destroyed', () => {
    const d = duel({ parts: ['utility_ballast'] });
    const bare = duel({ parts: [] });
    expect(d.a.session.params.massKg - bare.a.session.params.massKg).toBe(90);
    repairComponent(d.race, d.a, d.module(d.a, 'utility_ballast').component, -200);
    expect(d.a.session.params.corneringGrip).toBe(0);
    expect(d.a.session.params.massKg - bare.a.session.params.massKg).toBe(90);
  });

  // --- Radar and Mine Detector: information ---------------------------------------------------------
  behavior('utility_radar', 'tracks the rival from 50 percent farther', () => {
    const bare = duel({ parts: [] }, BEETLE, { ahead: 800 });
    const radar = duel({ parts: ['utility_radar'] }, BEETLE, { ahead: 800 });
    expect(bare.a.trackRange).toBe(RIVAL_TRACK_RANGE);
    expect(radar.a.trackRange).toBe(RIVAL_TRACK_RANGE * 1.5);
    expect(rivalTracked(bare.race, 0, 1)).toBe(false);
    expect(rivalTracked(radar.race, 0, 1)).toBe(true);
  });
  limit('utility_radar', 'warns of a missile half a second sooner, and stops none of it', () => {
    const warnedAt = (parts: TestPart[]) => {
      const d = duel(armed('weapon_homing'), { parts }, { ahead: 215 });
      d.step(ticksOf(0.6) + 1);
      d.fire(0, 0, 60);
      const shot = d.of('shot', 0)[0]!;
      const warning = d.of('warning', 1).find((e) => e.kind === 'missile')!;
      const hit = d.of('hit', 1)[0]!;
      expect(hit.damage).toBe(20);
      return { lead: hit.tick - warning.tick, flight: hit.tick - shot.tick };
    };
    const bare = warnedAt([]);
    const radar = warnedAt(['utility_radar']);
    expect(bare.lead).toBeLessThanOrEqual(ticksOf(0.5) + 1);
    expect(radar.lead).toBeGreaterThan(bare.lead);
    expect(radar.lead).toBeLessThanOrEqual(Math.min(radar.flight, ticksOf(1) + 1));
  });

  behavior('utility_minesensor', 'reveals an enemy trap 120 pixels sooner and calls it out', () => {
    const d = duel({ parts: ['utility_minesensor'] }, layer, { ahead: 300 });
    expect(d.a.revealRange).toBe(HAZARD_REVEAL_RANGE + 120);
    d.fire(1, 0, 3);
    const mine = d.race.hazards.find((h) => h.active)!;
    expect(mine.revealMask & 1).toBe(0);
    d.a.session.motion.x = mine.x + 200;
    d.step(2);
    expect(mine.revealMask & 1).toBe(1);
    expect(d.of('warning', 0)).toMatchObject([{ kind: 'trap', by: 1, value: mine.id }]);
  });
  limit(
    'utility_minesensor',
    'warns, it does not clear; and without one a trap is seen only from 90',
    () => {
      const d = duel({ parts: [] }, layer, { ahead: 300 });
      d.fire(1, 0, 3);
      const mine = d.race.hazards.find((h) => h.active)!;
      d.a.session.motion.x = mine.x + 200;
      d.step(2);
      expect(mine.revealMask & 1).toBe(0);
      d.a.session.motion.x = mine.x + 95;
      d.step(2);
      expect(mine.revealMask & 1).toBe(1);
      // Close enough to see, but nobody called it out.
      expect(d.of('warning', 0)).toEqual([]);

      const sensor = duel({ parts: ['utility_minesensor'] }, layer, { ahead: 300 });
      const live = layMine(sensor);
      sensor.a.session.motion.x = live.x + 4;
      sensor.step(2);
      expect(sensor.of('hit', 0).length).toBeGreaterThan(0);
    },
  );

  // --- Decoy Drone ------------------------------------------------------------------------------------
  const decoyCar: TestCar = { parts: ['utility_decoy'] };
  behavior('utility_decoy', 'draws a guided missile away from the car', () => {
    const d = duel(armed('weapon_homing'), decoyCar, { ahead: 200 });
    d.step(ticksOf(0.6) + 1);
    d.fire(0);
    d.use(1, 0, 40);
    expect(d.of('utility', 1)[0]).toMatchObject({ utility: 'utility_decoy', state: 'started' });
    expect(d.of('hazard').some((e) => e.kind === 'decoy' && e.state === 'placed')).toBe(true);
    expect(d.of('hit', 1)).toEqual([]);
    // The missile went off on the drone.
    expect(d.of('explosion')).toHaveLength(1);
    expect(d.of('hazard').some((e) => e.kind === 'decoy' && e.state === 'triggered')).toBe(true);
  });
  limit('utility_decoy', 'two a match, and useless against a rocket that is not guided', () => {
    const d = duel(armed('weapon_rocket'), decoyCar, { ahead: 200 });
    d.fire(0);
    d.use(1, 0, 30);
    expect(d.of('hit', 1)).toHaveLength(1);
    d.step(ticksOf(3));
    d.use(1, 0, 3);
    d.use(1, 0, 3);
    expect(d.of('refused', 1).at(-1)!.reason).toBe('no_ammo');
    expect(d.b.modules[0]!.charges).toBe(0);
    // A drone lasts 3 seconds.
    d.step(ticksOf(3));
    expect(d.race.hazards.filter((h) => h.active && h.kind === 'decoy')).toEqual([]);
  });

  // --- Jump Pad -----------------------------------------------------------------------------------
  const jumper: TestCar = {
    parts: ['utility_jump', { id: 'weapon_front_mg', mount: 'roof_front', fire: 0 }],
  };
  behavior('utility_jump', 'hops the car over a trap on the road', () => {
    const d = duel(jumper, layer, { ahead: 300 });
    const mine = layMine(d);
    d.use(0);
    expect(hasStatus(d.a, 'airborne')).toBe(true);
    expect(d.a.session.effects.airborne).toBe(true);
    d.a.session.motion.x = mine.x + 2;
    d.step(3);
    expect(mine.active).toBe(true);
    expect(d.of('hit', 0)).toEqual([]);
    // Back on the ground, on top of it: now it goes off.
    d.step(ticksOf(0.45));
    expect(hasStatus(d.a, 'airborne')).toBe(false);
    d.step(2);
    expect(mine.active).toBe(false);
  });
  limit(
    'utility_jump',
    'is in the air for 0.45 s, cannot fire up there, can still be shot, and needs 9 s',
    () => {
      const d = duel(jumper, armed('weapon_front_mg'), { ahead: 150, turnB: Math.PI });
      d.use(0);
      expect(d.of('status', 0)[0]).toMatchObject({ family: 'airborne', ticks: ticksOf(0.45) });
      d.fire(0);
      expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['jammed']);
      d.fire(1, 0, 8);
      expect(d.of('hit', 0).length).toBeGreaterThan(0);
      d.step(ticksOf(0.45));
      d.use(0);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('cooldown');
      expect(d.module(d.a, 'utility_jump').module.cooldownTotal).toBe(ticksOf(9));
    },
  );

  // --- Recovery Winch -----------------------------------------------------------------------------
  const pinned = () => {
    const d = duel(
      { chassis: 'chassis_beetle', parts: [{ id: 'utility_winch', mount: 'left_utility' }] },
      BEETLE,
      {
        ahead: 600,
      },
    );
    // Nose into the left-hand wall, engine pushing.
    const m = d.a.session.motion;
    m.y = 5000 + 316;
    m.headingRad = Math.PI;
    return d;
  };
  behavior(
    'utility_winch',
    'pulls a car that has been pinned for 1.5 s back toward the road ahead',
    () => {
      const d = pinned();
      d.step(ticksOf(1.5) + 4, GO);
      expect(d.a.session.telemetry.wallContact).toBe(true);
      expect(d.a.stuckTicks).toBeGreaterThanOrEqual(ticksOf(1.5));
      const m = d.a.session.motion;
      const from = { x: m.x, y: m.y };
      d.step(2, { ...GO, use: 1 });
      expect(d.of('utility', 0)[0]).toMatchObject({ utility: 'utility_winch', state: 'started' });
      d.step(ticksOf(0.6), GO);
      const pulled = Math.hypot(m.x - from.x, m.y - from.y);
      // A short pull, about 60 pixels, toward the middle of the road and along it. No teleport.
      expect(pulled).toBeGreaterThan(35);
      expect(pulled).toBeLessThan(75);
      expect(m.y).toBeLessThan(from.y - 20);
      expect(m.x).toBeLessThan(from.x);
    },
  );
  limit(
    'utility_winch',
    'is refused unless the car is actually stuck, and needs 20 s between pulls',
    () => {
      const free = duel({
        chassis: 'chassis_beetle',
        parts: [{ id: 'utility_winch', mount: 'left_utility' }],
      });
      free.use(0);
      expect(free.of('refused', 0).map((e) => e.reason)).toEqual(['not_needed']);
      expect(free.module(free.a, 'utility_winch').module.cooldown).toBe(0);
      const d = pinned();
      d.step(ticksOf(1.5) + 4, GO);
      d.step(2, { ...GO, use: 1 });
      expect(d.module(d.a, 'utility_winch').module.cooldownTotal).toBe(ticksOf(20));
      d.step(3);
      d.use(0);
      expect(d.of('refused', 0).at(-1)!.reason).toBe('cooldown');
    },
  );

  // --- Turret Computer ----------------------------------------------------------------------------
  const lockTick = (parts: TestPart[], mutate?: (d: Duel) => void) => {
    const d = duel(
      { parts: [{ id: 'weapon_turret', mount: 'roof_front', fire: 'auto' }, ...parts] },
      BEETLE,
      {
        ahead: -150,
      },
    );
    mutate?.(d);
    d.step(70);
    return d.of('lock', 0)[0]!.tick;
  };
  behavior('utility_targeting', 'turrets acquire 25 percent faster', () => {
    const plain = lockTick([]);
    const assisted = lockTick(['utility_targeting']);
    expect(assisted).toBeLessThan(plain);
    expect(assisted / plain).toBeGreaterThan(0.75);
    expect(assisted / plain).toBeLessThan(0.86);
    // Seekers too.
    const seeker = duel(
      { parts: [{ id: 'weapon_homing', mount: 'roof_front', fire: 0 }, 'utility_targeting'] },
      BEETLE,
      { ahead: 150 },
    );
    seeker.step(ticksOf(0.6) - 3);
    expect(seeker.of('lock', 0)).toHaveLength(1);
  });
  limit('utility_targeting', 'does nothing once destroyed, and nothing for a fixed gun', () => {
    const plain = lockTick([]);
    const dead = lockTick(['utility_targeting'], (d) =>
      repairComponent(d.race, d.a, d.module(d.a, 'utility_targeting').component, -200),
    );
    expect(dead).toBe(plain);
    const gun = duel({
      parts: [{ id: 'weapon_front_mg', mount: 'roof_front', fire: 0 }, 'utility_targeting'],
    });
    const bare = duel(armed('weapon_front_mg'));
    gun.fire(0, 0, 25);
    bare.fire(0, 0, 25);
    expect(gun.of('hit', 1).map((h) => h.tick)).toEqual(bare.of('hit', 1).map((h) => h.tick));
  });

  // --- Solar Panel --------------------------------------------------------------------------------
  behavior('utility_solar', 'generates 4 power a second in clear daylight', () => {
    const d = duel({ parts: ['utility_solar'] }, BEETLE, { timeOfDay: 'day' });
    expect(d.a.session.params.power.generation).toBe(14);
    d.a.session.motion.batteryEnergy = 0;
    d.step(30);
    expect(d.a.session.motion.batteryEnergy).toBeCloseTo(14, 6);
  });
  limit('utility_solar', 'is weak at dusk and in rain, and nearly dead at night', () => {
    const at = (timeOfDay: 'day' | 'dusk' | 'night', env?: RaceEnvironment) =>
      duel({ parts: ['utility_solar'] }, BEETLE, { timeOfDay, env }).a.session.params.power
        .generation - 10;
    expect(at('dusk')).toBeCloseTo(1.8, 9);
    expect(at('night')).toBeCloseTo(0.4, 9);
    expect(at('day', RAIN)).toBeCloseTo(1.2, 9);
  });
});

// ================================================================================================
describe('wheel kits and engines with a part in combat', () => {
  it('Razor Wheels cut 6 into a car that rubs their flank, at most every 1.2 s', () => {
    const d = duel({ chassis: 'chassis_beetle', tires: 'tires_blades' }, BEETLE, {
      ahead: 0,
      aside: 30,
    });
    d.race.ramGraceTicks = 0;
    // Car B leans on car A's right-hand side.
    d.step(50, undefined, { steer: -0.6, brake: 0 });
    const cuts = d.of('hit', 1).filter((h) => h.weapon === 'tires_blades');
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts[0]).toMatchObject({ cls: 'direct', damage: 6 });
    for (let i = 1; i < cuts.length; i++)
      expect(cuts[i]!.tick - cuts[i - 1]!.tick).toBeGreaterThanOrEqual(ticksOf(1.2));
    // The hubs are fragile: 20 percent less wheel integrity.
    expect(d.a.session.wheelIntegrity).toEqual([80, 80, 80, 80]);
  });

  it('Armored Tires carry 55 percent more wheel integrity and Hard Compound takes 22 percent less', () => {
    const armored = duel(BEETLE, { chassis: 'chassis_beetle', tires: 'tires_armored' });
    expect(armored.b.session.wheelIntegrity).toEqual([155, 155, 155, 155]);
    const hard = duel(BEETLE, { chassis: 'chassis_beetle', tires: 'tires_hard' });
    expect(hitAt(hard, hard.b, -14, -24, 20).damage).toBeCloseTo(15.6, 6);
  });

  it('Solid Core tires shrug off most of what a ruined wheel does to the car', () => {
    const grip = (tires: string) => {
      const d = duel(BEETLE, { chassis: 'chassis_beetle', tires });
      d.b.components[FL]!.integrity = 0;
      computeEffects(d.b);
      return 1 - d.b.session.effects.grip;
    };
    expect(grip('tires_solid')).toBeCloseTo(grip('tires_street') * 0.15, 9);
  });

  it('the Ironheart engine loses half as much output to damage and has a quarter more integrity', () => {
    const loss = (engine: string) => {
      const d = duel(BEETLE, { chassis: 'chassis_beetle', engine });
      const max = d.b.components[COMPONENT_ENGINE]!.maxIntegrity;
      d.b.components[COMPONENT_ENGINE]!.integrity = 0;
      computeEffects(d.b);
      return { loss: 1 - d.b.session.effects.drive, max };
    };
    expect(loss('engine_resilient').loss).toBeCloseTo(loss('engine_four_cylinder').loss * 0.5, 9);
    expect(loss('engine_resilient').max).toBe(125);
  });
});

// ================================================================================================
describe('catalog coverage (Section 19.7)', () => {
  it('every weapon, defense and utility has a behavior test and a limit or interaction test', () => {
    const missing: string[] = [];
    for (const def of [...WEAPON_LIST, ...DEFENSE_LIST, ...UTILITY_LIST]) {
      const entry = covered.get(def.id);
      if (!entry || entry.behavior < 1) missing.push(`${def.id}: no behavior test`);
      if (!entry || entry.limit < 1) missing.push(`${def.id}: no limit or interaction test`);
    }
    expect(missing).toEqual([]);
    expect(covered.size).toBe(60);
  });
});
