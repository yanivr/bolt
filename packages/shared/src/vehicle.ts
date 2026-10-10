import {
  BRAKE_DECEL,
  DRAG_LINEAR,
  DRAG_QUADRATIC,
  FORCE_PER_INDEX,
  FORCE_TAPER_START,
  FORCE_ZERO_FACTOR,
  LATERAL_GRIP_ACCEL,
  LAUNCH_FADE_SPEED,
  MAX_STEER_CURVATURE,
  NOMINAL_TOP_SPEED,
  REVERSE_SPEED,
  SLIP_STIFFNESS,
  STEER_GRIP_DEMAND,
  TRACTION_ACCEL,
  YAW_ALIGN_GAIN,
  YAW_RESPONSE_TIME,
} from './balance.js';
import type {
  ChassisDefinition,
  EngineDefinition,
  TireDefinition,
  VehicleParams,
} from './types.js';

/** A wheel kit is priced and weighed for four wheels and scaled to the chassis (Section 6.3). */
export function wheelKitPrice(tires: TireDefinition, wheelCount: number): number {
  return Math.round((tires.price * wheelCount) / 4);
}
export function wheelKitMass(tires: TireDefinition, wheelCount: number): number {
  return (tires.massKg * wheelCount) / 4;
}

/**
 * Derives the integrator coefficients from the three mandatory parts. Extra modules, damage
 * and status effects layer on top of this in later milestones.
 */
export function deriveVehicleParams(
  chassis: ChassisDefinition,
  engine: EngineDefinition,
  tires: TireDefinition,
  extraMassKg = 0,
): VehicleParams {
  const massKg =
    chassis.massKg + engine.massKg + wheelKitMass(tires, chassis.wheelCount) + extraMassKg;
  const reach = chassis.bodyHalfLength - chassis.bodyHalfWidth;
  return {
    massKg,
    driveForce: engine.forceIndex * FORCE_PER_INDEX,
    launchBoost: engine.launchBoost,
    launchFadeSpeed: LAUNCH_FADE_SPEED,
    forceTaperSpeed: NOMINAL_TOP_SPEED * FORCE_TAPER_START * engine.topEndFactor,
    forceZeroSpeed: NOMINAL_TOP_SPEED * FORCE_ZERO_FACTOR * engine.topEndFactor,
    dragLinear: DRAG_LINEAR * chassis.dragFactor,
    dragQuadratic: DRAG_QUADRATIC * chassis.dragFactor,
    brakeDecel: BRAKE_DECEL,
    lateralGripAccel: LATERAL_GRIP_ACCEL,
    tractionAccel: TRACTION_ACCEL,
    tireGrip: tires.grip,
    tireSurfaceGrip: tires.surfaceGrip,
    tireWetGripFactor: tires.wetGripFactor,
    maxSteerCurvature: MAX_STEER_CURVATURE * chassis.yawFactor,
    steerGripDemand: STEER_GRIP_DEMAND,
    yawResponseTime: YAW_RESPONSE_TIME / chassis.yawFactor,
    yawAlign: YAW_ALIGN_GAIN,
    slipStiffness: SLIP_STIFFNESS,
    slipRecovery: tires.slipRecoveryFactor,
    reverseSpeed: REVERSE_SPEED,
    colliderOffset: Math.max(4, reach),
    colliderRadius: chassis.bodyHalfWidth,
  };
}
