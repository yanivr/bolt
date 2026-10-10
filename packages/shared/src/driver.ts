import { BRAKE_LIFT_THRESHOLD } from './balance.js';
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

export function driveCenterline(
  track: TrackRuntime,
  motion: VehicleMotionState,
  params: VehicleParams,
  env: RaceEnvironment,
  scratch: DriverScratch,
  tuning: DriverTuning = DEFAULT_DRIVER,
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
  let allowed = Infinity;
  const horizon = 60 + speed * 1.1;
  for (let d = 0; d <= horizon; d += TRACK_SAMPLE_SPACING * 2) {
    const p = sampleBranch(track.main, lapS + d);
    const surface = track.main.surface[p.index] ?? 'asphalt';
    const grip = surfaceGrip(params, env, surface, false);
    const curvature = Math.max(Math.abs(p.curvature), 1e-5);
    const cornerSpeed = Math.sqrt(
      (params.lateralGripAccel * grip * tuning.cornerConfidence) / curvature,
    );
    const entry = Math.sqrt(
      cornerSpeed * cornerSpeed + 2 * params.brakeDecel * grip * tuning.brakeConfidence * d,
    );
    if (entry < allowed) allowed = entry;
  }

  let pull = 0;
  if (speed > allowed) {
    const lift = clamp((speed - allowed) / 45, 0.25, 1);
    pull = BRAKE_LIFT_THRESHOLD + lift * (1 - BRAKE_LIFT_THRESHOLD);
  }
  return { steer, brake: pull, coast: false };
}
