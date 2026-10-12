import { BRAKE_LIFT_THRESHOLD, SIM_DT } from './balance.js';
import { scheduleState } from './hazards.js';
import { angleDelta, clamp, headingFromVector } from './math.js';
import type { ControlInput } from './physics.js';
import { surfaceGrip } from './physics.js';
import type { TrackLocation, TrackRuntime } from './track.js';
import {
  TRACK_SAMPLE_SPACING,
  createLocation,
  lapPosition,
  locate,
  sampleBranch,
} from './track.js';
import type { RaceEnvironment, VehicleMotionState, VehicleParams } from './types.js';

/**
 * Centerline-following driver. It produces the same normalized control sample a human does,
 * from information a human can see: the road ahead and the car's own motion. It is the basis
 * of the bot controller (Section 15.9) and is used today to measure lap times in the
 * simulator and to drive capture runs. It never touches physics state directly.
 */

export type DriverTuning = {
  /** Fraction of the theoretical cornering limit the driver is willing to use. */
  cornerConfidence: number;
  /** Fraction of the theoretical braking capacity the driver plans around. */
  brakeConfidence: number;
  lookAheadBase: number;
  lookAheadPerSpeed: number;
  steerGain: number;
};

export const DEFAULT_DRIVER: DriverTuning = {
  cornerConfidence: 0.86,
  brakeConfidence: 0.7,
  lookAheadBase: 46,
  lookAheadPerSpeed: 0.3,
  steerGain: 2.4,
};

export type DriverScratch = { loc: TrackLocation };
export function createDriverScratch(): DriverScratch {
  return { loc: createLocation() };
}

/** What the speed plan decided: the fastest the car should go now, and why. */
export type SpeedPlan = {
  allowed: number;
  /** True when the binding limit is a rail crossing that will be down: wait, do not reverse. */
  holding: boolean;
};

/** Seconds of margin a planner keeps either side of a crossing's closed time. */
const CROSSING_MARGIN_SECONDS = 0.6;
/** Where a car waiting for a crossing stops, px before the barrier. */
const CROSSING_STOP_GAP = 34;

/**
 * The speed plan of `driveCenterline`, shared with the sparring brain: for each point ahead on
 * the main line, the fastest entry speed that still allows braking to that point's cornering
 * limit under the grip there (zone surfaces and oil included), and to a stop before a rail
 * crossing that will be down when the car gets there. The tightest constraint wins. `grip` is
 * an extra multiplier for what is acting on the car (an oil status, damaged wheels).
 */
export function planSpeed(
  track: TrackRuntime,
  params: VehicleParams,
  env: RaceEnvironment,
  lapS: number,
  speed: number,
  tuning: DriverTuning,
  gripScale = 1,
  clockTicks = 0,
  out: SpeedPlan = { allowed: Infinity, holding: false },
): SpeedPlan {
  let allowed = Infinity;
  const horizon = 60 + speed * 1.1;
  const main = track.main;
  for (let d = 0; d <= horizon; d += TRACK_SAMPLE_SPACING * 2) {
    const p = sampleBranch(main, lapS + d);
    const surface = main.surface[p.index] ?? 'asphalt';
    let grip = surfaceGrip(params, env, surface, false) * gripScale;
    const h = main.hazard[p.index] ?? -1;
    if (h >= 0) {
      const hz = track.hazards[h]!;
      if (hz.kind === 'oil') grip *= hz.grip;
    }
    const curvature = Math.max(Math.abs(p.curvature), 1e-5);
    const cornerSpeed = Math.sqrt(
      (params.lateralGripAccel * grip * tuning.cornerConfidence) / curvature,
    );
    const entry = Math.sqrt(
      cornerSpeed * cornerSpeed + 2 * params.brakeDecel * grip * tuning.brakeConfidence * d,
    );
    if (entry < allowed) allowed = entry;
  }
  let holding = false;
  for (let k = 0; k < track.routeHazards.length; k++) {
    const rh = track.routeHazards[k]!;
    if (rh.branch !== 0) continue;
    const hz = track.hazards[rh.hazard]!;
    if (hz.kind !== 'crossing') continue;
    let d = rh.s - lapS;
    d = ((d % main.length) + main.length) % main.length;
    if (d > horizon + 120) continue;
    // Already at the barrier and it is not down: go through rather than stop on the rails.
    const now = scheduleState(hz.schedule, clockTicks * SIM_DT);
    if (d < CROSSING_STOP_GAP - 6 && now.phase !== 'active') continue;
    // Whether the barrier is down, or comes down, while the car would be passing it.
    const eta = d / Math.max(speed, 60);
    const from = scheduleState(hz.schedule, clockTicks * SIM_DT + eta - CROSSING_MARGIN_SECONDS);
    if (from.phase === 'idle' && from.secondsLeft > CROSSING_MARGIN_SECONDS * 2) continue;
    const room = Math.max(0, d - CROSSING_STOP_GAP);
    const stop = Math.sqrt(2 * params.brakeDecel * 0.6 * room);
    if (stop < allowed) {
      allowed = stop;
      holding = true;
    }
  }
  out.allowed = allowed;
  out.holding = holding;
  return out;
}

const planScratch: SpeedPlan = { allowed: Infinity, holding: false };

export function driveCenterline(
  track: TrackRuntime,
  motion: VehicleMotionState,
  params: VehicleParams,
  env: RaceEnvironment,
  scratch: DriverScratch,
  tuning: DriverTuning = DEFAULT_DRIVER,
  /** Race clock in ticks since GO, so the plan can wait for a rail crossing. */
  clockTicks = 0,
): ControlInput {
  const loc = scratch.loc;
  locate(track, motion.x, motion.y, loc);
  const lapS = track.startS + lapPosition(track, loc);
  const speed = Math.hypot(motion.velocityX, motion.velocityY);

  const aim = sampleBranch(
    track.main,
    lapS + tuning.lookAheadBase + speed * tuning.lookAheadPerSpeed,
  );
  const wanted = headingFromVector(aim.x - motion.x, aim.y - motion.y);
  const error = angleDelta(motion.headingRad, wanted);
  const steer = clamp(error * tuning.steerGain, -1, 1);

  // Speed plan: for each point ahead, the fastest entry speed that still allows braking to
  // that point's cornering limit. The tightest constraint wins.
  const allowed = planSpeed(
    track,
    params,
    env,
    lapS,
    speed,
    tuning,
    1,
    clockTicks,
    planScratch,
  ).allowed;

  let pull = 0;
  if (speed > allowed) {
    const lift = clamp((speed - allowed) / 45, 0.25, 1);
    pull = BRAKE_LIFT_THRESHOLD + lift * (1 - BRAKE_LIFT_THRESHOLD);
  }
  return { steer, brake: pull, coast: false };
}
