import {
  BRAKE_LIFT_THRESHOLD,
  CORNER_ASSIST_ANGLE_FULL,
  CORNER_ASSIST_ANGLE_START,
  CORNER_ASSIST_MAX,
  CORNER_ASSIST_SPEED_HIGH,
  CORNER_ASSIST_SPEED_LOW,
  DIRECTION_BRAKE_FULL,
  DIRECTION_BRAKE_START,
  DIRECTION_FULL_AUTHORITY,
  DIRECTION_REVERSE_EXIT,
  DIRECTION_REVERSE_SPEED,
  DIRECTION_STEER_FADE_END,
  DIRECTION_STOP_FULL,
  DIRECTION_STOP_START,
  DIRECTION_TURN_SPEED_HIGH,
  DIRECTION_TURN_SPEED_LOW,
  HEADING_DAMPING,
  HEADING_GAIN,
  HEADING_MIN_YAW_GAIN,
  JOYSTICK_CURVE,
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_RADIUS_PX,
  JOYSTICK_TRAIL_RADII,
} from './balance.js';
import { angleDelta, clamp, smoothstep, wrapAngle } from './math.js';
import type { ControlInput } from './physics.js';
import { steerYawGain } from './physics.js';
import type { VehicleMotionState, VehicleParams } from './types.js';

/**
 * Control mapping, kept pure so the same maths is unit tested and shared by touch, mouse drag,
 * keyboard, the bots and any future input device. Everything here produces the one normalized
 * `ControlInput` the simulation consumes, so the server never needs to know which scheme a
 * player used.
 */

/** Soft dead zone followed by the response curve `sign(u) * |u|^1.25`. */
export function shapeAxis(raw: number): number {
  const u = clamp(raw, -1, 1);
  const magnitude = Math.abs(u);
  if (magnitude <= JOYSTICK_DEAD_ZONE) return 0;
  const rescaled = (magnitude - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE);
  return Math.sign(u) * Math.pow(rescaled, JOYSTICK_CURVE);
}

/**
 * Wheel steering: converts a thumb displacement in CSS pixels, measured from where the finger
 * first touched, into a control sample relative to the car. Positive dx steers the car to its
 * own right; positive dy (pulling down the screen) lifts the throttle and brakes.
 */
export function joystickToControl(
  dxPx: number,
  dyPx: number,
  radiusPx = JOYSTICK_RADIUS_PX,
): ControlInput {
  const steer = shapeAxis(dxPx / radiusPx);
  const down = clamp(dyPx / radiusPx, 0, 1);
  return { steer, brake: down, coast: false };
}

/** Keyboard state to the same normalized schema, so desktop and touch converge. */
export function keysToControl(
  left: boolean,
  right: boolean,
  brake: boolean,
  anyHeld: boolean,
): ControlInput {
  const steer = (right ? 1 : 0) - (left ? 1 : 0);
  return { steer, brake: brake ? 1 : 0, coast: !anyHeld };
}

/** Clamped visual offset of the thumb nub so it never leaves the disc. */
export function clampToDisc(
  dxPx: number,
  dyPx: number,
  radiusPx = JOYSTICK_RADIUS_PX,
): { x: number; y: number } {
  const len = Math.hypot(dxPx, dyPx);
  if (len <= radiusPx || len === 0) return { x: dxPx, y: dyPx };
  return { x: (dxPx / len) * radiusPx, y: (dyPx / len) * radiusPx };
}

/**
 * Direction steering. The stick points where the car should go on screen; the world is drawn
 * north-up, so screen directions are world directions. `stickX` and `stickY` are the thumb
 * displacement divided by the stick radius (x right, y down) and may exceed 1.
 *
 * The controller reads only the car's own simulated state, so the client can compute it for
 * the tick it is about to predict and send the result as an ordinary sample. The server and
 * every replay then consume identical numbers.
 *
 * - Inside the dead zone: full throttle, wheels straight (holding a finger down means go).
 * - Pointing ahead or to a side: steer toward that heading with a damped controller, so the
 *   nose arrives on it without swinging past.
 * - Pointing to the rear quarter: trail the brake into the turn, harder the faster the car is
 *   going and the further the stick is pushed, and keep turning toward that side.
 * - Pointing roughly straight behind: brake in a straight line to a stop; held at a standstill
 *   it reverses.
 * - While reversing, the tail follows the stick until the stick comes round to the front.
 */
export function directionToControl(
  stickX: number,
  stickY: number,
  motion: VehicleMotionState,
  params: VehicleParams,
  grip: number,
): ControlInput {
  const magnitude = Math.hypot(stickX, stickY);
  if (!(magnitude > JOYSTICK_DEAD_ZONE)) return { steer: 0, brake: 0, coast: false };
  const authority = smoothstep(JOYSTICK_DEAD_ZONE, DIRECTION_FULL_AUTHORITY, magnitude);
  const wanted = Math.atan2(stickX, -stickY);
  const error = angleDelta(motion.headingRad, wanted);
  const away = Math.abs(error);

  const fx = Math.sin(motion.headingRad);
  const fy = -Math.cos(motion.headingRad);
  const forward = motion.velocityX * fx + motion.velocityY * fy;
  const speed = Math.hypot(motion.velocityX, motion.velocityY);

  const backing = motion.reversing || forward < -4;
  if (backing && away > DIRECTION_REVERSE_EXIT) {
    // Swing the tail onto the stick. In reverse the yaw gain is negative, which turns the
    // wheels the right way without a special case.
    const tailError = angleDelta(wrapAngle(motion.headingRad + Math.PI), wanted);
    const gain = Math.min(steerYawGain(params, forward, grip), -HEADING_MIN_YAW_GAIN);
    const steer =
      clamp((HEADING_GAIN * (tailError - HEADING_DAMPING * motion.yawRate)) / gain, -1, 1) *
      authority;
    return { steer, brake: 1, coast: false };
  }

  const gain = Math.max(steerYawGain(params, Math.max(forward, 0), grip), HEADING_MIN_YAW_GAIN);
  const fade = 1 - smoothstep(DIRECTION_STOP_FULL, DIRECTION_STEER_FADE_END, away);
  const steer =
    clamp((HEADING_GAIN * (error - HEADING_DAMPING * motion.yawRate)) / gain, -1, 1) *
    authority *
    fade;

  // Corner assist (Section 7.4): asking for a big change of direction at speed eases the
  // throttle and leans on the brake, so the car slows to a pace at which it can make the turn
  // that was asked for. It acts only on the driver's own request and never steers.
  // Cornering speed goes with the square root of grip, so the assist starts earlier in the wet.
  const pace = Math.sqrt(clamp(grip, 0.2, 1.2));
  let amount =
    CORNER_ASSIST_MAX *
    smoothstep(CORNER_ASSIST_ANGLE_START, CORNER_ASSIST_ANGLE_FULL, away) *
    smoothstep(CORNER_ASSIST_SPEED_LOW * pace, CORNER_ASSIST_SPEED_HIGH * pace, speed) *
    authority;
  if (away > DIRECTION_BRAKE_START) {
    const push = smoothstep(JOYSTICK_DEAD_ZONE, 0.8, magnitude);
    // To the rear quarter: trail the brake into the turn, harder the faster the car is going,
    // but never to a stop. The car slows to a pace it can turn round at and keeps turning.
    const turn =
      smoothstep(DIRECTION_BRAKE_START, DIRECTION_BRAKE_FULL, away) *
      smoothstep(DIRECTION_TURN_SPEED_LOW, DIRECTION_TURN_SPEED_HIGH, speed);
    // Roughly straight behind: brake to a stop, and from a stop, reverse.
    const stop = smoothstep(DIRECTION_STOP_START, DIRECTION_STOP_FULL, away);
    amount = Math.max(amount, Math.max(turn, stop) * push);
    if (speed < DIRECTION_REVERSE_SPEED) amount = stop > 0.5 ? 1 : 0;
  }
  const pull = amount > 0 ? BRAKE_LIFT_THRESHOLD + amount * (1 - BRAKE_LIFT_THRESHOLD) : 0;
  return { steer, brake: pull, coast: false };
}

/**
 * Lets the stick origin trail the thumb. Returns how far the origin should move, in the same
 * units as the displacement, so that the thumb is never more than the trail distance from it.
 */
export function trailStickOrigin(
  dxPx: number,
  dyPx: number,
  radiusPx = JOYSTICK_RADIUS_PX,
): { x: number; y: number } {
  const limit = radiusPx * JOYSTICK_TRAIL_RADII;
  const len = Math.hypot(dxPx, dyPx);
  if (len <= limit) return { x: 0, y: 0 };
  const excess = (len - limit) / len;
  return { x: dxPx * excess, y: dyPx * excess };
}
