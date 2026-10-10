import { JOYSTICK_DEAD_ZONE, JOYSTICK_RADIUS_PX, clampToDisc, joystickToControl, keysToControl, shapeAxis } from '@bolt/shared';
import { describe, expect, it } from 'vitest';

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
