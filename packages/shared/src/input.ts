import { JOYSTICK_CURVE, JOYSTICK_DEAD_ZONE, JOYSTICK_RADIUS_PX } from './balance.js';
import { clamp } from './math.js';
import type { ControlInput } from './physics.js';

/**
 * Floating pull joystick math from Section 7.1, kept pure so the same curve is unit tested and
 * shared by touch, mouse drag and any future input device.
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
 * Converts a thumb displacement in CSS pixels, measured from where the finger first touched,
 * into a control sample. Positive dx steers right; positive dy (pulling down the screen) lifts
 * the throttle and brakes.
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
