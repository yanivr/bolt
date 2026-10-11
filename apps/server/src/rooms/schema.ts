import type { SchemaType } from '@colyseus/schema';
import type { MapSchema } from '@colyseus/schema';
import { schema } from '@colyseus/schema';
import type { CombatCar, DriveSession, RaceSession, Standing } from '@bolt/shared';
import {
  HAZARD_KINDS,
  PROJECTILE_KINDS,
  SIM_DT,
  STATUS_COUNT,
  countdownSeconds,
  raceTimeMs,
  raceTimeOf,
  rivalTracked,
  standingOf,
} from '@bolt/shared';

const uint8 = (value = 0) => ({ type: 'uint8', default: value }) as const;
const int8 = (value = 0) => ({ type: 'int8', default: value }) as const;
const uint16 = (value = 0) => ({ type: 'uint16', default: value }) as const;
const int16 = (value = 0) => ({ type: 'int16', default: value }) as const;
const uint32 = (value = 0) => ({ type: 'uint32', default: value }) as const;
const int32 = (value = 0) => ({ type: 'int32', default: value }) as const;
const float32 = (value = 0) => ({ type: 'float32', default: value }) as const;
const float64 = (value = 0) => ({ type: 'float64', default: value }) as const;
const bool = (value = false) => ({ type: 'boolean', default: value }) as const;
const text = (value = '') => ({ type: 'string', default: value }) as const;

/**
 * One status family on a car. Every car carries one of these per family for the whole race;
 * `untilTick` in the past means it is not active. Nothing in it changes while a status runs,
 * so an active status costs no bandwidth after the patch that announced it.
 */
export const StatusState = schema({ magnitude: float32(), untilTick: uint32() }, 'StatusState');
export type StatusState = SchemaType<typeof StatusState>;

/** Runtime state of one mounted part of the player's own car (`ModuleSnapshot`). */
export const ModuleState = schema(
  {
    state: uint8(),
    charges: int16(-1),
    readyTick: uint32(),
    cooldownTicks: uint16(),
    aim: float32(),
    locked: bool(),
    pool: float32(),
  },
  'ModuleState',
);
export type ModuleState = SchemaType<typeof ModuleState>;

/** What can be seen of one of the rival's parts from outside. */
export const RivalModuleState = schema(
  { state: uint8(), aim: float32(), up: bool() },
  'RivalModuleState',
);
export type RivalModuleState = SchemaType<typeof RivalModuleState>;

/**
 * The other car as a driver may see it (`RivalSnapshot`). It is drawn by interpolation, never
 * predicted, so its motion travels as float32: a hundredth of a pixel at the far corner of
 * the largest track. Heat, energy and ammunition are not here at all (Section 7.5).
 */
export const RivalState = schema(
  {
    x: float32(),
    y: float32(),
    headingRad: float32(),
    velocityX: float32(),
    velocityY: float32(),
    steeringInput: float32(),
    braking: bool(),
    lap: uint8(),
    checkpointIndex: uint16(),
    courseProgress: float32(),
    finishedAtMs: int32(-1),
    chassis: float32(),
    chassisMax: float32(),
    armor: ['float32'],
    components: ['float32'],
    statuses: [StatusState],
    modules: [RivalModuleState],
    ko: bool(),
    buildHash: text(),
  },
  'RivalState',
);
export type RivalState = SchemaType<typeof RivalState>;

/**
 * One thing in flight (`ProjectileSnapshot`). Ballistic kinds are written once, at launch, and
 * the client moves them itself from `x`, `y`, `vx`, `vy` and `tick`; only missiles and
 * boomerangs, which steer, are rewritten.
 */
export const ProjectileState = schema(
  {
    id: uint32(),
    kind: uint8(),
    owner: uint8(),
    x: float32(),
    y: float32(),
    vx: float32(),
    vy: float32(),
    tick: uint32(),
    landTick: uint32(),
  },
  'ProjectileState',
);
export type ProjectileState = SchemaType<typeof ProjectileState>;

/** One thing on the road (`HazardSnapshot`). Written once unless it changes kind or is revealed. */
export const HazardState = schema(
  {
    id: uint32(),
    kind: uint8(),
    owner: uint8(),
    x: float32(),
    y: float32(),
    radius: float32(),
    halfLength: float32(),
    angle: float32(),
    armedTick: uint32(),
    endTick: uint32(),
    revealed: bool(),
  },
  'HazardState',
);
export type HazardState = SchemaType<typeof HazardState>;

/**
 * `VehicleEffects` of the player's own car. Exact (float64), because the client replays its
 * unconfirmed input with these numbers. `speedCap` is -1 for no cap, since a schema number
 * cannot carry Infinity.
 */
export const EffectsState = schema(
  {
    drive: float64(1),
    speedCap: float64(-1),
    grip: float64(1),
    steerBias: float64(),
    steerScale: float64(1),
    steerLag: float64(),
    rollingAdd: float64(),
    heatFactor: float64(1),
    auxLimit: float64(1),
    driveSupplyLimit: float64(1),
    stabilityAdd: float64(),
    airborne: bool(),
  },
  'EffectsState',
);
export type EffectsState = SchemaType<typeof EffectsState>;

/** Combat state of the player's own car (`CarCombatSnapshot`). */
export const CombatState = schema(
  {
    chassis: float32(),
    chassisMax: float32(),
    /** Armor points per arc: front, right, rear, left. */
    armor: ['float32'],
    /** Integrity per component: engine, steering, each wheel, then each mounted part. */
    components: ['float32'],
    /** One per status family, in `STATUS_FAMILIES` order. */
    statuses: [StatusState],
    /** One per mounted part, in canonical blueprint order. */
    modules: [ModuleState],
    reserve: float32(),
    lockWarning: uint8(),
    ko: bool(),
  },
  'CombatState',
);
export type CombatState = SchemaType<typeof CombatState>;

/** Standings and the result (`RaceSnapshot`, less the entities). */
export const RaceInfoState = schema(
  {
    /** Race phase. The root `phase` is the player's own car, which goes FINISHED when it finishes. */
    phase: { type: 'string', default: 'COUNTDOWN' },
    /** The race clock. The root `raceTimeMs` is the player's own car and stops when it finishes. */
    clockMs: uint32(),
    position: uint8(1),
    gapMeters: float32(),
    gapSeconds: float32(),
    rivalTracked: bool(),
    finishWindowEndTick: uint32(),
    /** -2 while there is no result; -1 for a draw; otherwise the winning car. */
    resultWinner: int8(-2),
    /** The `RaceResult` as JSON once the race is over, otherwise empty. */
    resultJson: text(),
  },
  'RaceInfoState',
);
export type RaceInfoState = SchemaType<typeof RaceInfoState>;

/**
 * Synchronized state of a drive room: the player's own car flat at the root, then the race
 * around it. Field names mirror `CarSnapshot` and `RaceSnapshot` in the shared protocol (the
 * car's `motion`, `progress`, `effects` and `combat` members are flattened here) so the client
 * can rebuild a snapshot from a patch without a lookup table.
 *
 * Continuous motion values of the player's car travel as float64 on purpose: the client
 * replays its unconfirmed inputs on top of this state, and any quantization would show up as a
 * correction every snapshot. Note that the schema type named `number` would not do: it picks
 * the smallest encoding per value and sends fractions as float32.
 *
 * The class is declared with `schema()` rather than `@type` decorators. Decorated fields only
 * work when every tool that compiles this file (tsc, esbuild, tsx, Vitest) agrees on the
 * legacy decorator and class-field settings, and a mismatch fails at startup, not at build.
 */
export const DriveState = schema(
  {
    tick: uint32(),
    phase: { type: 'string', default: 'COUNTDOWN' },
    countdown: uint8(),
    countdownTicks: uint16(),
    raceTimeMs: uint32(),
    /** Sequence of the last input sample the simulation consumed. -1 until the first one. */
    ackSequence: int32(-1),
    bestLapMs: uint32(),
    lastLapMs: uint32(),
    /** Mechanical hash of the blueprint the server accepted for this car (Section 15.5). */
    buildHash: { type: 'string', default: '' },
    /** One entry per wheel anchor of the chassis, 0 to 100. */
    wheelIntegrity: ['float32'],

    // VehicleMotionState
    x: float64(),
    y: float64(),
    headingRad: float64(),
    velocityX: float64(),
    velocityY: float64(),
    yawRate: float64(),
    steeringInput: float64(),
    brakeInput: float64(),
    throttleFraction: float64(),
    reverseHold: float64(),
    reversing: { type: 'boolean', default: false },
    wallGrace: float64(),
    // Powertrain state. Synchronized exactly for the same reason as the motion values: the
    // client replays its unconfirmed inputs from here, and heat, battery and engine state all
    // feed back into the force the engine makes.
    coreHeat: float64(),
    batteryEnergy: float64(),
    thermalLimited: bool(),
    engineSpool: float64(),
    engineCharge: float64(1),
    engineClock: float64(),
    engineBurst: float64(),
    tireWearSeconds: float64(),

    // VehicleProgressState
    checkpointIndex: uint16(),
    lap: uint8(),
    courseProgress: float64(),
    lastCheckpointMs: uint32(),
    wrongWaySeconds: float64(),
    /** Race time at the finish in milliseconds, or -1 while the car has not finished. */
    finishedAtMs: int32(-1),

    /** What damage and statuses are doing to the player's car this tick. */
    fx: EffectsState,
    combat: CombatState,
    race: RaceInfoState,
    rival: RivalState,
    /** Canonical JSON of the rival's blueprint. Written once. */
    rivalBlueprint: text(),
    projectiles: { map: ProjectileState },
    hazards: { map: HazardState },
  },
  'DriveState',
);
export type DriveState = SchemaType<typeof DriveState>;

function writeNumbers(
  target: { length: number; push(value: number): unknown; pop(): unknown; [index: number]: number },
  source: readonly number[],
  count = source.length,
): void {
  while (target.length < count) target.push(0);
  while (target.length > count) target.pop();
  for (let i = 0; i < count; i++) {
    // Compared as float32, which is what the wire carries, so equal values are not resent.
    const value = Math.fround(source[i]!);
    if (target[i] !== value) target[i] = value;
  }
}

/**
 * Copies the player's car into the root of the schema. Plain field writes only: the schema
 * tracks which values actually changed, so unchanged fields cost nothing on the wire.
 */
export function writeDriveState(
  state: DriveState,
  session: DriveSession,
  ackSequence: number,
): void {
  state.tick = session.tick;
  state.phase = session.phase;
  state.countdown = countdownSeconds(session);
  state.countdownTicks = session.phase === 'COUNTDOWN' ? Math.max(0, session.countdownTicks) : 0;
  state.raceTimeMs = raceTimeMs(session);
  state.ackSequence = ackSequence;
  state.bestLapMs = session.bestLapMs;
  state.lastLapMs = session.lastLapMs;

  const motion = session.motion;
  state.x = motion.x;
  state.y = motion.y;
  state.headingRad = motion.headingRad;
  state.velocityX = motion.velocityX;
  state.velocityY = motion.velocityY;
  state.yawRate = motion.yawRate;
  state.steeringInput = motion.steeringInput;
  state.brakeInput = motion.brakeInput;
  state.throttleFraction = motion.throttleFraction;
  state.reverseHold = motion.reverseHold;
  state.reversing = motion.reversing;
  state.wallGrace = motion.wallGrace;
  state.coreHeat = motion.coreHeat;
  state.batteryEnergy = motion.batteryEnergy;
  state.thermalLimited = motion.thermalLimited;
  state.engineSpool = motion.engineSpool;
  state.engineCharge = motion.engineCharge;
  state.engineClock = motion.engineClock;
  state.engineBurst = motion.engineBurst;
  state.tireWearSeconds = motion.tireWearSeconds;

  const wheels = session.wheelIntegrity;
  while (state.wheelIntegrity.length < wheels.length) state.wheelIntegrity.push(100);
  while (state.wheelIntegrity.length > wheels.length) state.wheelIntegrity.pop();
  for (let i = 0; i < wheels.length; i++)
    if (state.wheelIntegrity[i] !== wheels[i]) state.wheelIntegrity[i] = wheels[i]!;

  const progress = session.progress;
  state.checkpointIndex = progress.checkpointIndex;
  state.lap = progress.lap;
  state.courseProgress = progress.courseProgress;
  state.lastCheckpointMs = progress.lastCheckpointMs;
  state.wrongWaySeconds = progress.wrongWaySeconds;
  state.finishedAtMs = progress.finishedAtMs ?? -1;

  const from = session.effects;
  const fx = state.fx;
  fx.drive = from.drive;
  fx.speedCap = Number.isFinite(from.speedCap) ? from.speedCap : -1;
  fx.grip = from.grip;
  fx.steerBias = from.steerBias;
  fx.steerScale = from.steerScale;
  fx.steerLag = from.steerLag;
  fx.rollingAdd = from.rollingAdd;
  fx.heatFactor = from.heatFactor;
  fx.auxLimit = from.auxLimit;
  fx.driveSupplyLimit = from.driveSupplyLimit;
  fx.stabilityAdd = from.stabilityAdd;
  fx.airborne = from.airborne;
}

function writeStatuses(
  target: { length: number; push(value: StatusState): unknown; [index: number]: StatusState },
  car: CombatCar,
  tick: number,
): void {
  while (target.length < STATUS_COUNT) target.push(new StatusState());
  for (let i = 0; i < STATUS_COUNT; i++) {
    const slot = target[i]!;
    const left = car.statusTicks[i]!;
    // The end tick of a running status never moves, so this writes once per application.
    const until = left > 0 ? tick + left : 0;
    if (slot.untilTick !== until) slot.untilTick = until;
    const magnitude = left > 0 ? Math.fround(car.statusMagnitude[i]!) : 0;
    if (slot.magnitude !== magnitude) slot.magnitude = magnitude;
  }
}

const standing: Standing = { position: 1, gapMeters: 0, gapSeconds: 0 };
const armorScratch = [0, 0, 0, 0];
const componentScratch: number[] = [];

function componentValues(car: CombatCar): number[] {
  componentScratch.length = car.components.length;
  for (let i = 0; i < car.components.length; i++)
    componentScratch[i] = car.components[i]!.integrity;
  return componentScratch;
}

/**
 * Copies the race around the player's car into the schema: its combat state, the rival as
 * seen from outside, everything in flight and on the road, and the standings. Allocates only
 * when something new appears.
 */
export function writeRaceState(state: DriveState, race: RaceSession, viewer: number): void {
  const tick = race.tick;
  const me = race.cars[viewer]!;
  const rivalIndex = race.cars.length > 1 ? (viewer === 0 ? 1 : 0) : viewer;
  const other = race.cars[rivalIndex]!;

  const combat = state.combat;
  const info = state.race;
  info.phase = race.phase;
  combat.chassis = me.chassis;
  combat.chassisMax = me.chassisMax;
  for (let i = 0; i < 4; i++) armorScratch[i] = me.armor[i]!;
  writeNumbers(combat.armor, armorScratch);
  writeNumbers(combat.components, componentValues(me));
  writeStatuses(combat.statuses, me, tick);
  while (combat.modules.length < me.modules.length) combat.modules.push(new ModuleState());
  for (let i = 0; i < me.modules.length; i++) {
    const from = me.modules[i]!;
    const to = combat.modules[i]!;
    to.state = from.state;
    to.charges = from.charges;
    // Ready time is written as the tick it falls on, which stands still while a cooldown runs.
    const ready = from.cooldown > 0 ? tick + from.cooldown : 0;
    if (to.readyTick !== ready) to.readyTick = ready;
    to.cooldownTicks = from.cooldownTotal;
    const aim = Math.fround(from.aim);
    if (to.aim !== aim) to.aim = aim;
    to.locked = from.locked;
    const pool = Math.fround(from.pool);
    if (to.pool !== pool) to.pool = pool;
  }
  combat.reserve = me.reserve;
  combat.lockWarning = me.lockWarning;
  combat.ko = me.ko;

  const rival = state.rival;
  const m = other.session.motion;
  const p = other.session.progress;
  rival.x = m.x;
  rival.y = m.y;
  rival.headingRad = m.headingRad;
  rival.velocityX = m.velocityX;
  rival.velocityY = m.velocityY;
  rival.steeringInput = m.steeringInput;
  rival.braking = m.brakeInput > 0.3 || m.reversing;
  rival.lap = p.lap;
  rival.checkpointIndex = p.checkpointIndex;
  rival.courseProgress = p.courseProgress;
  rival.finishedAtMs = p.finishedAtMs ?? -1;
  rival.chassis = other.chassis;
  rival.chassisMax = other.chassisMax;
  for (let i = 0; i < 4; i++) armorScratch[i] = other.armor[i]!;
  writeNumbers(rival.armor, armorScratch);
  writeNumbers(rival.components, componentValues(other));
  writeStatuses(rival.statuses, other, tick);
  while (rival.modules.length < other.modules.length) rival.modules.push(new RivalModuleState());
  for (let i = 0; i < other.modules.length; i++) {
    const from = other.modules[i]!;
    const to = rival.modules[i]!;
    to.state = from.state;
    const aim = Math.fround(from.aim);
    if (to.aim !== aim) to.aim = aim;
    to.up = other.specs[i]!.kind === 'shield' && from.pool > 0;
  }
  rival.ko = other.ko;
  if (rival.buildHash !== other.buildHash) rival.buildHash = other.buildHash;
  if (state.rivalBlueprint !== other.blueprintJson) state.rivalBlueprint = other.blueprintJson;

  // --- Projectiles: add the new, rewrite the ones that steer, drop the gone ----------------------
  const projectiles = state.projectiles;
  let liveProjectiles = 0;
  for (const source of race.projectiles) {
    if (!source.active) continue;
    liveProjectiles++;
    const key = String(source.id);
    let target = projectiles.get(key);
    if (!target) {
      target = new ProjectileState();
      target.id = source.id;
      target.kind = PROJECTILE_KINDS.indexOf(source.kind);
      target.owner = source.owner;
      const lobbed = source.kind === 'foam' || source.kind === 'shell';
      target.landTick = lobbed ? tick + source.life : 0;
      projectiles.set(key, target);
    }
    if (target.tick !== source.syncTick) {
      target.tick = source.syncTick;
      target.x = source.syncX;
      target.y = source.syncY;
      target.vx = source.syncVx / SIM_DT;
      target.vy = source.syncVy / SIM_DT;
    }
  }
  if (projectiles.size !== liveProjectiles) pruneMap(projectiles, race.projectiles);

  // --- Hazards -----------------------------------------------------------------------------------
  const hazards = state.hazards;
  let liveHazards = 0;
  for (const source of race.hazards) {
    if (!source.active) continue;
    liveHazards++;
    const key = String(source.id);
    let target = hazards.get(key);
    if (!target) {
      target = new HazardState();
      target.id = source.id;
      target.owner = source.owner;
      target.radius = source.radius;
      target.halfLength = source.halfLength;
      target.angle = source.angle;
      target.armedTick = tick + source.arm;
      hazards.set(key, target);
    }
    target.kind = HAZARD_KINDS.indexOf(source.kind);
    target.owner = source.owner;
    const x = Math.fround(source.x);
    const y = Math.fround(source.y);
    if (target.x !== x) target.x = x;
    if (target.y !== y) target.y = y;
    const end = tick + source.life;
    if (target.endTick !== end) target.endTick = end;
    target.revealed = ((source.revealMask >> viewer) & 1) === 1;
  }
  if (hazards.size !== liveHazards) pruneMap(hazards, race.hazards);

  standingOf(race, viewer, standing);
  info.position = standing.position;
  info.gapMeters = standing.gapMeters;
  info.gapSeconds = standing.gapSeconds;
  info.rivalTracked = rivalTracked(race, viewer, rivalIndex);
  const windowEnd = race.finishWindowEnd >= 0 ? tick + (race.finishWindowEnd - race.raceTicks) : 0;
  if (info.finishWindowEndTick !== windowEnd) info.finishWindowEndTick = windowEnd;
  if (race.result) {
    if (info.resultJson === '') {
      info.resultWinner = race.result.winner;
      info.resultJson = JSON.stringify(race.result);
    }
  } else if (info.resultJson !== '') {
    info.resultWinner = -2;
    info.resultJson = '';
  }
  info.clockMs = raceTimeOf(race);
}

const gone: string[] = [];

function pruneMap(
  map: MapSchema<{ id: number }>,
  live: ReadonlyArray<{ id: number; active: boolean }>,
): void {
  gone.length = 0;
  map.forEach((value, key) => {
    let found = false;
    for (let i = 0; i < live.length; i++) {
      const item = live[i]!;
      if (item.active && item.id === value.id) {
        found = true;
        break;
      }
    }
    if (!found) gone.push(key);
  });
  for (const key of gone) map.delete(key);
}

/** The state encoder, for the test that measures what a snapshot costs on the wire. */
export { Encoder as StateEncoder } from '@colyseus/schema';
