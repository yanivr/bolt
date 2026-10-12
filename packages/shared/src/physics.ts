import {
  AIRFLOW_FULL_SPEED,
  AIRFLOW_STILL,
  BASE_BATTERY,
  BRAKE_LIFT_THRESHOLD,
  COOLING_MULTIPLIER,
  DOWNFORCE_REF_SPEED,
  DRIVETRAIN_MIN_SUPPLY,
  FREE_ROLL_SLIP,
  HEAT_PROTECTION,
  HEAT_RECOVERY,
  HEAT_SHED_BASE,
  HEAT_SHED_SCALE,
  HEAT_WARNING,
  IDLE_THROTTLE,
  KINETIC_GRIP_FACTOR,
  MAX_COMBINED_GRIP,
  PARTIAL_LOAD_THROTTLE,
  REVERSE_ACCEL,
  REVERSE_HOLD_SECONDS,
  SHOULDER_GRIP_FACTOR,
  SHOULDER_ROLLING_DECEL,
  SCRUB_FULL_SLIP,
  SIM_DT,
  SLOW_ONSET_DECEL,
  STABILITY_MAX,
  STABILITY_MIN,
  STEER_BLEND_SHARPNESS,
  STEER_ENGAGE_TIME,
  STEER_GRIP_SENSE,
  STEER_RELEASE_TIME,
  SURFACE_GRIP,
  SURFACE_ROLLING_DECEL,
  THERMAL_PENALTY_MAX,
  THROTTLE_ASSIST_MIN,
  THROTTLE_ASSIST_SLIP_FULL,
  THROTTLE_ASSIST_SLIP_START,
  TIRE_FADE_END,
  TIRE_FADE_START,
  TIRE_KNEE_SHARPNESS,
  TOW,
  UNSTABLE_ALIGN_LOSS,
  UNSTABLE_GRIP_LOSS,
  UNSTABLE_RECOVERY_LOSS,
  WALL_FORGIVE_SPEED,
  WALL_FRICTION_DECEL,
  WALL_GRACE_SECONDS,
  WALL_RESTITUTION,
  WALL_SCRAPE_FULL_SPEED,
  WALL_SCRAPE_LOSS_MAX,
  WALL_SCRAPE_LOSS_MIN,
  WET_WEATHER,
} from './balance.js';
import { TAU, approach, clamp, expBlend, lerp, smoothstep, wrapAngle } from './math.js';
import type { TrackLocation, TrackRuntime } from './track.js';
import { createLocation, locate, surfaceAt } from './track.js';
import type {
  RaceEnvironment,
  SurfaceId,
  VehicleEffects,
  VehicleMotionState,
  VehicleParams,
  VehicleTelemetry,
} from './types.js';

/**
 * The arcade vehicle integrator. One pure function advances one car by one fixed step. The
 * authoritative server calls it at 30 Hz; the client calls the very same code to predict its
 * own car between snapshots. It must never read a clock, a random source or any browser API.
 *
 * Order follows Section 7.3: engine force, traction, forward integration, yaw, lateral slip,
 * then collision response that keeps tangential motion.
 */

const ALIGN_FLOOR_SPEED = 30;
/** Self-aligning yaw is bounded so a car shoved sideways turns briskly but never snaps round. */
const ALIGN_LIMIT = 2.2;

export type ControlInput = {
  /** -1 full left to 1 full right. */
  steer: number;
  /** 0 to 1 joystick pull-back. Past the lift threshold the throttle releases and brakes apply. */
  brake: number;
  /** True when nobody is touching the controls: gentle throttle, wheels straight. */
  coast: boolean;
  /** Fire buttons held: bit 0 primary, bit 1 secondary. The integrator ignores it. */
  fire?: number;
  /** Manual utilities held, one bit each in blueprint order. The integrator ignores it. */
  use?: number;
  /** Repair target: 0 automatic, otherwise component index + 1. The integrator ignores it. */
  target?: number;
};

export const NEUTRAL_INPUT: ControlInput = Object.freeze({ steer: 0, brake: 0, coast: true });

/** A car that nothing is acting on. Stepping with these is exactly stepping without effects. */
export function createEffects(): VehicleEffects {
  return {
    drive: 1,
    speedCap: Infinity,
    grip: 1,
    steerBias: 0,
    steerScale: 1,
    steerLag: 0,
    rollingAdd: 0,
    heatFactor: 1,
    auxLimit: 1,
    driveSupplyLimit: 1,
    stabilityAdd: 0,
    airborne: false,
    tow: 0,
    towTarget: 0,
    towNext: 0,
  };
}

export const NEUTRAL_EFFECTS: VehicleEffects = Object.freeze(createEffects());

export function copyEffects(from: VehicleEffects, to: VehicleEffects): void {
  to.drive = from.drive;
  to.speedCap = from.speedCap;
  to.grip = from.grip;
  to.steerBias = from.steerBias;
  to.steerScale = from.steerScale;
  to.steerLag = from.steerLag;
  to.rollingAdd = from.rollingAdd;
  to.heatFactor = from.heatFactor;
  to.auxLimit = from.auxLimit;
  to.driveSupplyLimit = from.driveSupplyLimit;
  to.stabilityAdd = from.stabilityAdd;
  to.airborne = from.airborne;
  to.tow = from.tow;
  to.towTarget = from.towTarget;
  to.towNext = from.towNext;
}

/**
 * Moves a car's tow on by one race tick: `raceTick` is the tick about to be simulated, counted
 * from GO. On a decision tick the share announced one period ago becomes the one the bonus
 * moves toward; every tick the bonus moves toward it at the ramp rate. Everything it reads is
 * in the effects record, so the race and a predicting client, starting from the same snapshot,
 * get the same bits for as many ticks as one decision period holds (the race alone then writes
 * the next announcement into `towNext`).
 *
 * Returns true on a decision tick, so the caller that owns the race can make the next decision.
 */
export function advanceTow(
  fx: Pick<VehicleEffects, 'tow' | 'towTarget' | 'towNext'>,
  raceTick: number,
): boolean {
  const period = Math.max(1, Math.round(TOW.updateSeconds / SIM_DT));
  const decision = raceTick % period === 0;
  if (decision) fx.towTarget = fx.towNext;
  if (fx.tow !== fx.towTarget) {
    const rate = fx.towTarget > fx.tow ? TOW.rampUpPerSecond : TOW.rampDownPerSecond;
    fx.tow = approach(fx.tow, fx.towTarget, TOW.maxBonus * rate * SIM_DT);
  }
  return decision;
}

/** Takes the tow off at once: a car that has finished, is wrecked or is not racing has none. */
export function clearTow(fx: Pick<VehicleEffects, 'tow' | 'towTarget' | 'towNext'>): void {
  fx.tow = 0;
  fx.towTarget = 0;
  fx.towNext = 0;
}

export function resetEffects(fx: VehicleEffects): void {
  copyEffects(NEUTRAL_EFFECTS, fx);
}

/**
 * A car at rest. Pass the car's params so the battery starts full for that build; without
 * them it starts with the base battery every chassis has.
 */
export function createMotionState(
  x: number,
  y: number,
  headingRad: number,
  params?: VehicleParams,
): VehicleMotionState {
  return {
    x,
    y,
    headingRad,
    velocityX: 0,
    velocityY: 0,
    yawRate: 0,
    steeringInput: 0,
    brakeInput: 0,
    throttleFraction: 0,
    reverseHold: 0,
    reversing: false,
    wallGrace: 0,
    coreHeat: 0,
    batteryEnergy: params ? params.power.capacity : BASE_BATTERY,
    thermalLimited: false,
    engineSpool: 0,
    engineCharge: 1,
    engineClock: 0,
    engineBurst: 0,
    tireWearSeconds: 0,
  };
}

/** Puts the powertrain back in its starting state: cold, fully charged, launch stored. */
export function resetPowertrain(state: VehicleMotionState, params: VehicleParams): void {
  state.coreHeat = 0;
  state.batteryEnergy = params.power.capacity;
  state.thermalLimited = false;
  state.engineSpool = 0;
  state.engineCharge = 1;
  state.engineClock = 0;
  state.engineBurst = 0;
  state.tireWearSeconds = 0;
}

export function createTelemetry(): VehicleTelemetry {
  return {
    speed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    slipAngle: 0,
    slipRatio: 0,
    surface: 'asphalt',
    onShoulder: false,
    grip: 1,
    rpm: 0,
    wallContact: false,
    wallImpactSpeed: 0,
    wallNormalX: 0,
    wallNormalY: 0,
    powerFraction: 1,
    drivetrainSupply: 1,
    auxSupply: 1,
    generation: 0,
    powerDemand: 0,
    heatProduction: 0,
    heatCooling: 0,
    heatLevel: 0,
    lowPower: false,
  };
}

export function copyMotionState(from: VehicleMotionState, to: VehicleMotionState): void {
  to.x = from.x;
  to.y = from.y;
  to.headingRad = from.headingRad;
  to.velocityX = from.velocityX;
  to.velocityY = from.velocityY;
  to.yawRate = from.yawRate;
  to.steeringInput = from.steeringInput;
  to.brakeInput = from.brakeInput;
  to.throttleFraction = from.throttleFraction;
  to.reverseHold = from.reverseHold;
  to.reversing = from.reversing;
  to.wallGrace = from.wallGrace;
  to.coreHeat = from.coreHeat;
  to.batteryEnergy = from.batteryEnergy;
  to.thermalLimited = from.thermalLimited;
  to.engineSpool = from.engineSpool;
  to.engineCharge = from.engineCharge;
  to.engineClock = from.engineClock;
  to.engineBurst = from.engineBurst;
  to.tireWearSeconds = from.tireWearSeconds;
}

function isRoad(surface: SurfaceId): boolean {
  return surface === 'asphalt' || surface === 'cobble' || surface === 'metal';
}
function isLoose(surface: SurfaceId): boolean {
  return surface === 'sand' || surface === 'dirt' || surface === 'mud' || surface === 'snow';
}

/**
 * Grip for a surface under the published conditions before the Section 9.2 cap: the weather
 * table, the tire kit's base grip and every surface, wet and dry specialization. Powered
 * tire effects (magnetic rollers, adaptive tires) are scaled by `poweredShare`, the share of
 * their electrical demand that is being met.
 */
function rawSurfaceGrip(
  params: VehicleParams,
  env: RaceEnvironment,
  surface: SurfaceId,
  onShoulder: boolean,
  poweredShare: number,
): number {
  const wet = WET_WEATHER[env.weather];
  let grip =
    SURFACE_GRIP[env.weather][surface] * params.tireGrip * (params.tireSurfaceGrip[surface] ?? 1);
  if (wet) grip *= params.tireWetGripFactor * (params.tireWetSurfaceGrip[surface] ?? 1);
  else grip *= params.tireDryGrip[surface] ?? 1;
  if (poweredShare > 0) {
    const consumers = params.power.consumers;
    for (let i = 0; i < consumers.length; i++) {
      const effect = consumers[i]!.effect;
      const bonus = effect.surfaceGrip?.[surface];
      if (bonus !== undefined) grip *= 1 + bonus * poweredShare;
      if (wet && effect.wetGrip !== undefined) grip *= 1 + effect.wetGrip * poweredShare;
    }
  }
  if (onShoulder) grip *= 1 - (1 - SHOULDER_GRIP_FACTOR) * params.shoulderPenalty;
  return grip;
}

/** Combined grip for a surface under the published conditions, capped per Section 9.2. */
export function surfaceGrip(
  params: VehicleParams,
  env: RaceEnvironment,
  surface: SurfaceId,
  onShoulder: boolean,
  poweredShare = 1,
): number {
  return Math.min(
    MAX_COMBINED_GRIP,
    rawSurfaceGrip(params, env, surface, onShoulder, poweredShare),
  );
}

/** Rolling resistance on a surface for this car, world px/s2. */
export function rollingDecel(
  params: VehicleParams,
  surface: SurfaceId,
  onShoulder: boolean,
): number {
  let rolling = SURFACE_ROLLING_DECEL[surface];
  if (onShoulder) rolling = Math.max(SHOULDER_ROLLING_DECEL, rolling);
  rolling *= params.rollingFactor[surface] ?? 1;
  if (isLoose(surface)) rolling *= params.looseRollingFactor;
  return rolling + (params.rollingAdd[surface] ?? 0);
}

/** Wheel force available at a given forward speed with full throttle. */
export function driveForceAt(params: VehicleParams, forwardSpeed: number): number {
  const v = Math.max(0, forwardSpeed);
  let taper = 1;
  if (v > params.forceTaperSpeed) {
    taper = Math.max(
      0,
      1 - (v - params.forceTaperSpeed) / (params.forceZeroSpeed - params.forceTaperSpeed),
    );
  }
  const launch = 1 + params.launchBoost * Math.exp(-v / params.launchFadeSpeed);
  return params.driveForce * taper * launch;
}

/**
 * Curvature that full lock asks for at a forward speed. Below the hand-over speed this is the
 * fixed low-speed turning circle; above it the request falls with the square of speed, so full
 * lock always asks for the same lateral acceleration and the stick maps to cornering force.
 */
export function lockCurvature(params: VehicleParams, forwardSpeed: number, grip: number): number {
  const demand =
    params.lateralGripAccel * params.steerGripDemand * Math.pow(grip, STEER_GRIP_SENSE);
  const ratio = (forwardSpeed * forwardSpeed * params.maxSteerCurvature) / demand;
  const n = STEER_BLEND_SHARPNESS;
  return params.maxSteerCurvature / Math.pow(1 + Math.pow(ratio, n), 1 / n);
}

/**
 * Steady yaw rate, radians per second, that one unit of steering produces at this speed while
 * the tires are gripping. Negative in reverse. Controllers divide by it to turn a wanted yaw
 * rate into a stick position.
 */
export function steerYawGain(params: VehicleParams, forwardSpeed: number, grip: number): number {
  return (
    (forwardSpeed * lockCurvature(params, forwardSpeed, grip)) /
    (1 + params.yawAlign / params.slipStiffness)
  );
}

/**
 * Share of peak lateral force the tires deliver for a demand `r`, where 1 is the force that
 * would exactly reach the grip limit. Linear for small demands, a smooth knee into the peak,
 * then a gentle fade toward the sliding value. Continuous everywhere.
 */
export function tireResponse(r: number, kinetic: number): number {
  const n = TIRE_KNEE_SHARPNESS;
  const knee = r / Math.pow(1 + Math.pow(r, n), 1 / n);
  return knee * lerp(1, kinetic, smoothstep(TIRE_FADE_START, TIRE_FADE_END, r));
}

/** What the powertrain decided this step. Reused between steps to avoid allocation. */
export type PowertrainOutput = {
  /** Engine force this step as a fraction of rated force. */
  output: number;
  /** Multiplier on the engine's rev ceiling this step. */
  revScale: number;
  /** Share of powered tire effects that is supplied. */
  gripSupply: number;
  stabilityAdd: number;
  slipRecoveryAdd: number;
  downforce: number;
};

export function createPowertrainOutput(): PowertrainOutput {
  return {
    output: 1,
    revScale: 1,
    gripSupply: 1,
    stabilityAdd: 0,
    slipRecoveryAdd: 0,
    downforce: 0,
  };
}

/**
 * Section 11.8 steps 2 and 3 for one car: electrical generation, battery and consumer
 * priorities, then heat production, cooling and thermal limiting, along with the engine's
 * own runtime character (wind-up, output cycle, fuel pulses, stored launch). Everything it
 * remembers lives in the motion state, so the server, the predicting client and a replay all
 * produce the same numbers from the same inputs.
 */
export function stepPowertrain(
  state: VehicleMotionState,
  throttle: number,
  speed: number,
  params: VehicleParams,
  env: RaceEnvironment,
  dt: number,
  out: PowertrainOutput,
  telemetry: VehicleTelemetry,
  fx: VehicleEffects = NEUTRAL_EFFECTS,
): void {
  const engine = params.engine;
  let output = 1;
  let revScale = 1;

  // --- Engine character --------------------------------------------------------------------
  if (engine.spoolUpSeconds > 0) {
    state.engineSpool =
      throttle > 0.5
        ? Math.min(1, state.engineSpool + dt / engine.spoolUpSeconds)
        : Math.max(0, state.engineSpool - dt / Math.max(0.05, engine.spoolDownSeconds));
    output *= lerp(engine.spoolFloor, 1, state.engineSpool);
    revScale *= lerp(1, engine.spoolTopEndFactor, state.engineSpool);
  }
  if (engine.cyclePeriodSeconds > 0) {
    state.engineClock = (state.engineClock + dt) % engine.cyclePeriodSeconds;
    const wave = 0.5 + 0.5 * Math.cos((TAU * state.engineClock) / engine.cyclePeriodSeconds);
    output *= lerp(engine.cycleLowFactor, 1, wave);
  }
  if (engine.pulseBurnSeconds > 0) {
    if (state.engineBurst > 0 && throttle > 0.3) {
      state.engineCharge -= dt / engine.pulseBurnSeconds;
      if (state.engineCharge <= 0) {
        state.engineCharge = 0;
        state.engineBurst = 0;
      }
    } else {
      state.engineCharge = Math.min(
        1,
        state.engineCharge + dt / Math.max(0.05, engine.pulseRefillSeconds),
      );
      if (state.engineCharge >= 1) state.engineBurst = 1;
    }
    if (!(state.engineBurst > 0)) output *= engine.pulseRestFactor;
  } else if (engine.burstRechargeSeconds > 0) {
    if (state.engineBurst > 0) {
      state.engineBurst = Math.max(0, state.engineBurst - dt);
      output *= engine.burstFactor;
    } else {
      state.engineCharge = Math.min(1, state.engineCharge + dt / engine.burstRechargeSeconds);
      if (state.engineCharge >= 1 && throttle >= 0.8) {
        state.engineCharge = 0;
        state.engineBurst = engine.burstSeconds;
        output *= engine.burstFactor;
      }
    }
  }

  // --- Power: generation, battery, consumers by priority -------------------------------------
  const power = params.power;
  const generation = power.generation + (throttle < 0.5 ? power.offThrottleGeneration : 0);
  let available = state.batteryEnergy + generation * dt;
  let demand = 0;
  let driveSupply = 1;
  const driveNeed = power.drivetrainDraw * throttle * dt;
  if (driveNeed > 0) {
    demand += driveNeed;
    // An EMP holds an electric drivetrain down to its protected minimum (Section 8.1).
    driveSupply = Math.min(fx.driveSupplyLimit, available / driveNeed);
    available -= driveNeed * driveSupply;
    // The drivetrain is served first and still keeps a protected minimum when starved.
    if (driveSupply < 1) output *= Math.max(DRIVETRAIN_MIN_SUPPLY, driveSupply);
  }
  let cooling = params.heat.cooling;
  let stabilityAdd = 0;
  let slipRecoveryAdd = 0;
  let downforce = 0;
  let gripSupply = 1;
  let auxNeed = 0;
  let auxGot = 0;
  const consumers = power.consumers;
  for (let i = 0; i < consumers.length; i++) {
    const consumer = consumers[i]!;
    const need = consumer.draw * dt;
    const supply = need > 0 ? Math.min(fx.auxLimit, Math.max(0, available) / need) : fx.auxLimit;
    available -= need * supply;
    demand += need;
    auxNeed += need;
    auxGot += need * supply;
    const effect = consumer.effect;
    if (effect.cooling !== undefined) cooling += effect.cooling * supply;
    if (effect.stability !== undefined) stabilityAdd += effect.stability * supply;
    if (effect.slipRecovery !== undefined) slipRecoveryAdd += effect.slipRecovery * supply;
    if (effect.downforce !== undefined) downforce += effect.downforce * supply;
    if (effect.surfaceGrip !== undefined || effect.wetGrip !== undefined)
      gripSupply = Math.min(gripSupply, supply);
  }
  state.batteryEnergy = clamp(available, 0, power.capacity);

  // --- Heat: thermal limit from the heat the core already has, then this step's balance ------
  const heat = params.heat;
  let penalty = 0;
  if (state.thermalLimited) penalty = THERMAL_PENALTY_MAX;
  else if (state.coreHeat > heat.performanceThreshold)
    penalty =
      THERMAL_PENALTY_MAX *
      clamp(
        (state.coreHeat - heat.performanceThreshold) /
          Math.max(1, HEAT_PROTECTION - heat.performanceThreshold),
        0,
        1,
      );
  output *= 1 - penalty;
  // Damage, limp-home and boosts act on what the engine delivers, after its own limits.
  output *= fx.drive;

  const work = heat.idleFraction + (1 - heat.idleFraction) * throttle * output;
  const production =
    heat.enginePerSecond *
      fx.heatFactor *
      work *
      (throttle < PARTIAL_LOAD_THROTTLE ? heat.partialLoadFactor : 1) +
    heat.constantPerSecond;
  const airflow = AIRFLOW_STILL + (1 - AIRFLOW_STILL) * Math.min(1, speed / AIRFLOW_FULL_SPEED);
  const shed =
    cooling *
    COOLING_MULTIPLIER[env.weather] *
    airflow *
    (HEAT_SHED_BASE + state.coreHeat / HEAT_SHED_SCALE);
  state.coreHeat = Math.max(0, state.coreHeat + (production - shed) * dt);
  if (state.coreHeat >= HEAT_PROTECTION) state.thermalLimited = true;
  else if (state.coreHeat < HEAT_RECOVERY) state.thermalLimited = false;

  out.output = output;
  out.revScale = revScale;
  out.gripSupply = gripSupply;
  out.stabilityAdd = stabilityAdd;
  out.slipRecoveryAdd = slipRecoveryAdd;
  out.downforce = downforce;

  telemetry.powerFraction = output;
  telemetry.drivetrainSupply = driveSupply;
  telemetry.auxSupply = auxNeed > 0 ? auxGot / auxNeed : 1;
  telemetry.generation = generation;
  telemetry.powerDemand = demand / dt;
  telemetry.heatProduction = production;
  telemetry.heatCooling = shed;
  telemetry.heatLevel = state.thermalLimited
    ? 3
    : state.coreHeat >= heat.performanceThreshold
      ? 2
      : state.coreHeat >= HEAT_WARNING
        ? 1
        : 0;
  telemetry.lowPower =
    (driveNeed > 0 && driveSupply < fx.driveSupplyLimit) ||
    (fx.auxLimit >= 1 && auxGot < auxNeed - 1e-9);
}

/**
 * Share of handling lost to instability: 0 at or above the chassis threshold, 1 at the
 * bottom of the scale. Powered stabilisers count only as far as they are supplied.
 */
export function instability(params: VehicleParams, stabilityAdd: number): number {
  const score = clamp(params.stability + stabilityAdd, STABILITY_MIN, STABILITY_MAX);
  const span = Math.max(1, params.stabilityThreshold - STABILITY_MIN);
  return clamp((params.stabilityThreshold - score) / span, 0, 1);
}

/**
 * One step of a car driving flat out in a straight line on a single surface: the same
 * powertrain, grip, traction, drag and rolling terms `stepVehicle` uses, without steering or
 * a track. The garage uses it to predict acceleration and top speed for the Speed score, and
 * a test holds it to the full integrator. Returns the new forward speed.
 */
export function stepStraight(
  state: VehicleMotionState,
  speed: number,
  params: VehicleParams,
  env: RaceEnvironment,
  surface: SurfaceId,
  dt: number,
  out: PowertrainOutput,
  telemetry: VehicleTelemetry,
): number {
  stepPowertrain(state, 1, speed, params, env, dt, out, telemetry);
  let gripRaw = rawSurfaceGrip(params, env, surface, false, out.gripSupply);
  if (params.wearRampSeconds > 0) {
    if (speed > 20) state.tireWearSeconds += dt;
    gripRaw *= lerp(
      1,
      params.wornGrip,
      clamp((state.tireWearSeconds - params.wearStartSeconds) / params.wearRampSeconds, 0, 1),
    );
  }
  if (out.downforce > 0) {
    const q = Math.min(1, speed / DOWNFORCE_REF_SPEED);
    gripRaw *= 1 + out.downforce * q * q;
  }
  const grip = Math.min(MAX_COMBINED_GRIP, gripRaw);
  const speedScale = isRoad(surface) ? params.roadSpeedFactor : 1;
  const tractionLimit =
    params.tractionAccel * grip * (isLoose(surface) ? params.looseTractionFactor : 1);
  const drive = Math.min(
    tractionLimit,
    (out.output * driveForceAt(params, speed / (speedScale * out.revScale))) / params.massKg,
  );
  const drag =
    ((params.dragLinear * speed) / speedScale +
      (params.dragQuadratic * speed * speed) / (speedScale * speedScale)) /
    params.massKg;
  let v = speed + (drive - drag) * dt;
  v = Math.max(0, v - rollingDecel(params, surface, false) * dt);
  telemetry.grip = grip;
  return v;
}

export type StepScratch = { loc: TrackLocation; probe: TrackLocation; power: PowertrainOutput };
export function createStepScratch(): StepScratch {
  return { loc: createLocation(), probe: createLocation(), power: createPowertrainOutput() };
}

export function stepVehicle(
  state: VehicleMotionState,
  input: ControlInput,
  params: VehicleParams,
  env: RaceEnvironment,
  track: TrackRuntime,
  dt: number,
  scratch: StepScratch,
  telemetry: VehicleTelemetry,
  effects: VehicleEffects = NEUTRAL_EFFECTS,
): void {
  // --- 1. Filter the commanded steering -------------------------------------------------------
  let steerTarget = input.coast ? 0 : clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1);
  // Damaged steering has less lock, and a damaged wheel pulls the car toward its side.
  if (effects.steerScale !== 1 || effects.steerBias !== 0)
    steerTarget = clamp(steerTarget * effects.steerScale + effects.steerBias, -1, 1);
  const air = effects.airborne;
  // Returning toward centre is a release. Crossing over to the other side is not: it engages at
  // the quicker rate all the way through, so a left-right flick has no kink at the centre.
  const releasing =
    Math.abs(steerTarget) < Math.abs(state.steeringInput) && steerTarget * state.steeringInput >= 0;
  state.steeringInput +=
    (steerTarget - state.steeringInput) *
    expBlend(dt, (releasing ? STEER_RELEASE_TIME : STEER_ENGAGE_TIME) + effects.steerLag);
  if (Math.abs(state.steeringInput) < 1e-4 && steerTarget === 0) state.steeringInput = 0;

  // --- 2. Surface under the car --------------------------------------------------------------
  const loc = scratch.loc;
  locate(track, state.x, state.y, loc);
  const ground = surfaceAt(track, loc);

  // --- 3. Velocity in the car frame -----------------------------------------------------------
  let fx = Math.sin(state.headingRad);
  let fy = -Math.cos(state.headingRad);
  let rx = -fy;
  let ry = fx;
  let vf = state.velocityX * fx + state.velocityY * fy;
  let vl = state.velocityX * rx + state.velocityY * ry;

  // --- 4. Pedals -----------------------------------------------------------------------------
  const pull = input.coast ? 0 : clamp(Number.isFinite(input.brake) ? input.brake : 0, 0, 1);
  const lift =
    pull <= BRAKE_LIFT_THRESHOLD ? 0 : (pull - BRAKE_LIFT_THRESHOLD) / (1 - BRAKE_LIFT_THRESHOLD);
  state.brakeInput = lift;

  if (lift > 0.5 && vf < 8) state.reverseHold += dt;
  else if (lift <= 0.5) state.reverseHold = 0;
  state.reversing = lift > 0.5 && state.reverseHold >= REVERSE_HOLD_SECONDS;

  const slipAngleNow = Math.atan2(Math.abs(vl), Math.max(Math.abs(vf), 12));
  const slipRatioNow = clamp(slipAngleNow / 0.5, 0, 1);
  const assist = lerp(
    1,
    THROTTLE_ASSIST_MIN,
    smoothstep(THROTTLE_ASSIST_SLIP_START, THROTTLE_ASSIST_SLIP_FULL, slipRatioNow),
  );
  let throttle = input.coast ? IDLE_THROTTLE : 1 - smoothstep(0, 0.3, lift);
  throttle *= assist;
  if (state.reversing) throttle = 0;
  state.throttleFraction = throttle;

  // --- 4b. Power, heat and the engine's own state (Section 11.8 steps 2 and 3) ----------------
  const power = scratch.power;
  const speedNow = Math.hypot(vf, vl);
  if (air) throttle = 0;
  stepPowertrain(state, throttle, speedNow, params, env, dt, power, telemetry, effects);

  // --- 4c. Coefficients for this step (Section 11.8 step 4) ---------------------------------
  let gripRaw = rawSurfaceGrip(params, env, ground.surface, ground.onShoulder, power.gripSupply);
  if (params.wearRampSeconds > 0) {
    if (speedNow > 20) state.tireWearSeconds += dt;
    gripRaw *= lerp(
      1,
      params.wornGrip,
      clamp((state.tireWearSeconds - params.wearStartSeconds) / params.wearRampSeconds, 0, 1),
    );
  }
  if (power.downforce > 0) {
    const q = Math.min(1, speedNow / DOWNFORCE_REF_SPEED);
    gripRaw *= 1 + power.downforce * q * q;
  }
  const grip = Math.min(MAX_COMBINED_GRIP, gripRaw) * effects.grip;
  const unstable = instability(params, power.stabilityAdd + effects.stabilityAdd);
  const road = isRoad(ground.surface);
  let speedScale = road ? params.roadSpeedFactor : 1;
  // The tow: the whole speed axis of the engine's force and of the drag is stretched, which
  // raises top speed by exactly that share and leaves grip, brakes and steering alone. It
  // fades in with speed, so it is absent off the line and out of a slow corner, and it follows
  // the throttle, so a car that has lifted or is braking slows exactly as it would without it.
  if (effects.tow > 0)
    speedScale *=
      1 + effects.tow * throttle * smoothstep(TOW.fadeStartSpeed, TOW.fadeFullSpeed, vf);

  // --- 5. Forward speed ----------------------------------------------------------------------
  const tractionLimit =
    params.tractionAccel * grip * (isLoose(ground.surface) ? params.looseTractionFactor : 1);
  const drive = Math.min(
    tractionLimit,
    (throttle * power.output * driveForceAt(params, vf / (speedScale * power.revScale))) /
      params.massKg,
  );
  const drag =
    ((params.dragLinear * vf) / speedScale +
      (params.dragQuadratic * vf * Math.abs(vf)) / (speedScale * speedScale)) /
    params.massKg;
  const rolling = rollingDecel(params, ground.surface, ground.onShoulder) + effects.rollingAdd;
  const vfIn = vf;

  if (air) {
    // Off the ground: nothing drives, brakes or drags the car until it lands.
  } else if (state.reversing) {
    vf = approach(vf, -params.reverseSpeed, REVERSE_ACCEL * grip * dt);
  } else {
    vf += (drive - drag) * dt;
    const resist = rolling + lift * params.brakeDecel * grip;
    // Friction and brakes can stop the car but never push it backwards.
    if (vf > 0) vf = Math.max(0, vf - resist * dt);
    else if (vf < 0)
      vf = Math.min(0, vf + (resist + params.brakeDecel * 0.4 * grip * throttle) * dt);
    // A slow holds the car down to a speed: it sheds the excess quickly and cannot regain it.
    if (vf > effects.speedCap) vf = Math.max(effects.speedCap, vfIn - SLOW_ONSET_DECEL * dt);
  }

  // --- 6. Yaw --------------------------------------------------------------------------------
  // An unstable car has less grip to corner with. The steering request is made against that
  // reduced grip too, so the car runs wide progressively instead of snapping into a slide.
  const cornerGrip = grip * (1 - UNSTABLE_GRIP_LOSS * unstable);
  const lateralLimit =
    params.lateralGripAccel *
    cornerGrip *
    params.peakGripFactor *
    (1 + params.corneringGrip * Math.abs(state.steeringInput));
  const curvature = state.steeringInput * lockCurvature(params, vf, cornerGrip);
  // Self-aligning: the nose is drawn toward the direction of travel in proportion to slip. In
  // reverse the same expression draws the tail toward it.
  const alignSpeed = vf < 0 ? Math.min(vf, -ALIGN_FLOOR_SPEED) : Math.max(vf, ALIGN_FLOOR_SPEED);
  const align =
    params.yawAlign *
    (1 - UNSTABLE_ALIGN_LOSS * unstable) *
    (vl / alignSpeed) *
    smoothstep(8, 48, Math.abs(vf) + Math.abs(vl));
  const yawTarget = vf * curvature + clamp(align, -ALIGN_LIMIT, ALIGN_LIMIT);
  // In the air the car keeps the rotation it left the ground with.
  if (!air) state.yawRate += (yawTarget - state.yawRate) * expBlend(dt, params.yawResponseTime);
  state.headingRad = wrapAngle(state.headingRad + state.yawRate * dt);

  // --- 7. Lateral slip -----------------------------------------------------------------------
  // Rebuild the world velocity from the old frame, then read it in the rotated frame. The
  // lateral component that appears is what the tires must cancel.
  let vx = fx * vf + rx * vl;
  let vy = fy * vf + ry * vl;
  fx = Math.sin(state.headingRad);
  fy = -Math.cos(state.headingRad);
  rx = -fy;
  ry = fx;
  vf = vx * fx + vy * fy;
  vl = vx * rx + vy * ry;

  const wanted = -vl * Math.min(1, params.slipStiffness * dt);
  const maxDv = lateralLimit * dt;
  const demand = Math.abs(wanted) / maxDv;
  const kinetic = Math.min(
    1,
    KINETIC_GRIP_FACTOR *
      params.slipRecovery *
      (1 + power.slipRecoveryAdd) *
      (1 - UNSTABLE_RECOVERY_LOSS * unstable),
  );
  // The tire curve can never deliver more than was asked for, so the car cannot be pushed
  // through zero slip and out the other side.
  const dv = air
    ? 0
    : Math.sign(wanted) * Math.min(Math.abs(wanted), maxDv * tireResponse(demand, kinetic));
  // The tires push across the car, not across its path, so some of their work comes off the
  // car's speed. Within the free-rolling band of slip that loss is given back and cornering
  // costs nothing; past it the loss fades in to its full physical value, which is what slows
  // a slide and ends a drift. Nothing switches on or off.
  const before = Math.hypot(vf, vl);
  vl += dv;
  const after = Math.hypot(vf, vl);
  if (after > 1e-6 && before > after) {
    const slip = Math.atan2(Math.abs(vl), Math.abs(vf));
    const giveBack = 1 - smoothstep(FREE_ROLL_SLIP, SCRUB_FULL_SLIP, slip);
    const scale = (after + (before - after) * giveBack) / after;
    vf *= scale;
    vl *= scale;
  }

  vx = fx * vf + rx * vl;
  vy = fy * vf + ry * vl;

  // --- 8. Integrate position -----------------------------------------------------------------
  state.x += vx * dt;
  state.y += vy * dt;
  state.wallGrace = Math.max(0, state.wallGrace - dt);

  // --- 9. Solid edges and obstacles ----------------------------------------------------------
  telemetry.wallContact = false;
  telemetry.wallImpactSpeed = 0;
  telemetry.wallNormalX = 0;
  telemetry.wallNormalY = 0;

  const probe = scratch.probe;
  const d = params.colliderOffset;
  const r = params.colliderRadius;
  let pushFx = 0;
  let pushFy = 0;
  let pushRx = 0;
  let pushRy = 0;
  let hitNx = 0;
  let hitNy = 0;
  let hits = 0;

  for (let c = 0; c < 2; c++) {
    const sign = c === 0 ? 1 : -1;
    const cx = state.x + fx * d * sign;
    const cy = state.y + fy * d * sign;
    let px = 0;
    let py = 0;
    locate(track, cx, cy, probe);
    const depth = probe.edge + r;
    if (depth > 0) {
      let nx = cx - probe.cx;
      let ny = cy - probe.cy;
      const len = Math.hypot(nx, ny);
      if (len > 1e-6) {
        nx /= len;
        ny /= len;
        px -= nx * depth;
        py -= ny * depth;
        hitNx += nx;
        hitNy += ny;
        hits++;
      }
    }
    // Obstacles are solid circles inside the corridor.
    const gc = Math.floor(cx / 96);
    const gr = Math.floor(cy / 96);
    if (!air && gc >= 0 && gr >= 0 && gc < track.gridCols && gr < track.gridRows) {
      const bucket = track.obstacleGrid[gr * track.gridCols + gc]!;
      for (let k = 0; k < bucket.length; k++) {
        const ob = track.obstacles[bucket[k]!]!;
        let ox = ob.x - cx;
        let oy = ob.y - cy;
        const dist = Math.hypot(ox, oy);
        const overlap = ob.radius + r - dist;
        if (overlap > 0 && dist > 1e-6) {
          ox /= dist;
          oy /= dist;
          px -= ox * overlap;
          py -= oy * overlap;
          hitNx += ox;
          hitNy += oy;
          hits++;
        }
      }
    }
    if (c === 0) {
      pushFx = px;
      pushFy = py;
    } else {
      pushRx = px;
      pushRy = py;
    }
  }

  if (hits > 0) {
    state.x += (pushFx + pushRx) / 2;
    state.y += (pushFy + pushRy) / 2;
    // A push on one end of the body turns the car along the wall instead of pinning it.
    const twist = ((pushFx - pushRx) * rx + (pushFy - pushRy) * ry) / (2 * d);
    state.headingRad = wrapAngle(state.headingRad + clamp(twist * 0.7, -0.14, 0.14));

    const nLen = Math.hypot(hitNx, hitNy) || 1;
    const nx = hitNx / nLen;
    const ny = hitNy / nLen;
    const closing = vx * nx + vy * ny;
    telemetry.wallContact = true;
    telemetry.wallNormalX = nx;
    telemetry.wallNormalY = ny;
    if (closing > 0) {
      const bounce = Math.min(0.6, WALL_RESTITUTION * params.obstacleImpulse);
      vx -= (1 + bounce) * closing * nx;
      vy -= (1 + bounce) * closing * ny;
      let tangent = vx * -ny + vy * nx;
      const along = Math.abs(tangent);
      if (closing > WALL_FORGIVE_SPEED && state.wallGrace <= 0) {
        const severity = clamp(
          (closing - WALL_FORGIVE_SPEED) / (WALL_SCRAPE_FULL_SPEED - WALL_FORGIVE_SPEED),
          0,
          1,
        );
        tangent *=
          1 -
          Math.min(
            0.5,
            lerp(WALL_SCRAPE_LOSS_MIN, WALL_SCRAPE_LOSS_MAX, severity) * params.obstacleImpulse,
          );
        state.wallGrace = WALL_GRACE_SECONDS;
        telemetry.wallImpactSpeed = closing;
      } else {
        tangent = Math.sign(tangent) * Math.max(0, along - WALL_FRICTION_DECEL * dt);
      }
      const normalPart = vx * nx + vy * ny;
      vx = nx * normalPart + -ny * tangent;
      vy = ny * normalPart + nx * tangent;
      state.yawRate *= 0.8;
    }
  }

  state.velocityX = vx;
  state.velocityY = vy;

  // --- 10. Observations ----------------------------------------------------------------------
  fx = Math.sin(state.headingRad);
  fy = -Math.cos(state.headingRad);
  const outF = vx * fx + vy * fy;
  const outL = vx * -fy + vy * fx;
  telemetry.speed = Math.hypot(vx, vy);
  telemetry.forwardSpeed = outF;
  telemetry.lateralSpeed = outL;
  telemetry.slipAngle = telemetry.speed > 14 ? Math.atan2(outL, Math.max(Math.abs(outF), 12)) : 0;
  telemetry.slipRatio = clamp(Math.abs(telemetry.slipAngle) / 0.5, 0, 1);
  telemetry.surface = ground.surface;
  telemetry.onShoulder = ground.onShoulder;
  telemetry.grip = grip;
  telemetry.rpm = clamp(Math.abs(outF) / params.forceZeroSpeed + throttle * 0.25, 0, 1);
}
