import {
  HAZARD_LIFE_WEATHER,
  HAZARD_REVEAL_RANGE,
  MAX_HAZARDS,
  MAX_PROJECTILES,
  PROJECTILE_MAX_LIFE_SECONDS,
  SIM_DT,
  WET_WEATHER,
  WIND,
} from '../balance.js';
import { exposureAt } from '../hazards.js';
import { clamp, wrapAngle } from '../math.js';
import type { HazardKind, ProjectileKind } from '../protocol.js';
import {
  applyHit,
  applyStatus,
  clearStatus,
  createHit,
  emit,
  hasStatus,
  isDisrupted,
  drawEnergy,
} from './car.js';
import type { Vec } from './geometry.js';
import { hullDistance, localToWorld, segmentCar, sweepSolid, withinArc } from './geometry.js';
import type { ModuleSpec } from './specs.js';
import { ticksOf } from './specs.js';
import type { CombatCar, Hazard, Projectile, RaceSession } from './types.js';
import { MODULE_COOLDOWN, MODULE_DISABLED } from './types.js';

/**
 * Things in flight and things on the road (Section 11.8 step 7): bullets, rockets, guided
 * missiles, lobbed shells, the boomerang and the harpoon; mines, oil, foam, fire, frost and
 * decoys. Fast projectiles are swept against cars and the track's solid edges every tick.
 */

const scratchA: Vec = { x: 0, y: 0 };
const scratchB: Vec = { x: 0, y: 0 };
const what = { kind: 0 };
const hit = createHit();
const MAX_LIFE_TICKS = ticksOf(PROJECTILE_MAX_LIFE_SECONDS);

/** Lobbed kinds fly over cars and walls and act where they land. */
function isLobbed(kind: ProjectileKind): boolean {
  return kind === 'foam' || kind === 'shell';
}

function allocProjectile(race: RaceSession): Projectile {
  const list = race.projectiles;
  let oldest: Projectile | null = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    if (!p.active) return p;
    if (!oldest || p.id < oldest.id) oldest = p;
  }
  if (list.length < MAX_PROJECTILES) {
    const p = {} as Projectile;
    list.push(p);
    return p;
  }
  // Full: the oldest gives way cleanly (Section 8.3).
  emit(race, {
    type: 'impact',
    weapon: oldest!.spec.id,
    x: oldest!.x,
    y: oldest!.y,
    projectile: oldest!.id,
    on: 'expired',
  });
  return oldest!;
}

/**
 * Launches a projectile from a car's weapon along a world heading. It inherits the car's own
 * velocity, so a weapon reaches as far ahead of a fast car as of a slow one.
 */
export function spawnProjectile(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  kind: ProjectileKind,
  x: number,
  y: number,
  heading: number,
  n: number,
  of: number,
): Projectile {
  const p = allocProjectile(race);
  const m = car.session.motion;
  const dx = Math.sin(heading);
  const dy = -Math.cos(heading);
  p.id = race.nextEntityId++;
  p.active = true;
  p.kind = kind;
  p.owner = car.index;
  p.spec = spec;
  p.x = x;
  p.y = y;
  p.vx = (dx * spec.speed + m.velocityX) * SIM_DT;
  p.vy = (dy * spec.speed + m.velocityY) * SIM_DT;
  // Wind drift (Section 9.2), carried from the launch so the flight stays a straight line.
  if (projectileDrift(race, x, y)) {
    p.vx += drift.x;
    p.vy += drift.y;
  }
  p.life = Math.min(spec.lifeTicks > 0 ? spec.lifeTicks : MAX_LIFE_TICKS, MAX_LIFE_TICKS);
  p.age = 0;
  p.travel = 0;
  p.target = -1;
  p.decoyed = false;
  p.phase = 0;
  p.hitMask = 0;
  p.landX = 0;
  p.landY = 0;
  p.warned = false;
  syncProjectile(race, p);
  emit(race, {
    type: 'shot',
    car: car.index,
    part: spec.part,
    weapon: spec.id,
    x,
    y,
    dir: heading,
    projectile: p.id,
    n,
    of,
  });
  return p;
}

/** Launches a lobbed projectile that lands on a spot after its flight time. */
export function spawnLobbed(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  kind: ProjectileKind,
  x: number,
  y: number,
  landX: number,
  landY: number,
  radius: number,
): Projectile {
  const p = allocProjectile(race);
  const flight = Math.max(1, spec.flightTicks);
  // The wind carries a shell for its whole flight; the telegraph shows where it will land.
  if (projectileDrift(race, x, y)) {
    landX += drift.x * flight;
    landY += drift.y * flight;
  }
  p.id = race.nextEntityId++;
  p.active = true;
  p.kind = kind;
  p.owner = car.index;
  p.spec = spec;
  p.x = x;
  p.y = y;
  p.vx = (landX - x) / flight;
  p.vy = (landY - y) / flight;
  p.life = flight;
  p.age = 0;
  p.travel = 0;
  p.target = -1;
  p.decoyed = false;
  p.phase = 0;
  p.hitMask = 0;
  p.landX = landX;
  p.landY = landY;
  p.warned = false;
  syncProjectile(race, p);
  // Projectiles move in the tick they are launched in. A lobbed one is promised to land
  // exactly `flight` ticks after its shot event, so it starts one step back.
  p.x -= p.vx;
  p.y -= p.vy;
  p.life = flight + 1;
  emit(race, {
    type: 'shot',
    car: car.index,
    part: spec.part,
    weapon: spec.id,
    x,
    y,
    dir: Math.atan2(landX - x, -(landY - y)),
    projectile: p.id,
    n: 0,
    of: 1,
  });
  emit(race, {
    type: 'telegraph',
    car: car.index,
    part: spec.part,
    weapon: spec.id,
    x: landX,
    y: landY,
    radius,
    ticks: flight,
    projectile: p.id,
  });
  return p;
}

const drift = { x: 0, y: 0 };

/**
 * Wind drift for something launched at (x, y) this tick, world px per tick, into `drift`.
 * False, and nothing written, when the air is still or the launch point is sheltered.
 */
function projectileDrift(race: RaceSession, x: number, y: number): boolean {
  const wx = race.env.windX ?? 0;
  const wy = race.env.windY ?? 0;
  if (wx === 0 && wy === 0) return false;
  const exposure = exposureAt(race.track, x, y, race.raceTicks);
  if (!(exposure > 0)) return false;
  drift.x = wx * exposure * WIND.projectileGain * SIM_DT;
  drift.y = wy * exposure * WIND.projectileGain * SIM_DT;
  return true;
}

/** Records where a projectile is and how it is moving, for the next snapshot. */
function syncProjectile(race: RaceSession, p: Projectile): void {
  p.syncTick = race.tick;
  p.syncX = p.x;
  p.syncY = p.y;
  p.syncVx = p.vx;
  p.syncVy = p.vy;
}

function endProjectile(
  race: RaceSession,
  p: Projectile,
  on: 'wall' | 'obstacle' | 'ground' | 'expired' | 'caught' | 'intercepted' | 'scrambled',
): void {
  p.active = false;
  emit(race, { type: 'impact', weapon: p.spec.id, x: p.x, y: p.y, projectile: p.id, on });
}

// --- Hazards -------------------------------------------------------------------------------------

function weatherLife(race: RaceSession, kind: HazardKind, ticks: number): number {
  if (kind !== 'oil' && kind !== 'fire' && kind !== 'frost' && kind !== 'foam') return ticks;
  return Math.max(1, Math.round(ticks * HAZARD_LIFE_WEATHER[kind][race.env.weather]));
}

export function placeHazard(
  race: RaceSession,
  owner: CombatCar,
  spec: ModuleSpec,
  kind: HazardKind,
  x: number,
  y: number,
  radius: number,
  halfLength: number,
  angle: number,
  lifeTicks: number,
  armTicks: number,
): Hazard {
  const list = race.hazards;
  let slot: Hazard | null = null;
  let oldest: Hazard | null = null;
  let live = 0;
  let oldestOwn: Hazard | null = null;
  for (let i = 0; i < list.length; i++) {
    const h = list[i]!;
    if (!h.active) {
      slot ??= h;
      continue;
    }
    if (!oldest || h.id < oldest.id) oldest = h;
    if (h.owner === owner.index && h.kind === kind) {
      live++;
      if (!oldestOwn || h.id < oldestOwn.id) oldestOwn = h;
    }
  }
  // A capped kind replaces its owner's oldest (Section 8.3: six live mines a racer).
  if (spec.liveCap > 0 && live >= spec.liveCap && oldestOwn) {
    removeHazard(race, oldestOwn, 'expired', -1);
    slot ??= oldestOwn;
  }
  if (!slot) {
    if (list.length < MAX_HAZARDS) {
      slot = {} as Hazard;
      list.push(slot);
    } else {
      removeHazard(race, oldest!, 'expired', -1);
      slot = oldest!;
    }
  }
  slot.id = race.nextEntityId++;
  slot.active = true;
  slot.kind = kind;
  slot.owner = owner.index;
  slot.spec = spec;
  slot.x = x;
  slot.y = y;
  slot.radius = radius;
  slot.halfLength = halfLength;
  slot.angle = angle;
  slot.arm = armTicks;
  slot.life = weatherLife(race, kind, lifeTicks);
  slot.bornTick = race.tick;
  slot.revealMask = 1 << owner.index;
  slot.vx = 0;
  slot.vy = 0;
  emit(race, {
    type: 'hazard',
    hazard: slot.id,
    kind,
    by: owner.index,
    state: 'placed',
    x,
    y,
    car: -1,
  });
  return slot;
}

export function removeHazard(
  race: RaceSession,
  h: Hazard,
  state: 'triggered' | 'expired' | 'cleared' | 'melted',
  car: number,
): void {
  if (!h.active) return;
  h.active = false;
  emit(race, {
    type: 'hazard',
    hazard: h.id,
    kind: h.kind,
    by: h.owner,
    state,
    x: h.x,
    y: h.y,
    car,
  });
}

/** Signed distances of a point from a hazard: inside when both are within its extents. */
function insideHazard(h: Hazard, x: number, y: number, margin: number): boolean {
  const dx = x - h.x;
  const dy = y - h.y;
  if (h.halfLength <= 0) {
    const r = h.radius + margin;
    return dx * dx + dy * dy <= r * r;
  }
  const ax = Math.sin(h.angle);
  const ay = -Math.cos(h.angle);
  const along = dx * ax + dy * ay;
  const across = dx * -ay + dy * ax;
  return Math.abs(along) <= h.halfLength + margin && Math.abs(across) <= h.radius + margin;
}

/** Burn rate of a fire or a flame, damage per second, from the flame weapon's own numbers. */
export function burnRate(spec: ModuleSpec): number {
  return spec.activeTicks > 0 ? spec.damage / (spec.activeTicks * SIM_DT) : 0;
}

/** Sets a car alight: a burn status that pulses, and heat into its core (Section 8.4 thermal). */
export function igniteCar(
  race: RaceSession,
  target: CombatCar,
  spec: ModuleSpec,
  by: number,
  fromX: number,
  fromY: number,
): void {
  if (applyStatus(race, target, 'burn', burnRate(spec), Math.max(1, spec.lingerTicks), by)) {
    // The fire sits on the side it came from.
    const m = target.session.motion;
    const fx = Math.sin(m.headingRad);
    const fy = -Math.cos(m.headingRad);
    const dx = fromX - m.x;
    const dy = fromY - m.y;
    target.burnX = dx * -fy + dy * fx;
    target.burnY = -(dx * fx + dy * fy);
    target.burnWeapon = spec.id;
    target.burnPart = spec.part;
  }
  if (spec.activeTicks > 0)
    target.session.motion.coreHeat +=
      (spec.heatApplied / spec.activeTicks) * (target.totals.damage.heat_status ?? 1);
  // Fire thaws frost.
  if (target.gripSource === 2 && hasStatus(target, 'grip')) clearStatus(race, target, 'grip');
}

/** An explosion at a point: every car inside the radius is hit, by falloff from the centre. */
export function explode(
  race: RaceSession,
  by: number,
  spec: ModuleSpec,
  x: number,
  y: number,
  radius: number,
  damageCenter: number,
  damageEdge: number,
  cls: 'direct' | 'heavy',
  projectile: number,
  skipCar: number,
): void {
  emit(race, { type: 'explosion', by, weapon: spec.id, x, y, radius, projectile });
  if (radius <= 0 || damageCenter <= 0) return;
  for (const car of race.cars) {
    if (car.index === skipCar || car.ko) continue;
    const gap = hullDistance(car.session.motion, car.session.params, x, y, scratchA);
    if (gap >= radius) continue;
    hit.by = by;
    hit.part = spec.part;
    hit.weapon = spec.id;
    hit.cls = cls;
    hit.damage = damageCenter + (damageEdge - damageCenter) * (gap / radius);
    hit.x = scratchA.x;
    hit.y = scratchA.y;
    hit.penetration = 0;
    hit.projectile = projectile;
    hit.bypass = false;
    applyHit(race, car, hit);
  }
}

function activeDecoyOf(race: RaceSession, owner: number): Hazard | null {
  for (const h of race.hazards) if (h.active && h.kind === 'decoy' && h.owner === owner) return h;
  return null;
}

function hazardById(race: RaceSession, id: number): Hazard | null {
  for (const h of race.hazards) if (h.active && h.id === id) return h;
  return null;
}

// --- Projectile step -----------------------------------------------------------------------------

/** What a projectile does to a car it strikes. Returns true when the projectile is spent. */
function strike(race: RaceSession, p: Projectile, car: CombatCar, x: number, y: number): boolean {
  const spec = p.spec;
  hit.by = p.owner;
  hit.part = spec.part;
  hit.weapon = spec.id;
  hit.x = x;
  hit.y = y;
  hit.penetration = spec.penetration;
  hit.projectile = p.id;
  hit.bypass = false;
  switch (p.kind) {
    case 'bullet':
    case 'pellet': {
      // Damage falls off with the distance between the gun and what it hits (Section 11.5):
      // measured car to car at the moment of the hit, so it reads the same at any speed.
      const from = race.cars[p.owner]!.session.motion;
      const span = Math.max(1, spec.range - spec.falloffStart);
      const fade = clamp((Math.hypot(x - from.x, y - from.y) - spec.falloffStart) / span, 0, 1);
      hit.cls = 'bullet';
      hit.damage = spec.damage * (1 + (spec.falloffMin - 1) * fade);
      applyHit(race, car, hit);
      return true;
    }
    case 'rocket':
    case 'missile':
      hit.cls = 'direct';
      hit.damage = spec.damage;
      applyHit(race, car, hit);
      p.x = x;
      p.y = y;
      explode(
        race,
        p.owner,
        spec,
        x,
        y,
        spec.splashRadius,
        spec.splashDamage,
        0,
        'direct',
        p.id,
        car.index,
      );
      return true;
    case 'frost':
      if (applyStatus(race, car, 'grip', spec.statusMagnitude, spec.statusTicks, p.owner))
        car.gripSource = 2;
      // Frost puts a fire out.
      if (hasStatus(car, 'burn')) clearStatus(race, car, 'burn');
      p.x = x;
      p.y = y;
      frostPatch(race, p);
      return true;
    case 'harpoon': {
      const owner = race.cars[p.owner]!;
      owner.tether.active = true;
      owner.tether.target = car.index;
      // The line is first counted down later in this same tick.
      owner.tether.ticks = spec.activeTicks + 1;
      owner.tether.spec = spec;
      emit(race, {
        type: 'tether',
        car: owner.index,
        part: spec.part,
        target: car.index,
        state: 'attached',
      });
      return true;
    }
    case 'boomerang':
      // One target a leg: it cuts through and carries on.
      p.hitMask |= 1 << car.index;
      hit.cls = 'direct';
      hit.damage = spec.damage;
      applyHit(race, car, hit);
      return false;
    default:
      return true;
  }
}

function frostPatch(race: RaceSession, p: Projectile): void {
  const spec = p.spec;
  const wet = WET_WEATHER[race.env.weather] ? spec.wetFactor : 1;
  placeHazard(
    race,
    race.cars[p.owner]!,
    spec,
    'frost',
    p.x,
    p.y,
    spec.hazardRadius * wet,
    0,
    0,
    spec.hazardLifeTicks,
    0,
  );
}

function land(race: RaceSession, p: Projectile): void {
  const spec = p.spec;
  p.x = p.landX;
  p.y = p.landY;
  p.active = false;
  if (p.kind === 'foam') {
    emit(race, { type: 'impact', weapon: spec.id, x: p.x, y: p.y, projectile: p.id, on: 'ground' });
    placeHazard(
      race,
      race.cars[p.owner]!,
      spec,
      'foam',
      p.x,
      p.y,
      spec.hazardRadius,
      0,
      0,
      spec.hazardLifeTicks,
      0,
    );
  } else {
    explode(
      race,
      p.owner,
      spec,
      p.x,
      p.y,
      spec.splashRadius,
      spec.damage,
      spec.damageEdge,
      'heavy',
      p.id,
      -1,
    );
  }
}

/** Steers a velocity toward a point by at most `turn` radians, keeping its speed. */
function steerToward(p: Projectile, tx: number, ty: number, turn: number): void {
  const speed = Math.hypot(p.vx, p.vy);
  if (speed < 1e-9) return;
  const current = Math.atan2(p.vx, -p.vy);
  const wanted = Math.atan2(tx - p.x, -(ty - p.y));
  const next = current + clamp(wrapAngle(wanted - current), -turn, turn);
  p.vx = Math.sin(next) * speed;
  p.vy = -Math.cos(next) * speed;
}

export function stepProjectiles(race: RaceSession): void {
  const track = race.track;
  const loc = race.scratchLoc;
  for (const car of race.cars) car.missileInbound = false;

  for (let i = 0; i < race.projectiles.length; i++) {
    const p = race.projectiles[i]!;
    if (!p.active) continue;
    p.age++;
    const spec = p.spec;

    if (isLobbed(p.kind)) {
      p.x += p.vx;
      p.y += p.vy;
      if (--p.life <= 0) land(race, p);
      continue;
    }

    // --- Guidance ------------------------------------------------------------------------
    if (p.kind === 'missile' && p.target >= 0) {
      let tx = 0;
      let ty = 0;
      let live = true;
      if (p.decoyed) {
        const decoy = hazardById(race, p.target);
        if (decoy) {
          tx = decoy.x;
          ty = decoy.y;
        } else live = false;
      } else {
        const target = race.cars[p.target]!;
        const decoy = activeDecoyOf(race, p.target);
        if (decoy && Math.hypot(decoy.x - p.x, decoy.y - p.y) <= decoy.spec.range) {
          // The drone is the brighter target (aim interference, Section 8.4).
          p.target = decoy.id;
          p.decoyed = true;
          tx = decoy.x;
          ty = decoy.y;
        } else if (target.ko) live = false;
        else {
          tx = target.session.motion.x;
          ty = target.session.motion.y;
          // The warning a target gets shortly before impact (Section 8.4), sooner with Radar.
          const speed = Math.hypot(p.vx, p.vy);
          const eta = speed > 1e-6 ? Math.hypot(tx - p.x, ty - p.y) / speed : 0;
          if (eta <= spec.warnTicks + target.missileWarnTicks) {
            target.missileInbound = true;
            if (!p.warned) {
              p.warned = true;
              emit(race, {
                type: 'warning',
                car: target.index,
                kind: 'missile',
                by: p.owner,
                value: Math.round(eta),
              });
            }
          }
        }
      }
      if (live) {
        steerToward(p, tx, ty, spec.turnRate);
        syncProjectile(race, p);
      } else {
        p.target = -1;
        p.decoyed = false;
      }
    } else if (p.kind === 'boomerang') {
      const owner = race.cars[p.owner]!.session.motion;
      if (p.phase === 0 && p.travel >= spec.range) {
        p.phase = 1;
        p.hitMask = 0;
      }
      // It slows toward the far end of its flight, hangs, and gathers speed on the way home.
      const ownerSpeed = Math.hypot(owner.velocityX, owner.velocityY);
      let want: number;
      if (p.phase === 0) {
        want = (spec.speed * (1 - 0.7 * Math.min(1, p.travel / spec.range)) + ownerSpeed) * SIM_DT;
      } else {
        steerToward(p, owner.x, owner.y, spec.turnRate);
        const homeward = Math.min(1, (p.travel - spec.range) / (spec.range * 0.4));
        want = (spec.speed * (0.3 + 0.7 * Math.max(0, homeward)) + ownerSpeed) * SIM_DT;
      }
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > 1e-9) {
        p.vx *= want / speed;
        p.vy *= want / speed;
      }
      if (
        p.phase === 1 &&
        Math.hypot(owner.x - p.x, owner.y - p.y) <= spec.catchRadius + Math.hypot(p.vx, p.vy)
      ) {
        // Caught: the thrower is ready to throw again sooner.
        const car = race.cars[p.owner]!;
        const module = car.modules[spec.part]!;
        module.cooldown = Math.max(0, module.cooldown - spec.refundTicks);
        p.x = owner.x;
        p.y = owner.y;
        endProjectile(race, p, 'caught');
        continue;
      }
      syncProjectile(race, p);
    }

    // --- Movement, swept (Section 7.3) ---------------------------------------------------------
    const x0 = p.x;
    const y0 = p.y;
    const x1 = x0 + p.vx;
    const y1 = y0 + p.vy;
    let best = 2;
    let struck: CombatCar | null = null;
    for (const car of race.cars) {
      if (car.index === p.owner || car.ko) continue;
      if ((p.hitMask >> car.index) & 1) continue;
      const m = car.session.motion;
      // Relative to the car's own movement this tick, so two fast things cannot pass through
      // each other between steps.
      const t = segmentCar(
        x0 - car.prevX + m.x,
        y0 - car.prevY + m.y,
        x1,
        y1,
        m.x,
        m.y,
        m.headingRad,
        car.session.params,
        spec.radius,
      );
      if (t < best) {
        best = t;
        struck = car;
      }
    }
    // A decoy is struck like a car.
    let decoyHit: Hazard | null = null;
    if (p.kind === 'missile' && p.decoyed) {
      const decoy = hazardById(race, p.target);
      if (decoy) {
        const reach = decoy.radius + spec.radius + Math.hypot(p.vx, p.vy);
        if (Math.hypot(decoy.x - x0, decoy.y - y0) <= reach) decoyHit = decoy;
      }
    }
    const wallT = sweepSolid(track, x0, y0, x1, y1, 0, loc, what);
    const wallKind = what.kind;

    if (decoyHit) {
      p.x = decoyHit.x;
      p.y = decoyHit.y;
      p.active = false;
      explode(
        race,
        p.owner,
        spec,
        p.x,
        p.y,
        spec.splashRadius,
        spec.splashDamage,
        0,
        'direct',
        p.id,
        -1,
      );
      removeHazard(race, decoyHit, 'triggered', -1);
      continue;
    }
    if (struck && best <= 1 && best <= wallT) {
      const hx = x0 + p.vx * best;
      const hy = y0 + p.vy * best;
      p.travel += Math.hypot(p.vx, p.vy) * best;
      if (strike(race, p, struck, hx, hy)) {
        p.active = false;
        continue;
      }
    } else if (wallT <= 1) {
      p.x = x0 + p.vx * wallT;
      p.y = y0 + p.vy * wallT;
      if (p.kind === 'boomerang' && p.phase === 0) {
        // It glances off and starts for home from where it struck.
        p.phase = 1;
        p.hitMask = 0;
        p.vx = -p.vx;
        p.vy = -p.vy;
        p.x = x0;
        p.y = y0;
        syncProjectile(race, p);
        continue;
      }
      if (p.kind === 'rocket' || p.kind === 'missile') {
        p.active = false;
        explode(
          race,
          p.owner,
          spec,
          p.x,
          p.y,
          spec.splashRadius,
          spec.splashDamage,
          0,
          'direct',
          p.id,
          -1,
        );
      } else {
        if (p.kind === 'frost') frostPatch(race, p);
        endProjectile(race, p, wallKind === 2 ? 'obstacle' : 'wall');
      }
      continue;
    }
    p.x = x1;
    p.y = y1;
    p.travel += Math.hypot(p.vx, p.vy);
    if (--p.life <= 0) {
      if (p.kind === 'rocket' || p.kind === 'missile') {
        p.active = false;
        explode(
          race,
          p.owner,
          spec,
          p.x,
          p.y,
          spec.splashRadius,
          spec.splashDamage,
          0,
          'direct',
          p.id,
          -1,
        );
      } else {
        if (p.kind === 'frost') frostPatch(race, p);
        endProjectile(race, p, 'expired');
      }
    }
  }
}

/** Missile Interceptor: shoots down one guided missile homing on its car, when ready and powered. */
export function stepInterceptors(race: RaceSession): void {
  for (const car of race.cars) {
    if (car.ko || isDisrupted(car)) continue;
    for (const spec of car.specs) {
      if (spec.kind !== 'intercept') continue;
      const module = car.modules[spec.part]!;
      if (module.state === MODULE_DISABLED || module.cooldown > 0) continue;
      const m = car.session.motion;
      for (const p of race.projectiles) {
        if (!p.active || p.kind !== 'missile' || p.decoyed || p.target !== car.index) continue;
        if (Math.hypot(p.x - m.x, p.y - m.y) > spec.range) continue;
        if (!drawEnergy(car, spec.energy)) break;
        localToWorld(m, spec.lx, spec.ly, scratchB);
        module.cooldown = spec.cooldownTicks;
        module.cooldownTotal = spec.cooldownTicks;
        module.state = MODULE_COOLDOWN;
        car.stats.usesByPart[spec.part]!++;
        emit(race, {
          type: 'beam',
          car: car.index,
          part: spec.part,
          weapon: spec.id,
          x: scratchB.x,
          y: scratchB.y,
          toX: p.x,
          toY: p.y,
          hit: -1,
        });
        endProjectile(race, p, 'intercepted');
        break;
      }
    }
  }
}

// --- Hazard step ---------------------------------------------------------------------------------

function detonateMine(race: RaceSession, h: Hazard, car: CombatCar): void {
  const spec = h.spec;
  removeHazard(race, h, 'triggered', car.index);
  hullDistance(car.session.motion, car.session.params, h.x, h.y, scratchA);
  hit.by = h.owner;
  hit.part = spec.part;
  hit.weapon = spec.id;
  hit.cls = 'direct';
  hit.damage = spec.damage;
  hit.x = scratchA.x;
  hit.y = scratchA.y;
  hit.penetration = 0;
  hit.projectile = h.id;
  hit.bypass = false;
  applyHit(race, car, hit);
  applyStatus(race, car, 'slow', spec.statusMagnitude, spec.statusTicks, h.owner);
  // Anything else inside the blast takes half at the centre, fading to nothing.
  explode(
    race,
    h.owner,
    spec,
    h.x,
    h.y,
    spec.splashRadius,
    spec.damage * 0.5,
    0,
    'direct',
    h.id,
    car.index,
  );
}

export function stepHazards(race: RaceSession): void {
  for (let i = 0; i < race.hazards.length; i++) {
    const h = race.hazards[i]!;
    if (!h.active) continue;
    if (h.arm > 0 && --h.arm === 0)
      emit(race, {
        type: 'hazard',
        hazard: h.id,
        kind: h.kind,
        by: h.owner,
        state: 'armed',
        x: h.x,
        y: h.y,
        car: -1,
      });
    if (--h.life <= 0) {
      removeHazard(race, h, 'expired', -1);
      continue;
    }
    if (h.kind === 'decoy') {
      h.x += h.vx;
      h.y += h.vy;
      h.vx *= 0.97;
      h.vy *= 0.97;
      continue;
    }
    for (const car of race.cars) {
      if (car.ko) continue;
      const m = car.session.motion;
      const bit = 1 << car.index;
      if (!(h.revealMask & bit)) {
        const reach = car.revealRange + h.radius + h.halfLength;
        if (Math.hypot(h.x - m.x, h.y - m.y) <= reach) {
          h.revealMask |= bit;
          // A detector calls a trap out; without one it is simply close enough to see.
          if (car.revealRange > HAZARD_REVEAL_RANGE && h.owner !== car.index)
            emit(race, {
              type: 'warning',
              car: car.index,
              kind: 'trap',
              by: h.owner,
              value: h.id,
            });
        }
      }
      if (h.arm > 0 || hasStatus(car, 'airborne')) continue;
      switch (h.kind) {
        case 'mine':
          if (hullDistance(m, car.session.params, h.x, h.y, null) <= h.radius) {
            detonateMine(race, h, car);
          }
          break;
        case 'oil':
          if (insideHazard(h, m.x, m.y, 6)) {
            const magnitude = h.spec.statusMagnitude * (car.totals.damage.oil ?? 1);
            if (applyStatus(race, car, 'grip', magnitude, h.spec.statusTicks, h.owner))
              car.gripSource = 1;
          }
          break;
        case 'foam':
          if (insideHazard(h, m.x, m.y, 6))
            applyStatus(race, car, 'slow', h.spec.statusMagnitude, h.spec.statusTicks, h.owner);
          break;
        case 'frost':
          if (insideHazard(h, m.x, m.y, 6)) {
            if (applyStatus(race, car, 'grip', h.spec.statusMagnitude, h.spec.statusTicks, h.owner))
              car.gripSource = 2;
          }
          break;
        case 'fire':
          if (insideHazard(h, m.x, m.y, 6)) igniteCar(race, car, h.spec, h.owner, h.x, h.y);
          break;
      }
      if (!h.active) break;
    }
  }
}

/** Mine Sweeper: clears one trap just ahead of its car, when ready. */
export function stepSweepers(race: RaceSession): void {
  for (const car of race.cars) {
    if (car.ko || isDisrupted(car)) continue;
    for (const spec of car.specs) {
      if (spec.kind !== 'sweep') continue;
      const module = car.modules[spec.part]!;
      if (module.state === MODULE_DISABLED || module.cooldown > 0) continue;
      const m = car.session.motion;
      const facing = m.headingRad + (spec.turn * Math.PI) / 2;
      let nearest: Hazard | null = null;
      let nearestD = Infinity;
      for (const h of race.hazards) {
        if (!h.active || h.kind === 'decoy' || h.owner === car.index) continue;
        const d = Math.hypot(h.x - m.x, h.y - m.y) - h.radius - h.halfLength;
        if (d > spec.range || d >= nearestD) continue;
        if (!withinArc(facing, Math.atan2(h.x - m.x, -(h.y - m.y)), spec.half)) continue;
        nearest = h;
        nearestD = d;
      }
      if (!nearest) continue;
      module.cooldown = spec.cooldownTicks;
      module.cooldownTotal = spec.cooldownTicks;
      module.state = MODULE_COOLDOWN;
      car.stats.usesByPart[spec.part]!++;
      localToWorld(m, spec.lx, spec.ly, scratchB);
      emit(race, {
        type: 'beam',
        car: car.index,
        part: spec.part,
        weapon: spec.id,
        x: scratchB.x,
        y: scratchB.y,
        toX: nearest.x,
        toY: nearest.y,
        hit: -1,
      });
      removeHazard(race, nearest, 'cleared', car.index);
    }
  }
}

/** A flame over the road: lights oil it touches and melts frost. */
export function flameOverHazards(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  x: number,
  y: number,
  facing: number,
): void {
  for (const h of race.hazards) {
    if (!h.active || (h.kind !== 'oil' && h.kind !== 'frost')) continue;
    const d = Math.hypot(h.x - x, h.y - y) - h.radius - h.halfLength;
    if (d > spec.range) continue;
    if (d > 0 && !withinArc(facing, Math.atan2(h.x - x, -(h.y - y)), spec.half)) continue;
    if (h.kind === 'frost') removeHazard(race, h, 'melted', car.index);
    else if (spec.flagA) {
      // Burning oil: the strip stays where it is and becomes a fire for the time it had left.
      h.kind = 'fire';
      h.owner = car.index;
      h.spec = spec;
      h.life = weatherLife(race, 'fire', h.life);
      h.revealMask = (1 << race.cars.length) - 1;
      emit(race, {
        type: 'hazard',
        hazard: h.id,
        kind: 'fire',
        by: car.index,
        state: 'ignited',
        x: h.x,
        y: h.y,
        car: car.index,
      });
    }
  }
}

/** An EMP over things in flight: guided missiles lose their guidance. */
export function scrambleMissiles(
  race: RaceSession,
  x: number,
  y: number,
  radius: number,
  by: number,
): void {
  for (const p of race.projectiles) {
    if (!p.active || p.kind !== 'missile' || p.owner === by || p.target < 0) continue;
    if (Math.hypot(p.x - x, p.y - y) > radius) continue;
    p.target = -1;
    p.decoyed = false;
    emit(race, {
      type: 'impact',
      weapon: p.spec.id,
      x: p.x,
      y: p.y,
      projectile: p.id,
      on: 'scrambled',
    });
  }
}

/** An air blast over things in flight: anything that is not a bullet is thrown off its line. */
export function blowProjectiles(
  race: RaceSession,
  car: CombatCar,
  spec: ModuleSpec,
  x: number,
  y: number,
  facing: number,
): void {
  for (const p of race.projectiles) {
    if (!p.active || p.owner === car.index) continue;
    if (p.kind === 'bullet' || p.kind === 'pellet' || isLobbed(p.kind)) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.hypot(dx, dy);
    if (d > spec.range || d < 1e-6) continue;
    if (!withinArc(facing, Math.atan2(dx, -dy), spec.half)) continue;
    p.vx += (dx / d) * spec.projectileImpulse * SIM_DT;
    p.vy += (dy / d) * spec.projectileImpulse * SIM_DT;
    // A guided missile blown aside has lost its lock.
    if (p.kind === 'missile') {
      p.target = -1;
      p.decoyed = false;
    }
    syncProjectile(race, p);
  }
}

/** Launches a decoy drone behind a car. Missiles homing on the car go for it while it lives. */
export function launchDecoy(race: RaceSession, car: CombatCar, spec: ModuleSpec): void {
  const m = car.session.motion;
  const fx = Math.sin(m.headingRad);
  const fy = -Math.cos(m.headingRad);
  const h = placeHazard(
    race,
    car,
    spec,
    'decoy',
    m.x - fx * spec.dropDistance,
    m.y - fy * spec.dropDistance,
    8,
    0,
    0,
    spec.hazardLifeTicks,
    0,
  );
  // It is flown, not dropped: it leaves at most of the car's speed and falls behind.
  h.vx = m.velocityX * 0.6 * SIM_DT;
  h.vy = m.velocityY * 0.6 * SIM_DT;
  h.revealMask = (1 << race.cars.length) - 1;
}

export function clearEntities(race: RaceSession): void {
  for (const p of race.projectiles) p.active = false;
  for (const h of race.hazards) h.active = false;
}
