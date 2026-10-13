import type {
  CarSnapshot,
  HazardSnapshot,
  MatchPhase,
  ModuleSnapshot,
  ProjectileSnapshot,
  RaceResult,
  RaceSnapshot,
  RivalSnapshot,
  StatusSnapshot,
} from '@bolt/shared';
import { HAZARD_KINDS, PROJECTILE_KINDS, STATUS_FAMILIES } from '@bolt/shared';

/**
 * A driver's synchronized race state as colyseus.js decodes it, and its conversion into the
 * plain snapshots the race view reconciles against (docs/COMBAT_API.md). The drive room's root
 * state has this shape, and so does each seat's view in a match room. Pure: the online links
 * and the network tests share it.
 */

/** Flat synchronized state of one driver, mirroring apps/server/src/rooms/schema.ts. */
export type DriveStateView = {
  /** This driver's car on the grid. */
  you?: number;
  /** The race this state describes. */
  raceId?: number;
  /** The room holds the race on the grid: the client does not run its clock. */
  held?: boolean;
  net?: NetView;
  tick: number;
  phase: string;
  countdown: number;
  countdownTicks: number;
  raceTimeMs: number;
  ackSequence: number;
  bestLapMs: number;
  lastLapMs: number;
  x: number;
  y: number;
  headingRad: number;
  velocityX: number;
  velocityY: number;
  yawRate: number;
  steeringInput: number;
  brakeInput: number;
  throttleFraction: number;
  reverseHold: number;
  reversing: boolean;
  wallGrace: number;
  coreHeat: number;
  batteryEnergy: number;
  thermalLimited: boolean;
  engineSpool: number;
  engineCharge: number;
  engineClock: number;
  engineBurst: number;
  tireWearSeconds: number;
  wheelIntegrity: Iterable<number>;
  buildHash: string;
  checkpointIndex: number;
  lap: number;
  courseProgress: number;
  lastCheckpointMs: number;
  wrongWaySeconds: number;
  finishedAtMs: number;
  fx?: {
    drive: number;
    speedCap: number;
    grip: number;
    steerBias: number;
    steerScale: number;
    steerLag: number;
    rollingAdd: number;
    heatFactor: number;
    auxLimit: number;
    driveSupplyLimit: number;
    stabilityAdd: number;
    airborne: boolean;
    tow?: number;
    towTarget?: number;
    towNext?: number;
  };
  /** The tow level of the player's car, in hundredths. */
  tow?: number;
  combat?: {
    chassis: number;
    chassisMax: number;
    armor: Iterable<number>;
    components: Iterable<number>;
    statuses: Iterable<StatusView>;
    modules: Iterable<ModuleSnapshot>;
    reserve: number;
    lockWarning: number;
    ko: boolean;
  };
  race?: {
    phase: string;
    clockMs: number;
    position: number;
    gapMeters: number;
    gapSeconds: number;
    rivalTracked: boolean;
    finishWindowEndTick: number;
    resultWinner: number;
    resultJson: string;
  };
  rival?: RivalView;
  rivalBlueprint: string;
  projectiles?: { forEach(fn: (value: ProjectileView) => void): void };
  hazards?: { forEach(fn: (value: HazardView) => void): void };
};

/** How this driver's input reaches the room (`NetState`). */
export type NetView = {
  delay: number;
  depth: number;
  missing: number;
  late: number;
  grown: number;
  shrunk: number;
  reanchors: number;
  absent: boolean;
};

type StatusView = { magnitude: number; untilTick: number };
type RivalView = Omit<
  RivalSnapshot,
  'armor' | 'components' | 'statuses' | 'modules' | 'finishedAtMs' | 'tow'
> & {
  finishedAtMs: number;
  /** In hundredths. */
  tow?: number;
  armor: Iterable<number>;
  components: Iterable<number>;
  statuses: Iterable<StatusView>;
  modules: Iterable<{ state: number; aim: number; up: boolean }>;
};
type ProjectileView = Omit<ProjectileSnapshot, 'kind'> & { kind: number };
type HazardView = Omit<HazardSnapshot, 'kind'> & { kind: number };

/** One status entry per family on the wire; only the ones still running are kept. */
function statusList(statuses: Iterable<StatusView> | undefined, tick: number): StatusSnapshot[] {
  const out: StatusSnapshot[] = [];
  if (!statuses) return out;
  let index = 0;
  for (const status of statuses) {
    const family = STATUS_FAMILIES[index++];
    if (family && status.untilTick > tick)
      out.push({ family, magnitude: status.magnitude, untilTick: status.untilTick });
  }
  return out;
}

/** The race around the local car, rebuilt from the synchronized state. */
export function toRace(state: DriveStateView, car: CarSnapshot): RaceSnapshot | null {
  const rival = state.rival;
  const info = state.race;
  if (!rival || !info) return null;
  const projectiles: ProjectileSnapshot[] = [];
  state.projectiles?.forEach((p) =>
    projectiles.push({
      id: p.id,
      kind: PROJECTILE_KINDS[p.kind] ?? 'bullet',
      owner: p.owner,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      tick: p.tick,
      landTick: p.landTick,
    }),
  );
  const hazards: HazardSnapshot[] = [];
  state.hazards?.forEach((h) =>
    hazards.push({
      id: h.id,
      kind: HAZARD_KINDS[h.kind] ?? 'mine',
      owner: h.owner,
      x: h.x,
      y: h.y,
      radius: h.radius,
      halfLength: h.halfLength,
      angle: h.angle,
      armedTick: h.armedTick,
      endTick: h.endTick,
      revealed: h.revealed,
    }),
  );
  let result: RaceResult | null = null;
  if (info.resultJson) {
    try {
      result = JSON.parse(info.resultJson) as RaceResult;
    } catch {
      result = null;
    }
  }
  return {
    tick: state.tick,
    you: state.you ?? 0,
    phase: info.phase as MatchPhase,
    raceTimeMs: info.clockMs,
    car,
    rival: {
      x: rival.x,
      y: rival.y,
      headingRad: rival.headingRad,
      velocityX: rival.velocityX,
      velocityY: rival.velocityY,
      steeringInput: rival.steeringInput,
      braking: rival.braking,
      lap: rival.lap,
      checkpointIndex: rival.checkpointIndex,
      courseProgress: rival.courseProgress,
      finishedAtMs: rival.finishedAtMs < 0 ? null : rival.finishedAtMs,
      chassis: rival.chassis,
      chassisMax: rival.chassisMax,
      armor: Array.from(rival.armor ?? []),
      components: Array.from(rival.components ?? []),
      statuses: statusList(rival.statuses, state.tick),
      modules: Array.from(rival.modules ?? [], (m) => ({ state: m.state, aim: m.aim, up: m.up })),
      ko: rival.ko,
      buildHash: rival.buildHash,
      tow: (rival.tow ?? 0) / 100,
    },
    rivalBlueprint: state.rivalBlueprint ?? '',
    projectiles,
    hazards,
    position: info.position,
    gapMeters: info.gapMeters,
    gapSeconds: info.gapSeconds,
    rivalTracked: info.rivalTracked,
    finishWindowEndTick: info.finishWindowEndTick,
    result,
  };
}

export function toSnapshot(state: DriveStateView): CarSnapshot {
  const fx = state.fx;
  const combat = state.combat;
  return {
    tick: state.tick,
    ackSequence: state.ackSequence,
    raceTimeMs: state.raceTimeMs,
    phase: state.phase as MatchPhase,
    countdown: state.countdown,
    countdownTicks: state.countdownTicks,
    motion: {
      x: state.x,
      y: state.y,
      headingRad: state.headingRad,
      velocityX: state.velocityX,
      velocityY: state.velocityY,
      yawRate: state.yawRate,
      steeringInput: state.steeringInput,
      brakeInput: state.brakeInput,
      throttleFraction: state.throttleFraction,
      reverseHold: state.reverseHold,
      reversing: state.reversing,
      wallGrace: state.wallGrace,
      coreHeat: state.coreHeat,
      batteryEnergy: state.batteryEnergy,
      thermalLimited: state.thermalLimited,
      engineSpool: state.engineSpool,
      engineCharge: state.engineCharge,
      engineClock: state.engineClock,
      engineBurst: state.engineBurst,
      tireWearSeconds: state.tireWearSeconds,
    },
    progress: {
      checkpointIndex: state.checkpointIndex,
      lap: state.lap,
      courseProgress: state.courseProgress,
      lastCheckpointMs: state.lastCheckpointMs,
      wrongWaySeconds: state.wrongWaySeconds,
      finishedAtMs: state.finishedAtMs < 0 ? null : state.finishedAtMs,
    },
    bestLapMs: state.bestLapMs,
    lastLapMs: state.lastLapMs,
    wheelIntegrity: state.wheelIntegrity ? Array.from(state.wheelIntegrity) : [],
    buildHash: state.buildHash ?? '',
    tow: (state.tow ?? 0) / 100,
    ...(fx
      ? {
          effects: {
            drive: fx.drive,
            speedCap: fx.speedCap < 0 ? Infinity : fx.speedCap,
            grip: fx.grip,
            steerBias: fx.steerBias,
            steerScale: fx.steerScale,
            steerLag: fx.steerLag,
            rollingAdd: fx.rollingAdd,
            heatFactor: fx.heatFactor,
            auxLimit: fx.auxLimit,
            driveSupplyLimit: fx.driveSupplyLimit,
            stabilityAdd: fx.stabilityAdd,
            airborne: fx.airborne,
            tow: fx.tow ?? 0,
            towTarget: fx.towTarget ?? 0,
            towNext: fx.towNext ?? 0,
          },
        }
      : {}),
    ...(combat
      ? {
          combat: {
            chassis: combat.chassis,
            chassisMax: combat.chassisMax,
            armor: Array.from(combat.armor ?? []),
            components: Array.from(combat.components ?? []),
            statuses: statusList(combat.statuses, state.tick),
            modules: Array.from(combat.modules ?? [], (m) => ({
              state: m.state,
              charges: m.charges,
              readyTick: m.readyTick,
              cooldownTicks: m.cooldownTicks,
              aim: m.aim,
              locked: m.locked,
              pool: m.pool,
            })),
            reserve: combat.reserve,
            lockWarning: combat.lockWarning,
            ko: combat.ko,
          },
        }
      : {}),
  };
}
