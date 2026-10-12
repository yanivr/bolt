import { COUNTDOWN_SECONDS, RACE_LIMIT_SECONDS, SIM_DT } from './balance.js';
import type { ControlInput, StepScratch } from './physics.js';
import {
  NEUTRAL_INPUT,
  createEffects,
  createMotionState,
  createStepScratch,
  createTelemetry,
  resetPowertrain,
  stepVehicle,
} from './physics.js';
import type { CarSnapshot } from './protocol.js';
import type { ProgressEvent, TrackRuntime } from './track.js';
import { createProgress, updateProgress } from './track.js';
import type {
  MatchPhase,
  RaceEnvironment,
  VehicleEffects,
  VehicleMotionState,
  VehicleParams,
  VehicleProgressState,
  VehicleTelemetry,
} from './types.js';

/**
 * A single-car session: countdown, racing, finish. The authoritative server owns one of
 * these per test-drive room. The offline development session and the unit tests run the same
 * code, which is the point: there is exactly one implementation of the rules.
 */

export type DriveSession = {
  track: TrackRuntime;
  env: RaceEnvironment;
  params: VehicleParams;
  motion: VehicleMotionState;
  progress: VehicleProgressState;
  telemetry: VehicleTelemetry;
  /**
   * Integrity of each wheel, 0 to 100, one entry per wheel anchor of the chassis in anchor
   * order. State only for now: damage arrives with combat in Milestone C.
   */
  wheelIntegrity: number[];
  /**
   * What damage and status effects are doing to this car's driving. Neutral for a car on its
   * own; the race rewrites it every tick and a predicting client copies it from the snapshot.
   */
  effects: VehicleEffects;
  scratch: StepScratch;
  phase: MatchPhase;
  tick: number;
  /** Ticks left before GO. */
  countdownTicks: number;
  raceTicks: number;
  lapStartTick: number;
  lastLapMs: number;
  bestLapMs: number;
};

export function createDriveSession(
  track: TrackRuntime,
  env: RaceEnvironment,
  params: VehicleParams,
  spawnIndex = 0,
): DriveSession {
  const spawn = track.spawns[spawnIndex % track.spawns.length]!;
  return {
    track,
    env,
    params,
    motion: createMotionState(spawn.x, spawn.y, spawn.headingRad, params),
    progress: createProgress(),
    telemetry: createTelemetry(),
    wheelIntegrity: Array.from({ length: params.wheelCount }, () => 100),
    effects: createEffects(),
    scratch: createStepScratch(),
    phase: 'COUNTDOWN',
    tick: 0,
    countdownTicks: Math.round(COUNTDOWN_SECONDS / SIM_DT),
    raceTicks: 0,
    lapStartTick: 0,
    lastLapMs: 0,
    bestLapMs: 0,
  };
}

/**
 * The clock timed track hazards run on for this session's next step: race ticks since GO
 * (zero on the grid). Planners that look ahead add the ticks until they arrive.
 */
export function hazardClock(session: DriveSession): number {
  return session.raceTicks;
}

export function raceTimeMs(session: DriveSession): number {
  return Math.round(session.raceTicks * SIM_DT * 1000);
}

export function countdownSeconds(session: DriveSession): number {
  return session.phase === 'COUNTDOWN' ? Math.ceil(session.countdownTicks * SIM_DT) : 0;
}

/**
 * The plain snapshot of a session that an authority hands to a predicting client. The server
 * room sends the same fields through its synchronized schema; the offline link, the benches
 * and the tests build theirs here, so there is one definition of what a snapshot contains.
 */
export function sessionSnapshot(
  session: DriveSession,
  ackSequence: number,
  buildHash = '',
): CarSnapshot {
  return {
    tick: session.tick,
    ackSequence,
    raceTimeMs: raceTimeMs(session),
    phase: session.phase,
    countdown: countdownSeconds(session),
    countdownTicks: session.phase === 'COUNTDOWN' ? Math.max(0, session.countdownTicks) : 0,
    motion: { ...session.motion },
    progress: { ...session.progress },
    bestLapMs: session.bestLapMs,
    lastLapMs: session.lastLapMs,
    wheelIntegrity: [...session.wheelIntegrity],
    buildHash,
    effects: { ...session.effects },
    tow: 0,
  };
}

/** Puts the car back on the grid for another run. Development convenience for Milestone A. */
export function resetDriveSession(session: DriveSession, spawnIndex = 0): void {
  const fresh = createDriveSession(session.track, session.env, session.params, spawnIndex);
  const tick = session.tick;
  Object.assign(session, fresh);
  session.tick = tick;
}

export type StepResult = { event: ProgressEvent; lapTimeMs: number };

/** Advances the session by exactly one fixed step. */
export function stepDriveSession(session: DriveSession, input: ControlInput): StepResult {
  session.tick += 1;
  const result: StepResult = { event: 'none', lapTimeMs: 0 };

  if (session.phase === 'COUNTDOWN') {
    session.countdownTicks -= 1;
    // Cars are held on the grid. Steering still filters so the front wheels respond.
    stepVehicle(
      session.motion,
      { steer: input.steer, brake: 1, coast: false },
      session.params,
      session.env,
      session.track,
      SIM_DT,
      session.scratch,
      session.telemetry,
      session.effects,
      0,
    );
    session.motion.velocityX = 0;
    session.motion.velocityY = 0;
    session.motion.yawRate = 0;
    session.motion.reverseHold = 0;
    session.motion.reversing = false;
    // Every car leaves the grid cold, charged and with its launch stored.
    resetPowertrain(session.motion, session.params);
    if (session.countdownTicks <= 0) session.phase = 'RACING';
    return result;
  }

  const racing = session.phase === 'RACING';
  const control = racing ? input : NEUTRAL_BRAKE;
  const prevX = session.motion.x;
  const prevY = session.motion.y;
  // Timed track hazards run on the race clock: ticks since GO, before this one.
  stepVehicle(
    session.motion,
    control,
    session.params,
    session.env,
    session.track,
    SIM_DT,
    session.scratch,
    session.telemetry,
    session.effects,
    session.raceTicks,
  );

  if (!racing) return result;
  session.raceTicks += 1;
  const event = updateProgress(
    session.track,
    session.progress,
    prevX,
    prevY,
    session.motion.x,
    session.motion.y,
    session.motion.headingRad,
    session.telemetry.speed,
    session.scratch.loc,
    raceTimeMs(session),
    SIM_DT,
  );
  result.event = event;
  if (event === 'lap' || event === 'finish') {
    const lapMs = Math.round((session.raceTicks - session.lapStartTick) * SIM_DT * 1000);
    session.lastLapMs = lapMs;
    if (session.bestLapMs === 0 || lapMs < session.bestLapMs) session.bestLapMs = lapMs;
    session.lapStartTick = session.raceTicks;
    result.lapTimeMs = lapMs;
  } else if (
    event === 'checkpoint' &&
    session.progress.lap === 1 &&
    session.progress.checkpointIndex === 1
  ) {
    // First crossing of the start line: the opening lap is timed from here.
    session.lapStartTick = session.raceTicks;
  }
  if (event === 'finish' || session.raceTicks * SIM_DT >= RACE_LIMIT_SECONDS) {
    session.phase = 'FINISHED';
    if (result.event !== 'finish') result.event = 'finish';
  }
  return result;
}

/**
 * What a car that is no longer racing is given: off the throttle and on the brake, held just
 * short of the pull that engages reverse. (At 0.75 a finished car stopped and then backed down
 * the track for good, which a second car still racing would have met.)
 */
export const NEUTRAL_BRAKE: ControlInput = Object.freeze({ steer: 0, brake: 0.58, coast: false });
export { NEUTRAL_INPUT };
