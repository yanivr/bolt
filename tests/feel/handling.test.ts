import { CHASSIS, CITY_01, DEFAULT_LOADOUT, environmentFor, resolveLoadout } from '@bolt/content';
import type { VehicleParams } from '@bolt/shared';
import { buildTrack } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  brakeAndTurn,
  flick,
  headingStep,
  pathElasticity,
  pointingLap,
  pullBack,
  slalom,
  slowSweep,
  stepSteer,
  stickNoise,
  topSpeed,
} from './handling.js';

/**
 * Handling acceptance thresholds. Nobody can feel a headless simulation, so these numbers are
 * the definition of "progressive and predictable" that the build is held to. Each threshold
 * says what a driver would notice if it were broken. The measured values, before and after the
 * steering rework, are in docs/evidence/feel.
 */

const cars: Array<[string, VehicleParams]> = Object.values(CHASSIS).map((chassis) => {
  const resolved = resolveLoadout({ ...DEFAULT_LOADOUT, chassisId: chassis.id });
  if (!resolved.ok) throw new Error(`${chassis.id} must resolve`);
  return [chassis.displayName, resolved.params];
});

function speedsFor(params: VehicleParams): number[] {
  return [40, 80, 120, 160, 200, 240, Math.floor(topSpeed(params))];
}

describe.each(cars)('%s: steering the wheels directly (keys and the wheel option)', (_name, params) => {
  const speeds = speedsFor(params);

  it('answers full lock promptly, without a lurch, at every speed', () => {
    for (const v of speeds) {
      const r = stepSteer(params, v, 1);
      // Slower than a third of a second reads as lag; faster than a tenth reads as a twitch.
      expect(r.t90, `t90 at ${v}`).toBeGreaterThanOrEqual(0.12);
      expect(r.t90, `t90 at ${v}`).toBeLessThanOrEqual(0.34);
      // Yaw that shoots past its steady value is the nose tucking in on its own.
      expect(r.overshootPct, `overshoot at ${v}`).toBeLessThanOrEqual(15);
      expect(r.peakYawJerk, `jerk at ${v}`).toBeLessThanOrEqual(16000);
    }
  });

  it('holds full lock as a stable, shallow drift instead of spinning down', () => {
    for (const v of speeds) {
      const r = stepSteer(params, v, 1);
      // The old model let the tail out to 40 degrees and shed more than half the speed.
      expect(r.peakSlipDeg, `slip at ${v}`).toBeLessThanOrEqual(16);
      expect(r.endSpeed, `speed kept at ${v}`).toBeGreaterThanOrEqual(v * 0.9);
      // And it still corners hard: at least 85 percent of the grip the surface offers.
      if (v >= 200) expect(r.lateralAccel, `grip used at ${v}`).toBeGreaterThanOrEqual(340);
    }
  });

  it('turns a parking-speed circle a little over one car length across', () => {
    const r = stepSteer(params, 40, 1);
    expect(r.radius).toBeGreaterThanOrEqual(56);
    expect(r.radius).toBeLessThanOrEqual(80);
  });

  it('maps stick to yaw in proportion at every speed', () => {
    for (const v of speeds) {
      const half = stepSteer(params, v, 0.5).yawDeg;
      const full = stepSteer(params, v, 1).yawDeg;
      const quarter = stepSteer(params, v, 0.25).yawDeg;
      expect(half / full, `half stick at ${v}`).toBeGreaterThan(0.46);
      expect(half / full, `half stick at ${v}`).toBeLessThan(0.6);
      expect(quarter / half, `quarter stick at ${v}`).toBeGreaterThan(0.47);
      expect(quarter / half, `quarter stick at ${v}`).toBeLessThan(0.53);
    }
  });

  it('tightens the path in proportion to ten percent more stick, and never loosens it', () => {
    for (const v of speeds) {
      for (const stick of [0.2, 0.4, 0.6]) {
        const e = pathElasticity(params, v, stick);
        expect(e, `elasticity at ${v}, stick ${stick}`).toBeGreaterThan(0.9);
        expect(e, `elasticity at ${v}, stick ${stick}`).toBeLessThan(1.1);
      }
      for (const stick of [0.8, 0.9]) {
        // Near the grip limit more stick buys less and less, but always something, and never
        // more than its share. Above 1.25 is the twitch the old model had (up to 1.86).
        const e = pathElasticity(params, v, stick);
        expect(e, `elasticity at ${v}, stick ${stick}`).toBeGreaterThan(0.2);
        expect(e, `elasticity at ${v}, stick ${stick}`).toBeLessThan(1.25);
      }
    }
  });

  it('has no grip cliff anywhere in the stick travel', () => {
    for (const v of speeds) {
      const r = slowSweep(params, v);
      expect(r.worstReversalPct, `reversal at ${v}`).toBeLessThanOrEqual(1);
      // The old model stepped lateral acceleration by 82 px/s2 in one tick at top speed.
      expect(r.worstAccelStep, `accel step at ${v}`).toBeLessThanOrEqual(10);
    }
  });

  it('shrugs off a thumb twitch', () => {
    for (const v of speeds) {
      const r = flick(params, v);
      expect(r.headingChangeDeg, `flick at ${v}`).toBeLessThanOrEqual(27);
      expect(r.settle, `settle at ${v}`).toBeLessThanOrEqual(0.6);
      expect(r.reboundDeg, `rebound at ${v}`).toBeLessThanOrEqual(1);
    }
  });

  it('follows a slalom with short, symmetric lag', () => {
    for (const v of speeds) {
      const r = slalom(params, v);
      expect(r.lagMs, `lag at ${v}`).toBeLessThanOrEqual(134);
      expect(r.asymmetryPct, `asymmetry at ${v}`).toBeLessThanOrEqual(1);
    }
  });

  it('can brake and turn together from top speed without spinning', () => {
    const r = brakeAndTurn(params);
    expect(r.spun).toBe(false);
    expect(r.peakSlipDeg).toBeLessThanOrEqual(16);
    expect(r.headingChangeDeg).toBeGreaterThan(45);
  });
});

describe.each(cars)('%s: direction steering (the default on touch)', (_name, params) => {
  const top = Math.floor(topSpeed(params));
  const speeds = [40, 100, 160, 220, top];

  it('puts the nose on the requested heading without swinging past it or hunting', () => {
    for (const delta of [10, 30, 60, 90, 135]) {
      for (const v of speeds) {
        const r = headingStep(params, v, delta);
        expect(r.overshootDeg, `overshoot for ${delta} at ${v}`).toBeLessThanOrEqual(1.5);
        expect(r.reversals, `reversals for ${delta} at ${v}`).toBeLessThanOrEqual(1);
        expect(r.peakSlipDeg, `slip for ${delta} at ${v}`).toBeLessThanOrEqual(16);
      }
    }
  });

  it('makes a small correction in about half a second', () => {
    for (const v of speeds) {
      const r = headingStep(params, v, 10);
      expect(r.t90, `t90 at ${v}`).toBeLessThanOrEqual(0.58);
      expect(r.settle, `settle at ${v}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('turns a right angle in little more than a second once rolling', () => {
    for (const v of speeds.filter((s) => s >= 100)) {
      expect(headingStep(params, v, 90).t90, `t90 at ${v}`).toBeLessThanOrEqual(1.3);
    }
  });

  it('gives ten percent more turn for ten percent more stick angle', () => {
    for (const v of speeds.filter((s) => s >= 100)) {
      const a = headingStep(params, v, 20).at500ms;
      const b = headingStep(params, v, 22).at500ms;
      expect(b / a, `ratio at ${v}`).toBeGreaterThan(1.07);
      expect(b / a, `ratio at ${v}`).toBeLessThan(1.13);
    }
  });

  it('does not pass a trembling thumb through to the car', () => {
    for (const v of speeds) {
      // Ten degrees of stick wobble at 6 Hz moves the nose by under half a degree.
      expect(stickNoise(params, v).headingWobbleDeg, `wobble at ${v}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('eases off for a hard turn at speed instead of ploughing on', () => {
    const r = headingStep(params, top, 90);
    expect(r.minSpeed).toBeLessThan(top * 0.8);
    expect(r.minSpeed).toBeGreaterThan(90);
    // A gentle correction at the same speed costs nothing.
    expect(headingStep(params, top, 10).minSpeed).toBeGreaterThan(top * 0.99);
  });

  it('brakes straight when the stick is pulled straight back, reverses when held, and recovers', () => {
    for (const v of [100, 200, top]) {
      const r = pullBack(params, v);
      expect(r.stopSeconds, `stop from ${v}`).toBeGreaterThan(0);
      expect(r.stopSeconds, `stop from ${v}`).toBeLessThan(1.6);
      expect(r.headingDriftDeg, `drift from ${v}`).toBeLessThan(1);
      expect(r.reverseSeconds - r.stopSeconds, `reverse after stop from ${v}`).toBeLessThan(0.6);
      expect(r.recovers, `recovers from ${v}`).toBe(true);
    }
  });

  it('lets a driver who only points finish Neon Cut without touching a wall', () => {
    const track = buildTrack(CITY_01);
    const env = environmentFor('city_clear_night')!;
    for (const lookAhead of [0.45, 0.6, 0.8]) {
      const lap = pointingLap(track, env, params, lookAhead);
      expect(lap.finished, `finished at ${lookAhead}`).toBe(true);
      expect(lap.wallStrikes, `wall strikes at ${lookAhead}`).toBe(0);
      expect(lap.seconds, `time at ${lookAhead}`).toBeLessThan(140);
      expect(lap.peakSlipDeg, `slip at ${lookAhead}`).toBeLessThan(20);
    }
  });
});
