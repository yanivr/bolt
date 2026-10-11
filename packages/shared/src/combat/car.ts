import {
  ARMOR_MIN_ABSORB,
  BODY_HIT_SHARE,
  CC_IMMUNITY_SECONDS,
  CHASSIS_DAMAGE_SHARE,
  COMPONENT_CRITICAL,
  COMPONENT_HEALTHY,
  COMPONENT_INTEGRITY,
  DRIVETRAIN_MIN_SUPPLY,
  ENGINE_DAMAGE_HEAT,
  ENGINE_LIMP_OUTPUT,
  GRIP_LOSS_CAP,
  HAZARD_REVEAL_RANGE,
  HIT_LOCAL_RADIUS,
  IMPULSE_MASS_MAX,
  IMPULSE_MASS_MIN,
  LIMP_DRIVE_FACTOR,
  PENETRATION_SECOND_SHARE,
  REFERENCE_MASS_KG,
  RIVAL_TRACK_RANGE,
  SIM_DT,
  SLOW_TOTAL_CAP,
  STEERING_DAMAGE_LAG,
  STEERING_LIMP_SCALE,
  WHEEL_DRAG_DECEL,
  WHEEL_GRIP_WEIGHT,
  WHEEL_LIMP_EFFICIENCY,
  WHEEL_PULL_MAX,
  WHEEL_STABILITY_PENALTY,
} from '../balance.js';
import type { PlacedPart, ResolvedBuild } from '../blueprint.js';
import { engineMount, serializeBlueprint } from '../blueprint.js';
import { clamp, lerp } from '../math.js';
import { aggregateModifiers } from '../modifiers.js';
import { resetEffects } from '../physics.js';
import type {
  ComponentCondition,
  HitClass,
  RaceEvent,
  RaceEventBody,
  StatusFamily,
} from '../protocol.js';
import { STATUS_FAMILIES } from '../protocol.js';
import type { DriveSession } from '../sim.js';
import type { AccessoryDefinition, BuildConditions, CarArc, VehicleParams } from '../types.js';
import { deriveVehicleParams } from '../vehicle.js';
import { compileModules, ticksOf } from './specs.js';
import type { CarComponent, CombatCar, ModuleRuntime, RaceSession } from './types.js';
import {
  ARCS,
  ARC_INDEX,
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_STEERING,
  MODULE_COOLDOWN,
  MODULE_DISABLED,
  MODULE_IDLE,
  STATUS_COUNT,
  STATUS_INDEX,
} from './types.js';

/**
 * One car's combat state: components and armor, the damage pipeline (Sections 8.1 and 11.8
 * step 8), status effects with their stacking and immunity rules (Section 8.4), and what all
 * of that does to driving (Section 11.8 step 4).
 */

export function emit(race: RaceSession, body: RaceEventBody): void {
  const event = body as RaceEvent;
  event.id = race.nextEventId++;
  event.tick = race.tick;
  race.events.push(event);
}

const CONDITIONS: readonly ComponentCondition[] = ['healthy', 'damaged', 'critical', 'disabled'];

/** Section 8.1: healthy above 65, damaged 20 to 65, critical 1 to 20, disabled at 0. */
export function conditionIndex(integrity: number): number {
  if (integrity <= 0) return 3;
  if (integrity <= COMPONENT_CRITICAL) return 2;
  if (integrity <= COMPONENT_HEALTHY) return 1;
  return 0;
}

export function componentCondition(integrity: number): ComponentCondition {
  return CONDITIONS[conditionIndex(integrity)]!;
}

// --- Construction ------------------------------------------------------------------------------

const massOnly = new WeakMap<AccessoryDefinition, AccessoryDefinition>();

/** A failed part still weighs what it weighs and sits where it sits; it does nothing else. */
function inert(def: AccessoryDefinition): AccessoryDefinition {
  let stripped = massOnly.get(def);
  if (!stripped) {
    stripped = { ...def, modifiers: def.modifiers.filter((m) => m.type === 'AddMass') };
    massOnly.set(def, stripped);
  }
  return stripped;
}

/** The build as it currently works: parts whose bit is set in `disabledMask` are dead weight. */
export function workingBuild(build: ResolvedBuild, disabledMask: number): ResolvedBuild {
  if (disabledMask === 0) return build;
  return {
    ...build,
    parts: build.parts.map((part, index): PlacedPart =>
      (disabledMask >> index) & 1 ? { ...part, def: inert(part.def) } : part,
    ),
  };
}

/**
 * Coefficients for a build with some parts out of action. The server calls this when a part
 * fails or is repaired; a predicting client calls it with the same mask from the snapshot, so
 * both integrate with identical numbers.
 */
export function deriveParamsWithDisabled(
  build: ResolvedBuild,
  conditions: BuildConditions,
  disabledMask: number,
): VehicleParams {
  return deriveVehicleParams(workingBuild(build, disabledMask), conditions);
}

function tireNumber(build: ResolvedBuild, key: string): number {
  const value = build.tires.params?.[key];
  return typeof value === 'number' ? value : 0;
}

function arcOf(x: number, y: number, halfW: number, halfL: number): CarArc {
  if (Math.abs(y) / halfL >= Math.abs(x) / halfW) return y <= 0 ? 'front' : 'rear';
  return x < 0 ? 'left' : 'right';
}

function createModule(): ModuleRuntime {
  return {
    state: MODULE_IDLE,
    cooldown: 0,
    cooldownTotal: 0,
    charges: -1,
    phase: 0,
    timer: 0,
    burstLeft: 0,
    burstTimer: 0,
    lock: 0,
    locked: false,
    aim: 0,
    pool: 0,
    targetX: 0,
    targetY: 0,
    target: -1,
    refusedTick: -1000,
    losTick: -1000,
    los: false,
  };
}

export function createCombatCar(
  index: number,
  session: DriveSession,
  build: ResolvedBuild,
  buildHash: string,
  conditions: BuildConditions,
): CombatCar {
  const chassis = build.chassis;
  const totals = aggregateModifiers(build);
  const specs = compileModules(build, totals);
  const halfW = chassis.bodyHalfWidth;
  const halfL = chassis.bodyHalfLength;

  const components: CarComponent[] = [];
  const bay = engineMount(chassis);
  const part = (kind: CarComponent['kind'], ref: number, x: number, y: number, max: number) =>
    components.push({
      kind,
      ref,
      x,
      y,
      integrity: max,
      maxIntegrity: max,
      arc: arcOf(x, y, halfW, halfL),
      condition: 0,
    });
  part('engine', 0, bay?.x ?? 0, bay?.y ?? 0, COMPONENT_INTEGRITY * totals.integrity.engine);
  // The steering rack sits between the steered wheels.
  const steered = chassis.wheelAnchors.filter((w) => w.steers);
  const rackY =
    steered.length > 0 ? steered.reduce((sum, w) => sum + w.y, 0) / steered.length : -halfL * 0.6;
  part('steering', 0, 0, rackY, COMPONENT_INTEGRITY);
  chassis.wheelAnchors.forEach((wheel, i) =>
    part('wheel', i, wheel.x, wheel.y, COMPONENT_INTEGRITY * totals.integrity.wheels),
  );
  build.parts.forEach((placed, i) => part('part', i, placed.x, placed.y, COMPONENT_INTEGRITY));

  const modules = specs.map((spec) => {
    const m = createModule();
    m.charges = spec.charges > 0 ? spec.charges : -1;
    m.aim = spec.aim === 'track' ? 0 : (spec.turn * Math.PI) / 2;
    if (spec.kind === 'shield' || spec.kind === 'breakaway') m.pool = spec.points;
    return m;
  });

  const car: CombatCar = {
    index,
    session,
    build,
    buildHash,
    blueprintJson: serializeBlueprint(build.blueprint),
    baseParams: session.params,
    totals,
    specs,
    modules,
    manualUtilities: specs.filter((s) => s.useBit >= 0).map((s) => s.part),
    chassis: chassis.baseIntegrity * totals.integrity.chassis,
    chassisMax: chassis.baseIntegrity * totals.integrity.chassis,
    armor: [0, 0, 0, 0],
    armorMax: [0, 0, 0, 0],
    components,
    disabledMask: 0,
    statusMagnitude: new Array<number>(STATUS_COUNT).fill(0),
    statusTicks: new Array<number>(STATUS_COUNT).fill(0),
    statusBy: new Array<number>(STATUS_COUNT).fill(-1),
    statusRef: new Array<number>(STATUS_COUNT).fill(0),
    tether: { active: false, target: -1, ticks: 0, spec: null },
    reserve: 0,
    reserveMax: 0,
    koTicks: 0,
    ko: false,
    koBy: -1,
    repairLock: 0,
    stuckTicks: 0,
    winchTicks: 0,
    winchVx: 0,
    winchVy: 0,
    lockCount: 0,
    missileInbound: false,
    lockWarning: 0,
    prevFire: 0,
    prevUse: 0,
    fire: 0,
    use: 0,
    repairTarget: 0,
    prevX: session.motion.x,
    prevY: session.motion.y,
    lastHitBy: -1,
    trackRange: RIVAL_TRACK_RANGE,
    revealRange: HAZARD_REVEAL_RANGE,
    missileWarnTicks: 0,
    acquisitionFactor: 1,
    stats: {
      damageDealt: 0,
      damageTaken: 0,
      shotsFired: 0,
      hitsLanded: 0,
      damageByPart: build.parts.map(() => 0),
      usesByPart: build.parts.map(() => 0),
      ramsDealt: 0,
      heatLimitedTicks: 0,
      lowPowerTicks: 0,
      impairedTicks: 0,
    },
    lastWallEventTick: -1000,
    touching: false,
    bladeDamage: tireNumber(build, 'contactDamage'),
    bladeCooldownTicks: ticksOf(tireNumber(build, 'contactCooldownSeconds')),
    bladeMinSpeed: tireNumber(build, 'contactMinClosingSpeed'),
    bladeCooldown: 0,
    burnPending: 0,
    burnTimer: 0,
    burnX: 0,
    burnY: 0,
    burnWeapon: '',
    burnPart: -1,
    gripSource: 0,
  };
  refreshDerived(car, conditions, true);
  for (let arc = 0; arc < 4; arc++) car.armor[arc] = car.armorMax[arc]!;
  car.reserve = car.reserveMax;
  syncWheels(car);
  return car;
}

/**
 * Recomputes everything that depends on which parts are working: passive totals, armor
 * ceilings, driving coefficients and sensor reach.
 */
export function refreshDerived(car: CombatCar, conditions: BuildConditions, initial = false): void {
  const working = workingBuild(car.build, car.disabledMask);
  if (!initial) car.totals = aggregateModifiers(working);
  car.session.params =
    car.disabledMask === 0 ? car.baseParams : deriveVehicleParams(working, conditions, car.totals);
  for (const arc of ARCS) {
    const i = ARC_INDEX[arc];
    car.armorMax[i] = car.totals.armor[arc] * car.totals.integrity.armor;
    if (car.armor[i]! > car.armorMax[i]!) car.armor[i] = car.armorMax[i]!;
  }
  car.reserveMax = car.totals.burstReserve;
  if (car.reserve > car.reserveMax) car.reserve = car.reserveMax;
  car.trackRange = RIVAL_TRACK_RANGE;
  car.revealRange = HAZARD_REVEAL_RANGE;
  car.missileWarnTicks = 0;
  car.acquisitionFactor = 1;
  for (const spec of car.specs) {
    if ((car.disabledMask >> spec.part) & 1) continue;
    if (spec.kind === 'radar') {
      car.trackRange *= spec.factor;
      car.missileWarnTicks += spec.warnTicks;
    } else if (spec.kind === 'minesensor') car.revealRange += spec.range;
    else if (spec.kind === 'targeting') car.acquisitionFactor *= spec.factor;
  }
}

function syncWheels(car: CombatCar): void {
  const wheels = car.session.wheelIntegrity;
  for (let i = 0; i < wheels.length; i++)
    wheels[i] = car.components[COMPONENT_FIRST_WHEEL + i]!.integrity;
}

// --- Statuses (Sections 8.1, 8.4, 11.8) --------------------------------------------------------

export function hasStatus(car: CombatCar, family: StatusFamily): boolean {
  return car.statusTicks[STATUS_INDEX[family]]! > 0;
}

export function statusMagnitude(car: CombatCar, family: StatusFamily): number {
  const i = STATUS_INDEX[family];
  return car.statusTicks[i]! > 0 ? car.statusMagnitude[i]! : 0;
}

/** True while electronics are down: weapons, powered defenses and manual utilities do nothing. */
export function isDisrupted(car: CombatCar): boolean {
  return hasStatus(car, 'emp') || hasStatus(car, 'jam');
}

const CC_IMMUNITY_TICKS = ticksOf(CC_IMMUNITY_SECONDS);

/**
 * Applies a status. Same family: strongest magnitude and the longer of the two remaining
 * durations (Section 11.8). A hard disable is refused while the car is immune, and grants
 * immunity that outlasts it by two seconds (Section 8.1). Returns false when blocked.
 */
export function applyStatus(
  race: RaceSession,
  car: CombatCar,
  family: StatusFamily,
  magnitude: number,
  ticks: number,
  by: number,
): boolean {
  if (ticks <= 0 || car.ko) return false;
  const i = STATUS_INDEX[family];
  const hard = family === 'emp' || family === 'jam';
  let duration = ticks;
  if (hard) {
    if (hasStatus(car, 'immune')) {
      emit(race, {
        type: 'status',
        car: car.index,
        by,
        family,
        state: 'blocked',
        magnitude,
        ticks,
      });
      return false;
    }
    duration = Math.max(1, Math.round(ticks * (car.totals.damage.emp_duration ?? 1)));
  }
  const active = car.statusTicks[i]! > 0;
  const wasMagnitude = active ? car.statusMagnitude[i]! : 0;
  let level = Math.max(wasMagnitude, magnitude);
  if (family === 'slow') level = Math.min(SLOW_TOTAL_CAP, level);
  if (family === 'grip') level = Math.min(GRIP_LOSS_CAP, level);
  car.statusMagnitude[i] = level;
  car.statusTicks[i] = Math.max(active ? car.statusTicks[i]! : 0, duration);
  car.statusBy[i] = by;
  if (family === 'slow') {
    // A slow holds the car to a share of the speed it was doing, and never of less than the
    // speed its engine holds full force to, so a car caught at walking pace is not pinned there.
    const m = car.session.motion;
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const ref = Math.max(speed, car.session.params.forceTaperSpeed);
    car.statusRef[i] = active ? Math.max(car.statusRef[i]!, ref) : ref;
  }
  if (!active || level > wasMagnitude)
    emit(race, {
      type: 'status',
      car: car.index,
      by,
      family,
      state: 'applied',
      magnitude: level,
      ticks: car.statusTicks[i]!,
    });
  // Section 8.1: no chain-stuns. Immunity outlasts the disable by two seconds.
  if (hard) grantImmunity(race, car, by, duration + CC_IMMUNITY_TICKS);
  return true;
}

export function clearStatus(race: RaceSession, car: CombatCar, family: StatusFamily): void {
  const i = STATUS_INDEX[family];
  if (car.statusTicks[i]! <= 0) return;
  car.statusTicks[i] = 0;
  emit(race, {
    type: 'status',
    car: car.index,
    by: car.statusBy[i]!,
    family,
    state: 'expired',
    magnitude: car.statusMagnitude[i]!,
    ticks: 0,
  });
}

/** Counts every status down by one tick and announces the ones that end. */
export function tickStatuses(race: RaceSession, car: CombatCar): void {
  for (let i = 0; i < STATUS_COUNT; i++) {
    const left = car.statusTicks[i]!;
    if (left <= 0) continue;
    car.statusTicks[i] = left - 1;
    if (left === 1)
      emit(race, {
        type: 'status',
        car: car.index,
        by: car.statusBy[i]!,
        family: STATUS_FAMILIES[i]!,
        state: 'expired',
        magnitude: car.statusMagnitude[i]!,
        ticks: 0,
      });
  }
}

/** Starts the forced-steering immunity window (Section 8.1) without a status of its own. */
export function grantImmunity(
  race: RaceSession,
  car: CombatCar,
  by: number,
  ticks = CC_IMMUNITY_TICKS,
): void {
  const immune = STATUS_INDEX.immune;
  const active = car.statusTicks[immune]! > 0;
  car.statusTicks[immune] = Math.max(car.statusTicks[immune]!, ticks);
  car.statusMagnitude[immune] = 1;
  car.statusBy[immune] = by;
  // Announced when it begins, so a client can show the car as protected for its length.
  if (!active)
    emit(race, {
      type: 'status',
      car: car.index,
      by,
      family: 'immune',
      state: 'applied',
      magnitude: 1,
      ticks: car.statusTicks[immune]!,
    });
}

// --- Driving consequences (Section 11.8 step 4) ------------------------------------------------

/**
 * Rewrites the car's `VehicleEffects` from component health and active statuses. Every term
 * is continuous with integrity and capped (Section 8.1). A car with nothing wrong gets exactly
 * the neutral effects.
 */
export function computeEffects(car: CombatCar): void {
  const fx = car.session.effects;
  resetEffects(fx);
  const comps = car.components;
  const tags = car.totals.damage;

  // Wheels: each one loses efficiency below healthy, down to limp-home at zero.
  const anchors = car.build.chassis.wheelAnchors;
  const puncture = tags.puncture ?? 1;
  let lossSum = 0;
  let lossLeft = 0;
  let lossRight = 0;
  let nLeft = 0;
  let nRight = 0;
  for (let i = 0; i < anchors.length; i++) {
    const wheel = comps[COMPONENT_FIRST_WHEEL + i]!;
    const loss =
      (1 - WHEEL_LIMP_EFFICIENCY) *
      (1 - clamp(wheel.integrity / COMPONENT_HEALTHY, 0, 1)) *
      puncture;
    lossSum += loss;
    const x = anchors[i]!.x;
    if (x < 0) {
      lossLeft += loss;
      nLeft++;
    } else if (x > 0) {
      lossRight += loss;
      nRight++;
    }
  }
  if (lossSum > 0) {
    const mean = lossSum / anchors.length;
    fx.grip = 1 - mean * WHEEL_GRIP_WEIGHT;
    fx.rollingAdd = mean * WHEEL_DRAG_DECEL;
    fx.stabilityAdd = -WHEEL_STABILITY_PENALTY * mean;
    const side = (nRight > 0 ? lossRight / nRight : 0) - (nLeft > 0 ? lossLeft / nLeft : 0);
    fx.steerBias = WHEEL_PULL_MAX * clamp(side / (1 - WHEEL_LIMP_EFFICIENCY), -1, 1);
  }

  const engine = comps[COMPONENT_ENGINE]!;
  if (engine.integrity < COMPONENT_HEALTHY) {
    const hurt = 1 - clamp(engine.integrity / COMPONENT_HEALTHY, 0, 1);
    fx.drive = 1 - hurt * (1 - ENGINE_LIMP_OUTPUT) * (tags.engine_output_loss ?? 1);
    fx.heatFactor = 1 + hurt * ENGINE_DAMAGE_HEAT;
  }

  const rack = comps[COMPONENT_STEERING]!;
  if (rack.integrity < COMPONENT_HEALTHY) {
    const hurt = (1 - clamp(rack.integrity / COMPONENT_HEALTHY, 0, 1)) * (tags.steering ?? 1);
    fx.steerScale = 1 - hurt * (1 - STEERING_LIMP_SCALE);
    fx.steerLag = hurt * STEERING_DAMAGE_LAG;
  }

  if (car.chassis <= 0) fx.drive *= LIMP_DRIVE_FACTOR;

  const ticks = car.statusTicks;
  const mag = car.statusMagnitude;
  if (ticks[STATUS_INDEX.slow]! > 0)
    fx.speedCap = (1 - mag[STATUS_INDEX.slow]!) * car.statusRef[STATUS_INDEX.slow]!;
  if (ticks[STATUS_INDEX.grip]! > 0) fx.grip *= 1 - mag[STATUS_INDEX.grip]!;
  if (ticks[STATUS_INDEX.boost]! > 0) fx.drive *= 1 + mag[STATUS_INDEX.boost]!;
  if (ticks[STATUS_INDEX.refit]! > 0) fx.drive *= 1 - mag[STATUS_INDEX.refit]!;
  if (ticks[STATUS_INDEX.emp]! > 0) {
    fx.auxLimit = 0;
    fx.driveSupplyLimit = DRIVETRAIN_MIN_SUPPLY;
  }
  if (ticks[STATUS_INDEX.airborne]! > 0) fx.airborne = true;
}

// --- Damage (Section 8.1, 11.8 step 8) -----------------------------------------------------------

export type HitInput = {
  /** Car that caused it, or -1 for the track. */
  by: number;
  /** Attacking part index on `by`, or -1. */
  part: number;
  weapon: string;
  cls: HitClass;
  /** Nominal component damage before any defense. */
  damage: number;
  /** World position of the strike. */
  x: number;
  y: number;
  /** Share of armor the hit ignores, and of the damage that carries on to a second module. */
  penetration: number;
  projectile: number;
  /** Fire gets in everywhere: no shield, breakaway or plate stands in its way. */
  bypass: boolean;
};

/** A reusable hit record, so the hot path allocates nothing per hit. */
export function createHit(): HitInput {
  return {
    by: -1,
    part: -1,
    weapon: '',
    cls: 'direct',
    damage: 0,
    x: 0,
    y: 0,
    penetration: 0,
    projectile: 0,
    bypass: false,
  };
}

function nearestComponent(
  car: CombatCar,
  lx: number,
  ly: number,
  reach: number,
  skip: number,
): number {
  let best = -1;
  let bestD = reach * reach;
  const comps = car.components;
  for (let i = 0; i < comps.length; i++) {
    if (i === skip) continue;
    const c = comps[i]!;
    if (c.integrity <= 0) continue;
    const dx = c.x - lx;
    const dy = c.y - ly;
    const d = dx * dx + dy * dy;
    // Strictly nearer wins, so ties go to the lower index and the result never depends on order.
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function setIntegrity(
  race: RaceSession,
  car: CombatCar,
  index: number,
  integrity: number,
  repaired: boolean,
): void {
  const comp = car.components[index]!;
  const wasDisabled = comp.integrity <= 0;
  comp.integrity = clamp(integrity, 0, comp.maxIntegrity);
  const condition = conditionIndex(comp.integrity);
  if (condition !== comp.condition) {
    comp.condition = condition;
    emit(race, {
      type: 'component',
      car: car.index,
      component: index,
      condition: CONDITIONS[condition]!,
      integrity: comp.integrity,
      repaired,
    });
  }
  if (comp.kind === 'wheel') car.session.wheelIntegrity[comp.ref] = comp.integrity;
  if (comp.kind === 'part') {
    const nowDisabled = comp.integrity <= 0;
    if (nowDisabled !== wasDisabled) {
      const module = car.modules[comp.ref]!;
      if (nowDisabled) {
        car.disabledMask |= 1 << comp.ref;
        module.state = MODULE_DISABLED;
        module.phase = 0;
        module.timer = 0;
        module.burstLeft = 0;
        module.lock = 0;
        module.locked = false;
        const spec = car.specs[comp.ref]!;
        if (spec.kind === 'shield' && module.pool > 0) {
          module.pool = 0;
          emit(race, { type: 'shield', car: car.index, part: comp.ref, state: 'down', points: 0 });
        }
      } else {
        car.disabledMask &= ~(1 << comp.ref);
        module.state = module.cooldown > 0 ? MODULE_COOLDOWN : MODULE_IDLE;
      }
      refreshDerived(car, race.options.conditions);
    }
  }
}

const ARC_TAG: readonly CarArc[] = ARCS;

/**
 * Resolves one hit on one car, in the order Section 11.8 gives: damage tags, reactive foam,
 * energy shield, breakaway armor, the armor of the arc it arrives on, then the component at
 * the point of impact and the chassis behind it. Returns the integrity actually removed.
 */
export function applyHit(race: RaceSession, car: CombatCar, hit: HitInput): number {
  if (car.ko || hit.damage <= 0) return 0;
  const m = car.session.motion;
  const chassis = car.build.chassis;
  const halfW = chassis.bodyHalfWidth;
  const halfL = chassis.bodyHalfLength;
  // World to chassis-local: x to the right, y toward the rear.
  const fx = Math.sin(m.headingRad);
  const fy = -Math.cos(m.headingRad);
  const dx = hit.x - m.x;
  const dy = hit.y - m.y;
  const lx = clamp(dx * -fy + dy * fx, -halfW, halfW);
  const ly = clamp(-(dx * fx + dy * fy), -halfL, halfL);
  const arc = arcOf(lx, ly, halfW, halfL);
  const arcIndex = ARC_INDEX[arc];
  const tags = car.totals.damage;

  let dmg = hit.damage * (tags[ARC_TAG[arcIndex]!] ?? 1);
  switch (hit.cls) {
    case 'bullet':
      dmg *= (tags.bullet ?? 1) * (tags.direct ?? 1);
      break;
    case 'direct':
      dmg *= tags.direct ?? 1;
      break;
    case 'heavy':
      dmg *= tags.heavy ?? 1;
      break;
    case 'ram':
      dmg *= tags.ram ?? 1;
      if (arc === 'front') dmg *= tags.ram_front ?? 1;
      else if (arc === 'rear') dmg *= tags.ram_rear ?? 1;
      break;
    case 'burn':
      dmg *= tags.burn ?? 1;
      break;
  }

  let shield = 0;
  let armor = 0;
  let absorbed = 0;
  if (!hit.bypass) {
    const disrupted = hasStatus(car, 'emp');
    for (let i = 0; i < car.specs.length && dmg > 0; i++) {
      const spec = car.specs[i]!;
      const module = car.modules[i]!;
      if (module.state === MODULE_DISABLED) continue;
      if (spec.kind === 'reactive') {
        if (module.cooldown > 0 || dmg < spec.threshold) continue;
        const cut = dmg * spec.factor;
        dmg -= cut;
        absorbed += cut;
        module.cooldown = spec.cooldownTicks;
        module.cooldownTotal = spec.cooldownTicks;
        module.state = MODULE_COOLDOWN;
        car.stats.usesByPart[i]!++;
        emit(race, { type: 'shield', car: car.index, part: i, state: 'down', points: cut });
      } else if (spec.kind === 'shield') {
        if (module.pool <= 0 || disrupted || hit.cls === 'ram' || hit.cls === 'burn') continue;
        const take = Math.min(module.pool, dmg);
        dmg -= take;
        shield += take;
        // One hit, then it is down until it has recharged.
        module.pool = 0;
        module.cooldown = spec.cooldownTicks;
        module.cooldownTotal = spec.cooldownTicks;
        module.state = MODULE_COOLDOWN;
        car.stats.usesByPart[i]!++;
        emit(race, { type: 'shield', car: car.index, part: i, state: 'down', points: take });
      } else if (spec.kind === 'breakaway') {
        if (module.pool <= 0) continue;
        const take = Math.min(module.pool, dmg);
        dmg -= take;
        absorbed += take;
        module.pool -= take;
        if (module.pool <= 1e-9) {
          module.pool = 0;
          module.charges = 0;
          car.stats.usesByPart[i]!++;
          emit(race, { type: 'shield', car: car.index, part: i, state: 'broken', points: take });
        }
      }
    }
    const plate = car.armor[arcIndex]!;
    if (dmg > 0 && plate > 0) {
      const health = plate / Math.max(1e-9, car.armorMax[arcIndex]!);
      const share = (1 - hit.penetration) * lerp(ARMOR_MIN_ABSORB, 1, clamp(health, 0, 1));
      const take = Math.min(plate, dmg * share);
      car.armor[arcIndex] = plate - take;
      dmg -= take;
      armor = take;
    }
  }

  let component = -1;
  let componentDamage = 0;
  let chassisDamage = 0;
  if (dmg > 0) {
    component = nearestComponent(car, lx, ly, HIT_LOCAL_RADIUS, -1);
    if (component >= 0) {
      const comp = car.components[component]!;
      let factor = 1;
      if (comp.kind === 'wheel') factor = tags.wheel ?? 1;
      else if (comp.kind === 'engine') factor = tags.engine ?? 1;
      else if (comp.kind === 'part')
        factor =
          (tags.mounted_part ?? 1) * (comp.arc === 'rear' ? (tags.rear_mounted_part ?? 1) : 1);
      componentDamage = Math.min(comp.integrity, dmg * factor);
      setIntegrity(race, car, component, comp.integrity - componentDamage, false);
      if (hit.penetration > 0) {
        const second = nearestComponent(car, lx, ly, HIT_LOCAL_RADIUS * 1.8, component);
        if (second >= 0) {
          const next = car.components[second]!;
          const through = Math.min(
            next.integrity,
            dmg * hit.penetration * PENETRATION_SECOND_SHARE,
          );
          setIntegrity(race, car, second, next.integrity - through, false);
          componentDamage += through;
        }
      }
    }
    chassisDamage = Math.min(
      car.chassis,
      dmg * (CHASSIS_DAMAGE_SHARE + (component < 0 ? BODY_HIT_SHARE : 0)),
    );
    car.chassis -= chassisDamage;
  }

  const total = componentDamage + chassisDamage;
  car.stats.damageTaken += total;
  if (hit.by >= 0 && hit.by !== car.index) {
    car.lastHitBy = hit.by;
    const attacker = race.cars[hit.by]!;
    attacker.stats.damageDealt += total + shield + armor + absorbed;
    attacker.stats.hitsLanded++;
    if (hit.part >= 0)
      attacker.stats.damageByPart[hit.part] =
        (attacker.stats.damageByPart[hit.part] ?? 0) + total + shield + armor + absorbed;
  }
  emit(race, {
    type: 'hit',
    car: car.index,
    by: hit.by,
    weapon: hit.weapon,
    cls: hit.cls,
    x: hit.x,
    y: hit.y,
    component,
    damage: componentDamage,
    chassis: chassisDamage,
    shield,
    armor,
    absorbed,
    projectile: hit.projectile,
  });
  return total;
}

// --- Repairs (Section 8.2) -----------------------------------------------------------------------

/** Restores integrity to a component. Returns the amount restored. */
export function repairComponent(
  race: RaceSession,
  car: CombatCar,
  index: number,
  amount: number,
): number {
  const comp = car.components[index];
  if (!comp) return 0;
  const before = comp.integrity;
  setIntegrity(race, car, index, comp.integrity + amount, true);
  return comp.integrity - before;
}

/** The most damaged wheel, or -1 when none is below its full integrity. */
export function worstWheel(car: CombatCar): number {
  let worst = -1;
  let worstRatio = 1;
  const count = car.build.chassis.wheelAnchors.length;
  for (let i = 0; i < count; i++) {
    const comp = car.components[COMPONENT_FIRST_WHEEL + i]!;
    const ratio = comp.integrity / comp.maxIntegrity;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = COMPONENT_FIRST_WHEEL + i;
    }
  }
  return worst;
}

/**
 * Section 8.2: the worst critical core part (engine, steering, a wheel); failing that, the
 * most damaged component of any kind. -1 when nothing is damaged.
 */
export function worstComponent(car: CombatCar): number {
  const coreEnd = COMPONENT_FIRST_WHEEL + car.build.chassis.wheelAnchors.length;
  let worst = -1;
  let worstValue = Infinity;
  for (let i = 0; i < coreEnd; i++) {
    const comp = car.components[i]!;
    if (comp.integrity <= COMPONENT_CRITICAL && comp.integrity < worstValue) {
      worstValue = comp.integrity;
      worst = i;
    }
  }
  if (worst >= 0) return worst;
  let worstRatio = 1;
  for (let i = 0; i < car.components.length; i++) {
    const comp = car.components[i]!;
    const ratio = comp.integrity / comp.maxIntegrity;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = i;
    }
  }
  return worst;
}

// --- Impulses and energy -----------------------------------------------------------------------

/**
 * Shoves a car. `dvx`, `dvy` are the change in velocity, px/s, a car of reference mass would
 * get; lighter cars get more and Shock Dampers less. A major shove is refused while the car is
 * immune and starts a new immunity window (Section 8.1). Returns false when refused.
 */
export function applyImpulse(
  race: RaceSession,
  car: CombatCar,
  dvx: number,
  dvy: number,
  by: number,
  weapon: string,
  major: boolean,
): boolean {
  if (car.ko) return false;
  if (major && hasStatus(car, 'immune')) {
    emit(race, {
      type: 'status',
      car: car.index,
      by,
      family: 'immune',
      state: 'blocked',
      magnitude: Math.hypot(dvx, dvy),
      ticks: car.statusTicks[STATUS_INDEX.immune]!,
    });
    return false;
  }
  const scale =
    car.totals.impulse.displacement *
    clamp(REFERENCE_MASS_KG / car.session.params.massKg, IMPULSE_MASS_MIN, IMPULSE_MASS_MAX);
  const m = car.session.motion;
  m.velocityX += dvx * scale;
  m.velocityY += dvy * scale;
  if (major) grantImmunity(race, car, by);
  emit(race, {
    type: 'impulse',
    car: car.index,
    by,
    weapon,
    dx: dvx * scale,
    dy: dvy * scale,
  });
  return true;
}

/** Energy a shot of this size can call on: the battery, plus the capacitor for big shots. */
export function energyAvailable(car: CombatCar, amount: number): number {
  let available = car.session.motion.batteryEnergy;
  if (car.reserveMax > 0 && amount >= capacitorThreshold(car)) available += car.reserve;
  return available;
}

function capacitorThreshold(car: CombatCar): number {
  for (const spec of car.specs)
    if (spec.kind === 'capacitor' && !((car.disabledMask >> spec.part) & 1)) return spec.threshold;
  return Infinity;
}

/** Takes energy for a shot, from the capacitor first when it is entitled to it. */
export function drawEnergy(car: CombatCar, amount: number): boolean {
  if (amount <= 0) return true;
  if (energyAvailable(car, amount) < amount - 1e-9) return false;
  let need = amount;
  if (car.reserve > 0 && amount >= capacitorThreshold(car)) {
    const take = Math.min(car.reserve, need);
    car.reserve -= take;
    need -= take;
  }
  const m = car.session.motion;
  m.batteryEnergy = Math.max(0, m.batteryEnergy - need);
  return true;
}

/** Tops the capacitor up from the battery while the battery has charge to spare. */
export function rechargeReserve(car: CombatCar): void {
  if (car.reserveMax <= 0 || car.reserve >= car.reserveMax) return;
  for (const spec of car.specs) {
    if (spec.kind !== 'capacitor' || (car.disabledMask >> spec.part) & 1) continue;
    const m = car.session.motion;
    const spare = m.batteryEnergy - car.session.params.power.capacity * 0.25;
    if (spare <= 0) return;
    const take = Math.min(spec.factor * SIM_DT, spare, car.reserveMax - car.reserve);
    m.batteryEnergy -= take;
    car.reserve += take;
    return;
  }
}
