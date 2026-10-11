import {
  BURN_PULSE_SECONDS,
  IMPULSE_MASS_MAX,
  IMPULSE_MASS_MIN,
  RAM_DAMAGE_COOLDOWN_SECONDS,
  RAM_DAMAGE_MAX,
  RAM_DAMAGE_PER_SPEED,
  RAM_FORGIVE_SPEED,
  REFERENCE_MASS_KG,
  REPAIR_LOCKOUT_SECONDS,
  SIM_DT,
  SPAWN_RAM_GRACE_FACTOR,
} from '../balance.js';
import { angleDelta, clamp, headingFromVector } from '../math.js';
import type { RefusalReason } from '../protocol.js';
import { lapPosition, locate, sampleBranch } from '../track.js';
import {
  applyHit,
  applyStatus,
  createHit,
  emit,
  hasStatus,
  isDisrupted,
  rechargeReserve,
  repairComponent,
  statusMagnitude,
  tickStatuses,
  worstComponent,
  worstWheel,
} from './car.js';
import { launchDecoy } from './entities.js';
import { createContact, findCarContact, localToWorld, resolveCarContact } from './geometry.js';
import type { ModuleSpec } from './specs.js';
import { ticksOf } from './specs.js';
import type { CombatCar, ModuleRuntime, RaceSession } from './types.js';
import {
  COMPONENT_FIRST_WHEEL,
  MODULE_ACTIVE,
  MODULE_COOLDOWN,
  MODULE_DISABLED,
  MODULE_IDLE,
  STATUS_INDEX,
} from './types.js';

/**
 * The rest of the combat step: manual utilities (Section 11.7), repairs (Section 8.2), shield
 * recharge, burn pulses, the harpoon's tether, and car against car (Sections 3.4 and 10.1).
 */

const contact = createContact();
const hit = createHit();
const point = { x: 0, y: 0 };
const BURN_PULSE_TICKS = ticksOf(BURN_PULSE_SECONDS);
const REPAIR_LOCK_TICKS = ticksOf(REPAIR_LOCKOUT_SECONDS);
const RAM_COOLDOWN_TICKS = ticksOf(RAM_DAMAGE_COOLDOWN_SECONDS);

function refuse(race: RaceSession, car: CombatCar, spec: ModuleSpec, reason: RefusalReason): void {
  emit(race, { type: 'refused', car: car.index, part: spec.part, reason });
}

function utilityEvent(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  state: 'started' | 'done' | 'interrupted',
  value: number,
): void {
  emit(race, { type: 'utility', car: car.index, part: spec.part, utility: spec.id, state, value });
}

function startCooldown(spec: ModuleSpec, module: ModuleRuntime): void {
  module.cooldown = spec.cooldownTicks;
  module.cooldownTotal = spec.cooldownTicks;
  if (spec.cooldownTicks > 0) module.state = MODULE_COOLDOWN;
}

/** A manual utility's button went down this tick. */
function activate(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  module: ModuleRuntime,
): void {
  if (module.state === MODULE_DISABLED) return refuse(race, car, spec, 'disabled');
  if (isDisrupted(car)) return refuse(race, car, spec, 'jammed');
  if (module.charges === 0) return refuse(race, car, spec, 'no_ammo');
  if (module.cooldown > 0) return refuse(race, car, spec, 'cooldown');
  if (module.phase !== 0) return refuse(race, car, spec, 'busy');
  const m = car.session.motion;
  const wheelCount = car.build.chassis.wheelAnchors.length;

  switch (spec.kind) {
    case 'spare': {
      if (car.repairLock > 0) return refuse(race, car, spec, 'busy');
      // The wheel picked on the silhouette if it is a damaged wheel, otherwise the worst one.
      let target = car.repairTarget - 1;
      const picked = car.components[target];
      if (
        target < COMPONENT_FIRST_WHEEL ||
        target >= COMPONENT_FIRST_WHEEL + wheelCount ||
        !picked ||
        picked.integrity >= picked.maxIntegrity
      )
        target = worstWheel(car);
      if (target < 0) return refuse(race, car, spec, 'not_needed');
      module.phase = 3;
      module.timer = spec.windupTicks;
      module.target = target;
      module.state = MODULE_ACTIVE;
      car.repairLock = spec.windupTicks + REPAIR_LOCK_TICKS;
      applyStatus(race, car, 'refit', spec.factor, spec.statusTicks, car.index);
      utilityEvent(race, car, spec, 'started', target);
      break;
    }
    case 'repair': {
      if (car.repairLock > 0) return refuse(race, car, spec, 'busy');
      let target = car.repairTarget - 1;
      const picked = car.components[target];
      if (!picked || picked.integrity >= picked.maxIntegrity) target = worstComponent(car);
      if (target < 0) return refuse(race, car, spec, 'not_needed');
      module.phase = 3;
      module.timer = spec.windupTicks;
      module.target = target;
      module.state = MODULE_ACTIVE;
      car.repairLock = spec.windupTicks + REPAIR_LOCK_TICKS;
      utilityEvent(race, car, spec, 'started', target);
      break;
    }
    case 'nitro':
    case 'boost':
      // One burst at a time: a second press while it burns would waste the charge.
      if (hasStatus(car, 'boost')) return refuse(race, car, spec, 'busy');
      if (module.charges > 0) module.charges--;
      applyStatus(race, car, 'boost', spec.factor, spec.activeTicks, car.index);
      m.coreHeat += spec.heat;
      startCooldown(spec, module);
      car.stats.usesByPart[spec.part]!++;
      utilityEvent(race, car, spec, 'started', spec.activeTicks);
      break;
    case 'decoy':
      if (module.charges > 0) module.charges--;
      launchDecoy(race, car, spec);
      car.stats.usesByPart[spec.part]!++;
      utilityEvent(race, car, spec, 'started', spec.hazardLifeTicks);
      break;
    case 'hop':
      applyStatus(race, car, 'airborne', 1, spec.activeTicks, car.index);
      startCooldown(spec, module);
      car.stats.usesByPart[spec.part]!++;
      utilityEvent(race, car, spec, 'started', spec.activeTicks);
      break;
    case 'winch': {
      // Only a car that has been pinned for a while may use it (Section 8.2).
      if (car.stuckTicks < spec.windupTicks) return refuse(race, car, spec, 'not_needed');
      const track = race.track;
      const loc = race.scratchLoc;
      locate(track, m.x, m.y, loc);
      // A pull toward the road ahead, never across a checkpoint it has not earned.
      const ahead = sampleBranch(track.main, track.startS + lapPosition(track, loc) + spec.range);
      const dx = ahead.x - m.x;
      const dy = ahead.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      const speed = spec.range / (spec.activeTicks * SIM_DT);
      car.winchTicks = spec.activeTicks;
      car.winchVx = (dx / d) * speed;
      car.winchVy = (dy / d) * speed;
      car.stuckTicks = 0;
      startCooldown(spec, module);
      car.stats.usesByPart[spec.part]!++;
      utilityEvent(race, car, spec, 'started', spec.activeTicks);
      break;
    }
    default:
      break;
  }
}

/** Section 11.8 step 1 for utilities: buttons that went down this tick. */
export function stepUtilityInput(race: RaceSession): void {
  for (const car of race.cars) {
    const active = !car.ko && car.session.phase === 'RACING';
    const pressed = active ? car.use & ~car.prevUse : 0;
    car.prevUse = car.use;
    if (pressed === 0) continue;
    for (let bit = 0; bit < car.manualUtilities.length; bit++) {
      if (!((pressed >> bit) & 1)) continue;
      const part = car.manualUtilities[bit]!;
      activate(race, car, car.specs[part]!, car.modules[part]!);
    }
  }
}

/** While the winch is pulling, it decides where the car goes. */
export function stepWinch(car: CombatCar): void {
  if (car.winchTicks <= 0) return;
  car.winchTicks--;
  const m = car.session.motion;
  m.velocityX = car.winchVx;
  m.velocityY = car.winchVy;
  // The nose comes round to the pull.
  const wanted = headingFromVector(car.winchVx, car.winchVy);
  m.headingRad += clamp(angleDelta(m.headingRad, wanted), -0.12, 0.12);
  m.yawRate = 0;
}

/** Cooldowns, repairs in progress and shield recharge for everything that is not a weapon. */
function stepModules(race: RaceSession, car: CombatCar): void {
  const disrupted = isDisrupted(car);
  const lowPower = car.session.telemetry.lowPower;
  for (let i = 0; i < car.specs.length; i++) {
    const spec = car.specs[i]!;
    if (spec.category === 'weapon') continue;
    const module = car.modules[i]!;
    if (module.state === MODULE_DISABLED) {
      if (module.phase === 3) {
        module.phase = 0;
        utilityEvent(race, car, spec, 'interrupted', module.target);
      }
      continue;
    }

    if (module.phase === 3) {
      // A repair can be disrupted, never robbed: the kit is still there to try again (Section 8.2).
      if (disrupted) {
        module.phase = 0;
        module.state = MODULE_IDLE;
        car.repairLock = 0;
        utilityEvent(race, car, spec, 'interrupted', module.target);
        continue;
      }
      if (--module.timer <= 0) {
        module.phase = 0;
        if (module.charges > 0) module.charges--;
        const comp = car.components[module.target]!;
        if (spec.kind === 'spare') repairComponent(race, car, module.target, comp.maxIntegrity);
        else repairComponent(race, car, module.target, spec.points);
        car.stats.usesByPart[i]!++;
        module.state = MODULE_IDLE;
        utilityEvent(race, car, spec, 'done', module.target);
      }
      continue;
    }

    if (module.cooldown > 0) {
      // An energy shield only recharges while it has power.
      if (spec.kind === 'shield' && (disrupted || lowPower)) continue;
      if (--module.cooldown <= 0) {
        module.state = MODULE_IDLE;
        if (spec.kind === 'shield') {
          module.pool = spec.points;
          emit(race, { type: 'shield', car: car.index, part: i, state: 'up', points: spec.points });
        } else if (spec.kind === 'reactive') {
          emit(race, { type: 'shield', car: car.index, part: i, state: 'up', points: 0 });
        }
      }
    }
  }
}

/** Burn damage arrives in pulses at the side of the car the fire is on (Section 8.4 thermal). */
function stepBurn(race: RaceSession, car: CombatCar): void {
  const rate = statusMagnitude(car, 'burn');
  if (rate > 0) {
    car.burnPending += rate * SIM_DT;
    car.burnTimer++;
  }
  if (car.burnPending <= 0) return;
  if (rate > 0 && car.burnTimer < BURN_PULSE_TICKS) return;
  localToWorld(car.session.motion, car.burnX, car.burnY, point);
  hit.by = car.statusBy[STATUS_INDEX.burn]!;
  hit.part = car.burnPart;
  hit.weapon = car.burnWeapon;
  hit.cls = 'burn';
  hit.damage = car.burnPending;
  hit.x = point.x;
  hit.y = point.y;
  hit.penetration = 0;
  hit.projectile = 0;
  hit.bypass = true;
  car.burnPending = 0;
  car.burnTimer = 0;
  applyHit(race, car, hit);
}

/** The harpoon's line: it pulls the two cars together and lets go (Section 11.5: no hard stun). */
function stepTether(race: RaceSession, car: CombatCar): void {
  const tether = car.tether;
  if (!tether.active || !tether.spec) return;
  const spec = tether.spec;
  const target = race.cars[tether.target]!;
  const a = car.session.motion;
  const b = target.session.motion;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.hypot(dx, dy);
  tether.ticks--;
  if (
    tether.ticks <= 0 ||
    dist > spec.breakDistance ||
    car.ko ||
    target.ko ||
    isDisrupted(car) ||
    car.modules[spec.part]!.state === MODULE_DISABLED
  ) {
    tether.active = false;
    emit(race, {
      type: 'tether',
      car: car.index,
      part: spec.part,
      target: target.index,
      state: 'released',
    });
    return;
  }
  // Slack while they are close, so two cars already touching are not ground together.
  const slack = car.session.params.colliderRadius + target.session.params.colliderRadius + 8;
  if (dist <= slack) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const massOf = (c: CombatCar) =>
    clamp(REFERENCE_MASS_KG / c.session.params.massKg, IMPULSE_MASS_MIN, IMPULSE_MASS_MAX) *
    c.totals.impulse.displacement;
  const pullTarget = spec.pullAccel * (1 - spec.selfShare) * massOf(target) * SIM_DT;
  const pullSelf = spec.pullAccel * spec.selfShare * massOf(car) * SIM_DT;
  b.velocityX += nx * pullTarget;
  b.velocityY += ny * pullTarget;
  a.velocityX -= nx * pullSelf;
  a.velocityY -= ny * pullSelf;
}

/** Whether a car has been pinned against something: slow, and touching a wall or a car. */
function stepStuck(car: CombatCar): void {
  const t = car.session.telemetry;
  let threshold = 0;
  for (const spec of car.specs) if (spec.kind === 'winch') threshold = spec.threshold;
  if (
    threshold > 0 &&
    car.session.phase === 'RACING' &&
    t.speed < threshold &&
    (t.wallContact || car.touching)
  )
    car.stuckTicks++;
  else car.stuckTicks = 0;
}

/** Section 11.8 step 8: statuses, burn, repairs, shields, tethers, capacitor. */
export function stepSystems(race: RaceSession): void {
  for (const car of race.cars) {
    if (car.repairLock > 0) car.repairLock--;
    if (car.bladeCooldown > 0) car.bladeCooldown--;
    stepBurn(race, car);
    tickStatuses(race, car);
    stepModules(race, car);
    stepTether(race, car);
    rechargeReserve(car);
    stepStuck(car);
    // Being locked on to, and a missile about to arrive, are things a driver is told once.
    const level = car.missileInbound ? 2 : car.lockCount > 0 ? 1 : 0;
    if (level !== car.lockWarning) {
      if (level === 1 && car.lockWarning === 0)
        emit(race, { type: 'warning', car: car.index, kind: 'lock', by: -1, value: 0 });
      else if (level === 0)
        emit(race, { type: 'warning', car: car.index, kind: 'lock_lost', by: -1, value: 0 });
      car.lockWarning = level;
    }
    const t = car.session.telemetry;
    if (t.heatLevel >= 2) car.stats.heatLimitedTicks++;
    if (t.lowPower) car.stats.lowPowerTicks++;
    if (hasStatus(car, 'emp') || hasStatus(car, 'slow') || hasStatus(car, 'grip'))
      car.stats.impairedTicks++;
  }
}

// --- Car against car (Section 11.8 step 6) -------------------------------------------------------

function ramHit(
  race: RaceSession,
  target: CombatCar,
  by: CombatCar,
  damage: number,
  cls: 'ram' | 'direct',
  weapon: string,
): void {
  if (damage <= 0) return;
  hit.by = by.index;
  hit.part = -1;
  hit.weapon = weapon;
  hit.cls = cls;
  hit.damage = damage;
  hit.x = contact.x;
  hit.y = contact.y;
  hit.penetration = 0;
  hit.projectile = 0;
  hit.bypass = false;
  applyHit(race, target, hit);
}

/** True when the contact point is on a car's flank rather than its nose or tail. */
function onFlank(car: CombatCar, x: number, y: number): boolean {
  const m = car.session.motion;
  const fx = Math.sin(m.headingRad);
  const fy = -Math.cos(m.headingRad);
  const dx = x - m.x;
  const dy = y - m.y;
  const side = Math.abs(dx * -fy + dy * fx) / car.build.chassis.bodyHalfWidth;
  const along = Math.abs(dx * fx + dy * fy) / car.build.chassis.bodyHalfLength;
  return side > along;
}

export function stepCarCollisions(race: RaceSession): void {
  const cars = race.cars;
  for (const car of cars) car.touching = false;
  // Pairs in index order, so a three-way pile-up always resolves the same way (Section 15.3).
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i]!;
    if (a.ko || hasStatus(a, 'airborne')) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j]!;
      if (b.ko || hasStatus(b, 'airborne')) continue;
      const am = a.session.motion;
      const bm = b.session.motion;
      if (!findCarContact(am, a.session.params, bm, b.session.params, contact)) continue;
      a.touching = true;
      b.touching = true;
      const grace = race.raceTicks < race.ramGraceTicks ? SPAWN_RAM_GRACE_FACTOR : 1;
      const relative = Math.hypot(am.velocityX - bm.velocityX, am.velocityY - bm.velocityY);
      resolveCarContact(
        am,
        a.session.params,
        bm,
        b.session.params,
        contact,
        grace * b.totals.impulse.ram_dealt * a.totals.impulse.displacement,
        grace * a.totals.impulse.ram_dealt * b.totals.impulse.displacement,
        true,
      );
      const closing = contact.closing;
      if (closing > RAM_FORGIVE_SPEED && race.tick - race.lastRamTick >= RAM_COOLDOWN_TICKS) {
        race.lastRamTick = race.tick;
        // Relative speed, combined mass and what each car brought to it (Section 10.1): the
        // lighter car takes the larger share.
        const base =
          Math.min(RAM_DAMAGE_MAX, (closing - RAM_FORGIVE_SPEED) * RAM_DAMAGE_PER_SPEED) * grace;
        const ma = a.session.params.massKg;
        const mb = b.session.params.massKg;
        const total = ma + mb;
        a.stats.ramsDealt++;
        b.stats.ramsDealt++;
        ramHit(race, a, b, ((base * 2 * mb) / total) * b.totals.impulse.ram_dealt, 'ram', 'ram');
        ramHit(race, b, a, ((base * 2 * ma) / total) * a.totals.impulse.ram_dealt, 'ram', 'ram');
      }
      // Bladed hubs cut whatever rubs the flank they are on.
      for (let k = 0; k < 2; k++) {
        const blade = k === 0 ? a : b;
        const victim = k === 0 ? b : a;
        if (blade.bladeDamage <= 0 || blade.bladeCooldown > 0) continue;
        if (relative < blade.bladeMinSpeed || !onFlank(blade, contact.x, contact.y)) continue;
        blade.bladeCooldown = blade.bladeCooldownTicks;
        ramHit(race, victim, blade, blade.bladeDamage * grace, 'direct', blade.build.tires.id);
      }
    }
  }
}
