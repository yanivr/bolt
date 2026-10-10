import { CATALOG, baselineBlueprint } from '@bolt/content';
import type {
  BuildConditions,
  ControlInput,
  RaceEnvironment,
  SurfaceId,
  TrackRuntime,
  VehicleBlueprint,
  VehicleMotionState,
  VehicleParams,
  VehicleTelemetry,
} from '@bolt/shared';
import {
  DEFAULT_CONDITIONS,
  MPH_PER_WORLD_SPEED,
  SIM_DT,
  buildTrack,
  computeBuildStats,
  createMotionState,
  createStepScratch,
  createTelemetry,
  deriveVehicleParams,
  headingFromVector,
  resolveBlueprint,
  stepVehicle,
} from '@bolt/shared';
import { makeProvingGround } from './tracks.js';

export const CLEAR: RaceEnvironment = { weather: 'clear', wetness: 0 };
export const RAIN: RaceEnvironment = { weather: 'rain', wetness: 0.8 };
export const FULL: ControlInput = { steer: 0, brake: 0, coast: false };
export const LIFT: ControlInput = { steer: 0, brake: 0.2, coast: false };
export const COAST: ControlInput = { steer: 0, brake: 0, coast: true };
export const BRAKE: ControlInput = { steer: 0, brake: 1, coast: false };

const grounds = new Map<string, TrackRuntime>();
/** The huge test oval paved in one surface. Built once per surface. */
export function provingGround(surface: SurfaceId = 'asphalt'): TrackRuntime {
  let track = grounds.get(surface);
  if (!track) {
    track = buildTrack(makeProvingGround(surface));
    grounds.set(surface, track);
  }
  return track;
}

/** Coefficients for a blueprint under given conditions. Throws when it does not resolve. */
export function paramsOf(
  blueprint: VehicleBlueprint,
  conditions: BuildConditions = DEFAULT_CONDITIONS,
): VehicleParams {
  const build = resolveBlueprint(blueprint, CATALOG);
  if (!build) throw new Error(`${blueprint.name} does not resolve`);
  return deriveVehicleParams(build, conditions);
}

/** A bare Beetle with one essential swapped: the bench every engine and wheel kit shares. */
export function withEngine(engineId: string, chassisId = 'chassis_beetle'): VehicleParams {
  return paramsOf(baselineBlueprint({ chassisId, engineId }));
}
export function withTires(tireKitId: string, conditions?: BuildConditions): VehicleParams {
  return paramsOf(baselineBlueprint({ tireKitId, engineId: 'engine_four_cylinder' }), conditions);
}

export function statsOf(
  blueprint: VehicleBlueprint,
  conditions: BuildConditions = DEFAULT_CONDITIONS,
) {
  const stats = computeBuildStats(blueprint, CATALOG, conditions);
  if (!stats) throw new Error(`${blueprint.name} does not resolve`);
  return stats;
}

export type Rig = {
  state: VehicleMotionState;
  telemetry: VehicleTelemetry;
  params: VehicleParams;
  /** Seconds simulated so far. */
  time: () => number;
  run: (input: ControlInput, seconds: number, each?: (rig: Rig) => void) => void;
};

/** A car at rest on the long straight of the proving ground, pointing along it. */
export function rig(
  params: VehicleParams,
  env: RaceEnvironment = CLEAR,
  surface: SurfaceId = 'asphalt',
): Rig {
  const track = provingGround(surface);
  const state = createMotionState(11000, 5000, headingFromVector(-1, 0), params);
  const telemetry = createTelemetry();
  const scratch = createStepScratch();
  let steps = 0;
  const self: Rig = {
    state,
    telemetry,
    params,
    time: () => steps * SIM_DT,
    run: (input, seconds, each) => {
      for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
        stepVehicle(state, input, params, env, track, SIM_DT, scratch, telemetry);
        steps++;
        each?.(self);
      }
    },
  };
  return self;
}

export type Sprint = {
  /** Seconds to 30 and 60 MPH, or null when not reached in the run. */
  toThirty: number | null;
  toSixty: number | null;
  /** World pixels covered in the first 2 and 8 seconds. */
  distance2s: number;
  distance8s: number;
  /** Mean speed over the last 6 seconds of a 24-second run, MPH. */
  topMph: number;
  /** Highest forward acceleration over any half second, world px/s2. */
  peakAccel: number;
  peakHeat: number;
};

/** Flat out from rest for 24 seconds on the real integrator. */
export function sprint(
  params: VehicleParams,
  env: RaceEnvironment = CLEAR,
  surface: SurfaceId = 'asphalt',
): Sprint {
  const r = rig(params, env, surface);
  const out: Sprint = {
    toThirty: null,
    toSixty: null,
    distance2s: 0,
    distance8s: 0,
    topMph: 0,
    peakAccel: 0,
    peakHeat: 0,
  };
  const x0 = r.state.x;
  const speeds: number[] = [];
  let tail = 0;
  let tailSteps = 0;
  r.run(FULL, 24, (self) => {
    const t = self.time();
    const mph = self.telemetry.speed * MPH_PER_WORLD_SPEED;
    speeds.push(self.telemetry.speed);
    if (out.toThirty === null && mph >= 30) out.toThirty = t;
    if (out.toSixty === null && mph >= 60) out.toSixty = t;
    if (Math.abs(t - 2) < 1e-6) out.distance2s = Math.abs(self.state.x - x0);
    if (Math.abs(t - 8) < 1e-6) out.distance8s = Math.abs(self.state.x - x0);
    if (t > 18) {
      tail += mph;
      tailSteps++;
    }
    out.peakHeat = Math.max(out.peakHeat, self.state.coreHeat);
  });
  for (let i = 15; i < speeds.length; i++)
    out.peakAccel = Math.max(out.peakAccel, (speeds[i]! - speeds[i - 15]!) / 0.5);
  out.topMph = tail / tailSteps;
  return out;
}

/** Stopping distance, world pixels, from a rolling start at `speed` under full brake. */
export function stoppingDistance(
  params: VehicleParams,
  env: RaceEnvironment,
  surface: SurfaceId,
  speed = 200,
): number {
  const r = rig(params, env, surface);
  r.state.velocityX = -speed;
  const x0 = r.state.x;
  r.run(BRAKE, 0.4);
  let stopped = Math.abs(r.state.x - x0);
  // Before the brake has been held long enough to reverse, the car is simply stationary.
  r.run({ steer: 0, brake: 0.5, coast: false }, 6, (self) => {
    if (self.telemetry.speed > 0.01) stopped = Math.abs(self.state.x - x0);
  });
  return stopped;
}

/** Grip the integrator reports under the car after a moment at rest. */
export function gripOn(params: VehicleParams, env: RaceEnvironment, surface: SurfaceId): number {
  const r = rig(params, env, surface);
  r.run(COAST, 0.2);
  return r.telemetry.grip;
}
