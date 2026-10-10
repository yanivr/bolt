import type {
  ControlInput,
  RaceEnvironment,
  TrackRuntime,
  VehicleMotionState,
  VehicleParams,
  VehicleTelemetry,
} from '@bolt/shared';
import {
  SIM_DT,
  angleDelta,
  buildTrack,
  clamp,
  createDriveSession,
  createLocation,
  createMotionState,
  createStepScratch,
  createTelemetry,
  directionToControl,
  driveForceAt,
  headingFromVector,
  lapPosition,
  locate,
  sampleBranch,
  stepDriveSession,
  stepVehicle,
} from '@bolt/shared';
import { PAD_START, makeSkidPad } from './pad.js';

/**
 * Headless handling bench. It drives the shared integrator with scripted control traces on an
 * open skid pad and reduces each run to the numbers a driver feels: how much yaw a given stick
 * buys at a given speed, how quickly it arrives, whether it overshoots, how hard it jerks, how
 * far the tail steps out, and whether a little more stick always means a little more turn.
 *
 * Everything here is deterministic. `tests/feel/report.ts` prints the tables and
 * `tests/feel/handling.test.ts` enforces the acceptance thresholds.
 */

export const DRY: RaceEnvironment = { weather: 'clear', wetness: 0 };
export const DEG = 180 / Math.PI;

let pad: TrackRuntime | null = null;
export function skidPad(): TrackRuntime {
  pad ??= buildTrack(makeSkidPad());
  return pad;
}

export type Rig = {
  state: VehicleMotionState;
  telemetry: VehicleTelemetry;
  params: VehicleParams;
  step: (input: ControlInput) => void;
};

/** A car on the pad heading west at `speed`, already rolling. */
export function makeRig(params: VehicleParams, speed = 0, env: RaceEnvironment = DRY): Rig {
  const track = skidPad();
  const heading = headingFromVector(-1, 0);
  const state = createMotionState(PAD_START.x, PAD_START.y, heading);
  state.velocityX = Math.sin(heading) * speed;
  state.velocityY = -Math.cos(heading) * speed;
  const telemetry = createTelemetry();
  telemetry.speed = speed;
  telemetry.forwardSpeed = speed;
  const scratch = createStepScratch();
  return {
    state,
    telemetry,
    params,
    step: (input) => stepVehicle(state, input, params, env, track, SIM_DT, scratch, telemetry),
  };
}

/**
 * A rig with a speed governor: the engine is throttled each tick to hold `speed`, never above
 * its real output. A steering trace can then be studied at one speed, and if the real engine
 * cannot hold that speed through the manoeuvre the speed falls, exactly as it would in play.
 */
export function governedRig(params: VehicleParams, speed: number, env: RaceEnvironment = DRY): Rig {
  const live = { ...params };
  const rig = makeRig(live, speed, env);
  const unit = driveForceAt({ ...params, driveForce: 1 }, speed);
  const hold = (params.dragLinear * speed + params.dragQuadratic * speed * speed + 4 * params.massKg) / unit;
  const step = rig.step;
  rig.step = (input) => {
    const error = speed - rig.telemetry.forwardSpeed;
    live.driveForce = clamp(hold + (error * 6 * params.massKg) / unit, 0, params.driveForce);
    step(input);
  };
  return rig;
}

export function topSpeed(params: VehicleParams): number {
  const rig = makeRig(params, 150);
  for (let i = 0; i < 30 * 25; i++) rig.step({ steer: 0, brake: 0, coast: false });
  return rig.telemetry.speed;
}

export type Trace = {
  t: number[];
  steer: number[];
  yaw: number[];
  heading: number[];
  slipDeg: number[];
  speed: number[];
  /** Rate of change of the direction of travel: what the path actually does. */
  pathYaw: number[];
  x: number[];
  y: number[];
};

export function record(rig: Rig, seconds: number, control: (t: number, rig: Rig) => ControlInput): Trace {
  const tr: Trace = { t: [], steer: [], yaw: [], heading: [], slipDeg: [], speed: [], pathYaw: [], x: [], y: [] };
  let lastDir = headingFromVector(rig.state.velocityX, rig.state.velocityY);
  let heading = 0;
  let lastHeading = rig.state.headingRad;
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    const t = i * SIM_DT;
    const input = control(t, rig);
    rig.step(input);
    const s = rig.state;
    const speed = Math.hypot(s.velocityX, s.velocityY);
    const dir = speed > 1 ? headingFromVector(s.velocityX, s.velocityY) : lastDir;
    heading += angleDelta(lastHeading, s.headingRad);
    lastHeading = s.headingRad;
    tr.t.push(t + SIM_DT);
    tr.steer.push(input.steer);
    tr.yaw.push(s.yawRate);
    tr.heading.push(heading);
    tr.slipDeg.push(rig.telemetry.slipAngle * DEG);
    tr.speed.push(speed);
    tr.pathYaw.push(angleDelta(lastDir, dir) / SIM_DT);
    tr.x.push(s.x);
    tr.y.push(s.y);
    lastDir = dir;
  }
  return tr;
}

function mean(values: number[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i]!;
  return sum / Math.max(1, to - from);
}

export type StepResponse = {
  speed: number;
  steer: number;
  /** Steady yaw rate in degrees per second. */
  yawDeg: number;
  /** Steady path radius in world pixels. */
  radius: number;
  /** Steady lateral acceleration in world pixels per second squared. */
  lateralAccel: number;
  /** Seconds from the stick moving until yaw reaches 90 percent of its steady value. */
  t90: number;
  overshootPct: number;
  /** Largest yaw acceleration, degrees per second squared. */
  peakYawAccel: number;
  /** Largest change of yaw acceleration between ticks, degrees per second cubed. */
  peakYawJerk: number;
  slipDeg: number;
  peakSlipDeg: number;
  endSpeed: number;
};

/** The stick jumps from centre to `steer` at t = 0 and stays there. */
export function stepSteer(params: VehicleParams, speed: number, steer: number, seconds = 3): StepResponse {
  const rig = governedRig(params, speed);
  const tr = record(rig, seconds, () => ({ steer, brake: 0, coast: false }));
  const n = tr.t.length;
  const tail = Math.round(0.5 / SIM_DT);
  const yawSS = mean(tr.yaw, n - tail, n);
  const pathSS = mean(tr.pathYaw, n - tail, n);
  const speedSS = mean(tr.speed, n - tail, n);
  let t90 = seconds;
  for (let i = 0; i < n; i++) {
    if (Math.abs(tr.yaw[i]!) >= 0.9 * Math.abs(yawSS)) {
      t90 = tr.t[i]!;
      break;
    }
  }
  let peak = 0;
  let peakAccel = 0;
  let peakJerk = 0;
  let lastAccel = 0;
  let peakSlip = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(tr.yaw[i]!));
    const accel = (tr.yaw[i]! - (i > 0 ? tr.yaw[i - 1]! : 0)) / SIM_DT;
    peakAccel = Math.max(peakAccel, Math.abs(accel));
    peakJerk = Math.max(peakJerk, Math.abs(accel - lastAccel) / SIM_DT);
    lastAccel = accel;
    peakSlip = Math.max(peakSlip, Math.abs(tr.slipDeg[i]!));
  }
  return {
    speed,
    steer,
    yawDeg: yawSS * DEG,
    radius: Math.abs(pathSS) > 1e-6 ? speedSS / Math.abs(pathSS) : Infinity,
    lateralAccel: speedSS * Math.abs(pathSS),
    t90,
    overshootPct: Math.abs(yawSS) > 1e-6 ? (peak / Math.abs(yawSS) - 1) * 100 : 0,
    peakYawAccel: peakAccel * DEG,
    peakYawJerk: peakJerk * DEG,
    slipDeg: Math.abs(mean(tr.slipDeg, n - tail, n)),
    peakSlipDeg: peakSlip,
    endSpeed: speedSS,
  };
}

/**
 * Path response to a ten percent change of stick, as an elasticity: 1.0 means ten percent more
 * stick tightens the path by ten percent. Zero or negative means more stick did nothing or
 * made the car run wider, which is what an unpredictable car feels like.
 */
export function pathElasticity(params: VehicleParams, speed: number, steer: number): number {
  const a = stepSteer(params, speed, steer);
  const b = stepSteer(params, speed, Math.min(1, steer * 1.1));
  const ratio = Math.min(1, steer * 1.1) / steer;
  return Math.log(a.radius / b.radius) / Math.log(ratio);
}

export type SweepResult = {
  speed: number;
  /** Largest fall in path yaw rate while the stick is still increasing, as a share of the peak. */
  worstReversalPct: number;
  /** Largest tick-to-tick change in lateral acceleration, world pixels per second squared. */
  worstAccelStep: number;
  peakSlipDeg: number;
};

/** The stick moves smoothly from centre to full lock over `seconds`. */
export function slowSweep(params: VehicleParams, speed: number, seconds = 4): SweepResult {
  const rig = governedRig(params, speed);
  const tr = record(rig, seconds, (t) => ({ steer: Math.min(1, t / seconds), brake: 0, coast: false }));
  // Smooth over a third of a second so tick noise is not mistaken for a reversal.
  const win = 10;
  const smooth: number[] = [];
  for (let i = win; i < tr.t.length; i++) smooth.push(mean(tr.pathYaw, i - win, i));
  let best = 0;
  let worst = 0;
  for (const v of smooth) {
    best = Math.max(best, Math.abs(v));
    worst = Math.max(worst, best - Math.abs(v));
  }
  let accelStep = 0;
  let peakSlip = 0;
  for (let i = 1; i < tr.t.length; i++) {
    const a0 = tr.pathYaw[i - 1]! * tr.speed[i - 1]!;
    const a1 = tr.pathYaw[i]! * tr.speed[i]!;
    accelStep = Math.max(accelStep, Math.abs(a1 - a0));
    peakSlip = Math.max(peakSlip, Math.abs(tr.slipDeg[i]!));
  }
  return {
    speed,
    worstReversalPct: best > 0 ? (worst / best) * 100 : 0,
    worstAccelStep: accelStep,
    peakSlipDeg: peakSlip,
  };
}

export type FlickResult = {
  speed: number;
  headingChangeDeg: number;
  /** Seconds after release until yaw stays under three degrees per second. */
  settle: number;
  /** Largest yaw the other way after release, degrees per second. */
  reboundDeg: number;
  peakYawDeg: number;
};

/** Full lock for `hold` seconds, then let go. A thumb twitch. */
export function flick(params: VehicleParams, speed: number, hold = 0.15): FlickResult {
  const rig = governedRig(params, speed);
  const tr = record(rig, hold + 2, (t) => ({ steer: t < hold ? 1 : 0, brake: 0, coast: false }));
  let settle = 0;
  let rebound = 0;
  let peak = 0;
  for (let i = 0; i < tr.t.length; i++) {
    const yaw = tr.yaw[i]! * DEG;
    peak = Math.max(peak, yaw);
    if (tr.t[i]! > hold) {
      if (Math.abs(yaw) > 3) settle = tr.t[i]! - hold;
      rebound = Math.max(rebound, -yaw);
    }
  }
  return {
    speed,
    headingChangeDeg: tr.heading[tr.heading.length - 1]! * DEG,
    settle,
    reboundDeg: rebound,
    peakYawDeg: peak,
  };
}

export type SlalomResult = {
  speed: number;
  yawAmplitudeDeg: number;
  /** Delay between the stick and the yaw it produces, milliseconds. */
  lagMs: number;
  peakSlipDeg: number;
  /** Left and right peaks should match; this is their mismatch in percent. */
  asymmetryPct: number;
};

export function slalom(params: VehicleParams, speed: number, hz = 0.8, amplitude = 0.7): SlalomResult {
  const rig = governedRig(params, speed);
  const seconds = 5 / hz;
  const tr = record(rig, seconds, (t) => ({
    steer: amplitude * Math.sin(2 * Math.PI * hz * t),
    brake: 0,
    coast: false,
  }));
  // Skip the first cycle, then find the lag that best lines yaw up with the stick.
  const from = Math.round(1 / hz / SIM_DT);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag < 20; lag++) {
    let score = 0;
    for (let i = from; i < tr.t.length; i++) score += tr.yaw[i]! * tr.steer[i - lag]!;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  let hi = 0;
  let lo = 0;
  let slip = 0;
  for (let i = from; i < tr.t.length; i++) {
    hi = Math.max(hi, tr.yaw[i]!);
    lo = Math.min(lo, tr.yaw[i]!);
    slip = Math.max(slip, Math.abs(tr.slipDeg[i]!));
  }
  return {
    speed,
    yawAmplitudeDeg: ((hi - lo) / 2) * DEG,
    lagMs: bestLag * SIM_DT * 1000,
    peakSlipDeg: slip,
    asymmetryPct: (Math.abs(hi + lo) / Math.max(1e-6, hi - lo)) * 200,
  };
}

export type BrakeTurnResult = {
  entrySpeed: number;
  peakSlipDeg: number;
  headingChangeDeg: number;
  endSpeed: number;
  /** True when the car ended up pointing more than 60 degrees away from where it travels. */
  spun: boolean;
};

/** From top speed: most of the brake and most of the lock together for 1.5 seconds. */
export function brakeAndTurn(params: VehicleParams): BrakeTurnResult {
  const entry = topSpeed(params);
  const rig = makeRig(params, entry);
  const tr = record(rig, 1.5, () => ({ steer: 0.7, brake: 0.8, coast: false }));
  let slip = 0;
  for (const s of tr.slipDeg) slip = Math.max(slip, Math.abs(s));
  return {
    entrySpeed: entry,
    peakSlipDeg: slip,
    headingChangeDeg: tr.heading[tr.heading.length - 1]! * DEG,
    endSpeed: tr.speed[tr.speed.length - 1]!,
    spun: slip > 60,
  };
}

// --- Direction steering ---------------------------------------------------------------------

function stickToward(headingRad: number): { x: number; y: number } {
  return { x: Math.sin(headingRad), y: -Math.cos(headingRad) };
}

export type HeadingStepResult = {
  speed: number;
  deltaDeg: number;
  /** Seconds until the nose has covered 90 percent of the change. */
  t90: number;
  /** Furthest the nose swings past the target, degrees. */
  overshootDeg: number;
  /** Seconds until the nose stays within two degrees of the target. */
  settle: number;
  /** Times the commanded steering changed sign: more than one means hunting. */
  reversals: number;
  peakYawJerk: number;
  peakSlipDeg: number;
  minSpeed: number;
  /** Heading covered half a second in, degrees. */
  at500ms: number;
};

/** The stick snaps to a heading `deltaDeg` to the right of the nose and is held there. */
export function headingStep(
  params: VehicleParams,
  speed: number,
  deltaDeg: number,
  seconds = 5,
  stickMagnitude = 1,
): HeadingStepResult {
  const rig = governedRig(params, speed);
  const target = rig.state.headingRad + deltaDeg / DEG;
  const stick = stickToward(target);
  let reversals = 0;
  let lastSign = 0;
  const tr = record(rig, seconds, () => {
    const c = directionToControl(
      stick.x * stickMagnitude,
      stick.y * stickMagnitude,
      rig.state,
      rig.params,
      rig.telemetry.grip,
    );
    const sign = Math.abs(c.steer) > 0.02 ? Math.sign(c.steer) : 0;
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) reversals++;
    if (sign !== 0) lastSign = sign;
    return c;
  });
  const goal = deltaDeg;
  let t90 = seconds;
  let over = 0;
  let settle = 0;
  let jerk = 0;
  let lastAccel = 0;
  let slip = 0;
  let minSpeed = Infinity;
  let at500 = 0;
  let reached = false;
  for (let i = 0; i < tr.t.length; i++) {
    const h = tr.heading[i]! * DEG;
    if (!reached && h >= 0.9 * goal) {
      t90 = tr.t[i]!;
      reached = true;
    }
    over = Math.max(over, h - goal);
    if (Math.abs(h - goal) > 2) settle = tr.t[i]!;
    const accel = (tr.yaw[i]! - (i > 0 ? tr.yaw[i - 1]! : 0)) / SIM_DT;
    jerk = Math.max(jerk, Math.abs(accel - lastAccel) / SIM_DT);
    lastAccel = accel;
    slip = Math.max(slip, Math.abs(tr.slipDeg[i]!));
    minSpeed = Math.min(minSpeed, tr.speed[i]!);
    if (Math.abs(tr.t[i]! - 0.5) < SIM_DT / 2) at500 = h;
  }
  return {
    speed,
    deltaDeg,
    t90,
    overshootDeg: over,
    settle,
    reversals,
    peakYawJerk: jerk * DEG,
    peakSlipDeg: slip,
    minSpeed,
    at500ms: at500,
  };
}

export type NoiseResult = { speed: number; headingWobbleDeg: number; steerWobble: number };

/** A thumb that trembles: the stick angle wobbles by `amplitudeDeg` at `hz` around straight ahead. */
export function stickNoise(params: VehicleParams, speed: number, amplitudeDeg = 5, hz = 6): NoiseResult {
  const rig = governedRig(params, speed);
  const base = rig.state.headingRad;
  let steerHi = 0;
  const tr = record(rig, 4, (t) => {
    const stick = stickToward(base + (amplitudeDeg / DEG) * Math.sin(2 * Math.PI * hz * t));
    const c = directionToControl(stick.x, stick.y, rig.state, rig.params, rig.telemetry.grip);
    if (t > 1) steerHi = Math.max(steerHi, Math.abs(c.steer));
    return c;
  });
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 30; i < tr.t.length; i++) {
    hi = Math.max(hi, tr.heading[i]!);
    lo = Math.min(lo, tr.heading[i]!);
  }
  return { speed, headingWobbleDeg: ((hi - lo) / 2) * DEG, steerWobble: steerHi };
}

export type PullBackResult = {
  entrySpeed: number;
  /** Seconds from pulling straight back until the car is stopped. */
  stopSeconds: number;
  /** Sideways drift of the nose while braking, degrees: a straight pull should brake straight. */
  headingDriftDeg: number;
  /** Seconds from pulling back until the car is rolling backwards. */
  reverseSeconds: number;
  /** After two more seconds pointing forward again, the car is driving forward. */
  recovers: boolean;
};

/** From speed: pull the stick straight back and hold it, then point forward again. */
export function pullBack(params: VehicleParams, speed: number): PullBackResult {
  const rig = makeRig(params, speed);
  const base = rig.state.headingRad;
  const back = stickToward(base + Math.PI);
  const ahead = stickToward(base);
  let stop = -1;
  let reverse = -1;
  let drift = 0;
  const tr = record(rig, 8, () =>
    directionToControl(back.x, back.y, rig.state, rig.params, rig.telemetry.grip),
  );
  for (let i = 0; i < tr.t.length; i++) {
    drift = Math.max(drift, Math.abs(tr.heading[i]! * DEG));
    if (stop < 0 && tr.speed[i]! < 2) stop = tr.t[i]!;
    if (reverse < 0 && rig.state.reversing && stop >= 0) reverse = tr.t[i]!;
  }
  // `reversing` is read after the run; find when backward motion actually began.
  reverse = -1;
  for (let i = 1; i < tr.t.length; i++) {
    const dx = tr.x[i]! - tr.x[i - 1]!;
    const dy = tr.y[i]! - tr.y[i - 1]!;
    const along = dx * Math.sin(base) + dy * -Math.cos(base);
    if (along < -0.2) {
      reverse = tr.t[i]!;
      break;
    }
  }
  record(rig, 2.5, () => directionToControl(ahead.x, ahead.y, rig.state, rig.params, rig.telemetry.grip));
  return {
    entrySpeed: speed,
    stopSeconds: stop,
    headingDriftDeg: drift,
    reverseSeconds: reverse,
    recovers: rig.telemetry.forwardSpeed > 20,
  };
}

// --- A driver who only points ---------------------------------------------------------------

export type PointingLap = {
  finished: boolean;
  seconds: number;
  wallStrikes: number;
  worstStrike: number;
  peakSlipDeg: number;
};

/**
 * The simplest plausible player in direction mode: the stick always points at the road a
 * fixed time ahead, pushed fully, and the brake is never deliberately used. If this driver
 * can finish a race cleanly, pointing where you want to go is enough to drive the track.
 */
export function pointingLap(
  track: TrackRuntime,
  env: RaceEnvironment,
  params: VehicleParams,
  lookAheadSeconds: number,
): PointingLap {
  const session = createDriveSession(track, env, params);
  const loc = createLocation();
  let strikes = 0;
  let worst = 0;
  let slip = 0;
  for (let i = 0; i < 30 * 200 && session.phase !== 'FINISHED'; i++) {
    const m = session.motion;
    locate(track, m.x, m.y, loc);
    const speed = Math.hypot(m.velocityX, m.velocityY);
    const aim = sampleBranch(
      track.main,
      track.startS + lapPosition(track, loc) + 40 + speed * lookAheadSeconds,
    );
    const dx = aim.x - m.x;
    const dy = aim.y - m.y;
    const len = Math.hypot(dx, dy) || 1;
    stepDriveSession(
      session,
      directionToControl(dx / len, dy / len, m, params, session.telemetry.grip),
    );
    if (session.telemetry.wallImpactSpeed > 0) {
      strikes++;
      worst = Math.max(worst, session.telemetry.wallImpactSpeed);
    }
    slip = Math.max(slip, Math.abs(session.telemetry.slipAngle) * DEG);
  }
  return {
    finished: session.progress.finishedAtMs !== null,
    seconds: session.raceTicks * SIM_DT,
    wallStrikes: strikes,
    worstStrike: worst,
    peakSlipDeg: slip,
  };
}
