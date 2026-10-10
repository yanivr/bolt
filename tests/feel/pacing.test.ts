import { CHASSIS, CITY_01, DEFAULT_LOADOUT, resolveLoadout } from '@bolt/content';
import { CAR_HEADINGS, SIM_DT, TAU, mulberry32 } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { CameraView, SimPose } from '../../apps/web/src/game/rendering/frame.js';
import {
  BodyMotion,
  FollowCamera,
  FramePacer,
  HeadingLatch,
  MAX_STEPS_PER_FRAME,
  PoseBuffer,
  StepClock,
  VIEW_LONG_MAX,
  VIEW_LONG_MIN,
  chooseViewScale,
  steadyLookAhead,
} from '../../apps/web/src/game/rendering/frame.js';
import { topSpeed } from './handling.js';
import { DISPLAYS, displayTimeline, lapWorld, measure, straightWorld } from './pacing.js';
import { makeSkidPad } from './pad.js';
import { shippedPipeline } from './pipelineBench.js';

/**
 * Frame pacing and camera acceptance thresholds, measured on the same pure module the race
 * scene runs. Positions are in device pixels on an 844 x 390 phone at a device pixel ratio
 * of 2, which is two device pixels per world pixel.
 */

const pad = makeSkidPad();
const phone = { widthPx: 1688, heightPx: 780, scale: 2 };
const padView: CameraView = { ...phone, worldWidth: pad.worldWidth, worldHeight: pad.worldHeight };
const cityView: CameraView = {
  ...phone,
  worldWidth: CITY_01.worldWidth,
  worldHeight: CITY_01.worldHeight,
};

describe('view scale', () => {
  const devices: Array<[string, number, number, number]> = [
    ['iPhone 14 landscape', 844, 390, 3],
    ['iPhone 15 Pro Max', 932, 430, 3],
    ['iPhone SE', 667, 375, 2],
    ['Pixel 7', 915, 412, 2.625],
    ['Galaxy S23', 780, 360, 3],
    ['small Android', 640, 360, 2],
    ['iPad', 1024, 768, 2],
    ['1080p desktop', 1920, 1080, 1],
    ['1366 laptop', 1366, 768, 1],
    ['1440p desktop', 2560, 1440, 1],
    ['4K desktop at 150%', 2560, 1440, 1.5],
    ['test viewport', 844, 390, 2],
    ['phone held upright', 390, 844, 3],
  ];

  it.each(devices)('%s shows 760 to 1040 world pixels on its long side at a whole-number scale', (_n, w, h, dpr) => {
    const choice = chooseViewScale(w, h, dpr);
    expect(Number.isInteger(choice.scale)).toBe(true);
    expect(choice.scale).toBeGreaterThanOrEqual(1);
    const long = (Math.max(w, h) * choice.renderRatio) / choice.scale;
    expect(long).toBeGreaterThanOrEqual(VIEW_LONG_MIN - 0.5);
    expect(long).toBeLessThanOrEqual(VIEW_LONG_MAX + 0.5);
    // Never render absurdly more pixels than the device has.
    expect(choice.renderRatio).toBeLessThanOrEqual(Math.min(dpr, 3) * 1.35 + 1e-9);
    if (choice.native) expect(choice.renderRatio).toBeCloseTo(Math.min(dpr, 3), 9);
  });

  it('renders the common phones at device resolution, with nothing resampled', () => {
    for (const [, w, h, dpr] of devices.filter(([name]) => /iPhone 1|Pixel|Galaxy|iPad|test/.test(name)))
      expect(chooseViewScale(w, h, dpr).native).toBe(true);
  });

  it('makes the car about 6.5 percent of the view width on a phone', () => {
    const choice = chooseViewScale(844, 390, 3);
    const long = (844 * choice.renderRatio) / choice.scale;
    expect(58 / long).toBeGreaterThan(0.055);
    expect(58 / long).toBeLessThan(0.077);
  });
});

describe('look-ahead', () => {
  const tops = Object.values(CHASSIS).map((chassis) => {
    const resolved = resolveLoadout({ ...DEFAULT_LOADOUT, chassisId: chassis.id });
    if (!resolved.ok) throw new Error('must resolve');
    return topSpeed(resolved.params);
  });
  const fastest = Math.max(...tops);

  it('shows at least 0.9 s of road ahead at top speed in every direction, for the fastest car', () => {
    for (const view of [cityView, { ...cityView, widthPx: 2532, heightPx: 1170, scale: 3 }]) {
      let worst = Infinity;
      for (let deg = 0; deg < 360; deg += 5) {
        const a = (deg * Math.PI) / 180;
        worst = Math.min(worst, steadyLookAhead(view, Math.sin(a), -Math.cos(a), fastest) / fastest);
      }
      expect(worst).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('keeps the whole car on screen with room for the HUD while leading', () => {
    const h = cityView.heightPx / cityView.scale;
    const ahead = steadyLookAhead(cityView, 0, -1, fastest);
    // Distance from the car to the edge behind it, world pixels.
    expect(h - ahead).toBeGreaterThanOrEqual(64);
  });
});

describe('follow camera', () => {
  function drive(camera: FollowCamera, seconds: number, hz: number, pose: SimPose, onFrame: () => void): void {
    const dt = 1 / hz;
    for (let i = 0; i < Math.round(seconds * hz); i++) {
      pose.x += pose.vx * dt;
      pose.y += pose.vy * dt;
      camera.update(dt, pose, 0);
      onFrame();
    }
  }

  it('swings the lead over smoothly when the car reverses direction: no overshoot, no oscillation, no jerk', () => {
    const camera = new FollowCamera();
    camera.configure(padView);
    const pose: SimPose = { x: 9000, y: 6000, heading: 0, vx: 0, vy: -270 };
    drive(camera, 3, 60, pose, () => undefined);
    const settled = camera.leadY;
    expect(settled).toBeLessThan(-90);
    pose.vy = 270;
    const leads: number[] = [];
    drive(camera, 3, 60, pose, () => leads.push(camera.leadY));
    let turns = 0;
    for (let i = 2; i < leads.length; i++) {
      const a = leads[i - 1]! - leads[i - 2]!;
      const b = leads[i]! - leads[i - 1]!;
      if (a * b < -1e-9) turns++;
    }
    // Even for an instant reversal, which no car can do, the lead moves one way only and
    // stops where it should.
    expect(turns).toBe(0);
    expect(Math.max(...leads)).toBeLessThanOrEqual(-settled + 1e-6);
    expect(leads[leads.length - 1]!).toBeGreaterThan(-settled * 0.98);
  });

  it('moves the car across the screen without jerk through a full-speed U-turn', () => {
    const camera = new FollowCamera();
    camera.configure(padView);
    const pose: SimPose = { x: 9000, y: 6000, heading: 0, vx: 0, vy: -270 };
    drive(camera, 3, 60, pose, () => undefined);
    // Turn through 180 degrees at 110 degrees per second, the most the car can do.
    const screen: Array<{ x: number; y: number }> = [];
    let angle = 0;
    drive(camera, 4, 60, pose, () => {
      angle = Math.min(Math.PI, angle + (110 * Math.PI) / 180 / 60);
      pose.vx = 270 * Math.sin(angle);
      pose.vy = -270 * Math.cos(angle);
      screen.push({ x: -camera.leadX * padView.scale, y: -camera.leadY * padView.scale });
    });
    let worst = 0;
    for (let i = 1; i < screen.length - 1; i++) {
      worst = Math.max(
        worst,
        Math.hypot(
          screen[i]!.x - (screen[i - 1]!.x + screen[i + 1]!.x) / 2,
          screen[i]!.y - (screen[i - 1]!.y + screen[i + 1]!.y) / 2,
        ),
      );
    }
    // Even with the turn starting and stopping abruptly, the car's movement on screen
    // changes by under a sixth of a device pixel from one frame to the next.
    expect(worst).toBeLessThan(0.15);
  });

  it('does not let a 30 Hz velocity step reach the screen', () => {
    // Velocity that jumps every second frame, as raw simulation state does at 60 Hz.
    const camera = new FollowCamera();
    camera.configure(padView);
    const pose: SimPose = { x: 9000, y: 6000, heading: 0, vx: 200, vy: 0 };
    const cars: number[] = [];
    let frame = 0;
    drive(camera, 4, 60, pose, () => {
      frame++;
      if (frame % 2 === 0) pose.vy += 3;
      cars.push((pose.y + camera.leadY) * padView.scale);
    });
    let worst = 0;
    for (let i = 122; i < cars.length - 1; i++)
      worst = Math.max(worst, Math.abs(cars[i]! - (cars[i - 1]! + cars[i + 1]!) / 2));
    expect(worst).toBeLessThan(0.1);
  });

  it('keeps the car on one whole pixel while the lead is steady, and never shows past the world edge', () => {
    const camera = new FollowCamera();
    camera.configure(cityView);
    const pose: SimPose = { x: 600, y: 1400, heading: 0, vx: 233.7, vy: 0 };
    const seen = new Set<number>();
    let frame = 0;
    drive(camera, 6, 60, pose, () => {
      frame++;
      expect(Number.isInteger(camera.scrollPxX)).toBe(true);
      expect(Number.isInteger(camera.carPxX)).toBe(true);
      expect(camera.scrollPxX).toBeGreaterThanOrEqual(0);
      expect(camera.scrollPxX).toBeLessThanOrEqual(cityView.worldWidth * 2 - cityView.widthPx);
      if (frame > 200 && pose.x < 1900) seen.add(camera.carPxX - camera.scrollPxX);
    });
    expect(seen.size).toBe(1);
  });

  it('cuts instead of panning when the car is placed somewhere else', () => {
    const camera = new FollowCamera();
    camera.configure(cityView);
    const pose: SimPose = { x: 1200, y: 1400, heading: 0, vx: 250, vy: 0 };
    drive(camera, 2, 60, pose, () => undefined);
    expect(camera.leadX).toBeGreaterThan(60);
    pose.x = 2400;
    pose.vx = 0;
    camera.update(1 / 60, pose, 0);
    expect(camera.leadX).toBe(0);
  });

  it('shakes by whole world pixels, within budget, and not at all when turned off', () => {
    const camera = new FollowCamera();
    camera.configure(cityView);
    const pose: SimPose = { x: 1500, y: 1400, heading: 0, vx: 0, vy: 0 };
    camera.update(1 / 60, pose, 1);
    camera.kick(99, 0.1);
    let saw = 0;
    for (let i = 0; i < 12; i++) {
      camera.update(1 / 60, pose, 1);
      expect(Math.abs(camera.shakePxX)).toBeLessThanOrEqual(3 * 2);
      expect(camera.shakePxX % 2 === 0).toBe(true);
      saw = Math.max(saw, Math.abs(camera.shakePxX), Math.abs(camera.shakePxY));
    }
    expect(saw).toBeGreaterThan(0);
    camera.kick(3, 0.1);
    camera.update(1 / 60, pose, 0);
    expect(camera.shakePxX).toBe(0);
    expect(camera.shakePxY).toBe(0);
  });
});

describe('frame pacer', () => {
  function run(hz: number, jitterMs: number, dropRate: number, seconds: number) {
    const pacer = new FramePacer();
    const frames = displayTimeline({ hz, jitterMs, dropRate, seed: 99 }, seconds);
    const period = 1 / hz;
    const errors: number[] = [];
    let total = 0;
    let last = frames[0]!;
    pacer.advance(last.timestamp);
    for (let i = 1; i < frames.length; i++) {
      const f = frames[i]!;
      const dt = pacer.advance(f.timestamp);
      total += dt;
      if (i > hz) errors.push(dt - (f.refresh - last.refresh) * period);
      last = f;
    }
    const worst = Math.max(...errors.map(Math.abs));
    const elapsed = (frames[frames.length - 1]!.refresh - frames[0]!.refresh) * period;
    return { worstMs: worst * 1000, driftMs: (total - elapsed) * 1000 };
  }

  it.each([60, 90, 120])('advances by exactly one refresh per frame at %i Hz', (hz) => {
    expect(run(hz, 0, 0, 20).worstMs).toBeLessThan(0.01);
  });

  it('removes two milliseconds of timestamp noise', () => {
    // Raw gaps would be wrong by up to 4 ms, a quarter of a frame.
    const r = run(60, 2, 0, 30);
    expect(r.worstMs).toBeLessThan(0.15);
    expect(Math.abs(r.driftMs)).toBeLessThan(4);
  });

  it('shows a dropped frame as exactly one doubled step', () => {
    const r = run(60, 0, 0.06, 30);
    expect(r.worstMs).toBeLessThan(0.01);
    expect(Math.abs(r.driftMs)).toBeLessThan(0.5);
  });

  it('copes with noise and drops together, at 60 and 120 Hz', () => {
    expect(run(60, 2, 0.04, 30).worstMs).toBeLessThan(0.15);
    expect(run(120, 1, 0.04, 30).worstMs).toBeLessThan(0.15);
  });

  it('stays on real time over five minutes on a display that is not quite 60 Hz', () => {
    const pacer = new FramePacer();
    const period = 1000 / 59.94;
    let total = 0;
    for (let i = 0; i < 59.94 * 300; i++) total += pacer.advance(500 + i * period);
    expect(Math.abs(total * 1000 - (Math.floor(59.94 * 300) * period))).toBeLessThan(20);
  });

  it('re-locks within a few frames when an adaptive display changes its refresh rate', () => {
    const pacer = new FramePacer();
    let t = 100;
    let total = 0;
    const start = t;
    pacer.advance(t);
    for (const [hz, frames] of [
      [120, 240],
      [90, 180],
      [60, 120],
      [120, 240],
    ] as const) {
      for (let i = 0; i < frames; i++) {
        t += 1000 / hz;
        total += pacer.advance(t);
      }
      expect(pacer.periodMs).toBeCloseTo(1000 / hz, 6);
      // Game time never drifts from real time by more than a frame or two across the switch.
      expect(Math.abs(total * 1000 - (t - start))).toBeLessThan(20);
    }
  });

  it('uses raw gaps when the frame rate is not a steady refresh', () => {
    const pacer = new FramePacer();
    const rng = mulberry32(4);
    let t = 0;
    let total = 0;
    for (let i = 0; i < 400; i++) {
      t += 28 + rng() * 60;
      total += pacer.advance(t);
    }
    expect(pacer.periodMs).toBe(0);
    expect(total * 1000).toBeGreaterThan(t - 120);
    expect(total * 1000).toBeLessThanOrEqual(t);
  });

  it('treats a long gap as a pause, not as a quarter second of motion', () => {
    const pacer = new FramePacer();
    for (let i = 0; i < 60; i++) pacer.advance(i * (1000 / 60));
    expect(pacer.advance(60 * (1000 / 60) + 4000)).toBeLessThan(0.02);
  });
});

describe('fixed step clock', () => {
  it('runs the simulation at 30 Hz from any refresh rate', () => {
    for (const hz of [30, 60, 90, 120, 144]) {
      const clock = new StepClock();
      let steps = 0;
      for (let i = 0; i < hz * 10; i++) {
        const n = clock.advance(1 / hz);
        expect(n).toBeLessThanOrEqual(1 + (hz < 31 ? 1 : 0));
        expect(clock.alpha).toBeGreaterThanOrEqual(0);
        expect(clock.alpha).toBeLessThanOrEqual(1);
        steps += n;
      }
      expect(Math.abs(steps - 300)).toBeLessThanOrEqual(1);
    }
  });

  it('catches up after a hitch, and slows rather than spirals after a very long one', () => {
    const clock = new StepClock();
    expect(clock.advance(0.127)).toBe(3);
    expect(clock.advance(2)).toBe(MAX_STEPS_PER_FRAME);
    expect(clock.advance(SIM_DT)).toBe(1);
  });
});

describe('interpolation', () => {
  it('stays continuous when a server correction moves the predicted car', () => {
    const poses = new PoseBuffer();
    poses.reset({ x: 0, y: 0, heading: 0, vx: 90, vy: 0 });
    poses.push({ x: 3, y: 0, heading: 0.01, vx: 90, vy: 0 });
    const before: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
    const after: SimPose = { ...before };
    poses.sample(0.4, before);
    // The predictor moved the car by (5, -2); its visual offset absorbs exactly that.
    poses.rebase({ x: 8, y: -2, heading: 0.03, vx: 90, vy: 0 }, 5, -2, 0.02);
    poses.sample(0.4, after);
    expect(after.x - 5).toBeCloseTo(before.x, 9);
    expect(after.y + 2).toBeCloseTo(before.y, 9);
    expect(after.heading - 0.02).toBeCloseTo(before.heading, 9);
  });

  it('interpolates heading the short way round', () => {
    const poses = new PoseBuffer();
    poses.reset({ x: 0, y: 0, heading: Math.PI - 0.05, vx: 0, vy: 0 });
    poses.push({ x: 0, y: 0, heading: -Math.PI + 0.05, vx: 0, vy: 0 });
    const out: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
    poses.sample(0.5, out);
    expect(Math.abs(Math.abs(out.heading) - Math.PI)).toBeLessThan(1e-9);
  });
});

describe('car presentation', () => {
  it('never flickers between heading frames on a boundary', () => {
    const latch = new HeadingLatch();
    const step = TAU / CAR_HEADINGS;
    const rng = mulberry32(8);
    let changes = 0;
    let last = latch.update(step * 10.5);
    for (let i = 0; i < 600; i++) {
      // Sitting on the boundary between frames 10 and 11 with a degree of noise.
      const shown = latch.update(step * 10.5 + (rng() - 0.5) * 0.035);
      if (shown !== last) changes++;
      last = shown;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('follows a steady turn one frame at a time, in order', () => {
    const latch = new HeadingLatch();
    let last = Math.round(latch.update(0) / (TAU / CAR_HEADINGS));
    let changes = 0;
    for (let i = 1; i <= 600; i++) {
      const frame = Math.round(latch.update((i / 600) * TAU) / (TAU / CAR_HEADINGS)) % CAR_HEADINGS;
      if (frame !== last) {
        expect((frame - last + CAR_HEADINGS) % CAR_HEADINGS).toBe(1);
        changes++;
        last = frame;
      }
    }
    expect(changes).toBe(CAR_HEADINGS);
  });

  it('leans and squats once per manoeuvre, not once per threshold crossing', () => {
    const body = new BodyMotion();
    const rng = mulberry32(3);
    let leanChanges = 0;
    let pitchChanges = 0;
    let lastLean = 0;
    let lastPitch = 0;
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      // A corner that builds to the first lean threshold and hovers there with noise, while
      // acceleration hovers around the squat threshold.
      const lateral = Math.min(190, t * 120) + (rng() - 0.5) * 30;
      const forward = 55 + (rng() - 0.5) * 16;
      body.update(1 / 60, lateral, forward, 150, t);
      if (body.shiftX !== lastLean) leanChanges++;
      if (body.shiftY !== lastPitch) pitchChanges++;
      lastLean = body.shiftX;
      lastPitch = body.shiftY;
    }
    expect(leanChanges).toBeLessThanOrEqual(1);
    expect(pitchChanges).toBeLessThanOrEqual(1);
    // Leans away from a right turn, by whole pixels only.
    const hard = new BodyMotion();
    for (let i = 0; i < 60; i++) hard.update(1 / 60, 380, 0, 200, 0);
    expect(hard.shiftX).toBe(-2);
    for (let i = 0; i < 60; i++) hard.update(1 / 60, 0, -200, 200, 0);
    expect(hard.shiftX).toBe(0);
    expect(hard.shiftY).toBe(-1);
  });
});

describe('what reaches the glass', () => {
  it.each(DISPLAYS)('$name: steady speed on a straight moves evenly', ({ model }) => {
    const r = measure(shippedPipeline(straightWorld(), padView), displayTimeline(model, 12), model.hz, 4);
    // Before rounding, one frame's movement differs from its neighbours by under a tenth of a
    // device pixel, about one percent of the step: far below anything visible.
    expect(r.worstGroundHitchExact).toBeLessThan(0.1);
    expect(r.worstCarHitchExact).toBeLessThan(0.02);
    // The car does not move on screen at all, and everything drawn is on the pixel grid.
    expect(r.worstCarHitch).toBe(0);
    expect(r.alignedPct).toBe(100);
    // Rounding to whole pixels moves anything by at most one pixel from where it should be.
    expect(r.worstSnapError).toBeLessThanOrEqual(1);
    expect(r.worstRelativeJitter).toBeLessThanOrEqual(1.001);
  });

  it.each(DISPLAYS)('$name: a lap of Neon Cut has no stutter in the ground or the car', ({ model }) => {
    const r = measure(shippedPipeline(lapWorld(), cityView), displayTimeline(model, 45), model.hz, 3.5);
    // Launch, braking and cornering included. Half a device pixel per refresh.
    expect(r.worstGroundHitchExact).toBeLessThan(0.6);
    expect(r.worstCarHitchExact).toBeLessThan(0.6);
    expect(r.alignedPct).toBe(100);
    expect(r.worstSnapError).toBeLessThanOrEqual(1);
    expect(r.headingFlickers).toBe(0);
  });
});
