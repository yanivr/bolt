import type { CombatCar, ControlInput } from '@bolt/shared';
import {
  ARMOR_MIN_ABSORB,
  BODY_HIT_SHARE,
  CC_IMMUNITY_SECONDS,
  CHASSIS_DAMAGE_SHARE,
  COMPONENT_CRITICAL,
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_HEALTHY,
  COMPONENT_STEERING,
  ENGINE_LIMP_OUTPUT,
  GRIP_LOSS_CAP,
  HAZARD_LIFE_WEATHER,
  KO_SECONDS,
  LIMP_DRIVE_FACTOR,
  MAX_PROJECTILES,
  NEUTRAL_EFFECTS,
  PROJECTILE_MAX_LIFE_SECONDS,
  RAM_FORGIVE_SPEED,
  SIM_DT,
  SLOW_TOTAL_CAP,
  SPAWN_RAM_GRACE_FACTOR,
  STATUS_FAMILIES,
  STEERING_LIMP_SCALE,
  WHEEL_LIMP_EFFICIENCY,
  WHEEL_PULL_MAX,
  applyImpulse,
  applyStatus,
  componentCondition,
  computeEffects,
  conditionIndex,
  copyMotionState,
  createDriveSession,
  hasStatus,
  repairComponent,
  statusMagnitude,
  stepDriveSession,
  ticksOf,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { Duel } from '../helpers/combat.js';
import { GO, PARK, duel, hitAt } from '../helpers/combat.js';
import { RAIN } from '../helpers/rig.js';

/**
 * The rules every part shares (Sections 8.1 to 8.4, 10.1, 11.8): where a hit lands, the order
 * defenses answer in, how statuses stack, what damage does to driving, repairs, KO, ramming,
 * and how weapons are tied to heat and energy. tests/unit/combatParts.test.ts covers the
 * sixty parts one by one on top of these.
 */

const BEETLE = { chassis: 'chassis_beetle' };
/** Wheel component indices on a four-wheel car: front-left, front-right, rear-left, rear-right. */
const FL = COMPONENT_FIRST_WHEEL;
const FR = COMPONENT_FIRST_WHEEL + 1;
const RL = COMPONENT_FIRST_WHEEL + 2;
const RR = COMPONENT_FIRST_WHEEL + 3;

function integrity(car: CombatCar, index: number): number {
  return car.components[index]!.integrity;
}

describe('component states (Section 8.1)', () => {
  it('names the four states at their thresholds', () => {
    expect(componentCondition(100)).toBe('healthy');
    expect(componentCondition(COMPONENT_HEALTHY + 0.1)).toBe('healthy');
    expect(componentCondition(COMPONENT_HEALTHY)).toBe('damaged');
    expect(componentCondition(COMPONENT_CRITICAL + 0.1)).toBe('damaged');
    expect(componentCondition(COMPONENT_CRITICAL)).toBe('critical');
    expect(componentCondition(1)).toBe('critical');
    expect(componentCondition(0)).toBe('disabled');
    expect([100, 65, 20, 0].map(conditionIndex)).toEqual([0, 1, 2, 3]);
  });

  it('gives every car an engine, a steering rack, one component per wheel and one per part', () => {
    const d = duel({ parts: ['weapon_front_mg', 'utility_radar'] }, { chassis: 'chassis_trike' });
    expect(d.a.components.map((c) => c.kind)).toEqual([
      'engine',
      'steering',
      ...Array.from({ length: 6 }, () => 'wheel'),
      'part',
      'part',
    ]);
    expect(d.b.components.filter((c) => c.kind === 'wheel')).toHaveLength(3);
    // One wheel-integrity entry per wheel anchor, mirrored from the components (Section 19.1).
    expect(d.a.session.wheelIntegrity).toEqual([100, 100, 100, 100, 100, 100]);
    expect(d.b.session.wheelIntegrity).toEqual([100, 100, 100]);
    expect(d.a.chassis).toBe(d.a.build.chassis.baseIntegrity);
  });

  it('announces each change of state once, and only when the state changes', () => {
    const d = duel(BEETLE, BEETLE);
    hitAt(d, d.b, 0, 29, 20);
    expect(d.of('component')).toEqual([]);
    hitAt(d, d.b, 0, 29, 20);
    hitAt(d, d.b, 0, 29, 20);
    const changes = d.of('component', 1);
    expect(changes.map((e) => e.condition)).toEqual(['damaged']);
    expect(changes[0]).toMatchObject({ component: COMPONENT_ENGINE, repaired: false });
    hitAt(d, d.b, 0, 29, 60);
    expect(d.of('component', 1).map((e) => e.condition)).toEqual(['damaged', 'disabled']);
  });
});

describe('where a hit lands (Sections 8.1, 19.1)', () => {
  it('damages the component at the point of impact: rear, front, and each corner', () => {
    const cases: Array<[string, number, number, number]> = [
      ['rear centre: the engine', 0, 29, COMPONENT_ENGINE],
      ['front centre: the steering', 0, -29, COMPONENT_STEERING],
      ['front-left corner', -14, -24, FL],
      ['front-right corner', 14, -24, FR],
      ['rear-left corner', -14, 26, RL],
      ['rear-right corner', 14, 26, RR],
    ];
    for (const [what, lx, ly, component] of cases) {
      const d = duel(BEETLE, BEETLE);
      const event = hitAt(d, d.b, lx, ly, 10);
      expect(event.component, what).toBe(component);
      expect(event.damage, what).toBe(10);
      expect(event.chassis, what).toBeCloseTo(10 * CHASSIS_DAMAGE_SHARE, 9);
      // Nothing on the far side of the car is touched.
      const others = d.b.components.filter((_, i) => i !== component);
      expect(
        others.every((c) => c.integrity === c.maxIntegrity),
        what,
      ).toBe(true);
    }
  });

  it('a rear-left hit damages the rear-left wheel, never the front-right one', () => {
    const d = duel(BEETLE, BEETLE);
    for (let i = 0; i < 6; i++) hitAt(d, d.b, -15, 22, 12);
    expect(integrity(d.b, RL)).toBeLessThan(40);
    expect(integrity(d.b, FR)).toBe(100);
    expect(d.b.session.wheelIntegrity[2]).toBe(integrity(d.b, RL));
    expect(d.b.session.wheelIntegrity[1]).toBe(100);
  });

  it('strikes bare bodywork when no component is within reach, and the chassis takes more', () => {
    const d = duel(BEETLE, BEETLE);
    const event = hitAt(d, d.b, -17, 0, 10);
    expect(event.component).toBe(-1);
    expect(event.damage).toBe(0);
    expect(event.chassis).toBeCloseTo(10 * (CHASSIS_DAMAGE_SHARE + BODY_HIT_SHARE), 9);
    expect(d.b.chassis).toBeCloseTo(110 - 7, 9);
  });

  it('hits a mounted part that sits where the hit lands, in place of what is behind it', () => {
    const d = duel(BEETLE, {
      chassis: 'chassis_beetle',
      parts: [{ id: 'weapon_mine', mount: 'rear_center', turn: 2 }],
    });
    const event = hitAt(d, d.b, 0, 29, 10);
    expect(d.b.components[event.component]!.kind).toBe('part');
    expect(integrity(d.b, COMPONENT_ENGINE)).toBe(100);
  });

  it('carries a penetrating hit into the next module along', () => {
    const d = duel(BEETLE, BEETLE);
    const plain = hitAt(d, d.b, -10, 26, 20);
    expect(plain.component).toBe(RL);
    expect(integrity(d.b, COMPONENT_ENGINE)).toBe(100);
    const piercing = hitAt(d, d.b, -10, 26, 20, 'heavy', { penetration: 0.5 });
    expect(piercing.component).toBe(RL);
    // Half of it carried on into the engine next to that wheel.
    expect(integrity(d.b, COMPONENT_ENGINE)).toBe(90);
    expect(piercing.damage).toBe(30);
  });

  it('a disabled component takes no more damage: the hit goes to what is next to it', () => {
    const d = duel(BEETLE, BEETLE);
    hitAt(d, d.b, 0, 29, 200);
    expect(integrity(d.b, COMPONENT_ENGINE)).toBe(0);
    const next = hitAt(d, d.b, 0, 29, 10);
    expect(next.component).not.toBe(COMPONENT_ENGINE);
  });

  it('never destroys a car with one ordinary hit (Section 10.1)', () => {
    const d = duel(BEETLE, BEETLE);
    hitAt(d, d.b, 0, 29, 30, 'heavy');
    expect(d.b.chassis).toBeGreaterThan(90);
    expect(d.b.ko).toBe(false);
  });
});

describe('the order defenses answer in (Section 11.8 step 8)', () => {
  const layered = {
    parts: [
      { id: 'defense_reactive' },
      { id: 'defense_energy_shield' },
      { id: 'defense_breakaway' },
      { id: 'defense_heavy_plate', mount: 'rear_utility', turn: 2 as const },
    ],
  };

  it('reactive foam, then the energy shield, then breakaway armor, then the plate, then the car', () => {
    const d = duel(BEETLE, layered);
    expect(d.b.armor).toEqual([0, 0, 75, 0]);
    // 30 heavy from behind: foam cuts 40 percent, the shield takes the 18 that is left.
    const first = hitAt(d, d.b, 0, 34, 30, 'heavy');
    expect(first).toMatchObject({ absorbed: 12, shield: 18, armor: 0, damage: 0, chassis: 0 });
    // Foam is recharging and the shield is down: breakaway armor soaks 30 of its 35.
    const second = hitAt(d, d.b, 0, 34, 30, 'heavy');
    expect(second).toMatchObject({ absorbed: 30, shield: 0, armor: 0, damage: 0, chassis: 0 });
    // Breakaway has 5 left and breaks; the plate takes the other 25.
    const third = hitAt(d, d.b, 0, 34, 30, 'heavy');
    expect(third).toMatchObject({ absorbed: 5, shield: 0, armor: 25, damage: 0, chassis: 0 });
    expect(d.b.armor[2]).toBe(50);
    expect(d.b.chassis).toBe(d.b.chassisMax);
    expect(d.of('shield', 1).map((e) => e.state)).toEqual(['down', 'down', 'broken']);
  });

  it('armor only protects the arc it is on', () => {
    const d = duel(BEETLE, layered);
    d.b.modules.forEach((m) => {
      m.pool = 0;
      m.cooldown = 999;
    });
    const front = hitAt(d, d.b, 0, -34, 10);
    expect(front.armor).toBe(0);
    expect(front.damage + front.chassis).toBeGreaterThan(0);
    const rear = hitAt(d, d.b, 0, 34, 10);
    expect(rear).toMatchObject({ armor: 10, damage: 0, chassis: 0 });
  });

  it('penetration ignores that share of the plate', () => {
    const d = duel(BEETLE, {
      parts: [{ id: 'defense_heavy_plate', mount: 'rear_utility', turn: 2 }],
    });
    const hit = hitAt(d, d.b, 0, 34, 20, 'heavy', { penetration: 0.5 });
    expect(hit.armor).toBe(10);
    expect(hit.damage + hit.chassis).toBeGreaterThan(0);
  });

  it('a worn plate lets more through (Section 8.1: damaged armor, increased penetration)', () => {
    const d = duel(BEETLE, {
      parts: [{ id: 'defense_heavy_plate', mount: 'rear_utility', turn: 2 }],
    });
    d.b.armor[2] = 15;
    const hit = hitAt(d, d.b, 0, 34, 10);
    const share = ARMOR_MIN_ABSORB + (1 - ARMOR_MIN_ABSORB) * (15 / 75);
    expect(hit.armor).toBeCloseTo(10 * share, 9);
    expect(hit.damage).toBeGreaterThan(0);
  });

  it('fire gets past shields and plates, and a ram past an energy shield', () => {
    const d = duel(BEETLE, layered);
    const burn = hitAt(d, d.b, 0, 34, 6, 'burn', { bypass: true });
    expect(burn).toMatchObject({ shield: 0, armor: 0, absorbed: 0 });
    expect(burn.chassis).toBeGreaterThan(0);
    const ram = hitAt(d, d.b, 0, 34, 6, 'ram');
    expect(ram.shield).toBe(0);
    expect(d.module(d.b, 'defense_energy_shield').module.pool).toBe(25);
  });

  it('a part destroyed in the fight stops protecting', () => {
    const d = duel(BEETLE, { parts: ['defense_wheel_cage'] });
    expect(d.b.totals.damage.wheel).toBe(0.55);
    const cage = d.module(d.b, 'defense_wheel_cage');
    repairComponent(d.race, d.b, cage.component, -200);
    expect(d.b.disabledMask).toBe(1);
    expect(d.b.totals.damage.wheel).toBeUndefined();
    // And it still weighs what it weighs.
    expect(d.b.session.params.massKg).toBe(d.b.baseParams.massKg);
    repairComponent(d.race, d.b, cage.component, 40);
    expect(d.b.disabledMask).toBe(0);
    expect(d.b.totals.damage.wheel).toBe(0.55);
  });
});

describe('status effects (Sections 8.1, 8.4, 11.8)', () => {
  it('has one slot per family', () => {
    const d = duel(BEETLE, BEETLE);
    expect(d.a.statusTicks).toHaveLength(STATUS_FAMILIES.length);
  });

  it('same family: strongest magnitude and the longer remaining duration, never a sum', () => {
    const d = duel(BEETLE, BEETLE);
    applyStatus(d.race, d.b, 'slow', 0.2, 60, 0);
    applyStatus(d.race, d.b, 'slow', 0.3, 30, 0);
    expect(statusMagnitude(d.b, 'slow')).toBe(0.3);
    expect(d.b.statusTicks[0]).toBe(60);
    applyStatus(d.race, d.b, 'slow', 0.1, 90, 0);
    expect(statusMagnitude(d.b, 'slow')).toBe(0.3);
    expect(d.b.statusTicks[0]).toBe(90);
  });

  it('caps total speed suppression at 45 percent and grip loss at 60 percent', () => {
    const d = duel(BEETLE, BEETLE);
    applyStatus(d.race, d.b, 'slow', 0.9, 60, 0);
    applyStatus(d.race, d.b, 'grip', 0.95, 60, 0);
    expect(statusMagnitude(d.b, 'slow')).toBe(SLOW_TOTAL_CAP);
    expect(statusMagnitude(d.b, 'grip')).toBe(GRIP_LOSS_CAP);
    computeEffects(d.b);
    expect(d.b.session.effects.grip).toBeCloseTo(1 - GRIP_LOSS_CAP, 9);
  });

  it('expires on time and says so once', () => {
    const d = duel(BEETLE, BEETLE);
    applyStatus(d.race, d.b, 'grip', 0.2, 10, 0);
    d.step(9);
    expect(hasStatus(d.b, 'grip')).toBe(true);
    d.step(1);
    expect(hasStatus(d.b, 'grip')).toBe(false);
    d.step(20);
    expect(d.of('status', 1).filter((e) => e.state === 'expired')).toHaveLength(1);
  });

  it('a slow holds the car to a share of its speed, sheds the excess quickly and never stops it', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 600, aside: 200 });
    d.step(150, GO, GO);
    const speed = d.a.session.telemetry.speed;
    expect(speed).toBeGreaterThan(200);
    applyStatus(d.race, d.a, 'slow', 0.2, 60, 1);
    d.step(15, GO, GO);
    // Section 6.5: a medium hit costs no more than 25 percent of speed for 1.5 seconds.
    expect(d.a.session.telemetry.speed).toBeLessThanOrEqual(speed * 0.8 + 1);
    expect(d.a.session.telemetry.speed).toBeGreaterThan(speed * 0.75);
    d.step(40, GO, GO);
    expect(d.a.session.telemetry.speed).toBeLessThanOrEqual(speed * 0.8 + 1);
    d.step(60, GO, GO);
    expect(d.a.session.telemetry.speed).toBeGreaterThan(speed * 0.9);
    // The untouched car alongside was never slowed.
    expect(d.b.session.telemetry.speed).toBeGreaterThan(speed);
  });

  it('a slow caught at walking pace does not pin the car there', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 600, aside: 200 });
    d.step(8, GO);
    applyStatus(d.race, d.a, 'slow', 0.3, 60, 1);
    d.step(50, GO);
    expect(d.a.session.telemetry.speed).toBeGreaterThan(90);
  });

  it('a hard disable grants immunity that outlasts it by two seconds (Section 8.1)', () => {
    const d = duel(BEETLE, BEETLE);
    expect(applyStatus(d.race, d.b, 'emp', 1, 45, 0)).toBe(true);
    expect(hasStatus(d.b, 'immune')).toBe(true);
    d.step(45 + ticksOf(CC_IMMUNITY_SECONDS) - 1);
    expect(hasStatus(d.b, 'emp')).toBe(false);
    // Still inside the two seconds after it ended: another one is refused, and says so.
    expect(applyStatus(d.race, d.b, 'emp', 1, 45, 0)).toBe(false);
    expect(applyStatus(d.race, d.b, 'jam', 1, 18, 0)).toBe(false);
    expect(d.race.events.filter((e) => e.type === 'status' && e.state === 'blocked')).toHaveLength(
      2,
    );
    d.step(1);
    expect(applyStatus(d.race, d.b, 'emp', 1, 45, 0)).toBe(true);
  });

  it('immunity blocks another disruption, not ordinary damage or a slow', () => {
    const d = duel(BEETLE, BEETLE);
    applyStatus(d.race, d.b, 'emp', 1, 45, 0);
    const hit = hitAt(d, d.b, 0, 29, 10);
    expect(hit.damage).toBe(10);
    expect(applyStatus(d.race, d.b, 'slow', 0.2, 30, 0)).toBe(true);
    expect(applyStatus(d.race, d.b, 'grip', 0.2, 30, 0)).toBe(true);
  });

  it('a major shove grants immunity to the next; a light one does neither', () => {
    const d = duel(BEETLE, BEETLE);
    expect(applyImpulse(d.race, d.b, 0, -30, 0, 'test', false)).toBe(true);
    expect(hasStatus(d.b, 'immune')).toBe(false);
    expect(applyImpulse(d.race, d.b, 0, -140, 0, 'test', true)).toBe(true);
    const speed = Math.hypot(d.b.session.motion.velocityX, d.b.session.motion.velocityY);
    expect(applyImpulse(d.race, d.b, 0, -140, 0, 'test', true)).toBe(false);
    expect(Math.hypot(d.b.session.motion.velocityX, d.b.session.motion.velocityY)).toBe(speed);
    // A light shove still lands while immune: only disabling disruption is refused.
    expect(applyImpulse(d.race, d.b, 0, -30, 0, 'test', false)).toBe(true);
  });

  it('throws a light car further than a heavy one', () => {
    const light = duel(BEETLE, { chassis: 'chassis_trike' });
    const heavy = duel(BEETLE, {
      chassis: 'chassis_pickup',
      parts: [{ id: 'defense_heavy_plate', mount: 'rear_center', turn: 2 }],
    });
    applyImpulse(light.race, light.b, 0, -100, 0, 'test', false);
    applyImpulse(heavy.race, heavy.b, 0, -100, 0, 'test', false);
    expect(Math.abs(light.b.session.motion.velocityY)).toBeGreaterThan(
      Math.abs(heavy.b.session.motion.velocityY) * 1.5,
    );
  });
});

describe('what damage does to driving (Section 8.1)', () => {
  it('leaves an undamaged car with exactly the neutral effects', () => {
    const d = duel(BEETLE, { parts: ['weapon_front_mg', 'defense_heavy_plate', 'utility_fan'] });
    computeEffects(d.a);
    computeEffects(d.b);
    expect(d.a.session.effects).toEqual(NEUTRAL_EFFECTS);
    expect(d.b.session.effects).toEqual(NEUTRAL_EFFECTS);
  });

  it('a damaged wheel costs grip and pulls toward its side, by at most 12 percent', () => {
    const d = duel(BEETLE, BEETLE);
    repairComponent(d.race, d.a, FR, -100);
    computeEffects(d.a);
    const fx = d.a.session.effects;
    // One of four wheels at limp efficiency.
    expect(fx.grip).toBeCloseTo(1 - ((1 - WHEEL_LIMP_EFFICIENCY) / 4) * 0.8, 9);
    expect(fx.steerBias).toBeGreaterThan(0);
    expect(fx.steerBias).toBeLessThanOrEqual(WHEEL_PULL_MAX);
    expect(fx.rollingAdd).toBeGreaterThan(0);
    expect(fx.stabilityAdd).toBeLessThan(0);
    // The same damage on the other side pulls the other way.
    const other = duel(BEETLE, BEETLE);
    repairComponent(other.race, other.a, FL, -100);
    computeEffects(other.a);
    expect(other.a.session.effects.steerBias).toBeCloseTo(-fx.steerBias, 9);
  });

  it('the pull is real: with the wheel gone and the stick centred the car drifts to that side', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 600, aside: 200 });
    repairComponent(d.race, d.a, FR, -100);
    const y0 = d.a.session.motion.y;
    d.step(120, GO);
    // Heading west, the right-hand side is toward smaller y.
    expect(d.a.session.motion.y).toBeLessThan(y0 - 4);
  });

  it('wheel effects are continuous with integrity and nothing happens above healthy', () => {
    const d = duel(BEETLE, BEETLE);
    let last = 1;
    for (const value of [100, 80, 66, 60, 40, 20, 5, 0]) {
      d.a.components[FL]!.integrity = value;
      computeEffects(d.a);
      const grip = d.a.session.effects.grip;
      if (value > COMPONENT_HEALTHY) expect(grip).toBe(1);
      expect(grip).toBeLessThanOrEqual(last);
      last = grip;
    }
    expect(last).toBeGreaterThan(0.8);
  });

  it('a disabled engine keeps half its output and runs hotter: limp-home, not a stop', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 600, aside: 200 });
    repairComponent(d.race, d.a, COMPONENT_ENGINE, -100);
    computeEffects(d.a);
    expect(d.a.session.effects.drive).toBe(ENGINE_LIMP_OUTPUT);
    expect(d.a.session.effects.heatFactor).toBeGreaterThan(1);
    d.step(150, GO, GO);
    expect(d.a.session.telemetry.speed).toBeGreaterThan(80);
    expect(d.a.session.telemetry.speed).toBeLessThan(d.b.session.telemetry.speed * 0.85);
  });

  it('disabled steering keeps half its lock: slower to turn, never uncontrollable', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 600, aside: 200 });
    repairComponent(d.race, d.a, COMPONENT_STEERING, -100);
    computeEffects(d.a);
    expect(d.a.session.effects.steerScale).toBe(STEERING_LIMP_SCALE);
    expect(d.a.session.effects.steerLag).toBeGreaterThan(0);
    d.step(60, GO, GO);
    const right: Partial<ControlInput> = { steer: 1, brake: 0 };
    const ha = d.a.session.motion.headingRad;
    const hb = d.b.session.motion.headingRad;
    d.step(20, right, right);
    const turnedA = Math.abs(d.a.session.motion.headingRad - ha);
    const turnedB = Math.abs(d.b.session.motion.headingRad - hb);
    expect(turnedA).toBeGreaterThan(0.05);
    expect(turnedA).toBeLessThan(turnedB * 0.8);
  });

  it('a chassis at zero limps on reduced power and the car still drives', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 600, aside: 200 });
    d.a.chassis = 0;
    computeEffects(d.a);
    expect(d.a.session.effects.drive).toBe(LIMP_DRIVE_FACTOR);
    d.step(120, GO);
    expect(d.a.ko).toBe(false);
    expect(d.a.session.telemetry.speed).toBeGreaterThan(100);
  });
});

describe('KO (Sections 3.4, 19.1)', () => {
  const kill = (d: Duel) => {
    d.b.chassis = 0;
    repairComponent(d.race, d.b, COMPONENT_ENGINE, -200);
    repairComponent(d.race, d.b, COMPONENT_STEERING, -200);
  };

  it('needs zero chassis and two core systems down, for three seconds without a break', () => {
    const d = duel(BEETLE, BEETLE);
    kill(d);
    d.step(ticksOf(KO_SECONDS) - 1);
    expect(d.b.ko).toBe(false);
    d.step(1);
    expect(d.b.ko).toBe(true);
    expect(d.of('ko')).toHaveLength(1);
    expect(d.race.phase).toBe('FINISHED');
    expect(d.race.result).toMatchObject({ winner: 0, reason: 'ko' });
    expect(d.race.result!.cars[1]!.ko).toBe(true);
  });

  it('zero chassis alone, or disabled systems alone, is not a KO', () => {
    const chassisOnly = duel(BEETLE, BEETLE);
    chassisOnly.b.chassis = 0;
    chassisOnly.step(200);
    expect(chassisOnly.b.ko).toBe(false);
    const systemsOnly = duel(BEETLE, BEETLE);
    repairComponent(systemsOnly.race, systemsOnly.b, COMPONENT_ENGINE, -200);
    repairComponent(systemsOnly.race, systemsOnly.b, COMPONENT_STEERING, -200);
    systemsOnly.step(200);
    expect(systemsOnly.b.ko).toBe(false);
    const oneSystem = duel(BEETLE, BEETLE);
    oneSystem.b.chassis = 0;
    repairComponent(oneSystem.race, oneSystem.b, COMPONENT_ENGINE, -200);
    oneSystem.step(200);
    expect(oneSystem.b.ko).toBe(false);
  });

  it('counts half the wheels gone as locomotion down', () => {
    const d = duel(BEETLE, BEETLE);
    d.b.chassis = 0;
    repairComponent(d.race, d.b, COMPONENT_ENGINE, -200);
    repairComponent(d.race, d.b, FL, -200);
    d.step(120);
    expect(d.b.ko).toBe(false);
    repairComponent(d.race, d.b, RR, -200);
    d.step(ticksOf(KO_SECONDS));
    expect(d.b.ko).toBe(true);
  });

  it('a repair inside the three seconds starts the count again', () => {
    const d = duel(BEETLE, BEETLE);
    kill(d);
    d.step(60);
    repairComponent(d.race, d.b, COMPONENT_ENGINE, 40);
    d.step(5);
    repairComponent(d.race, d.b, COMPONENT_ENGINE, -200);
    d.step(ticksOf(KO_SECONDS) - 2);
    expect(d.b.ko).toBe(false);
    d.step(2);
    expect(d.b.ko).toBe(true);
  });

  it('a knocked-out car takes no further part: it stops, cannot fire and cannot be hit', () => {
    const d = duel(BEETLE, { parts: [{ id: 'weapon_rear_mg', turn: 2 }] }, { ahead: 80 });
    kill(d);
    d.step(ticksOf(KO_SECONDS));
    const chassisA = d.a.chassis;
    const events = d.events.length;
    d.step(120);
    expect(d.a.chassis).toBe(chassisA);
    expect(d.events.slice(events).filter((e) => e.type === 'shot')).toEqual([]);
  });
});

describe('ramming (Sections 3.4, 7.3, 10.1)', () => {
  /** Drives car A into the back of a parked car B and returns the duel just after contact. */
  function rearEnd(
    a: Parameters<typeof duel>[0],
    b: Parameters<typeof duel>[1],
    ticks = 120,
  ): Duel {
    const d = duel(a, b, { ahead: 320 });
    // Past the spawn grace, so the full impulse and damage apply.
    d.race.ramGraceTicks = 0;
    d.step(ticks, GO);
    return d;
  }

  it('two cars cannot occupy the same road: they are pushed apart and exchange momentum', () => {
    const d = rearEnd(BEETLE, BEETLE);
    const gap = Math.hypot(
      d.a.session.motion.x - d.b.session.motion.x,
      d.a.session.motion.y - d.b.session.motion.y,
    );
    expect(gap).toBeGreaterThanOrEqual(34 - 12 * 2 - 1);
    expect(d.of('hit').some((e) => e.cls === 'ram')).toBe(true);
    // The parked car was knocked forward (west is negative x).
    expect(d.b.session.motion.x).toBeLessThan(11000 - 320 - 5);
  });

  it('is mass-aware: the light car is thrown and hurt more than the heavy one', () => {
    const heavyIntoLight = rearEnd(
      { chassis: 'chassis_pickup', engine: 'engine_v8' },
      { chassis: 'chassis_trike' },
    );
    const rams = heavyIntoLight.of('hit').filter((e) => e.cls === 'ram');
    const toLight = rams.filter((e) => e.car === 1).reduce((s, e) => s + e.damage + e.chassis, 0);
    const toHeavy = rams.filter((e) => e.car === 0).reduce((s, e) => s + e.damage + e.chassis, 0);
    expect(toLight).toBeGreaterThan(toHeavy * 1.5);
    // Speed handed to the struck car at the moment of contact, per unit of closing speed.
    const kick = (a: Parameters<typeof duel>[0], b: Parameters<typeof duel>[1]): number => {
      const d = duel(a, b, { ahead: 320 });
      d.race.ramGraceTicks = 0;
      let closing = 0;
      for (let i = 0; i < 200 && !d.b.touching; i++) {
        closing = d.a.session.telemetry.speed;
        d.step(1, GO);
      }
      expect(d.b.touching).toBe(true);
      const m = d.b.session.motion;
      return Math.hypot(m.velocityX, m.velocityY) / closing;
    };
    const lightKicked = kick(
      { chassis: 'chassis_pickup', engine: 'engine_v8' },
      { chassis: 'chassis_trike' },
    );
    const heavyKicked = kick(
      { chassis: 'chassis_trike', engine: 'engine_v8' },
      { chassis: 'chassis_pickup' },
    );
    expect(lightKicked).toBeGreaterThan(heavyKicked * 1.5);
  });

  it('lands where the cars met: the rammed car is hit in the tail, the rammer in the nose', () => {
    const d = rearEnd(BEETLE, BEETLE);
    const rams = d.of('hit').filter((e) => e.cls === 'ram');
    const target = rams.find((e) => e.car === 1)!;
    const rammer = rams.find((e) => e.car === 0)!;
    expect(target.component).toBe(COMPONENT_ENGINE);
    expect(rammer.component).toBe(COMPONENT_STEERING);
    expect(target.weapon).toBe('ram');
  });

  it('forgives a rub: closing speeds inside the band do no damage', () => {
    const d = duel(BEETLE, BEETLE, { ahead: 70 });
    d.race.ramGraceTicks = 0;
    // A short run-up: contact at well under the forgiveness speed.
    d.step(14, GO);
    d.step(40);
    expect(d.a.touching || d.b.touching || d.a.session.telemetry.speed < RAM_FORGIVE_SPEED).toBe(
      true,
    );
    expect(d.of('hit').filter((e) => e.cls === 'ram')).toEqual([]);
  });

  it('softens rams for the first 1.5 seconds after the start (Section 3.4)', () => {
    const graced = duel(
      { chassis: 'chassis_pickup', engine: 'engine_rocket' },
      { chassis: 'chassis_trike' },
      { ahead: 150 },
    );
    const full = duel(
      { chassis: 'chassis_pickup', engine: 'engine_rocket' },
      { chassis: 'chassis_trike' },
      { ahead: 150 },
    );
    full.race.ramGraceTicks = 0;
    graced.step(44, GO);
    full.step(44, GO);
    const sum = (d: Duel) =>
      d
        .of('hit', 1)
        .filter((e) => e.cls === 'ram')
        .reduce((s, e) => s + e.damage + e.chassis, 0);
    expect(sum(full)).toBeGreaterThan(0);
    expect(sum(graced)).toBeCloseTo(sum(full) * SPAWN_RAM_GRACE_FACTOR, 6);
  });

  it('does ram damage in discrete hits, not once a tick while two cars grind', () => {
    const d = rearEnd(BEETLE, BEETLE, 200);
    const rams = d.of('hit', 1).filter((e) => e.cls === 'ram');
    for (let i = 1; i < rams.length; i++)
      expect(rams[i]!.tick - rams[i - 1]!.tick).toBeGreaterThanOrEqual(15);
  });
});

describe('weapons, heat and energy (Sections 6.5, 8.3, 11.5)', () => {
  const gunner = { parts: [{ id: 'weapon_railshot', fire: 0 as const }] };

  it('a shot draws its energy and makes its heat when it is fired', () => {
    const d = duel(gunner, BEETLE, { ahead: 200 });
    const m = d.a.session.motion;
    const battery = m.batteryEnergy;
    const heat = m.coreHeat;
    d.fire(0);
    // 14 energy and 8 heat a shot; two ticks of generation and cooling since.
    expect(battery - m.batteryEnergy).toBeGreaterThan(13);
    expect(battery - m.batteryEnergy).toBeLessThanOrEqual(14);
    expect(m.coreHeat - heat).toBeGreaterThan(7);
    expect(m.coreHeat - heat).toBeLessThanOrEqual(8);
  });

  it('LOW POWER: a weapon cannot fire without the energy for it, and says why', () => {
    const d = duel(gunner, BEETLE, { ahead: 200 });
    d.a.session.motion.batteryEnergy = 5;
    d.fire(0);
    expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['low_power']);
    expect(d.of('windup')).toEqual([]);
    expect(d.module(d.a, 'weapon_railshot').module.charges).toBe(5);
    // Generation brings it back: about a second later it fires.
    d.step(30);
    d.fire(0);
    expect(d.of('windup')).toHaveLength(1);
  });

  it('OVERHEAT: thermal protection locks out weapons that make heat until the car has cooled', () => {
    const d = duel(gunner, BEETLE, { ahead: 200 });
    d.a.session.motion.coreHeat = 112;
    d.step(1);
    expect(d.a.session.motion.thermalLimited).toBe(true);
    d.fire(0);
    expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['overheat']);
    expect(d.module(d.a, 'weapon_railshot').module.charges).toBe(5);
    d.a.session.motion.coreHeat = 60;
    d.step(1);
    expect(d.a.session.motion.thermalLimited).toBe(false);
    d.fire(0);
    expect(d.of('windup')).toHaveLength(1);
  });

  it('a weapon that makes no heat still works in thermal protection', () => {
    const d = duel({ parts: [{ id: 'weapon_frost', fire: 0 }] }, BEETLE);
    d.a.session.motion.coreHeat = 112;
    d.step(1);
    d.fire(0);
    expect(d.of('shot')).toHaveLength(1);
  });

  it('a hot car reloads more slowly, a cool one on time', () => {
    const cool = duel(gunner, BEETLE, { ahead: 200 });
    const hot = duel(gunner, BEETLE, { ahead: 200 });
    hot.a.session.motion.coreHeat = 100;
    cool.fire(0);
    hot.fire(0);
    const coolWait = cool.module(cool.a, 'weapon_railshot').module.cooldownTotal;
    const hotWait = hot.module(hot.a, 'weapon_railshot').module.cooldownTotal;
    expect(coolWait).toBe(ticksOf(7));
    expect(hotWait).toBeGreaterThan(coolWait * 1.2);
    expect(hotWait).toBeLessThanOrEqual(coolWait * 1.5);
  });

  it('a damaged weapon reloads more slowly and sometimes misfires harmlessly; a dead one is silent', () => {
    const d = duel({ parts: [{ id: 'weapon_front_mg', fire: 0 }] }, BEETLE, { seed: 5 });
    const gun = d.module(d.a, 'weapon_front_mg');
    repairComponent(d.race, d.a, gun.component, -70);
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      d.step(70, { fire: 1 });
      fired = d.of('shot').length;
    }
    const misfires = d.of('misfire', 0).length;
    expect(misfires).toBeGreaterThan(0);
    expect(fired).toBeGreaterThan(misfires);
    expect(gun.module.cooldownTotal).toBeGreaterThan(ticksOf(1.4));
    // A misfire costs nothing but a moment: no damage to anyone.
    expect(d.a.chassis).toBe(d.a.chassisMax);
    repairComponent(d.race, d.a, gun.component, -200);
    const shots = d.of('shot').length;
    d.step(2);
    d.fire(0);
    d.step(60, { fire: 1 });
    expect(d.of('shot')).toHaveLength(shots);
    expect(d.of('refused', 0).at(-1)!.reason).toBe('disabled');
    expect(gun.module.state).toBe(4);
  });

  it('refuses a fire button that has no weapon on it', () => {
    const d = duel({ parts: [{ id: 'weapon_front_mg', fire: 0 }] }, BEETLE);
    d.fire(0, 1);
    expect(d.of('refused', 0)).toMatchObject([{ part: -1, reason: 'no_weapon' }]);
    expect(d.of('shot')).toEqual([]);
  });

  it('refuses a second press inside the cooldown, and a held button fires again when ready', () => {
    const d = duel({ parts: [{ id: 'weapon_rocket', fire: 0 }] }, BEETLE, {
      ahead: 600,
      aside: 250,
    });
    d.fire(0);
    d.fire(0);
    expect(d.of('shot')).toHaveLength(1);
    expect(d.of('refused', 0).map((e) => e.reason)).toEqual(['cooldown']);
    // Held down, it reports nothing more and fires on the tick it is ready.
    d.step(ticksOf(5), { fire: 1 });
    expect(d.of('refused', 0)).toHaveLength(2);
    expect(d.of('shot')).toHaveLength(2);
    expect(d.of('shot')[1]!.tick - d.of('shot')[0]!.tick).toBe(ticksOf(5));
  });

  it('an inactive weapon (no button, not automatic) never fires', () => {
    const d = duel({ parts: [{ id: 'weapon_rocket' }] }, BEETLE);
    d.step(60, { fire: 3 });
    expect(d.of('shot')).toEqual([]);
  });

  it('keeps ammunition and cooldown per installed weapon, not per kind', () => {
    const d = duel(
      {
        parts: [
          { id: 'weapon_rocket', fire: 0 },
          { id: 'weapon_rocket', fire: 1 },
        ],
      },
      BEETLE,
      { ahead: 600, aside: 250 },
    );
    d.fire(0);
    expect(d.a.modules[0]!.charges).toBe(4);
    expect(d.a.modules[1]!.charges).toBe(5);
    expect(d.a.modules[1]!.cooldown).toBe(0);
    d.fire(0, 1);
    expect(d.a.modules[1]!.charges).toBe(4);
  });
});

describe('projectiles and the world (Sections 7.3, 8.3)', () => {
  it("a projectile carries its car's speed, so a gun reaches as far ahead at speed as at rest", () => {
    const d = duel(
      {
        chassis: 'chassis_beetle',
        parts: [{ id: 'weapon_front_mg', mount: 'front_center', fire: 0 }],
      },
      BEETLE,
      { ahead: 150 },
    );
    d.step(120, GO, GO);
    expect(d.a.session.telemetry.speed).toBeGreaterThan(150);
    const before = d.of('hit', 1).length;
    d.step(30, { ...GO, fire: 1 }, GO);
    expect(d.of('hit', 1).length - before).toBe(5);
  });

  it('stops at something solid and says what it struck', () => {
    const d = duel({ parts: [{ id: 'weapon_rocket', fire: 0 }] }, BEETLE, {
      ahead: 200,
      posts: [{ ahead: 100, radius: 12 }],
    });
    d.fire(0, 0, 30);
    expect(d.of('explosion')).toHaveLength(1);
    expect(d.of('explosion')[0]!.x).toBeGreaterThan(11000 - 100 - 2);
    expect(d.of('hit', 1)).toEqual([]);
  });

  it('a bullet ends on a wall without an explosion', () => {
    const d = duel(
      { parts: [{ id: 'weapon_front_mg', mount: 'roof_front', turn: 3, fire: 0 }] },
      BEETLE,
      {
        ahead: 300,
      },
    );
    // Parked 80 pixels from the left-hand wall and firing at it.
    d.a.session.motion.y = 5000 + 260;
    d.fire(0, 0, 30);
    const impacts = d.of('impact');
    expect(impacts.length).toBe(5);
    expect(impacts.every((e) => e.on === 'wall')).toBe(true);
    expect(d.of('explosion')).toEqual([]);
  });

  it('a hitscan weapon does not shoot through cover', () => {
    const d = duel({ parts: [{ id: 'weapon_railshot', fire: 0 }] }, BEETLE, {
      ahead: 200,
      posts: [{ ahead: 110, radius: 14 }],
    });
    d.fire(0, 0, 40);
    const beam = d.of('beam')[0]!;
    expect(beam.hit).toBe(-1);
    expect(beam.toX).toBeGreaterThan(11000 - 112);
    expect(d.of('hit', 1)).toEqual([]);
  });

  it('nothing in flight lives longer than five seconds', () => {
    const d = duel({ parts: [{ id: 'weapon_rocket', fire: 0 }] }, BEETLE, {
      ahead: 600,
      aside: 250,
    });
    // Round the oval there is no wall for a long way: the rocket times out.
    d.fire(0);
    d.step(ticksOf(PROJECTILE_MAX_LIFE_SECONDS) + 2);
    expect(d.race.projectiles.filter((p) => p.active)).toEqual([]);
    expect(d.of('explosion')).toHaveLength(1);
  });

  it('keeps a bounded number of projectiles: the oldest gives way', () => {
    const d = duel(
      { parts: Array.from({ length: 6 }, () => ({ id: 'weapon_shotgun', fire: 0 as const })) },
      BEETLE,
      { ahead: 600, aside: 250 },
    );
    for (let i = 0; i < 3; i++) {
      d.a.modules.forEach((m) => (m.cooldown = 0));
      d.a.session.motion.batteryEnergy = 40;
      d.step(1, { fire: 1 });
      d.step(1);
    }
    expect(d.race.projectiles.length).toBeLessThanOrEqual(MAX_PROJECTILES);
    expect(d.race.projectiles.filter((p) => p.active).length).toBeLessThanOrEqual(MAX_PROJECTILES);
    expect(d.of('shot').length).toBe(3 * 6 * 8);
  });

  it('gives every projectile and hazard an id that is never reused', () => {
    const d = duel(
      {
        parts: [
          { id: 'weapon_front_mg', fire: 0 },
          { id: 'weapon_mine', mount: 'rear_utility', turn: 2, fire: 1 },
        ],
      },
      BEETLE,
    );
    d.step(60, { fire: 3 });
    const ids = [
      ...d
        .of('shot')
        .map((e) => e.projectile)
        .filter((id) => id > 0),
      ...d.of('hazard').map((e) => e.hazard),
    ];
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(new Set(ids).size);
    const shotIds = d.of('shot').map((e) => e.projectile);
    expect(new Set(shotIds).size).toBe(shotIds.length);
  });
});

describe('hazards on the road (Sections 8.3, 9.2)', () => {
  it('are cleaned up when their time is over', () => {
    const d = duel(
      { parts: [{ id: 'weapon_oil', mount: 'rear_utility', turn: 2, fire: 0 }] },
      BEETLE,
      {
        ahead: 300,
      },
    );
    d.fire(0);
    expect(d.race.hazards.filter((h) => h.active)).toHaveLength(1);
    d.step(ticksOf(8));
    expect(d.race.hazards.filter((h) => h.active)).toHaveLength(0);
    expect(d.of('hazard').map((e) => e.state)).toEqual(['placed', 'expired']);
  });

  it('weather acts on them: rain washes oil away sooner', () => {
    const dry = duel(
      { parts: [{ id: 'weapon_oil', mount: 'rear_utility', turn: 2, fire: 0 }] },
      BEETLE,
    );
    const wet = duel(
      { parts: [{ id: 'weapon_oil', mount: 'rear_utility', turn: 2, fire: 0 }] },
      BEETLE,
      {
        env: RAIN,
      },
    );
    dry.fire(0);
    wet.fire(0);
    const life = (d: Duel) => d.race.hazards.find((h) => h.active)!.life;
    expect(life(wet) / life(dry)).toBeCloseTo(HAZARD_LIFE_WEATHER.oil.rain, 1);
    expect(HAZARD_LIFE_WEATHER.fire.heavy_rain).toBeLessThan(HAZARD_LIFE_WEATHER.fire.rain);
    expect(HAZARD_LIFE_WEATHER.frost.snowfall).toBeGreaterThan(1);
  });

  it('do not care who put them there: the owner is caught by its own', () => {
    const d = duel(
      { parts: [{ id: 'weapon_oil', mount: 'rear_utility', turn: 2, fire: 0 }] },
      BEETLE,
      {
        ahead: 300,
      },
    );
    d.fire(0);
    const strip = d.race.hazards.find((h) => h.active)!;
    d.a.session.motion.x = strip.x;
    d.step(2);
    expect(hasStatus(d.a, 'grip')).toBe(true);
  });

  it('are hidden from the other driver until it is close', () => {
    const d = duel(
      { parts: [{ id: 'weapon_mine', mount: 'rear_utility', turn: 2, fire: 0 }] },
      BEETLE,
      {
        ahead: -300,
      },
    );
    d.fire(0, 0, 5);
    const mine = d.race.hazards.find((h) => h.active)!;
    expect(mine.revealMask).toBe(1);
    d.placeB(-150);
    d.step(2);
    expect(mine.revealMask).toBe(1);
    d.placeB(-110);
    d.step(2);
    expect(mine.revealMask).toBe(3);
  });
});

describe('determinism and bookkeeping', () => {
  it('a car nothing touches drives exactly as it would alone', () => {
    const d = duel(BEETLE, { chassis: 'chassis_arrow' }, { ahead: 0, aside: 250 });
    const alone = createDriveSession(d.race.track, d.race.env, d.a.session.params);
    copyMotionState(d.a.session.motion, alone.motion);
    alone.phase = 'RACING';
    const weave = (i: number): ControlInput => ({
      steer: Math.sin(i / 9) * 0.25,
      brake: 0,
      coast: false,
    });
    for (let i = 0; i < 300; i++) {
      d.step(1, weave(i), weave(i + 20));
      stepDriveSession(alone, weave(i));
      expect(d.a.touching).toBe(false);
    }
    // Bit for bit: the combat layer adds nothing to a car that nothing has happened to.
    expect(d.a.session.motion).toEqual(alone.motion);
    expect(d.a.session.progress).toEqual(alone.progress);
    expect(d.events.filter((e) => e.type !== 'position' && e.type !== 'checkpoint')).toEqual([]);
  });

  it('numbers events from one, in order, with the tick they happened on', () => {
    const d = duel({ parts: [{ id: 'weapon_front_mg', fire: 0 }] }, BEETLE);
    d.step(40, { fire: 1 });
    expect(d.events.length).toBeGreaterThan(5);
    d.events.forEach((event, i) => {
      if (i > 0) {
        expect(event.id).toBe(d.events[i - 1]!.id + 1);
        expect(event.tick).toBeGreaterThanOrEqual(d.events[i - 1]!.tick);
      }
    });
  });

  it('counts damage dealt and taken per car and per part', () => {
    const d = duel({ parts: [{ id: 'weapon_front_mg', fire: 0 }] }, BEETLE);
    d.fire(0, 0, 30);
    expect(d.a.stats.shotsFired).toBe(1);
    expect(d.a.stats.hitsLanded).toBe(5);
    expect(d.a.stats.damageByPart[0]).toBeCloseTo(15 * (1 + CHASSIS_DAMAGE_SHARE), 6);
    expect(d.b.stats.damageTaken).toBeCloseTo(d.a.stats.damageDealt, 6);
    expect(d.b.stats.damageDealt).toBe(0);
  });

  it('keeps a parked duel parked: the test harness itself moves nothing', () => {
    const d = duel(BEETLE, BEETLE);
    const x = d.a.session.motion.x;
    d.step(120, PARK, PARK);
    expect(d.a.session.motion.x).toBe(x);
    expect(d.a.session.motion.reversing).toBe(false);
    expect(d.events).toEqual([]);
    expect(SIM_DT).toBe(1 / 30);
  });
});
