import { DEFAULT_LOADOUT, resolveLoadout } from '@bolt/content';
import type { VehicleMotionState } from '@bolt/shared';
import {
  BRAKE_LIFT_THRESHOLD,
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_RADIUS_PX,
  JOYSTICK_TRAIL_RADII,
  clampToDisc,
  createMotionState,
  directionToControl,
  joystickToControl,
  keysToControl,
  shapeAxis,
  trailStickOrigin,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';

const resolved = resolveLoadout(DEFAULT_LOADOUT);
if (!resolved.ok) throw new Error('default loadout must resolve');
const params = resolved.params;

/** A car at the origin pointing along `headingRad` and rolling forward at `speed`. */
function car(headingRad: number, speed: number): VehicleMotionState {
  const m = createMotionState(0, 0, headingRad);
  m.velocityX = Math.sin(headingRad) * speed;
  m.velocityY = -Math.cos(headingRad) * speed;
  return m;
}

/** Stick pushed fully toward a screen heading: 0 is up, clockwise positive. */
function stick(headingRad: number, magnitude = 1): [number, number] {
  return [Math.sin(headingRad) * magnitude, -Math.cos(headingRad) * magnitude];
}

describe('floating joystick math (Section 7.1)', () => {
  it('has a soft dead zone of 0.12', () => {
    expect(shapeAxis(0)).toBe(0);
    expect(shapeAxis(JOYSTICK_DEAD_ZONE)).toBe(0);
    expect(shapeAxis(-JOYSTICK_DEAD_ZONE)).toBe(0);
    expect(shapeAxis(JOYSTICK_DEAD_ZONE + 0.01)).toBeGreaterThan(0);
  });

  it('applies the sign(u) * |u|^1.25 response curve and clamps to [-1, 1]', () => {
    expect(shapeAxis(1)).toBe(1);
    expect(shapeAxis(-1)).toBe(-1);
    expect(shapeAxis(5)).toBe(1);
    expect(shapeAxis(-5)).toBe(-1);
    const mid = (0.56 - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE);
    expect(shapeAxis(0.56)).toBeCloseTo(Math.pow(mid, 1.25), 9);
    expect(shapeAxis(-0.56)).toBeCloseTo(-Math.pow(mid, 1.25), 9);
  });

  it('is monotonic', () => {
    let last = -Infinity;
    for (let u = -1; u <= 1; u += 0.01) {
      const v = shapeAxis(u);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('steers right for positive dx and left for negative dx', () => {
    expect(joystickToControl(JOYSTICK_RADIUS_PX, 0).steer).toBe(1);
    expect(joystickToControl(-JOYSTICK_RADIUS_PX, 0).steer).toBe(-1);
  });

  it('brakes only when pulled down the screen, and combines with steering', () => {
    expect(joystickToControl(0, -JOYSTICK_RADIUS_PX).brake).toBe(0);
    expect(joystickToControl(0, JOYSTICK_RADIUS_PX).brake).toBe(1);
    const diagonal = joystickToControl(-JOYSTICK_RADIUS_PX * 0.8, JOYSTICK_RADIUS_PX * 0.8);
    expect(diagonal.brake).toBeCloseTo(0.8, 9);
    expect(diagonal.steer).toBeLessThan(-0.5);
    expect(diagonal.coast).toBe(false);
  });

  it('keeps the visual nub inside the disc', () => {
    const p = clampToDisc(300, 400);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(JOYSTICK_RADIUS_PX, 9);
    expect(clampToDisc(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it('maps keys onto the same normalized schema', () => {
    expect(keysToControl(true, false, false, true)).toEqual({ steer: -1, brake: 0, coast: false });
    expect(keysToControl(true, true, true, true)).toEqual({ steer: 0, brake: 1, coast: false });
    expect(keysToControl(false, false, false, false).coast).toBe(true);
  });
});

describe('direction steering (north-up camera)', () => {
  const D = Math.PI / 180;

  it('means full throttle with straight wheels while a finger rests inside the dead zone', () => {
    expect(directionToControl(0, 0, car(1, 150), params, 1)).toEqual({ steer: 0, brake: 0, coast: false });
    const edge = JOYSTICK_DEAD_ZONE * 0.99;
    expect(directionToControl(edge, 0, car(0, 150), params, 1).steer).toBe(0);
  });

  it('steers toward the stick whichever way the car is facing on screen', () => {
    for (const heading of [0, 90 * D, 180 * D, -90 * D, 37 * D]) {
      const right = directionToControl(...stick(heading + 30 * D), car(heading, 150), params, 1);
      const left = directionToControl(...stick(heading - 30 * D), car(heading, 150), params, 1);
      const ahead = directionToControl(...stick(heading), car(heading, 150), params, 1);
      expect(right.steer).toBeGreaterThan(0.2);
      expect(left.steer).toBeLessThan(-0.2);
      expect(Math.abs(ahead.steer)).toBeLessThan(1e-9);
      expect(left.steer).toBeCloseTo(-right.steer, 9);
    }
  });

  it('asks for less steering for the same error as speed and yaw authority rise', () => {
    const slow = directionToControl(...stick(8 * D), car(0, 60), params, 1).steer;
    const fast = directionToControl(...stick(8 * D), car(0, 160), params, 1).steer;
    expect(slow).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThan(0);
  });

  it('eases off the steering as the nose swings toward the target, to arrive without overshoot', () => {
    const still = car(0, 150);
    const swinging = car(0, 150);
    swinging.yawRate = 1.2;
    const a = directionToControl(...stick(15 * D), still, params, 1).steer;
    const b = directionToControl(...stick(15 * D), swinging, params, 1).steer;
    expect(b).toBeLessThan(a);
  });

  it('fades authority in from the edge of the dead zone, so a barely moved thumb cannot jerk the car', () => {
    const tiny = directionToControl(...stick(60 * D, JOYSTICK_DEAD_ZONE + 0.03), car(0, 150), params, 1);
    const full = directionToControl(...stick(60 * D, 1), car(0, 150), params, 1);
    expect(Math.abs(tiny.steer)).toBeLessThan(Math.abs(full.steer) * 0.1);
    expect(tiny.steer).toBeGreaterThan(0);
  });

  it('keeps full throttle for small corrections and eases off for a big turn at speed', () => {
    expect(directionToControl(...stick(12 * D), car(0, 260), params, 1).brake).toBe(0);
    expect(directionToControl(...stick(70 * D), car(0, 260), params, 1).brake).toBeGreaterThan(
      BRAKE_LIFT_THRESHOLD,
    );
    // The same turn at a pace the car can already manage costs nothing.
    expect(directionToControl(...stick(70 * D), car(0, 90), params, 1).brake).toBe(0);
    // On a slippery surface the assist starts at a lower speed.
    expect(directionToControl(...stick(70 * D), car(0, 125), params, 0.5).brake).toBeGreaterThan(
      directionToControl(...stick(70 * D), car(0, 125), params, 1).brake,
    );
  });

  it('brakes fully and straight when pulled straight back, harder the further it is pulled', () => {
    const hard = directionToControl(...stick(180 * D), car(0, 200), params, 1);
    expect(hard.brake).toBe(1);
    expect(Math.abs(hard.steer)).toBeLessThan(1e-9);
    const soft = directionToControl(...stick(180 * D, 0.35), car(0, 200), params, 1);
    expect(soft.brake).toBeGreaterThan(BRAKE_LIFT_THRESHOLD);
    expect(soft.brake).toBeLessThan(hard.brake);
  });

  it('trails the brake and keeps turning when pulled to a rear quarter, without ever stalling', () => {
    const fast = directionToControl(...stick(125 * D), car(0, 220), params, 1);
    expect(fast.brake).toBeGreaterThan(BRAKE_LIFT_THRESHOLD);
    expect(fast.steer).toBeGreaterThan(0.9);
    // Already slow enough to turn round: no brake at all, just steering.
    const slow = directionToControl(...stick(125 * D), car(0, 50), params, 1);
    expect(slow.brake).toBe(0);
    expect(slow.steer).toBeGreaterThan(0.9);
  });

  it('never leaves a stationary car held on a half brake', () => {
    for (let deg = -180; deg <= 180; deg += 3) {
      for (const magnitude of [0.2, 0.5, 1, 1.6]) {
        const c = directionToControl(...stick(deg * D, magnitude), car(0, 0), params, 1);
        // Either drive (no brake) or ask for reverse outright.
        expect(c.brake === 0 || c.brake === 1, `brake at ${deg} deg, ${magnitude}`).toBe(true);
      }
    }
  });

  it('reverses with the tail following the stick, and drives forward again when the stick comes round', () => {
    const backing = car(0, 0);
    backing.reversing = true;
    backing.velocityY = 40;
    // Stick down-left of a car facing up: keep reversing, swinging the tail that way.
    const c = directionToControl(...stick(-150 * D), backing, params, 1);
    expect(c.brake).toBe(1);
    expect(c.steer).not.toBe(0);
    const out = directionToControl(...stick(20 * D), backing, params, 1);
    expect(out.brake).toBe(0);
  });

  it('is a pure function of its inputs and stays finite for wild ones', () => {
    const m = car(0.3, 180);
    const a = directionToControl(0.7, -0.2, m, params, 0.8);
    const b = directionToControl(0.7, -0.2, m, params, 0.8);
    expect(a).toEqual(b);
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      const c = directionToControl(v, 0.3, m, params, 1);
      expect(Number.isFinite(c.steer)).toBe(true);
      expect(c.steer).toBeGreaterThanOrEqual(-1);
      expect(c.steer).toBeLessThanOrEqual(1);
      expect(c.brake).toBeGreaterThanOrEqual(0);
      expect(c.brake).toBeLessThanOrEqual(1);
    }
  });
});

describe('trailing stick origin', () => {
  it('leaves the origin alone while the thumb is near it', () => {
    expect(trailStickOrigin(30, -20)).toEqual({ x: 0, y: 0 });
    expect(trailStickOrigin(JOYSTICK_RADIUS_PX * JOYSTICK_TRAIL_RADII, 0)).toEqual({ x: 0, y: 0 });
  });

  it('drags the origin along so the thumb is never further than the trail distance', () => {
    const limit = JOYSTICK_RADIUS_PX * JOYSTICK_TRAIL_RADII;
    const shift = trailStickOrigin(200, -150);
    const left = Math.hypot(200 - shift.x, -150 - shift.y);
    expect(left).toBeCloseTo(limit, 9);
    // The direction the stick points is unchanged by the move.
    expect(Math.atan2(200 - shift.x, 150 + shift.y)).toBeCloseTo(Math.atan2(200, 150), 9);
  });
});
