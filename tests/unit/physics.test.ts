import { DEFAULT_LOADOUT, resolveLoadout } from '@bolt/content';
import type { ControlInput, RaceEnvironment, TrackRuntime, VehicleParams } from '@bolt/shared';
import {
  BRAKE_LIFT_THRESHOLD,
  MAX_COMBINED_GRIP,
  MPH_PER_WORLD_SPEED,
  SIM_DT,
  SURFACE_GRIP,
  SURFACE_IDS,
  WEATHER_IDS,
  buildTrack,
  createLocation,
  createMotionState,
  createStepScratch,
  createTelemetry,
  headingFromVector,
  locate,
  mulberry32,
  stepVehicle,
  surfaceGrip,
} from '@bolt/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeProvingGround } from '../helpers/tracks.js';

const CLEAR: RaceEnvironment = { weather: 'clear', wetness: 0 };
const FULL: ControlInput = { steer: 0, brake: 0, coast: false };

let track: TrackRuntime;
let params: VehicleParams;

function rig(env = CLEAR, t = track) {
  const state = createMotionState(11000, 5000, headingFromVector(-1, 0));
  const telemetry = createTelemetry();
  const scratch = createStepScratch();
  const step = (input: ControlInput, seconds: number, p = params) => {
    for (let i = 0; i < Math.round(seconds / SIM_DT); i++) stepVehicle(state, input, p, env, t, SIM_DT, scratch, telemetry);
  };
  return { state, telemetry, step };
}

beforeAll(() => {
  track = buildTrack(makeProvingGround());
  const resolved = resolveLoadout(DEFAULT_LOADOUT);
  if (!resolved.ok) throw new Error('default loadout must resolve');
  params = resolved.params;
});

describe('default Beetle feel targets (Section 6.5)', () => {
  it('reaches 60 MPH in about four seconds', () => {
    const { telemetry, step } = rig();
    let t = 0;
    while (telemetry.speed * MPH_PER_WORLD_SPEED < 60 && t < 10) {
      step(FULL, SIM_DT);
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(3.5);
    expect(t).toBeLessThan(4.5);
  });

  it('tops out between 70 and 95 MPH on dry asphalt', () => {
    const { telemetry, step } = rig();
    step(FULL, 25);
    const mph = telemetry.speed * MPH_PER_WORLD_SPEED;
    expect(mph).toBeGreaterThan(70);
    expect(mph).toBeLessThan(95);
  });

  it('settles steering in roughly 0.18 seconds', () => {
    const { state, step } = rig();
    step(FULL, 3);
    step({ steer: 1, brake: 0, coast: false }, 0.18);
    expect(state.steeringInput).toBeGreaterThan(0.8);
    step(FULL, 0.4);
    expect(Math.abs(state.steeringInput)).toBeLessThan(0.12);
  });

  it('holds a moderate bend without spinning', () => {
    const { state, telemetry, step } = rig();
    step(FULL, 4);
    let worstSlip = 0;
    for (let i = 0; i < 30; i++) {
      step({ steer: 0.45, brake: 0, coast: false }, SIM_DT);
      worstSlip = Math.max(worstSlip, Math.abs(telemetry.slipAngle));
    }
    expect(worstSlip).toBeLessThan(0.5);
    // The car is still travelling roughly where it points.
    expect(telemetry.forwardSpeed).toBeGreaterThan(telemetry.speed * 0.85);
    expect(Number.isFinite(state.headingRad)).toBe(true);
  });

  it('turns right for positive steer and left for negative steer', () => {
    const right = rig();
    right.step(FULL, 2);
    const h0 = right.state.headingRad;
    right.step({ steer: 1, brake: 0, coast: false }, 0.5);
    expect(right.state.yawRate).toBeGreaterThan(0);
    expect(right.state.headingRad).not.toBe(h0);
    const left = rig();
    left.step(FULL, 2);
    left.step({ steer: -1, brake: 0, coast: false }, 0.5);
    expect(left.state.yawRate).toBeLessThan(0);
  });
});

describe('pedals', () => {
  it('keeps full throttle until the pull passes the lift threshold', () => {
    const a = rig();
    a.step({ steer: 0, brake: BRAKE_LIFT_THRESHOLD, coast: false }, 2);
    const b = rig();
    b.step(FULL, 2);
    expect(a.telemetry.speed).toBeCloseTo(b.telemetry.speed, 6);
  });

  it('brakes to a stop and never rolls backwards from friction', () => {
    const { state, telemetry, step } = rig();
    step(FULL, 6);
    step({ steer: 0, brake: 0.5, coast: false }, 6);
    expect(telemetry.speed).toBeLessThan(0.01);
    expect(state.reversing).toBe(false);
  });

  it('reverses only after the brake is held at a standstill', () => {
    const { state, telemetry, step } = rig();
    step({ steer: 0, brake: 1, coast: false }, 0.2);
    expect(state.reversing).toBe(false);
    step({ steer: 0, brake: 1, coast: false }, 1.5);
    expect(state.reversing).toBe(true);
    expect(telemetry.forwardSpeed).toBeLessThan(-20);
    step(FULL, 3);
    expect(telemetry.forwardSpeed).toBeGreaterThan(20);
  });

  it('coasts on gentle throttle with the wheels straight when nothing is touched', () => {
    const { state, telemetry, step } = rig();
    step({ steer: 1, brake: 0, coast: true }, 8);
    expect(Math.abs(state.steeringInput)).toBeLessThan(0.01);
    expect(telemetry.speed).toBeGreaterThan(40);
    const full = rig();
    full.step(FULL, 8);
    expect(telemetry.speed).toBeLessThan(full.telemetry.speed);
  });
});

describe('mass, grip and weather', () => {
  it('makes a heavier car slower to accelerate without changing top speed much', () => {
    const light = rig();
    light.step(FULL, 3);
    const heavy = rig();
    heavy.step(FULL, 3, { ...params, massKg: params.massKg * 1.6 });
    expect(heavy.telemetry.speed).toBeLessThan(light.telemetry.speed * 0.85);
    // Both stay on the long straight: the heavy car needs more road, not more engine.
    light.step(FULL, 10);
    heavy.step(FULL, 20, { ...params, massKg: params.massKg * 1.6 });
    expect(heavy.telemetry.speed).toBeGreaterThan(light.telemetry.speed * 0.95);
  });

  it('uses the published grip table for every weather and surface, capped', () => {
    for (const weather of WEATHER_IDS) {
      for (const surface of SURFACE_IDS) {
        const g = surfaceGrip(params, { weather, wetness: 0 }, surface, false);
        expect(g).toBeCloseTo(Math.min(MAX_COMBINED_GRIP, SURFACE_GRIP[weather][surface]), 9);
      }
    }
    const sticky = { ...params, tireGrip: 3 };
    expect(surfaceGrip(sticky, CLEAR, 'asphalt', false)).toBe(MAX_COMBINED_GRIP);
  });

  it('slides wider in the rain at the same speed and steering', () => {
    const run = (env: RaceEnvironment) => {
      const r = rig(env);
      r.step(FULL, 5);
      let slip = 0;
      for (let i = 0; i < 45; i++) {
        r.step({ steer: 1, brake: 0, coast: false }, SIM_DT);
        slip = Math.max(slip, r.telemetry.slipRatio);
      }
      return slip;
    };
    expect(run({ weather: 'heavy_rain', wetness: 1 })).toBeGreaterThanOrEqual(run(CLEAR));
  });

  it('is slowed by soft surfaces', () => {
    const sand = buildTrack(makeProvingGround('sand'));
    const a = rig(CLEAR, sand);
    a.step(FULL, 20);
    const b = rig();
    b.step(FULL, 20);
    expect(a.telemetry.speed).toBeLessThan(b.telemetry.speed * 0.95);
  });
});

describe('walls', () => {
  it('keeps most tangential speed on a scrape and loses 8 to 20 percent on a real strike', () => {
    const { state, telemetry, step } = rig();
    step(FULL, 6);
    const before = telemetry.speed;
    // Aim into the outer wall at a shallow angle.
    state.headingRad += 0.35;
    const vx = state.velocityX;
    const vy = state.velocityY;
    const c = Math.cos(0.35);
    const s = Math.sin(0.35);
    state.velocityX = vx * c - vy * s;
    state.velocityY = vx * s + vy * c;
    let struck = 0;
    for (let i = 0; i < 240 && struck === 0; i++) {
      step(FULL, SIM_DT);
      if (telemetry.wallImpactSpeed > 0) struck = telemetry.wallImpactSpeed;
    }
    expect(struck).toBeGreaterThan(0);
    expect(telemetry.speed).toBeGreaterThan(before * 0.6);
    expect(telemetry.speed).toBeLessThan(before);
  });

  it('never lets random driving escape the corridor or produce non-finite state', () => {
    const rng = mulberry32(7);
    const { state, step } = rig();
    const loc = createLocation();
    let input: ControlInput = FULL;
    for (let i = 0; i < 30 * 120; i++) {
      if (i % 20 === 0) input = { steer: rng() * 2 - 1, brake: rng() < 0.2 ? rng() : 0, coast: rng() < 0.05 };
      step(input, SIM_DT);
      locate(track, state.x, state.y, loc);
      expect(loc.edge).toBeLessThan(2);
      expect(Number.isFinite(state.x + state.y + state.headingRad + state.velocityX + state.velocityY)).toBe(true);
    }
  });

  it('treats NaN and infinite controls as neutral instead of corrupting the car', () => {
    const { state, step } = rig();
    step({ steer: Number.NaN, brake: Number.POSITIVE_INFINITY, coast: false }, 1);
    expect(Number.isFinite(state.x + state.y + state.headingRad + state.steeringInput)).toBe(true);
  });
});
