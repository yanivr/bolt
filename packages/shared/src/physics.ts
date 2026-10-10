import {
  BRAKE_LIFT_THRESHOLD,
  IDLE_THROTTLE,
  KINETIC_GRIP_FACTOR,
  MAX_COMBINED_GRIP,
  REVERSE_ACCEL,
  REVERSE_HOLD_SECONDS,
  SHOULDER_GRIP_FACTOR,
  SHOULDER_ROLLING_DECEL,
  STEER_ENGAGE_TIME,
  STEER_OVERDRIVE,
  STEER_RELEASE_TIME,
  SURFACE_GRIP,
  SURFACE_ROLLING_DECEL,
  THROTTLE_ASSIST_MIN,
  THROTTLE_ASSIST_SLIP_FULL,
  THROTTLE_ASSIST_SLIP_START,
  WALL_FORGIVE_SPEED,
  WALL_FRICTION_DECEL,
  WALL_GRACE_SECONDS,
  WALL_RESTITUTION,
  WALL_SCRAPE_FULL_SPEED,
  WALL_SCRAPE_LOSS_MAX,
  WALL_SCRAPE_LOSS_MIN,
  WET_WEATHER,
} from './balance.js';
import { approach, clamp, expBlend, lerp, smoothstep, wrapAngle } from './math.js';
import type { TrackLocation, TrackRuntime } from './track.js';
import { createLocation, locate, surfaceAt } from './track.js';
import type {
  RaceEnvironment,
  SurfaceId,
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

export type ControlInput = {
  /** -1 full left to 1 full right. */
  steer: number;
  /** 0 to 1 joystick pull-back. Past the lift threshold the throttle releases and brakes apply. */
  brake: number;
  /** True when nobody is touching the controls: gentle throttle, wheels straight. */
  coast: boolean;
};

export const NEUTRAL_INPUT: ControlInput = Object.freeze({ steer: 0, brake: 0, coast: true });

export function createMotionState(x: number, y: number, headingRad: number): VehicleMotionState {
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
  };
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
}

/** Combined grip for a surface under the published conditions, capped per Section 9.2. */
export function surfaceGrip(
  params: VehicleParams,
  env: RaceEnvironment,
  surface: SurfaceId,
  onShoulder: boolean,
): number {
  let grip =
    SURFACE_GRIP[env.weather][surface] * params.tireGrip * (params.tireSurfaceGrip[surface] ?? 1);
  if (WET_WEATHER[env.weather]) grip *= params.tireWetGripFactor;
  if (onShoulder) grip *= SHOULDER_GRIP_FACTOR;
  return Math.min(MAX_COMBINED_GRIP, grip);
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

export type StepScratch = { loc: TrackLocation; probe: TrackLocation };
export function createStepScratch(): StepScratch {
  return { loc: createLocation(), probe: createLocation() };
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
): void {
  // --- 1. Filter the commanded steering -------------------------------------------------------
  const steerTarget = input.coast
    ? 0
    : clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1);
  const releasing =
    Math.abs(steerTarget) < Math.abs(state.steeringInput) || steerTarget * state.steeringInput < 0;
  state.steeringInput +=
    (steerTarget - state.steeringInput) *
    expBlend(dt, releasing ? STEER_RELEASE_TIME : STEER_ENGAGE_TIME);
  if (Math.abs(state.steeringInput) < 1e-4 && steerTarget === 0) state.steeringInput = 0;

  // --- 2. Surface under the car --------------------------------------------------------------
  const loc = scratch.loc;
  locate(track, state.x, state.y, loc);
  const ground = surfaceAt(track, loc);
  const grip = surfaceGrip(params, env, ground.surface, ground.onShoulder);

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

  // --- 5. Forward speed ----------------------------------------------------------------------
  const tractionLimit = params.tractionAccel * grip;
  const drive = Math.min(tractionLimit, (throttle * driveForceAt(params, vf)) / params.massKg);
  const drag = (params.dragLinear * vf + params.dragQuadratic * vf * Math.abs(vf)) / params.massKg;
  const rolling = ground.onShoulder
    ? Math.max(SHOULDER_ROLLING_DECEL, SURFACE_ROLLING_DECEL[ground.surface])
    : SURFACE_ROLLING_DECEL[ground.surface];

  if (state.reversing) {
    vf = approach(vf, -params.reverseSpeed, REVERSE_ACCEL * grip * dt);
  } else {
    vf += (drive - drag) * dt;
    const resist = rolling + lift * params.brakeDecel * grip;
    // Friction and brakes can stop the car but never push it backwards.
    if (vf > 0) vf = Math.max(0, vf - resist * dt);
    else if (vf < 0)
      vf = Math.min(0, vf + (resist + params.brakeDecel * 0.4 * grip * throttle) * dt);
  }

  // --- 6. Yaw --------------------------------------------------------------------------------
  const lateralLimit = params.lateralGripAccel * grip;
  const speedRatio = Math.abs(vf) / params.steerHalfSpeed;
  let curvature = (state.steeringInput * params.maxSteerCurvature) / (1 + speedRatio * speedRatio);
  // Steering assist: never ask for much more lateral acceleration than the tires can give.
  const curvatureCap = (lateralLimit * STEER_OVERDRIVE) / Math.max(vf * vf, 400);
  curvature = clamp(curvature, -curvatureCap, curvatureCap);
  const yawTarget = vf * curvature;
  state.yawRate += (yawTarget - state.yawRate) * expBlend(dt, params.yawResponseTime);
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
  let sliding = false;
  let dv = wanted;
  if (Math.abs(wanted) > maxDv) {
    sliding = true;
    dv = Math.sign(wanted) * maxDv * KINETIC_GRIP_FACTOR * params.slipRecovery;
  }
  vl += dv;
  if (sliding) {
    // Scrubbing tires bleed a little forward speed, which is what ends a drift.
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), Math.abs(dv) * 0.16);
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
    if (gc >= 0 && gr >= 0 && gc < track.gridCols && gr < track.gridRows) {
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
      vx -= (1 + WALL_RESTITUTION) * closing * nx;
      vy -= (1 + WALL_RESTITUTION) * closing * ny;
      let tangent = vx * -ny + vy * nx;
      const along = Math.abs(tangent);
      if (closing > WALL_FORGIVE_SPEED && state.wallGrace <= 0) {
        const severity = clamp(
          (closing - WALL_FORGIVE_SPEED) / (WALL_SCRAPE_FULL_SPEED - WALL_FORGIVE_SPEED),
          0,
          1,
        );
        tangent *= 1 - lerp(WALL_SCRAPE_LOSS_MIN, WALL_SCRAPE_LOSS_MAX, severity);
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
