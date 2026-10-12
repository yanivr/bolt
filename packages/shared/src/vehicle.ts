import {
  BASE_BATTERY,
  BASE_COOLING,
  BASE_GENERATION,
  BRAKE_DECEL,
  BRAKE_MASS_EXPONENT,
  BRAKE_MASS_MAX,
  BRAKE_MASS_MIN,
  DRAG_LINEAR,
  DRAG_QUADRATIC,
  ENGINE_IDLE_HEAT,
  FORCE_PER_INDEX,
  FORCE_TAPER_START,
  FORCE_ZERO_FACTOR,
  HEAT_PERFORMANCE,
  LATERAL_GRIP_ACCEL,
  MAX_STEER_CURVATURE,
  NOMINAL_TOP_SPEED,
  OVERLOAD_BRAKE_LOSS,
  OVERLOAD_FORCE_LOSS,
  OVERLOAD_HEAT_GAIN,
  REFERENCE_MASS_KG,
  REVERSE_SPEED,
  SLIP_STIFFNESS,
  SOLAR_TIME,
  SOLAR_WEATHER,
  STABILITY_HEIGHT_MAX,
  STABILITY_HEIGHT_WEIGHT,
  STABILITY_LATERAL_MAX,
  STABILITY_LATERAL_WEIGHT,
  STABILITY_LONGITUDINAL_FREE,
  STABILITY_LONGITUDINAL_MAX,
  STABILITY_LONGITUDINAL_WEIGHT,
  STABILITY_MAX,
  STABILITY_MIN,
  STABILITY_REF_TRACK,
  STABILITY_REF_WHEELBASE,
  STABILITY_TIRE_WEIGHT,
  STABILITY_TRACK_WEIGHT,
  STABILITY_WHEELBASE_WEIGHT,
  STABILITY_YAW_WEIGHT,
  STEER_GRIP_DEMAND,
  TRACTION_ACCEL,
  YAW_ALIGN_GAIN,
  YAW_RESPONSE_TIME,
} from './balance.js';
import type { ResolvedBuild } from './blueprint.js';
import { engineMount, wheelKitMass } from './blueprint.js';
import { clamp } from './math.js';
import type { PassiveTotals } from './modifiers.js';
import { aggregateModifiers } from './modifiers.js';
import { SURFACE_IDS } from './types.js';
import type { BuildConditions, SurfaceId, VehicleParams } from './types.js';

/** Conditions assumed when none are published: a clear day on asphalt. */
export const DEFAULT_CONDITIONS: BuildConditions = Object.freeze({
  weather: 'clear',
  timeOfDay: 'day',
});

export type MassBreakdown = {
  totalKg: number;
  /** Installed mass that counts against the chassis limits (everything but the chassis). */
  loadKg: number;
  recommendedKg: number;
  maxKg: number;
  /** 0 at or below the recommended load, 1 at the maximum safe load. */
  overload: number;
  /** Centre of mass in chassis-local pixels. */
  comX: number;
  comY: number;
};

export type StabilityBreakdown = {
  /** Final score, 10 to 100, with every stabiliser powered. */
  score: number;
  /** Score before clamping and before powered stabilisers. */
  raw: number;
  /** Points that depend on electrical supply (Gyro Stabilizer, Active Wing). */
  powered: number;
  lateralWeightPenalty: number;
  highCenterPenalty: number;
  wheelbasePenalty: number;
  longitudinalPenalty: number;
  damagePenalty: number;
  stabilizationBonus: number;
  wheelbase: number;
  trackWidth: number;
  threshold: number;
};

/**
 * Mass, load and the real centre of mass. The chassis' own mass sits at the body centre, the
 * engine at the engine mount, each wheel at its anchor, and every part where it is mounted,
 * offset included.
 */
export function computeMass(
  build: ResolvedBuild,
  totals = aggregateModifiers(build),
): MassBreakdown {
  const { chassis, engine, tires } = build;
  const bay = engineMount(chassis);
  let mx = 0;
  let my = 0;
  let m = chassis.massKg;
  m += engine.massKg;
  mx += engine.massKg * (bay?.x ?? 0);
  my += engine.massKg * (bay?.y ?? 0);
  const perWheel = wheelKitMass(tires, chassis.wheelCount) / chassis.wheelAnchors.length;
  for (const wheel of chassis.wheelAnchors) {
    m += perWheel;
    mx += perWheel * wheel.x;
    my += perWheel * wheel.y;
  }
  for (const part of build.parts) {
    m += part.def.massKg;
    mx += part.def.massKg * part.x;
    my += part.def.massKg * part.y;
  }
  // The modifier total is the mass of record; positions above only locate it.
  const totalKg = totals.massKg;
  const loadKg = totalKg - chassis.massKg;
  const span = chassis.maxLoadKg - chassis.recommendedLoadKg;
  return {
    totalKg,
    loadKg,
    recommendedKg: chassis.recommendedLoadKg,
    maxKg: chassis.maxLoadKg,
    overload: span > 0 ? clamp((loadKg - chassis.recommendedLoadKg) / span, 0, 1) : 0,
    comX: m > 0 ? mx / m : 0,
    comY: m > 0 ? my / m : 0,
  };
}

/**
 * Section 6.5: `100 - lateralWeightPenalty - highCenterPenalty - wheelbasePenalty -
 * damagePenalty + stabilizationBonus`, clamped to 10 to 100. Every divisor is bounded away
 * from zero. `wheelIntegrity`, when given, supplies the damage penalty during a race.
 */
export function computeStability(
  build: ResolvedBuild,
  totals = aggregateModifiers(build),
  mass = computeMass(build, totals),
  wheelIntegrity?: readonly number[],
): StabilityBreakdown {
  const { chassis, tires } = build;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const wheel of chassis.wheelAnchors) {
    minX = Math.min(minX, wheel.x);
    maxX = Math.max(maxX, wheel.x);
    minY = Math.min(minY, wheel.y);
    maxY = Math.max(maxY, wheel.y);
  }
  const trackWidth = Math.max(1, maxX - minX);
  const wheelbase = Math.max(1, maxY - minY);
  const axleMidY = (minY + maxY) / 2;
  const axleMidX = (minX + maxX) / 2;

  const lateralWeightPenalty = Math.min(
    STABILITY_LATERAL_MAX,
    (STABILITY_LATERAL_WEIGHT * Math.abs(mass.comX - axleMidX)) / (trackWidth / 2),
  );
  const fore = Math.abs(mass.comY - axleMidY) / (wheelbase / 2);
  const longitudinalPenalty = Math.min(
    STABILITY_LONGITUDINAL_MAX,
    STABILITY_LONGITUDINAL_WEIGHT * Math.max(0, fore - STABILITY_LONGITUDINAL_FREE),
  );
  const geometry =
    STABILITY_WHEELBASE_WEIGHT * Math.max(0, 1 - wheelbase / STABILITY_REF_WHEELBASE) +
    STABILITY_TRACK_WEIGHT * Math.max(0, 1 - trackWidth / STABILITY_REF_TRACK);
  const wheelbasePenalty = geometry + longitudinalPenalty;

  // Tall attachments, and roof mounts, carry their mass high. Ride height raises everything.
  let heightMoment = 0;
  for (const part of build.parts) {
    const onRoof = part.mount.categories[0] === 'ROOF' ? 0.5 : 0;
    heightMoment += part.def.massKg * (part.def.heightLevel * 0.5 + onRoof);
  }
  const rideHeight = typeof tires.params?.rideHeight === 'number' ? tires.params.rideHeight : 0;
  const highCenterPenalty = Math.min(
    STABILITY_HEIGHT_MAX,
    (STABILITY_HEIGHT_WEIGHT * heightMoment) / Math.max(1, mass.totalKg) + rideHeight,
  );

  let damagePenalty = 0;
  if (wheelIntegrity && wheelIntegrity.length > 0) {
    let lost = 0;
    for (const value of wheelIntegrity) lost += 1 - clamp(value / 100, 0, 1);
    damagePenalty = (25 * lost) / wheelIntegrity.length;
  }

  let powered = 0;
  for (const consumer of totals.consumers) powered += consumer.effect.stability ?? 0;
  const stabilizationBonus =
    totals.steering.stability +
    STABILITY_TIRE_WEIGHT * (tires.grip - 1) +
    STABILITY_YAW_WEIGHT * (1 - totals.steering.yaw);

  const raw =
    100 -
    lateralWeightPenalty -
    highCenterPenalty -
    wheelbasePenalty -
    damagePenalty +
    stabilizationBonus;
  return {
    score: Math.round(clamp(raw + powered, STABILITY_MIN, STABILITY_MAX)),
    raw,
    powered,
    lateralWeightPenalty,
    highCenterPenalty,
    wheelbasePenalty,
    longitudinalPenalty,
    damagePenalty,
    stabilizationBonus,
    wheelbase,
    trackWidth,
    threshold: chassis.stabilityThreshold,
  };
}

function sparse(
  table: Record<SurfaceId, number>,
  neutral: number,
): Partial<Record<SurfaceId, number>> {
  const out: Partial<Record<SurfaceId, number>> = {};
  for (const surface of SURFACE_IDS) if (table[surface] !== neutral) out[surface] = table[surface];
  return out;
}

/** Grip multiplier shared by every surface, with the per-surface remainder split out. */
function splitGrip(table: Record<SurfaceId, number>): {
  common: number;
  rest: Partial<Record<SurfaceId, number>>;
} {
  let common = Infinity;
  for (const surface of SURFACE_IDS) common = Math.min(common, table[surface]);
  if (!(common > 0)) return { common: 1, rest: sparse(table, 1) };
  const rest: Partial<Record<SurfaceId, number>> = {};
  for (const surface of SURFACE_IDS) {
    const ratio = table[surface] / common;
    if (Math.abs(ratio - 1) > 1e-12) rest[surface] = ratio;
  }
  return { common, rest };
}

/**
 * Derives every integrator coefficient from a resolved blueprint and the published
 * conditions. Section 11.8 step 4: chassis, engine, tires, mass, load and environment in,
 * physical coefficients out. Damage and status effects layer on top in Milestone C.
 */
export function deriveVehicleParams(
  build: ResolvedBuild,
  conditions: BuildConditions = DEFAULT_CONDITIONS,
  totals: PassiveTotals = aggregateModifiers(build),
): VehicleParams {
  const { chassis } = build;
  const mass = computeMass(build, totals);
  const stability = computeStability(build, totals, mass);
  const curve = totals.curve;
  const steering = totals.steering;
  const topSpeed = steering.topSpeed;
  const topEnd = curve.topEndFactor * topSpeed;

  const outerWheel = chassis.wheelAnchors.reduce((m, w) => Math.max(m, Math.abs(w.x)), 0);
  const colliderRadius = Math.max(chassis.bodyHalfWidth, outerWheel) * steering.width;
  const reach = chassis.bodyHalfLength - colliderRadius;

  const grip = splitGrip(totals.grip);
  const wet = splitGrip(totals.gripWet);
  const brakeMass = clamp(
    Math.pow(REFERENCE_MASS_KG / Math.max(1, mass.totalKg), BRAKE_MASS_EXPONENT),
    BRAKE_MASS_MIN,
    BRAKE_MASS_MAX,
  );

  const consumers = totals.consumers.filter((c) => !c.drivetrain);
  const drivetrainDraw = totals.consumers
    .filter((c) => c.drivetrain)
    .reduce((sum, c) => sum + c.draw, 0);
  const solar =
    totals.generation.solar * SOLAR_TIME[conditions.timeOfDay] * SOLAR_WEATHER[conditions.weather];

  return {
    massKg: mass.totalKg,
    driveForce: curve.forceIndex * FORCE_PER_INDEX * (1 - OVERLOAD_FORCE_LOSS * mass.overload),
    launchBoost: curve.launchBoost,
    launchFadeSpeed: curve.launchFadeSpeed,
    forceTaperSpeed: NOMINAL_TOP_SPEED * FORCE_TAPER_START * topEnd * curve.taperStartFactor,
    forceZeroSpeed: NOMINAL_TOP_SPEED * FORCE_ZERO_FACTOR * topEnd,
    // A top-speed modifier moves the whole force-against-drag balance, not just the rev limit.
    dragLinear: (DRAG_LINEAR * totals.drag) / topSpeed,
    dragQuadratic: (DRAG_QUADRATIC * totals.drag) / (topSpeed * topSpeed),
    brakeDecel:
      BRAKE_DECEL * steering.braking * brakeMass * (1 - OVERLOAD_BRAKE_LOSS * mass.overload),
    lateralGripAccel: LATERAL_GRIP_ACCEL,
    tractionAccel: TRACTION_ACCEL * curve.tractionFactor,
    tireGrip: grip.common,
    tireSurfaceGrip: grip.rest,
    tireWetGripFactor: wet.common,
    maxSteerCurvature: (MAX_STEER_CURVATURE * steering.yaw) / steering.turnRadius,
    steerGripDemand: STEER_GRIP_DEMAND,
    yawResponseTime: YAW_RESPONSE_TIME / steering.yaw,
    yawAlign: YAW_ALIGN_GAIN * totals.slip.align,
    slipStiffness: SLIP_STIFFNESS * totals.slip.stiffness,
    slipRecovery: totals.slip.factor,
    reverseSpeed: REVERSE_SPEED,
    colliderOffset: Math.max(4, reach),
    colliderRadius,

    wheelCount: chassis.wheelCount,
    tireDryGrip: sparse(totals.gripDry, 1),
    tireWetSurfaceGrip: wet.rest,
    peakGripFactor: steering.peakGrip,
    corneringGrip: steering.corneringGrip,
    shoulderPenalty: steering.shoulderPenalty,
    roadSpeedFactor: steering.roadSpeed * curve.roadSpeedFactor,
    looseRollingFactor: curve.looseRollingFactor,
    looseTractionFactor: curve.looseTractionFactor,
    rollingAdd: sparse(steering.rollingAdd, 0),
    rollingFactor: sparse(steering.rollingFactor, 1),
    obstacleImpulse: totals.impulse.obstacle,
    magneticTires: typeof build.tires.params?.metalGripFactor === 'number',
    wearStartSeconds: steering.wearStartSeconds,
    wearRampSeconds: steering.wearRampSeconds,
    wornGrip: steering.wornGrip,
    engine: {
      spoolUpSeconds: curve.spoolUpSeconds,
      spoolDownSeconds: curve.spoolDownSeconds,
      spoolFloor: curve.spoolFloor,
      spoolTopEndFactor: curve.spoolTopEndFactor,
      cyclePeriodSeconds: curve.cyclePeriodSeconds,
      cycleLowFactor: curve.cycleLowFactor,
      pulseBurnSeconds: curve.pulseBurnSeconds,
      pulseRefillSeconds: curve.pulseRefillSeconds,
      pulseRestFactor: curve.pulseRestFactor,
      burstRechargeSeconds: curve.burstRechargeSeconds,
      burstSeconds: curve.burstSeconds,
      burstFactor: curve.burstFactor,
    },
    heat: {
      enginePerSecond:
        totals.heat.engine * totals.heat.factor * (1 + OVERLOAD_HEAT_GAIN * mass.overload),
      idleFraction: totals.heat.idleFraction ?? ENGINE_IDLE_HEAT,
      partialLoadFactor: totals.heat.partialLoadFactor,
      constantPerSecond: totals.heat.constant,
      cooling: BASE_COOLING + totals.cooling,
      performanceThreshold: HEAT_PERFORMANCE + totals.heat.toleranceOffset,
    },
    power: {
      generation: BASE_GENERATION + totals.generation.always + solar,
      offThrottleGeneration: totals.generation.offThrottle,
      capacity: BASE_BATTERY + totals.capacity,
      drivetrainDraw,
      consumers: consumers.map((c) => ({ draw: c.draw, priority: c.priority, effect: c.effect })),
    },
    stability: stability.raw,
    stabilityThreshold: stability.threshold,
  };
}
