import {
  FINISH_WINDOW_SECONDS,
  GAP_SPEED_FLOOR,
  KO_SECONDS,
  RACE_LIMIT_SECONDS,
  SIM_DT,
  SPAWN_RAM_GRACE_SECONDS,
  WALL_FORGIVE_SPEED,
  WORLD_PIXELS_PER_METER,
} from './balance.js';
import type { ResolvedBuild } from './blueprint.js';
import { computeEffects, createCombatCar, emit } from './combat/car.js';
import {
  clearEntities,
  stepHazards,
  stepInterceptors,
  stepProjectiles,
  stepSweepers,
} from './combat/entities.js';
import { ticksOf } from './combat/specs.js';
import { stepCarCollisions, stepSystems, stepUtilityInput, stepWinch } from './combat/systems.js';
import type { CombatCar, RaceOptions, RaceSession } from './combat/types.js';
import {
  COMPONENT_ENGINE,
  COMPONENT_FIRST_WHEEL,
  COMPONENT_STEERING,
  MODULE_DISABLED,
  STATUS_COUNT,
} from './combat/types.js';
import { stepWeapons } from './combat/weapons.js';
import { mulberry32 } from './math.js';
import type { ControlInput } from './physics.js';
import type {
  CarCombatSnapshot,
  CarSnapshot,
  HazardSnapshot,
  ProjectileSnapshot,
  RaceEvent,
  RaceResult,
  RaceSnapshot,
  RivalSnapshot,
  StatusSnapshot,
} from './protocol.js';
import { STATUS_FAMILIES } from './protocol.js';
import { NEUTRAL_BRAKE, createDriveSession, sessionSnapshot, stepDriveSession } from './sim.js';
import type { TrackRuntime } from './track.js';
import { stepTow, towShareOf } from './tow.js';
import { createLocation } from './track.js';
import type { RaceEnvironment, VehicleParams } from './types.js';

/**
 * A race: N cars on one track (two at launch), combat included. One pure, deterministic step
 * function advances all of it by one fixed tick in the order Section 11.8 prescribes. The
 * authoritative server room owns one of these; the offline link, the scenario runner, the
 * balance harness and the tests run the same code with the same seed and get the same bits.
 */

export type RaceEntry = {
  build: ResolvedBuild;
  /** Coefficients for the published conditions, with every part working. */
  params: VehicleParams;
  buildHash: string;
};

const KO_TICKS = ticksOf(KO_SECONDS);
const FINISH_WINDOW_TICKS = ticksOf(FINISH_WINDOW_SECONDS);
const RAM_GRACE_TICKS = ticksOf(SPAWN_RAM_GRACE_SECONDS);
const WALL_EVENT_COOLDOWN_TICKS = ticksOf(0.25);
/** A new leader must be this far ahead, in world pixels, before the lead is announced. */
const POSITION_HYSTERESIS = 6;
const BRAKE = NEUTRAL_BRAKE;

function buildCars(race: RaceSession, entries: readonly RaceEntry[]): CombatCar[] {
  return entries.map((entry, index) =>
    createCombatCar(
      index,
      createDriveSession(race.track, race.env, entry.params, index),
      entry.build,
      entry.buildHash,
      race.options.conditions,
    ),
  );
}

export function createRace(
  track: TrackRuntime,
  env: RaceEnvironment,
  entries: readonly RaceEntry[],
  options: RaceOptions,
): RaceSession {
  if (entries.length < 1 || entries.length > 8) throw new Error('a race takes one to eight cars');
  const race: RaceSession = {
    track,
    env,
    options,
    cars: [],
    projectiles: [],
    hazards: [],
    events: [],
    nextEventId: 1,
    nextEntityId: 1,
    tick: 0,
    phase: 'COUNTDOWN',
    raceTicks: 0,
    finishWindowEnd: -1,
    leader: 0,
    result: null,
    rng: mulberry32(options.seed),
    lastRamTick: -1000,
    ramGraceTicks: RAM_GRACE_TICKS,
    scratchLoc: createLocation(),
    controls: entries.map(() => ({ steer: 0, brake: 0, coast: true })),
  };
  race.cars = buildCars(race, entries);
  return race;
}

/**
 * Puts every car back on the grid with everything repaired and reloaded, as a new race with
 * the same seed. The tick and event counters keep running, so ids are never reused.
 */
export function resetRace(race: RaceSession): void {
  const entries: RaceEntry[] = race.cars.map((car) => ({
    build: car.build,
    params: car.baseParams,
    buildHash: car.buildHash,
  }));
  const fresh = createRace(race.track, race.env, entries, race.options);
  const { tick, nextEventId, nextEntityId } = race;
  Object.assign(race, fresh);
  race.tick = tick;
  race.nextEventId = nextEventId;
  race.nextEntityId = nextEntityId;
  for (const car of race.cars) car.session.tick = tick;
}

export function raceTimeOf(race: RaceSession): number {
  return Math.round(race.raceTicks * SIM_DT * 1000);
}

/** Cars in race order: finishers by time, then everyone else by course progress. */
function ahead(a: CombatCar, b: CombatCar): boolean {
  const fa = a.session.progress.finishedAtMs;
  const fb = b.session.progress.finishedAtMs;
  if (fa !== null || fb !== null) {
    if (fa === null) return false;
    if (fb === null) return true;
    if (fa !== fb) return fa < fb;
  }
  const pa = a.session.progress.courseProgress;
  const pb = b.session.progress.courseProgress;
  if (pa !== pb) return pa > pb;
  return a.index < b.index;
}

export function leaderOf(race: RaceSession): number {
  let best = race.cars[0]!;
  for (const car of race.cars) if (ahead(car, best)) best = car;
  return best.index;
}

export type Standing = {
  /** 1 for the leader. */
  position: number;
  /** Distance along the course to the nearest other car, positive when this car is ahead of it. */
  gapMeters: number;
  gapSeconds: number;
};

export function standingOf(race: RaceSession, index: number, out: Standing): Standing {
  const me = race.cars[index]!;
  let position = 1;
  let gap = 0;
  let nearest = Infinity;
  let other: CombatCar | null = null;
  for (const car of race.cars) {
    if (car.index === index) continue;
    if (ahead(car, me)) position++;
    const d = me.session.progress.courseProgress - car.session.progress.courseProgress;
    if (Math.abs(d) < nearest) {
      nearest = Math.abs(d);
      gap = d;
      other = car;
    }
  }
  out.position = position;
  out.gapMeters = gap / WORLD_PIXELS_PER_METER;
  // Time to cover the gap at the speed of whichever car is behind.
  const chaser = gap >= 0 ? other : me;
  const speed = Math.max(GAP_SPEED_FLOOR, chaser ? chaser.session.telemetry.speed : 0);
  out.gapSeconds = gap / speed;
  return out;
}

function coreSystemsDown(car: CombatCar): number {
  let down = 0;
  if (car.components[COMPONENT_ENGINE]!.integrity <= 0) down++;
  if (car.components[COMPONENT_STEERING]!.integrity <= 0) down++;
  const wheels = car.build.chassis.wheelAnchors.length;
  let dead = 0;
  for (let i = 0; i < wheels; i++)
    if (car.components[COMPONENT_FIRST_WHEEL + i]!.integrity <= 0) dead++;
  // Locomotion is gone when half the wheels are.
  if (dead * 2 >= wheels) down++;
  return down;
}

/** What decides a race between two cars that are both still in it (Section 3.4). */
export type ResultStanding = {
  finishedAtMs: number | null;
  courseProgress: number;
  lastCheckpointMs: number;
  /** Chassis integrity as a share of its maximum. */
  chassisRatio: number;
};

/**
 * Section 3.4, in order: the earlier finish; failing that the greater course progress, then
 * the earlier last checkpoint, then the sounder chassis. Negative when `a` ranks ahead of `b`,
 * positive when behind, and zero for an exact tie, which is an explicit draw.
 */
export function compareStandings(a: ResultStanding, b: ResultStanding): number {
  if (a.finishedAtMs !== b.finishedAtMs) {
    if (a.finishedAtMs === null) return 1;
    if (b.finishedAtMs === null) return -1;
    return a.finishedAtMs - b.finishedAtMs;
  }
  if (a.courseProgress !== b.courseProgress) return b.courseProgress - a.courseProgress;
  if (a.lastCheckpointMs !== b.lastCheckpointMs) return a.lastCheckpointMs - b.lastCheckpointMs;
  if (a.chassisRatio !== b.chassisRatio) return b.chassisRatio - a.chassisRatio;
  return 0;
}

function standingForResult(car: CombatCar): ResultStanding {
  const p = car.session.progress;
  return {
    finishedAtMs: p.finishedAtMs,
    courseProgress: p.courseProgress,
    lastCheckpointMs: p.lastCheckpointMs,
    chassisRatio: car.chassis / car.chassisMax,
  };
}

function buildResult(race: RaceSession, reason: RaceResult['reason'], forced: number): RaceResult {
  let winner = forced;
  if (winner === -2) {
    const order = race.cars
      .filter((car) => !car.ko)
      .map((car) => ({ index: car.index, standing: standingForResult(car) }));
    order.sort((a, b) => compareStandings(a.standing, b.standing) || a.index - b.index);
    const first = order[0];
    const second = order[1];
    if (!first) winner = -1;
    else if (!second) winner = first.index;
    else winner = compareStandings(first.standing, second.standing) === 0 ? -1 : first.index;
  }
  return {
    winner,
    reason,
    raceTimeMs: raceTimeOf(race),
    cars: race.cars.map((car) => ({
      finished: car.session.progress.finishedAtMs !== null,
      finishTimeMs: car.session.progress.finishedAtMs,
      courseProgress: car.session.progress.courseProgress,
      lastCheckpointMs: car.session.progress.lastCheckpointMs,
      bestLapMs: car.session.bestLapMs,
      chassis: car.chassis,
      ko: car.ko,
      damageDealt: car.stats.damageDealt,
      damageTaken: car.stats.damageTaken,
      shotsFired: car.stats.shotsFired,
      hitsLanded: car.stats.hitsLanded,
    })),
  };
}

function endRace(race: RaceSession, reason: RaceResult['reason'], winner: number): void {
  race.phase = 'FINISHED';
  for (const car of race.cars) {
    if (car.session.phase !== 'FINISHED') {
      car.session.phase = 'FINISHED';
      emit(race, {
        type: 'finish',
        car: car.index,
        raceTimeMs: raceTimeOf(race),
        finished: false,
      });
    }
    car.tether.active = false;
  }
  clearEntities(race);
  race.result = buildResult(race, reason, winner);
  emit(race, { type: 'result', winner: race.result.winner, reason });
}

/**
 * Advances the race by exactly one fixed step. `inputs` holds one control sample per car, in
 * car order; a missing entry is a neutral coast. The order inside is Section 11.8's:
 * activation requests, power and heat and coefficients and integration (inside the car step),
 * car collisions, projectiles and hazards, hit resolution and statuses, then progress, finishes,
 * KO and the clock. Events of the step are left in `race.events`.
 */
export function stepRace(race: RaceSession, inputs: ReadonlyArray<ControlInput | undefined>): void {
  race.tick += 1;
  race.events.length = 0;
  const cars = race.cars;

  if (race.phase !== 'RACING') {
    for (const car of cars) {
      const input = inputs[car.index] ?? BRAKE;
      stepDriveSession(car.session, input);
      car.prevFire = 0;
      car.prevUse = 0;
    }
    if (race.phase === 'COUNTDOWN' && cars.every((car) => car.session.phase === 'RACING')) {
      race.phase = 'RACING';
      for (const car of cars) computeEffects(car);
    }
    return;
  }

  race.raceTicks += 1;

  // --- 0. The tow: gaps are measured before anything moves ---------------------------------------
  stepTow(race);

  // --- 1. Input and activation requests ---------------------------------------------------------
  for (const car of cars) {
    const input = inputs[car.index];
    const live = !car.ko && car.session.phase === 'RACING';
    car.fire = live && input ? (input.fire ?? 0) & 3 : 0;
    car.use = live && input ? (input.use ?? 0) & 255 : 0;
    car.repairTarget = live && input ? (input.target ?? 0) : 0;
  }
  stepUtilityInput(race);
  stepWeapons(race);

  // --- 2 to 5. Power, heat, coefficients and integration, one car at a time ---------------------
  for (const car of cars) {
    const session = car.session;
    const m = session.motion;
    car.prevX = m.x;
    car.prevY = m.y;
    computeEffects(car);
    session.effects.tow = car.tow.tow;
    session.effects.towTarget = car.tow.towTarget;
    session.effects.towNext = car.tow.towNext;
    const wasRacing = session.phase === 'RACING';
    const result = stepDriveSession(session, car.ko ? BRAKE : (inputs[car.index] ?? BRAKE));
    stepWinch(car);
    if (!wasRacing) continue;

    if (result.event === 'checkpoint') {
      const count = race.track.checkpoints.length;
      emit(race, {
        type: 'checkpoint',
        car: car.index,
        index: (session.progress.checkpointIndex + count - 1) % count,
      });
    } else {
      if (result.lapTimeMs > 0)
        emit(race, {
          type: 'lap',
          car: car.index,
          lap:
            session.progress.finishedAtMs !== null ? race.track.def.laps : session.progress.lap - 1,
          lapTimeMs: result.lapTimeMs,
        });
      if (result.event === 'finish')
        emit(race, {
          type: 'finish',
          car: car.index,
          raceTimeMs: raceTimeOf(race),
          finished: session.progress.finishedAtMs !== null,
        });
    }
    const impact = session.telemetry.wallImpactSpeed;
    if (
      impact > WALL_FORGIVE_SPEED &&
      race.tick - car.lastWallEventTick >= WALL_EVENT_COOLDOWN_TICKS
    ) {
      car.lastWallEventTick = race.tick;
      emit(race, { type: 'wall', car: car.index, speed: impact });
    }
  }

  // --- 6. Car against car ------------------------------------------------------------------------
  stepCarCollisions(race);

  // --- 7. Projectiles and hazards, swept --------------------------------------------------------
  stepInterceptors(race);
  stepProjectiles(race);
  stepSweepers(race);
  stepHazards(race);

  // --- 8. Statuses, repairs, shields, tethers ---------------------------------------------------
  stepSystems(race);

  // --- 9. Progress, finishes, KO and the clock ---------------------------------------------------
  let finished = 0;
  let running = 0;
  for (const car of cars) {
    if (!car.ko) {
      // KO is rare (Section 3.4): zero chassis and two core systems down for three seconds.
      if (car.chassis <= 0 && coreSystemsDown(car) >= 2) car.koTicks++;
      else car.koTicks = 0;
      if (car.koTicks >= KO_TICKS) {
        car.ko = true;
        car.koBy = car.lastHitBy;
        car.session.phase = 'FINISHED';
        emit(race, { type: 'ko', car: car.index, by: car.koBy });
      }
    }
    if (car.session.progress.finishedAtMs !== null) finished++;
    else if (!car.ko && car.session.phase === 'RACING') running++;
  }

  const leader = leaderOf(race);
  if (leader !== race.leader) {
    const lead = cars[leader]!.session.progress.courseProgress;
    let gap = Infinity;
    for (const car of cars)
      if (car.index !== leader) gap = Math.min(gap, lead - car.session.progress.courseProgress);
    // On the grid nobody leads, and a nose ahead for one tick is not a change of position.
    if (
      lead > 0 &&
      (gap >= POSITION_HYSTERESIS || cars[leader]!.session.progress.finishedAtMs !== null)
    ) {
      race.leader = leader;
      emit(race, {
        type: 'position',
        leader,
        gapMeters: Number.isFinite(gap) ? gap / WORLD_PIXELS_PER_METER : 0,
      });
    }
  }

  if (finished > 0 && race.finishWindowEnd < 0)
    race.finishWindowEnd = race.raceTicks + FINISH_WINDOW_TICKS;

  const knocked = cars.filter((car) => car.ko);
  if (knocked.length > 0 && cars.length - knocked.length <= 1 && finished === 0) {
    // A knockout decides a duel on the spot: the car still running has won.
    const survivor = cars.find((car) => !car.ko);
    endRace(race, 'ko', survivor ? survivor.index : -1);
  } else if (running === 0 && finished > 0) endRace(race, 'finish', -2);
  else if (race.finishWindowEnd >= 0 && race.raceTicks >= race.finishWindowEnd)
    endRace(race, 'finish', -2);
  else if (race.raceTicks * SIM_DT >= RACE_LIMIT_SECONDS || (running === 0 && finished === 0))
    endRace(race, finished > 0 ? 'finish' : 'timeout', -2);
}

/**
 * Whether an event is for a driver's eyes. Everything visible on the track is; what only the
 * other driver should know is not: its refused commands, its warnings, and its checkpoint
 * crossings, which are noise to anyone else. The server room and the offline link both filter
 * with this, so a client sees the same stream from either.
 */
export function eventVisibleTo(event: RaceEvent, viewer: number): boolean {
  if (event.type === 'refused' || event.type === 'warning' || event.type === 'checkpoint')
    return event.car === viewer;
  return true;
}

// --- Snapshots -----------------------------------------------------------------------------------

function statusList(car: CombatCar, tick: number): StatusSnapshot[] {
  const out: StatusSnapshot[] = [];
  for (let i = 0; i < STATUS_COUNT; i++) {
    const left = car.statusTicks[i]!;
    if (left > 0)
      out.push({
        family: STATUS_FAMILIES[i]!,
        magnitude: car.statusMagnitude[i]!,
        untilTick: tick + left,
      });
  }
  return out;
}

export function combatSnapshot(car: CombatCar, tick: number): CarCombatSnapshot {
  return {
    chassis: car.chassis,
    chassisMax: car.chassisMax,
    armor: [...car.armor],
    components: car.components.map((c) => c.integrity),
    statuses: statusList(car, tick),
    modules: car.modules.map((m) => ({
      state: m.state,
      charges: m.charges,
      readyTick: tick + m.cooldown,
      cooldownTicks: m.cooldownTotal,
      aim: m.aim,
      locked: m.locked,
      pool: m.pool,
    })),
    reserve: car.reserve,
    lockWarning: car.lockWarning,
    ko: car.ko,
  };
}

/** One car as its own driver sees it: the prediction fields plus combat state. */
export function carSnapshot(race: RaceSession, index: number, ackSequence: number): CarSnapshot {
  const car = race.cars[index]!;
  const snapshot = sessionSnapshot(car.session, ackSequence, car.buildHash);
  snapshot.combat = combatSnapshot(car, race.tick);
  snapshot.tow = towShareOf(car);
  return snapshot;
}

/** The other car as it may be seen from outside (Section 7.5): no heat, energy or ammunition. */
export function rivalSnapshot(race: RaceSession, index: number): RivalSnapshot {
  const car = race.cars[index]!;
  const m = car.session.motion;
  const p = car.session.progress;
  return {
    x: m.x,
    y: m.y,
    headingRad: m.headingRad,
    velocityX: m.velocityX,
    velocityY: m.velocityY,
    steeringInput: m.steeringInput,
    braking: m.brakeInput > 0.3 || m.reversing,
    lap: p.lap,
    checkpointIndex: p.checkpointIndex,
    courseProgress: p.courseProgress,
    finishedAtMs: p.finishedAtMs,
    chassis: car.chassis,
    chassisMax: car.chassisMax,
    armor: [...car.armor],
    components: car.components.map((c) => c.integrity),
    statuses: statusList(car, race.tick),
    modules: car.modules.map((mod, i) => ({
      state: mod.state === MODULE_DISABLED ? MODULE_DISABLED : mod.state,
      aim: mod.aim,
      up: car.specs[i]!.kind === 'shield' && mod.pool > 0,
    })),
    ko: car.ko,
    buildHash: car.buildHash,
    tow: towShareOf(car),
  };
}

export function projectileSnapshots(race: RaceSession): ProjectileSnapshot[] {
  const out: ProjectileSnapshot[] = [];
  for (const p of race.projectiles) {
    if (!p.active) continue;
    const lobbed = p.kind === 'foam' || p.kind === 'shell';
    out.push({
      id: p.id,
      kind: p.kind,
      owner: p.owner,
      x: p.syncX,
      y: p.syncY,
      vx: p.syncVx / SIM_DT,
      vy: p.syncVy / SIM_DT,
      tick: p.syncTick,
      landTick: lobbed ? race.tick + p.life : 0,
    });
  }
  return out;
}

export function hazardSnapshots(race: RaceSession, viewer: number): HazardSnapshot[] {
  const out: HazardSnapshot[] = [];
  for (const h of race.hazards) {
    if (!h.active) continue;
    out.push({
      id: h.id,
      kind: h.kind,
      owner: h.owner,
      x: h.x,
      y: h.y,
      radius: h.radius,
      halfLength: h.halfLength,
      angle: h.angle,
      armedTick: race.tick + h.arm,
      endTick: race.tick + h.life,
      revealed: ((h.revealMask >> viewer) & 1) === 1,
    });
  }
  return out;
}

const standing: Standing = { position: 1, gapMeters: 0, gapSeconds: 0 };

/** Whether the viewer may be shown where its rival is: close enough, or Radar reaches. */
export function rivalTracked(race: RaceSession, viewer: number, rival: number): boolean {
  const a = race.cars[viewer]!;
  const b = race.cars[rival]!.session.motion;
  const m = a.session.motion;
  return Math.hypot(b.x - m.x, b.y - m.y) <= a.trackRange;
}

/**
 * The whole race as one driver may see it. The server room writes the same fields through its
 * synchronized schema; the offline link, the scenario runner and the tests build theirs here.
 */
export function raceSnapshot(race: RaceSession, viewer: number, ackSequence: number): RaceSnapshot {
  const rival = race.cars.length > 1 ? (viewer === 0 ? 1 : 0) : viewer;
  standingOf(race, viewer, standing);
  return {
    tick: race.tick,
    you: viewer,
    phase: race.phase,
    raceTimeMs: raceTimeOf(race),
    car: carSnapshot(race, viewer, ackSequence),
    rival: rivalSnapshot(race, rival),
    rivalBlueprint: race.cars[rival]!.blueprintJson,
    projectiles: projectileSnapshots(race),
    hazards: hazardSnapshots(race, viewer),
    position: standing.position,
    gapMeters: standing.gapMeters,
    gapSeconds: standing.gapSeconds,
    rivalTracked: rivalTracked(race, viewer, rival),
    finishWindowEndTick:
      race.finishWindowEnd >= 0 ? race.tick + (race.finishWindowEnd - race.raceTicks) : 0,
    result: race.result,
  };
}

export type { RaceOptions, RaceSession, CombatCar };
