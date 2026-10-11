import {
  COMPONENT_HEALTHY,
  HEAT_PROTECTION,
  LOS_INTERVAL_TICKS,
  MAJOR_IMPULSE,
  SIM_DT,
  WEAPON_DAMAGE_RELOAD_PENALTY,
  WEAPON_HEAT_RELOAD_PENALTY,
  WEAPON_MISFIRE_CHANCE,
  WEAPON_MISFIRE_SECONDS,
  WET_WEATHER,
} from '../balance.js';
import { clamp, wrapAngle } from '../math.js';
import type { RefusalReason } from '../protocol.js';
import {
  applyHit,
  applyImpulse,
  applyStatus,
  createHit,
  drawEnergy,
  emit,
  energyAvailable,
  hasStatus,
  isDisrupted,
} from './car.js';
import {
  blowProjectiles,
  flameOverHazards,
  igniteCar,
  placeHazard,
  scrambleMissiles,
  spawnLobbed,
  spawnProjectile,
} from './entities.js';
import type { Vec } from './geometry.js';
import {
  hullDistance,
  hullGap,
  lineClear,
  localToWorld,
  segmentCar,
  sweepSolid,
  withinArc,
} from './geometry.js';
import type { ModuleSpec } from './specs.js';
import { ticksOf } from './specs.js';
import type { CombatCar, ModuleRuntime, RaceSession } from './types.js';
import {
  COMPONENT_FIRST_WHEEL,
  MODULE_ACTIVE,
  MODULE_COOLDOWN,
  MODULE_DISABLED,
  MODULE_IDLE,
  MODULE_TARGETING,
} from './types.js';

/**
 * Weapon lifecycle (Section 8.3): IDLE, TARGETING where it applies, ACTIVE, COOLDOWN. Every
 * weapon is one of the primitives of Section 11.8 with its own catalog numbers; what sets the
 * twenty apart is which primitive, how it aims, and what the hit does.
 */

const muzzle: Vec = { x: 0, y: 0 };
const base: Vec = { x: 0, y: 0 };
const near: Vec = { x: 0, y: 0 };
const what = { kind: 0 };
const hit = createHit();
const MISFIRE_TICKS = ticksOf(WEAPON_MISFIRE_SECONDS);

/** What a weapon knows about its target this tick. */
type Sight = {
  target: CombatCar | null;
  /** World heading from the muzzle to the target. */
  bearing: number;
  /** Distance from the muzzle to the target's hull. */
  distance: number;
  /** In range, in the cone, beyond the minimum range. */
  inReach: boolean;
  clear: boolean;
};
const sight: Sight = { target: null, bearing: 0, distance: 0, inReach: false, clear: false };

/** The nearest other car still in the race. */
export function pickTarget(race: RaceSession, car: CombatCar): CombatCar | null {
  let best: CombatCar | null = null;
  let bestD = Infinity;
  const m = car.session.motion;
  for (const other of race.cars) {
    if (other.index === car.index || other.ko) continue;
    const o = other.session.motion;
    const d = (o.x - m.x) * (o.x - m.x) + (o.y - m.y) * (o.y - m.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

/** World heading a part faces: the car's heading plus its quarter turn. */
function facingOf(car: CombatCar, spec: ModuleSpec): number {
  return car.session.motion.headingRad + (spec.turn * Math.PI) / 2;
}

/** Where a weapon's muzzle is when it points along `heading`. */
function muzzleAt(car: CombatCar, spec: ModuleSpec, heading: number, out: Vec): Vec {
  localToWorld(car.session.motion, spec.lx, spec.ly, out);
  out.x += Math.sin(heading) * spec.muzzle;
  out.y -= Math.cos(heading) * spec.muzzle;
  return out;
}

function weaponRange(race: RaceSession, spec: ModuleSpec): number {
  return spec.kind === 'arc' && WET_WEATHER[race.env.weather]
    ? spec.range * spec.wetFactor
    : spec.range;
}

function look(race: RaceSession, car: CombatCar, spec: ModuleSpec, module: ModuleRuntime): Sight {
  const target = pickTarget(race, car);
  sight.target = target;
  sight.inReach = false;
  sight.clear = false;
  if (!target) return sight;
  const facing = spec.aim === 'track' || spec.aim === 'none' ? 0 : facingOf(car, spec);
  muzzleAt(
    car,
    spec,
    spec.aim === 'track' || spec.aim === 'none' ? car.session.motion.headingRad : facing,
    muzzle,
  );
  const t = target.session.motion;
  sight.bearing = Math.atan2(t.x - muzzle.x, -(t.y - muzzle.y));
  // A contact weapon reaches as far as its own car's side does: what counts is the gap between
  // the two hulls, not how deep in the bodywork the blade is mounted.
  sight.distance =
    spec.kind === 'contact'
      ? hullGap(car.session.motion, car.session.params, t, target.session.params)
      : hullDistance(t, target.session.params, muzzle.x, muzzle.y, null);
  const range = weaponRange(race, spec);
  sight.inReach =
    sight.distance <= range &&
    sight.distance >= spec.minRange &&
    (spec.aim === 'track' || spec.aim === 'none' || withinArc(facing, sight.bearing, spec.half));
  if (!sight.inReach) return sight;
  if (!spec.lineOfSight) {
    sight.clear = true;
    return sight;
  }
  // Line of sight costs a walk along the track, so it is refreshed every few ticks.
  if (race.tick - module.losTick >= LOS_INTERVAL_TICKS) {
    module.losTick = race.tick;
    module.los = lineClear(race.track, muzzle.x, muzzle.y, t.x, t.y, race.scratchLoc);
  }
  sight.clear = module.los;
  return sight;
}

/** Heading to fire along: at the target with lead when it can be reached, else straight. */
function fireHeading(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  module: ModuleRuntime,
): number {
  const m = car.session.motion;
  if (spec.aim === 'track') return m.headingRad + module.aim;
  const facing = facingOf(car, spec);
  if (spec.aim !== 'assist') return facing;
  const s = look(race, car, spec, module);
  if (!s.target || !s.inReach) return facing;
  const t = s.target.session.motion;
  let aimX = t.x;
  let aimY = t.y;
  if (spec.speed > 0) {
    // The shot carries the firing car's velocity, so lead is on the relative velocity.
    const time = Math.hypot(t.x - muzzle.x, t.y - muzzle.y) / spec.speed;
    aimX += (t.velocityX - m.velocityX) * time;
    aimY += (t.velocityY - m.velocityY) * time;
  }
  const bearing = Math.atan2(aimX - muzzle.x, -(aimY - muzzle.y));
  return facing + clamp(wrapAngle(bearing - facing), -spec.half, spec.half);
}

function refuse(race: RaceSession, car: CombatCar, spec: ModuleSpec, reason: RefusalReason): void {
  emit(race, { type: 'refused', car: car.index, part: spec.part, reason });
}

function startCooldown(car: CombatCar, spec: ModuleSpec, module: ModuleRuntime): void {
  const m = car.session.motion;
  const heatThreshold = car.session.params.heat.performanceThreshold;
  // A hot car reloads slowly (Section 6.2: predictable duty-cycle loss), and so does a
  // damaged weapon (Section 8.1).
  const hot =
    spec.heat > 0
      ? clamp((m.coreHeat - heatThreshold) / Math.max(1, HEAT_PROTECTION - heatThreshold), 0, 1)
      : 0;
  const integrity =
    car.components[COMPONENT_FIRST_WHEEL + car.build.chassis.wheelAnchors.length + spec.part]!
      .integrity;
  const worn = 1 - clamp(integrity / COMPONENT_HEALTHY, 0, 1);
  const ticks = Math.round(
    spec.cooldownTicks *
      (1 + WEAPON_HEAT_RELOAD_PENALTY * hot + WEAPON_DAMAGE_RELOAD_PENALTY * worn),
  );
  module.cooldown = ticks;
  module.cooldownTotal = ticks;
}

/**
 * Tries to start a weapon. Order of refusals: no ammunition, still cooling down, thermal
 * protection, not enough power. A damaged weapon may misfire harmlessly.
 */
function tryFire(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  module: ModuleRuntime,
  report: boolean,
): boolean {
  let reason: RefusalReason | null = null;
  if (module.charges === 0) reason = 'no_ammo';
  else if (module.cooldown > 0 || module.phase !== 0) reason = 'cooldown';
  else if (spec.heat > 0 && car.session.motion.thermalLimited) reason = 'overheat';
  else if (energyAvailable(car, spec.energy) < spec.energy - 1e-9) reason = 'low_power';
  if (reason) {
    if (report) refuse(race, car, spec, reason);
    return false;
  }
  const integrity =
    car.components[COMPONENT_FIRST_WHEEL + car.build.chassis.wheelAnchors.length + spec.part]!
      .integrity;
  if (integrity < COMPONENT_HEALTHY) {
    const chance = WEAPON_MISFIRE_CHANCE * (1 - integrity / COMPONENT_HEALTHY);
    if (race.rng() < chance) {
      module.cooldown = MISFIRE_TICKS;
      module.cooldownTotal = MISFIRE_TICKS;
      emit(race, { type: 'misfire', car: car.index, part: spec.part, weapon: spec.id });
      return false;
    }
  }
  if (module.charges > 0) module.charges--;
  drawEnergy(car, spec.energy);
  car.session.motion.coreHeat += spec.heat;
  startCooldown(car, spec, module);
  car.stats.shotsFired++;
  car.stats.usesByPart[spec.part]!++;
  if (spec.windupTicks > 0) {
    module.phase = 1;
    module.timer = spec.windupTicks;
    emit(race, {
      type: 'windup',
      car: car.index,
      part: spec.part,
      weapon: spec.id,
      ticks: spec.windupTicks,
    });
  } else release(race, car, spec, module);
  return true;
}

function shotEvent(race: RaceSession, car: CombatCar, spec: ModuleSpec, heading: number): void {
  emit(race, {
    type: 'shot',
    car: car.index,
    part: spec.part,
    weapon: spec.id,
    x: muzzle.x,
    y: muzzle.y,
    dir: heading,
    projectile: 0,
    n: 0,
    of: 1,
  });
}

function fillHit(car: CombatCar, spec: ModuleSpec, x: number, y: number): void {
  hit.by = car.index;
  hit.part = spec.part;
  hit.weapon = spec.id;
  hit.x = x;
  hit.y = y;
  hit.penetration = spec.penetration;
  hit.projectile = 0;
  hit.bypass = false;
}

function fireBullet(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  module: ModuleRuntime,
): void {
  const n = spec.count - module.burstLeft;
  // Shots walk across the spread in a fixed order: the same burst every time.
  const offset = spec.count > 1 ? (n / (spec.count - 1) - 0.5) * spec.spread : 0;
  const heading = fireHeading(race, car, spec, module) + offset;
  muzzleAt(car, spec, heading, muzzle);
  spawnProjectile(race, car, spec, 'bullet', muzzle.x, muzzle.y, heading, n, spec.count);
  module.burstLeft--;
  module.burstTimer = spec.intervalTicks;
}

/** The effect leaves the weapon. */
function release(race: RaceSession, car: CombatCar, spec: ModuleSpec, module: ModuleRuntime): void {
  const m = car.session.motion;
  const facing = facingOf(car, spec);
  module.phase = 0;
  switch (spec.kind) {
    case 'burst':
      module.phase = 2;
      module.burstLeft = spec.count;
      fireBullet(race, car, spec, module);
      if (module.burstLeft <= 0) module.phase = 0;
      break;

    case 'spread': {
      muzzleAt(car, spec, facing, muzzle);
      const mx = muzzle.x;
      const my = muzzle.y;
      for (let n = 0; n < spec.count; n++) {
        const heading = facing + ((n + 0.5) / spec.count - 0.5) * spec.spread;
        spawnProjectile(race, car, spec, 'pellet', mx, my, heading, n, spec.count);
      }
      break;
    }

    case 'hitscan': {
      const heading = fireHeading(race, car, spec, module);
      muzzleAt(car, spec, heading, muzzle);
      const x0 = muzzle.x;
      const y0 = muzzle.y;
      const x1 = x0 + Math.sin(heading) * spec.range;
      const y1 = y0 - Math.cos(heading) * spec.range;
      let best = sweepSolid(race.track, x0, y0, x1, y1, 0, race.scratchLoc, what);
      if (best > 1) best = 1;
      let struck: CombatCar | null = null;
      for (const other of race.cars) {
        if (other.index === car.index || other.ko) continue;
        const o = other.session.motion;
        const t = segmentCar(
          x0,
          y0,
          x1,
          y1,
          o.x,
          o.y,
          o.headingRad,
          other.session.params,
          spec.radius,
        );
        if (t <= best) {
          best = t;
          struck = other;
        }
      }
      const ex = x0 + (x1 - x0) * best;
      const ey = y0 + (y1 - y0) * best;
      shotEvent(race, car, spec, heading);
      emit(race, {
        type: 'beam',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x: x0,
        y: y0,
        toX: ex,
        toY: ey,
        hit: struck ? struck.index : -1,
      });
      if (struck) {
        fillHit(car, spec, ex, ey);
        hit.cls = 'heavy';
        hit.damage = spec.damage;
        applyHit(race, struck, hit);
      }
      break;
    }

    case 'rocket':
      muzzleAt(car, spec, facing, muzzle);
      spawnProjectile(race, car, spec, 'rocket', muzzle.x, muzzle.y, facing, 0, 1);
      break;

    case 'homing': {
      muzzleAt(car, spec, facing, muzzle);
      const p = spawnProjectile(race, car, spec, 'missile', muzzle.x, muzzle.y, facing, 0, 1);
      // Unlocked, it flies along the muzzle like any rocket (Section 11.5).
      p.target = module.locked ? module.target : -1;
      module.lock = 0;
      module.locked = false;
      break;
    }

    case 'mine': {
      muzzleAt(car, spec, facing, muzzle);
      const x = muzzle.x + Math.sin(facing) * spec.dropDistance;
      const y = muzzle.y - Math.cos(facing) * spec.dropDistance;
      shotEvent(race, car, spec, facing);
      placeHazard(
        race,
        car,
        spec,
        'mine',
        x,
        y,
        spec.hazardRadius,
        0,
        0,
        spec.hazardLifeTicks,
        spec.armTicks,
      );
      break;
    }

    case 'strip': {
      muzzleAt(car, spec, facing, muzzle);
      const reach = spec.dropDistance + spec.hazardHalfLength;
      const x = muzzle.x + Math.sin(facing) * reach;
      const y = muzzle.y - Math.cos(facing) * reach;
      shotEvent(race, car, spec, facing);
      placeHazard(
        race,
        car,
        spec,
        'oil',
        x,
        y,
        spec.hazardRadius,
        spec.hazardHalfLength,
        facing,
        spec.hazardLifeTicks,
        0,
      );
      break;
    }

    case 'puddle': {
      muzzleAt(car, spec, facing, muzzle);
      const x = muzzle.x + Math.sin(facing) * spec.range;
      const y = muzzle.y - Math.cos(facing) * spec.range;
      spawnLobbed(race, car, spec, 'foam', muzzle.x, muzzle.y, x, y, spec.hazardRadius);
      break;
    }

    case 'pulse': {
      localToWorld(m, spec.lx, spec.ly, muzzle);
      shotEvent(race, car, spec, m.headingRad);
      emit(race, {
        type: 'area',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x: muzzle.x,
        y: muzzle.y,
        dir: m.headingRad,
        half: Math.PI,
        range: spec.range,
        ticks: 6,
      });
      for (const other of race.cars) {
        if (other.index === car.index || other.ko) continue;
        const gap = hullDistance(
          other.session.motion,
          other.session.params,
          muzzle.x,
          muzzle.y,
          null,
        );
        if (gap > spec.range) continue;
        applyEmp(race, other, spec.statusTicks, car.index);
      }
      if (spec.flagA) scrambleMissiles(race, muzzle.x, muzzle.y, spec.range, car.index);
      break;
    }

    case 'arc': {
      const target = pickTarget(race, car);
      localToWorld(m, spec.lx, spec.ly, muzzle);
      shotEvent(race, car, spec, m.headingRad);
      if (!target) break;
      hullDistance(target.session.motion, target.session.params, muzzle.x, muzzle.y, near);
      emit(race, {
        type: 'beam',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x: muzzle.x,
        y: muzzle.y,
        toX: near.x,
        toY: near.y,
        hit: target.index,
      });
      fillHit(car, spec, near.x, near.y);
      hit.cls = 'direct';
      hit.damage = spec.damage;
      applyHit(race, target, hit);
      applyStatus(race, target, 'jam', 1, spec.statusTicks, car.index);
      break;
    }

    case 'flame':
      module.phase = 2;
      module.timer = spec.activeTicks;
      muzzleAt(car, spec, facing, muzzle);
      shotEvent(race, car, spec, facing);
      emit(race, {
        type: 'area',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x: muzzle.x,
        y: muzzle.y,
        dir: facing,
        half: spec.half,
        range: spec.range,
        ticks: spec.activeTicks,
      });
      break;

    case 'frost':
      muzzleAt(car, spec, facing, muzzle);
      spawnProjectile(race, car, spec, 'frost', muzzle.x, muzzle.y, facing, 0, 1);
      break;

    case 'melee': {
      muzzleAt(car, spec, facing, muzzle);
      localToWorld(m, spec.lx, spec.ly, base);
      shotEvent(race, car, spec, facing);
      emit(race, {
        type: 'area',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x: base.x,
        y: base.y,
        dir: facing,
        half: spec.half,
        range: spec.range,
        ticks: 3,
      });
      for (const other of race.cars) {
        if (other.index === car.index || other.ko) continue;
        const o = other.session.motion;
        const gap = hullDistance(o, other.session.params, base.x, base.y, near);
        if (gap > spec.range) continue;
        if (!withinArc(facing, Math.atan2(o.x - base.x, -(o.y - base.y)), spec.half)) continue;
        fillHit(car, spec, near.x, near.y);
        hit.cls = 'heavy';
        hit.damage = spec.damage;
        applyHit(race, other, hit);
        // A sideways knock: across the struck car, away from the hammer.
        const rx = Math.cos(o.headingRad);
        const ry = Math.sin(o.headingRad);
        const side = (o.x - base.x) * rx + (o.y - base.y) * ry;
        const sign = side >= 0 ? 1 : -1;
        applyImpulse(
          race,
          other,
          rx * sign * spec.impulse,
          ry * sign * spec.impulse,
          car.index,
          spec.id,
          true,
        );
      }
      break;
    }

    case 'contact': {
      const target = pickTarget(race, car);
      muzzleAt(car, spec, facing, muzzle);
      shotEvent(race, car, spec, facing);
      if (!target) break;
      hullDistance(target.session.motion, target.session.params, muzzle.x, muzzle.y, near);
      fillHit(car, spec, near.x, near.y);
      hit.cls = 'direct';
      hit.damage = spec.damage;
      applyHit(race, target, hit);
      break;
    }

    case 'tether': {
      const heading = fireHeading(race, car, spec, module);
      muzzleAt(car, spec, heading, muzzle);
      spawnProjectile(race, car, spec, 'harpoon', muzzle.x, muzzle.y, heading, 0, 1);
      break;
    }

    case 'blast': {
      muzzleAt(car, spec, facing, muzzle);
      const x = muzzle.x;
      const y = muzzle.y;
      shotEvent(race, car, spec, facing);
      emit(race, {
        type: 'area',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x,
        y,
        dir: facing,
        half: spec.half,
        range: spec.range,
        ticks: 4,
      });
      for (const other of race.cars) {
        if (other.index === car.index || other.ko) continue;
        const o = other.session.motion;
        const gap = hullDistance(o, other.session.params, x, y, near);
        if (gap > spec.range) continue;
        const dx = o.x - x;
        const dy = o.y - y;
        if (!withinArc(facing, Math.atan2(dx, -dy), spec.half)) continue;
        if (!lineClear(race.track, x, y, o.x, o.y, race.scratchLoc)) continue;
        // Strongest at the mouth, fading to its floor at full reach.
        const strength = spec.impulse * (1 + (spec.falloffMin - 1) * (gap / spec.range));
        const d = Math.hypot(dx, dy) || 1;
        fillHit(car, spec, near.x, near.y);
        hit.cls = 'direct';
        hit.damage = spec.damage;
        applyHit(race, other, hit);
        applyImpulse(
          race,
          other,
          (dx / d) * strength,
          (dy / d) * strength,
          car.index,
          spec.id,
          strength >= MAJOR_IMPULSE,
        );
      }
      blowProjectiles(race, car, spec, x, y, facing);
      break;
    }

    case 'boomerang':
      muzzleAt(car, spec, facing, muzzle);
      spawnProjectile(race, car, spec, 'boomerang', muzzle.x, muzzle.y, facing, 0, 1);
      break;

    case 'mortar': {
      localToWorld(m, spec.lx, spec.ly, muzzle);
      spawnLobbed(
        race,
        car,
        spec,
        'shell',
        muzzle.x,
        muzzle.y,
        module.targetX,
        module.targetY,
        spec.splashRadius,
      );
      module.lock = 0;
      module.locked = false;
      break;
    }
    default:
      break;
  }
}

/** An EMP landing on a car: electronics down, shields dropped, anything mid-action cut off. */
export function applyEmp(race: RaceSession, target: CombatCar, ticks: number, by: number): void {
  if (!applyStatus(race, target, 'emp', 1, ticks, by)) return;
  for (let i = 0; i < target.specs.length; i++) {
    const spec = target.specs[i]!;
    const module = target.modules[i]!;
    if (module.state === MODULE_DISABLED) continue;
    if (spec.kind === 'shield' && module.pool > 0) {
      module.pool = 0;
      module.cooldown = spec.cooldownTicks;
      module.cooldownTotal = spec.cooldownTicks;
      module.state = MODULE_COOLDOWN;
      emit(race, { type: 'shield', car: target.index, part: i, state: 'down', points: 0 });
    }
  }
}

/** One flame tick: everything in the cone burns and heats, and the road under it catches. */
function flameTick(race: RaceSession, car: CombatCar, spec: ModuleSpec): void {
  const facing = facingOf(car, spec);
  muzzleAt(car, spec, facing, muzzle);
  const x = muzzle.x;
  const y = muzzle.y;
  for (const other of race.cars) {
    if (other.index === car.index || other.ko) continue;
    const o = other.session.motion;
    const gap = hullDistance(o, other.session.params, x, y, null);
    if (gap > spec.range) continue;
    if (gap > 0 && !withinArc(facing, Math.atan2(o.x - x, -(o.y - y)), spec.half)) continue;
    if (!lineClear(race.track, x, y, o.x, o.y, race.scratchLoc)) continue;
    igniteCar(race, other, spec, car.index, x, y);
  }
  flameOverHazards(race, car, spec, x, y, facing);
}

function setLock(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  module: ModuleRuntime,
  locked: boolean,
  target: number,
): void {
  if (module.locked === locked) return;
  module.locked = locked;
  emit(race, {
    type: 'lock',
    car: car.index,
    part: spec.part,
    weapon: spec.id,
    target,
    locked,
  });
}

/** Whether this weapon wants a target before it will fire by itself or hold a lock. */
function tracksTarget(spec: ModuleSpec): boolean {
  return spec.trigger !== 'manual' || spec.aim === 'track';
}

/**
 * Advances one weapon by a tick: cooldown, wind-up, burst or sustained emission, targeting,
 * and the trigger. `pressed` is the rising edge of its fire button this tick.
 */
function stepWeapon(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  module: ModuleRuntime,
  held: boolean,
  pressed: boolean,
  disrupted: boolean,
): void {
  if (module.state === MODULE_DISABLED) {
    if (pressed) refuse(race, car, spec, 'disabled');
    return;
  }
  if (disrupted) {
    // Electronics are down: nothing counts down, charges, tracks or fires (Sections 8.1, 11.5).
    if (module.phase !== 0) {
      module.phase = 0;
      module.burstLeft = 0;
      module.timer = 0;
    }
    if (module.locked) setLock(race, car, spec, module, false, module.target);
    module.lock = 0;
    if (pressed) refuse(race, car, spec, 'jammed');
    module.state = module.cooldown > 0 ? MODULE_COOLDOWN : MODULE_IDLE;
    return;
  }
  if (module.cooldown > 0) module.cooldown--;

  // --- Something already under way -----------------------------------------------------------
  if (module.phase === 1) {
    module.state = MODULE_ACTIVE;
    if (--module.timer <= 0) release(race, car, spec, module);
    return;
  }
  if (module.phase === 2) {
    module.state = MODULE_ACTIVE;
    if (spec.kind === 'flame') {
      flameTick(race, car, spec);
      if (--module.timer <= 0) module.phase = 0;
    } else if (--module.burstTimer <= 0) {
      fireBullet(race, car, spec, module);
      if (module.burstLeft <= 0) module.phase = 0;
    }
    return;
  }

  // --- Targeting (Section 8.3: published rules, line of sight where it applies) ------------
  let ready = true;
  let hasTarget = false;
  if (tracksTarget(spec) || spec.kind === 'arc' || spec.kind === 'contact') {
    const s = look(race, car, spec, module);
    const powered = 1 + (car.acquisitionFactor - 1) * car.session.telemetry.auxSupply;
    if (spec.aim === 'track') {
      // A turret turns toward its target at a limited rate and holds a lock inside its tolerance.
      let error = 0;
      const valid = s.target !== null && s.distance <= spec.range;
      if (valid) {
        const wanted = wrapAngle(s.bearing - car.session.motion.headingRad);
        error = wrapAngle(wanted - module.aim);
        const rate = spec.turnRate * powered;
        module.aim = wrapAngle(module.aim + clamp(error, -rate, rate));
        error = wrapAngle(wanted - module.aim);
      }
      hasTarget = valid && s.clear && Math.abs(error) <= spec.tolerance;
      setLock(race, car, spec, module, hasTarget, s.target ? s.target.index : -1);
      module.target = s.target ? s.target.index : -1;
    } else if (spec.lockTicks > 0) {
      // A seeker or a mortar needs its target in view for a moment before it has a lock.
      if (s.target && s.inReach && s.clear) {
        module.lock = Math.min(spec.lockTicks, module.lock + powered);
        module.target = s.target.index;
      } else module.lock = 0;
      hasTarget = module.lock >= spec.lockTicks;
      setLock(race, car, spec, module, hasTarget, module.target);
      if (hasTarget && spec.kind === 'mortar' && s.target) {
        // The reticle goes where the target will be when the shell comes down.
        const t = s.target.session.motion;
        const lead = spec.flightTicks * SIM_DT * spec.lead;
        module.targetX = t.x + t.velocityX * lead;
        module.targetY = t.y + t.velocityY * lead;
      }
    } else {
      hasTarget = s.target !== null && s.inReach && s.clear;
      module.target = s.target ? s.target.index : -1;
    }
    module.state =
      module.cooldown > 0
        ? MODULE_COOLDOWN
        : hasTarget || module.lock > 0
          ? MODULE_TARGETING
          : MODULE_IDLE;
    // A mortar has nowhere to send a shell without a target; the rest fire along the muzzle.
    if (spec.kind === 'mortar' || spec.auto) ready = hasTarget;
  } else {
    module.state = module.cooldown > 0 ? MODULE_COOLDOWN : MODULE_IDLE;
  }

  // --- Trigger -------------------------------------------------------------------------------
  if (spec.auto) {
    if (ready && module.cooldown <= 0) tryFire(race, car, spec, module, false);
  } else if (held) {
    if (!ready) {
      if (pressed) refuse(race, car, spec, 'no_target');
    } else if (module.cooldown <= 0 || pressed) tryFire(race, car, spec, module, pressed);
  }
  if (module.phase !== 0) module.state = MODULE_ACTIVE;
  else if (module.cooldown > 0) module.state = MODULE_COOLDOWN;
}

/**
 * Section 11.8 step 1 for weapons: every car's weapons advance one tick in car order, then
 * part order, so two cars firing on the same tick always resolve the same way.
 */
export function stepWeapons(race: RaceSession): void {
  for (const car of race.cars) car.lockCount = 0;
  for (const car of race.cars) {
    const active = !car.ko && car.session.phase === 'RACING';
    const disrupted = isDisrupted(car) || hasStatus(car, 'airborne');
    for (let slot = 0; slot < 2; slot++) {
      // A button with no weapon behind it is a command the car cannot carry out.
      const bit = 1 << slot;
      if (active && car.fire & bit && !(car.prevFire & bit)) {
        let found = false;
        for (const spec of car.specs)
          if (spec.category === 'weapon' && spec.slot === slot) found = true;
        if (!found) emit(race, { type: 'refused', car: car.index, part: -1, reason: 'no_weapon' });
      }
    }
    for (let i = 0; i < car.specs.length; i++) {
      const spec = car.specs[i]!;
      if (spec.category !== 'weapon') continue;
      const module = car.modules[i]!;
      if (!active) {
        if (module.locked) setLock(race, car, spec, module, false, module.target);
        module.phase = 0;
        continue;
      }
      const bit = spec.slot >= 0 ? 1 << spec.slot : 0;
      const held = (car.fire & bit) !== 0;
      const pressed = held && (car.prevFire & bit) === 0;
      stepWeapon(race, car, spec, module, held, pressed, disrupted);
      if (module.locked && spec.kind === 'homing' && module.target >= 0)
        race.cars[module.target]!.lockCount++;
    }
    car.prevFire = car.fire;
  }
}
