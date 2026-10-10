import { CAR_HEADINGS, SIM_DT, TAU, angleDelta, clamp, expBlend, lerp } from '@bolt/shared';

/**
 * Everything the race view computes between "a frame is due" and "tell the renderer where
 * things go", with no Phaser and no DOM in it. The scene calls this module every frame and so
 * does the frame-pacing bench in `tests/feel`, so what is measured is what ships.
 *
 * The world is always drawn north-up at a whole number of device pixels per world pixel. The
 * camera never rotates and never zooms. Because of that, the ground and the car can both be
 * placed on the device pixel grid, and they are: there is no sub-pixel difference between them
 * to shimmer.
 */

// --- View scale -------------------------------------------------------------------------------

/** World pixels the long side of the view should show: 15 to 16 car lengths. */
export const VIEW_LONG_TARGET = 900;
export const VIEW_LONG_MIN = 760;
export const VIEW_LONG_MAX = 1040;
const MAX_NATIVE_RATIO = 3;

export type ViewScale = {
  /** Canvas pixels per CSS pixel. Equal to the capped device pixel ratio when `native`. */
  renderRatio: number;
  /** Whole canvas pixels per world pixel. */
  scale: number;
  /** True when one canvas pixel is one device pixel, so nothing is resampled. */
  native: boolean;
};

/**
 * Picks the whole-number world scale whose view is closest to the target width. When the
 * device's own resolution puts that view inside the allowed band, the canvas is rendered at
 * device resolution. When it cannot (a few laptop and small-phone sizes), the canvas is sized
 * so the same whole-number scale shows the nearest allowed width and the browser resamples the
 * finished frame by a few percent. Either way every player sees about the same amount of road.
 */
export function chooseViewScale(cssWidth: number, cssHeight: number, devicePixelRatio: number): ViewScale {
  const ratio = clamp(devicePixelRatio || 1, 1, MAX_NATIVE_RATIO);
  const cssLong = Math.max(cssWidth, cssHeight, 1);
  const deviceLong = cssLong * ratio;
  let scale = Math.max(1, Math.round(deviceLong / VIEW_LONG_TARGET));
  // Prefer the neighbouring scale if it lands nearer the target in proportion.
  for (const candidate of [scale - 1, scale + 1]) {
    if (candidate < 1) continue;
    const a = Math.abs(Math.log(deviceLong / candidate / VIEW_LONG_TARGET));
    const b = Math.abs(Math.log(deviceLong / scale / VIEW_LONG_TARGET));
    if (a < b) scale = candidate;
  }
  const view = deviceLong / scale;
  if (view >= VIEW_LONG_MIN && view <= VIEW_LONG_MAX) return { renderRatio: ratio, scale, native: true };
  const wanted = clamp(view, VIEW_LONG_MIN, VIEW_LONG_MAX);
  return { renderRatio: (wanted * scale) / cssLong, scale, native: false };
}

// --- Frame pacing -----------------------------------------------------------------------------

const KNOWN_REFRESH_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
const PACER_HISTORY = 24;
/** A gap longer than this is a pause (tab switch, system dialog), not a slow frame. */
const PACER_GAP_MS = 250;

/**
 * Turns frame timestamps into the time each frame should advance the picture by.
 *
 * Frames reach the glass on the display's refresh, evenly spaced, but the timestamps a browser
 * hands out wobble by a millisecond or two and some are rounded. Advancing the picture by
 * those raw gaps makes steady motion visibly uneven. The pacer works out the display's refresh
 * period from recent frames and advances by a whole number of periods: one for a normal frame,
 * two when a frame was dropped. A dropped frame therefore shows as exactly one doubled step,
 * which is what really happened, and nothing is smeared over the frames after it. A slow
 * correction keeps game time locked to real time. When the frame rate is not a steady refresh
 * (a struggling device), raw gaps are used unchanged.
 */
export class FramePacer {
  private last = Number.NaN;
  private history: number[] = [];
  private sorted: number[] = [];
  private debt = 0;
  /** Estimated refresh period in milliseconds, or 0 while unknown or unsteady. */
  periodMs = 0;

  reset(): void {
    this.last = Number.NaN;
    this.history.length = 0;
    this.debt = 0;
    this.periodMs = 0;
  }

  /** Returns the seconds to advance for the frame stamped `timestampMs`. */
  advance(timestampMs: number): number {
    if (Number.isNaN(this.last)) {
      this.last = timestampMs;
      return 0;
    }
    const raw = timestampMs - this.last;
    this.last = timestampMs;
    if (!(raw > 0)) return 0;
    if (raw > PACER_GAP_MS) {
      // Resume from a pause as if one ordinary frame had passed.
      this.debt = 0;
      return (this.periodMs > 0 ? this.periodMs : 1000 / 60) / 1000;
    }
    this.history.push(raw);
    if (this.history.length > PACER_HISTORY) this.history.shift();
    this.periodMs = this.estimatePeriod();
    const period = this.periodMs;
    if (period <= 0) {
      this.debt = 0;
      return raw / 1000;
    }
    const spans = Math.max(1, Math.round(raw / period));
    if (spans > 4 || Math.abs(raw - spans * period) > period * 0.35) {
      this.debt = 0;
      return raw / 1000;
    }
    // Keep long-run game time equal to real time without disturbing any one frame.
    this.debt += raw - spans * period;
    if (Math.abs(this.debt) > period * 1.5) {
      // Real time is running away from the estimate: the display changed its refresh rate
      // (adaptive panels do) or the estimate was wrong. Start again from raw gaps.
      const owed = this.debt;
      this.history.length = 0;
      this.periodMs = 0;
      this.debt = 0;
      return Math.max(0, spans * period + owed) / 1000;
    }
    const repay = clamp(this.debt * 0.03, -period * 0.02, period * 0.02);
    this.debt -= repay;
    return (spans * period + repay) / 1000;
  }

  private estimatePeriod(): number {
    const n = this.history.length;
    if (n < 8) return 0;
    // Once locked to a refresh rate, stay locked while most recent frames still fit it. Noisy
    // timestamps must not be able to knock the pacer out for a frame or two.
    if (this.periodMs > 0 && this.fit(this.periodMs) >= 0.7) return this.periodMs;
    const sorted = this.sorted;
    sorted.length = 0;
    for (let i = 0; i < n; i++) sorted.push(this.history[i]!);
    sorted.sort((a, b) => a - b);
    // Dropped frames are longer, never shorter, so a value just under the median is a
    // single-refresh frame even when a fair share of frames drop.
    const typical = sorted[Math.floor(n * 0.4)]!;
    for (const hz of KNOWN_REFRESH_HZ) {
      const candidate = 1000 / hz;
      if (Math.abs(typical - candidate) <= candidate * 0.07 && this.fit(candidate) >= 0.85)
        return candidate;
    }
    return 0;
  }

  /** Share of recent frames that are a whole number of `period`s long, within tolerance. */
  private fit(period: number): number {
    const n = this.history.length;
    let steady = 0;
    for (let i = 0; i < n; i++) {
      const raw = this.history[i]!;
      const spans = Math.max(1, Math.round(raw / period));
      if (Math.abs(raw - spans * period) <= period * 0.35) steady++;
    }
    return steady / n;
  }
}

// --- Fixed simulation steps -------------------------------------------------------------------

/**
 * Most simulation steps one frame may run: enough to absorb any frame gap the pacer still
 * counts as a slow frame, so a hitch never loses game time. Beyond this the game slows rather
 * than spirals.
 */
export const MAX_STEPS_PER_FRAME = 8;

/** Accumulates frame time and says how many fixed simulation steps are due. */
export class StepClock {
  private accumulator = 0;

  reset(): void {
    this.accumulator = 0;
  }

  advance(dtSeconds: number): number {
    this.accumulator += dtSeconds;
    let steps = Math.floor(this.accumulator / SIM_DT + 1e-9);
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      this.accumulator = steps * SIM_DT;
    }
    this.accumulator = Math.max(0, this.accumulator - steps * SIM_DT);
    return steps;
  }

  /** Position between the previous and the current simulation state, 0 to 1. */
  get alpha(): number {
    return clamp(this.accumulator / SIM_DT, 0, 1);
  }
}

// --- Interpolation ----------------------------------------------------------------------------

export type SimPose = { x: number; y: number; heading: number; vx: number; vy: number };

function copyPose(from: SimPose, to: SimPose): void {
  to.x = from.x;
  to.y = from.y;
  to.heading = from.heading;
  to.vx = from.vx;
  to.vy = from.vy;
}

/** The last two simulation states of the local car, blended for the frame being drawn. */
export class PoseBuffer {
  readonly prev: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
  readonly curr: SimPose = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };

  reset(pose: SimPose): void {
    copyPose(pose, this.prev);
    copyPose(pose, this.curr);
  }

  /** Call once after each simulation step with the new state. */
  push(pose: SimPose): void {
    copyPose(this.curr, this.prev);
    copyPose(pose, this.curr);
  }

  /**
   * A server correction moved the predicted car by this much. Both ends of the blend move with
   * it and the newest state is replaced, so the blend stays continuous; the visible catch-up
   * is carried by the predictor's decaying offset.
   */
  rebase(pose: SimPose, dx: number, dy: number, dHeading: number): void {
    this.prev.x += dx;
    this.prev.y += dy;
    this.prev.heading += dHeading;
    copyPose(pose, this.curr);
  }

  sample(alpha: number, out: SimPose): void {
    const a = this.prev;
    const b = this.curr;
    out.x = lerp(a.x, b.x, alpha);
    out.y = lerp(a.y, b.y, alpha);
    out.heading = a.heading + angleDelta(a.heading, b.heading) * alpha;
    out.vx = lerp(a.vx, b.vx, alpha);
    out.vy = lerp(a.vy, b.vy, alpha);
  }
}

// --- Camera -----------------------------------------------------------------------------------

/**
 * How far the camera leads the car at speed, as a share of the view. The view is wider than it
 * is tall, so driving up or down the screen is the hard case: with the car this far behind
 * centre there is still more than a second of road ahead of it at top speed.
 */
export const LEAD_FRACTION_X = 0.12;
export const LEAD_FRACTION_Y = 0.27;
/** Speed, world pixels per second, at which the lead is all but fully out. */
export const LEAD_FULL_SPEED = 230;
/**
 * The lead follows the car's velocity through two equal low-pass stages with this time
 * constant each. Two stages mean the camera's own speed has no step in it, so the car never
 * appears to jerk on screen when it changes direction, and a critically damped pair cannot
 * overshoot or oscillate.
 */
export const LEAD_TIME = 0.2;
const SHAKE_LIMIT = 3;
/** A car that moves this far in one frame was placed, not driven: cut instead of panning. */
const TELEPORT_DISTANCE = 220;

export type CameraView = {
  /** Canvas size in device pixels. */
  widthPx: number;
  heightPx: number;
  /** Whole device pixels per world pixel. */
  scale: number;
  worldWidth: number;
  worldHeight: number;
};

/** Visible road ahead of the car, in world pixels, when travelling steadily along a unit direction. */
export function steadyLookAhead(view: CameraView, dirX: number, dirY: number, speed: number): number {
  const w = view.widthPx / view.scale;
  const h = view.heightPx / view.scale;
  const lead = leadTarget(view, dirX * speed, dirY * speed);
  // The car sits at minus the lead from the centre of the view. Distance from there to the
  // view edge along the direction of travel:
  const tx = dirX > 1e-9 ? (w / 2 + lead.x) / dirX : dirX < -1e-9 ? (-w / 2 + lead.x) / dirX : Infinity;
  const ty = dirY > 1e-9 ? (h / 2 + lead.y) / dirY : dirY < -1e-9 ? (-h / 2 + lead.y) / dirY : Infinity;
  return Math.min(tx, ty);
}

function leadTarget(view: CameraView, vx: number, vy: number): { x: number; y: number } {
  const nx = vx / LEAD_FULL_SPEED;
  const ny = vy / LEAD_FULL_SPEED;
  const m = Math.hypot(nx, ny);
  if (m < 1e-6) return { x: 0, y: 0 };
  // Smooth saturation: proportional to speed when slow, levelling off toward 1 with no corner.
  const gain = 1 / Math.pow(1 + m * m * m * m, 0.25);
  return {
    x: nx * gain * LEAD_FRACTION_X * (view.widthPx / view.scale),
    y: ny * gain * LEAD_FRACTION_Y * (view.heightPx / view.scale),
  };
}

/**
 * North-up follow camera. It holds the car at the centre of the view, shifted back along the
 * direction of travel so the road ahead is visible, and expresses everything in whole device
 * pixels.
 *
 * Snapping is done in two parts on purpose. The car's world position is rounded to the device
 * grid, and the lead offset is rounded separately. The scroll is their sum. While the lead is
 * steady the car's place on screen is therefore a constant whole number, and the ground moves
 * by exactly the car's own (rounded) movement: neither can flicker against the other or
 * against the screen.
 */
export class FollowCamera {
  private view: CameraView = { widthPx: 2, heightPx: 2, scale: 1, worldWidth: 1, worldHeight: 1 };
  private stageX = 0;
  private stageY = 0;
  leadX = 0;
  leadY = 0;
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private shakeAmount = 0;
  private shakeTime = 0;
  private shakeSeed = 1;
  /** Top-left corner of the view in device pixels, always whole. */
  scrollPxX = 0;
  scrollPxY = 0;
  /** Where the car is drawn, in device pixels from the world origin, always whole. */
  carPxX = 0;
  carPxY = 0;
  /** Camera shake this frame in device pixels. Already included in the scroll. */
  shakePxX = 0;
  shakePxY = 0;
  /**
   * The scroll before rounding and without shake, device pixels. Nothing is drawn from these;
   * the pacing bench uses them to tell real stutter from the one-pixel grain of snapping.
   */
  exactScrollPxX = 0;
  exactScrollPxY = 0;

  configure(view: CameraView): void {
    this.view = { ...view, scale: Math.max(1, Math.round(view.scale)) };
  }

  /** Forget history, for example when the car is put back on the grid. */
  cut(): void {
    this.lastX = Number.NaN;
  }

  /** Adds an impulse in world pixels. Overlapping impulses share one budget (Section 13.7). */
  kick(pixels: number, seconds: number): void {
    this.shakeAmount = Math.min(SHAKE_LIMIT, Math.max(this.shakeAmount, pixels));
    this.shakeTime = Math.max(this.shakeTime, seconds);
  }

  update(dt: number, pose: SimPose, shakeScale: number): void {
    const view = this.view;
    const s = view.scale;
    const target = leadTarget(view, pose.vx, pose.vy);
    const jumped =
      Number.isNaN(this.lastX) ||
      Math.hypot(pose.x - this.lastX, pose.y - this.lastY) > TELEPORT_DISTANCE;
    if (jumped) {
      this.stageX = this.leadX = target.x;
      this.stageY = this.leadY = target.y;
    } else {
      const k = expBlend(dt, LEAD_TIME);
      this.stageX += (target.x - this.stageX) * k;
      this.stageY += (target.y - this.stageY) * k;
      this.leadX += (this.stageX - this.leadX) * k;
      this.leadY += (this.stageY - this.leadY) * k;
    }
    this.lastX = pose.x;
    this.lastY = pose.y;

    if (this.shakeTime > 0 && shakeScale > 0) {
      this.shakeTime -= dt;
      // Stepped pseudo-random offsets: a couple of crisp jolts, not a smooth wobble.
      this.shakeSeed = (this.shakeSeed * 16807) % 2147483647;
      const a = (this.shakeSeed / 2147483647) * Math.PI * 2;
      const amount = this.shakeAmount * shakeScale * clamp(this.shakeTime / 0.12, 0, 1);
      this.shakePxX = Math.round(Math.cos(a) * amount) * s;
      this.shakePxY = Math.round(Math.sin(a) * amount) * s;
    } else {
      this.shakePxX = 0;
      this.shakePxY = 0;
      this.shakeAmount = 0;
      this.shakeTime = 0;
    }

    this.carPxX = Math.round(pose.x * s);
    this.carPxY = Math.round(pose.y * s);
    const halfW = Math.floor(view.widthPx / 2);
    const halfH = Math.floor(view.heightPx / 2);
    const maxX = Math.round(view.worldWidth * s) - view.widthPx;
    const maxY = Math.round(view.worldHeight * s) - view.heightPx;
    const freeX = this.carPxX + Math.round(this.leadX * s) - halfW;
    const freeY = this.carPxY + Math.round(this.leadY * s) - halfH;
    // Never show past the edge of the baked terrain; centre a world smaller than the view.
    const x = maxX >= 0 ? clamp(freeX, 0, maxX) : Math.round(maxX / 2);
    const y = maxY >= 0 ? clamp(freeY, 0, maxY) : Math.round(maxY / 2);
    this.scrollPxX = x + this.shakePxX;
    this.scrollPxY = y + this.shakePxY;
    const exactX = (pose.x + this.leadX) * s - halfW;
    const exactY = (pose.y + this.leadY) * s - halfH;
    this.exactScrollPxX = maxX >= 0 ? clamp(exactX, 0, maxX) : maxX / 2;
    this.exactScrollPxY = maxY >= 0 ? clamp(exactY, 0, maxY) : maxY / 2;
  }
}

// --- Car presentation -------------------------------------------------------------------------

/**
 * Chooses which authored heading frame to show. A plain round-to-nearest flips back and forth
 * whenever the heading sits on the boundary between two frames; this holds the current frame
 * until the heading is clearly inside the next one.
 */
export class HeadingLatch {
  private frame = -1;
  constructor(
    private readonly frames = CAR_HEADINGS,
    private readonly hysteresis = 0.2,
  ) {}

  reset(): void {
    this.frame = -1;
  }

  /** Returns the heading, in radians, of the frame to draw. */
  update(headingRad: number): number {
    const step = TAU / this.frames;
    if (this.frame < 0) this.frame = this.nearest(headingRad);
    else {
      const offset = angleDelta(this.frame * step, headingRad) / step;
      if (Math.abs(offset) > 0.5 + this.hysteresis) this.frame = this.nearest(headingRad);
    }
    return this.frame * step;
  }

  get index(): number {
    return this.frame;
  }

  private nearest(headingRad: number): number {
    const step = TAU / this.frames;
    return ((Math.round(headingRad / step) % this.frames) + this.frames) % this.frames;
  }
}

const LEAN_TIME = 0.12;
const PITCH_TIME = 0.15;
const LEAN_ON = [190, 345];
const LEAN_OFF = [150, 305];
const SQUAT_ON = 55;
const SQUAT_OFF = 32;
const DIVE_ON = -110;
const DIVE_OFF = -65;

/**
 * Whole-pixel body lean, squat and dive over planted wheels (Section 12.8). The offsets come
 * from low-passed accelerations and switch with hysteresis, so each shift happens once per
 * manoeuvre instead of chattering around a threshold.
 */
export class BodyMotion {
  private lateral = 0;
  private longitudinal = 0;
  private lean = 0;
  private pitch = 0;
  shiftX = 0;
  shiftY = 0;

  reset(): void {
    this.lateral = 0;
    this.longitudinal = 0;
    this.lean = 0;
    this.pitch = 0;
    this.shiftX = 0;
    this.shiftY = 0;
  }

  /**
   * `lateralAccel` is positive in a right turn, `longitudinalAccel` positive when speeding up,
   * both in world pixels per second squared. `idlePhase` is any steadily increasing time in
   * seconds, used for the idle engine shake.
   */
  update(dt: number, lateralAccel: number, longitudinalAccel: number, speed: number, idlePhase: number): void {
    this.lateral += (lateralAccel - this.lateral) * expBlend(dt, LEAN_TIME);
    this.longitudinal += (longitudinalAccel - this.longitudinal) * expBlend(dt, PITCH_TIME);

    const side = Math.abs(this.lateral);
    let level = Math.abs(this.lean);
    while (level < 2 && side > LEAN_ON[level]!) level++;
    while (level > 0 && side < LEAN_OFF[level - 1]!) level--;
    // The body rolls to the outside of the turn.
    this.lean = level === 0 ? 0 : -Math.sign(this.lateral) * level;

    if (this.pitch === 0) {
      if (this.longitudinal > SQUAT_ON) this.pitch = 1;
      else if (this.longitudinal < DIVE_ON) this.pitch = -1;
    } else if (this.pitch > 0 && this.longitudinal < SQUAT_OFF) this.pitch = 0;
    else if (this.pitch < 0 && this.longitudinal > DIVE_OFF) this.pitch = 0;

    this.shiftX = this.lean;
    this.shiftY = this.pitch;
    if (this.pitch === 0 && speed < 8 && Math.floor(idlePhase / 0.09) % 3 === 0) this.shiftY = 1;
  }
}

// --- One frame --------------------------------------------------------------------------------

export type FrameView = {
  /** Seconds this frame advanced the picture by. */
  dt: number;
  /** The car as drawn: interpolated simulation state plus any decaying correction offset. */
  pose: SimPose;
  /** Heading of the authored frame to show, radians. */
  frameHeading: number;
  /** Top-left of the view in world units; an exact multiple of one device pixel. */
  scrollX: number;
  scrollY: number;
  /** Car sprite origin in world units; an exact multiple of one device pixel. */
  carX: number;
  carY: number;
};

/**
 * The per-frame render maths in one place: pace the frame, count the simulation steps due,
 * interpolate, run the camera, snap. The caller owns the simulation itself.
 *
 *   const steps = pipeline.begin(timestamp, frozen);
 *   for (let i = 0; i < steps; i++) { ...advance the simulation...; pipeline.push(pose); }
 *   const view = pipeline.finish(errorX, errorY, errorHeading, shakeScale);
 */
export class RenderPipeline {
  readonly pacer = new FramePacer();
  readonly clock = new StepClock();
  readonly poses = new PoseBuffer();
  readonly camera = new FollowCamera();
  readonly latch = new HeadingLatch();
  private scale = 1;
  private frozen = false;
  private readonly out: FrameView = {
    dt: 0,
    pose: { x: 0, y: 0, heading: 0, vx: 0, vy: 0 },
    frameHeading: 0,
    scrollX: 0,
    scrollY: 0,
    carX: 0,
    carY: 0,
  };

  configure(view: CameraView): void {
    this.scale = Math.max(1, Math.round(view.scale));
    this.camera.configure(view);
  }

  /** Places the car without interpolating from wherever it was. */
  place(pose: SimPose): void {
    this.poses.reset(pose);
    this.camera.cut();
    this.latch.reset();
  }

  /** Seconds the frame in progress advances the picture by. */
  get frameDt(): number {
    return this.out.dt;
  }

  /** Starts a frame. Returns how many simulation steps to run before `finish`. */
  begin(timestampMs: number, frozen: boolean): number {
    const dt = this.pacer.advance(timestampMs);
    this.out.dt = dt;
    this.frozen = frozen;
    return frozen ? 0 : this.clock.advance(dt);
  }

  push(pose: SimPose): void {
    this.poses.push(pose);
  }

  finish(errorX: number, errorY: number, errorHeading: number, shakeScale: number): FrameView {
    const out = this.out;
    this.poses.sample(this.frozen ? 1 : this.clock.alpha, out.pose);
    out.pose.x += errorX;
    out.pose.y += errorY;
    out.pose.heading += errorHeading;
    this.camera.update(out.dt, out.pose, shakeScale);
    out.frameHeading = this.latch.update(out.pose.heading);
    out.scrollX = this.camera.scrollPxX / this.scale;
    out.scrollY = this.camera.scrollPxY / this.scale;
    out.carX = this.camera.carPxX / this.scale;
    out.carY = this.camera.carPxY / this.scale;
    return out;
  }
}
