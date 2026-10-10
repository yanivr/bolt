import { CITY_01, DEFAULT_LOADOUT, environmentFor, resolveLoadout } from '@bolt/content';
import type { ControlInput, DriveSession } from '@bolt/shared';
import {
  buildTrack,
  createDriveSession,
  createDriverScratch,
  driveCenterline,
  headingFromVector,
  mulberry32,
} from '@bolt/shared';
import { DRY, skidPad, topSpeed } from './handling.js';
import { PAD_START } from './pad.js';

/**
 * Frame-pacing bench. It models a display (refresh rate, timestamp noise, dropped frames),
 * feeds the resulting frame timestamps to a render pipeline, and measures what reaches the
 * glass in device pixels: how evenly the ground moves, how steadily the car sits on screen,
 * and whether the car and the ground under it ever disagree.
 *
 * The pipeline under test is whatever the caller wraps in `BenchPipeline`; the race scene and
 * this bench call the same pure module, so the numbers describe the shipped maths.
 */

export type DisplayModel = {
  hz: number;
  /** Uniform noise on the frame timestamp, plus or minus this many milliseconds. */
  jitterMs: number;
  /** Probability that a frame misses its refresh and lands on the next one. */
  dropRate: number;
  seed: number;
};

export type DisplayFrame = {
  /** Timestamp handed to the frame callback, milliseconds. */
  timestamp: number;
  /** Index of the refresh this frame is shown on. */
  refresh: number;
};

export function displayTimeline(model: DisplayModel, seconds: number): DisplayFrame[] {
  const rng = mulberry32(model.seed);
  const period = 1000 / model.hz;
  const frames: DisplayFrame[] = [];
  const total = Math.round(seconds * model.hz);
  for (let n = 0; n < total; n++) {
    // A dropped frame simply never renders for that refresh.
    if (n > 0 && rng() < model.dropRate) continue;
    const noise = model.jitterMs > 0 ? (rng() * 2 - 1) * model.jitterMs : 0;
    frames.push({ timestamp: 1000 + n * period + noise, refresh: n });
  }
  return frames;
}

export type Vec = { x: number; y: number };

export type PipelineFrame = {
  /** Where the car sprite origin is drawn, device pixels. */
  car: Vec;
  /** The world position the pipeline is rendering the car at this frame. */
  render: Vec;
  /** Where a world point is drawn this frame, device pixels. */
  project: (wx: number, wy: number) => Vec;
  /**
   * The same projection before any rounding to the pixel grid. Comparing the two separates
   * real stutter (uneven timing, a jumpy camera) from the unavoidable one-pixel grain of
   * drawing on whole pixels.
   */
  projectExact: (wx: number, wy: number) => Vec;
  /** The car's position on screen before rounding. */
  carExact: Vec;
  /** True when ground texels sit exactly on the device pixel grid this frame. */
  aligned: boolean;
  /** Heading frame index shown, when the pipeline reports one. */
  headingFrame?: number;
};

export type BenchPipeline = { frame: (timestampMs: number) => PipelineFrame };

export type BenchWorld = { session: DriveSession; control: () => ControlInput };

const env = environmentFor('city_clear_night')!;

function defaultParams() {
  const resolved = resolveLoadout(DEFAULT_LOADOUT);
  if (!resolved.ok) throw new Error('default loadout must resolve');
  return resolved.params;
}

/** The default car at a steady top speed on open asphalt, travelling along `headingRad`. */
export function straightWorld(headingRad = headingFromVector(-1, 0)): BenchWorld {
  const params = defaultParams();
  const session = createDriveSession(skidPad(), DRY, params);
  session.phase = 'RACING';
  session.countdownTicks = 0;
  const speed = topSpeed(params);
  const m = session.motion;
  m.x = PAD_START.x;
  m.y = PAD_START.y + 0.37;
  m.headingRad = headingRad;
  m.velocityX = Math.sin(headingRad) * speed;
  m.velocityY = -Math.cos(headingRad) * speed;
  return { session, control: () => ({ steer: 0, brake: 0, coast: false }) };
}

/** The reference driver lapping Neon Cut from the grid. */
export function lapWorld(): BenchWorld {
  const params = defaultParams();
  const track = buildTrack(CITY_01);
  const session = createDriveSession(track, env, params);
  const scratch = createDriverScratch();
  return {
    session,
    control: () => driveCenterline(track, session.motion, params, env, scratch),
  };
}

export type PacingResult = {
  frames: number;
  /** Mean ground speed across the screen, device pixels per refresh. */
  meanStep: number;
  /** Standard deviation of ground movement per refresh as a share of the mean, percent. */
  speedVariationPct: number;
  /**
   * Largest amount by which one frame's ground movement differs from the average of the
   * frames either side of it, device pixels per refresh. This is the stutter the eye sees.
   */
  worstGroundHitch: number;
  rmsGroundHitch: number;
  /** The same measure for the car's own position on screen. */
  worstCarHitch: number;
  /** Ground and car hitch measured before pixel rounding: timing and camera only. */
  worstGroundHitchExact: number;
  worstCarHitchExact: number;
  /** Furthest any drawn position sits from its exact position, device pixels. */
  worstSnapError: number;
  /** Largest frame-to-frame change in the offset between the car and the ground under it. */
  worstRelativeJitter: number;
  /** Share of frames in which ground texels are on the device pixel grid, percent. */
  alignedPct: number;
  /** Heading frame changes that were undone within three frames (flicker). */
  headingFlickers: number;
};

/**
 * Runs `pipeline` through `timeline` and reduces the result. `skipSeconds` drops the start so
 * camera settling is not counted as stutter.
 */
export function measure(
  pipeline: BenchPipeline,
  timeline: DisplayFrame[],
  hz: number,
  skipSeconds: number,
): PacingResult {
  const ground: Vec[] = [];
  const car: Vec[] = [];
  const groundExact: Vec[] = [];
  const carExact: Vec[] = [];
  let snapError = 0;
  const rel: Vec[] = [];
  const span: number[] = [];
  const heading: number[] = [];
  let aligned = 0;
  let last: PipelineFrame | null = null;
  let lastRefresh = 0;
  const skip = Math.round(skipSeconds * hz);
  for (const f of timeline) {
    const out = pipeline.frame(f.timestamp);
    if (last && f.refresh >= skip) {
      const k = f.refresh - lastRefresh;
      // Movement of the piece of ground the car was on, between the two frames.
      const before = last.project(last.render.x, last.render.y);
      const after = out.project(last.render.x, last.render.y);
      ground.push({ x: (after.x - before.x) / k, y: (after.y - before.y) / k });
      car.push({ x: (out.car.x - last.car.x) / k, y: (out.car.y - last.car.y) / k });
      const beforeExact = last.projectExact(last.render.x, last.render.y);
      const afterExact = out.projectExact(last.render.x, last.render.y);
      groundExact.push({ x: (afterExact.x - beforeExact.x) / k, y: (afterExact.y - beforeExact.y) / k });
      carExact.push({
        x: (out.carExact.x - last.carExact.x) / k,
        y: (out.carExact.y - last.carExact.y) / k,
      });
      snapError = Math.max(
        snapError,
        Math.abs(out.car.x - out.carExact.x),
        Math.abs(out.car.y - out.carExact.y),
        Math.abs(after.x - afterExact.x),
        Math.abs(after.y - afterExact.y),
      );
      const under = out.project(out.render.x, out.render.y);
      rel.push({ x: out.car.x - under.x, y: out.car.y - under.y });
      span.push(k);
      heading.push(out.headingFrame ?? 0);
      if (out.aligned) aligned++;
    }
    last = out;
    lastRefresh = f.refresh;
  }

  const n = ground.length;
  let sum = 0;
  for (const g of ground) sum += Math.hypot(g.x, g.y);
  const mean = sum / Math.max(1, n);
  let varSum = 0;
  for (const g of ground) varSum += (Math.hypot(g.x, g.y) - mean) ** 2;
  const hitch = (series: Vec[]): { worst: number; rms: number } => {
    let worst = 0;
    let sq = 0;
    for (let i = 1; i < series.length - 1; i++) {
      const dx = series[i]!.x - (series[i - 1]!.x + series[i + 1]!.x) / 2;
      const dy = series[i]!.y - (series[i - 1]!.y + series[i + 1]!.y) / 2;
      const d = Math.hypot(dx, dy);
      worst = Math.max(worst, d);
      sq += d * d;
    }
    return { worst, rms: Math.sqrt(sq / Math.max(1, series.length - 2)) };
  };
  const g = hitch(ground);
  const c = hitch(car);
  const gx = hitch(groundExact);
  const cx = hitch(carExact);
  let relJitter = 0;
  for (let i = 1; i < rel.length; i++)
    relJitter = Math.max(relJitter, Math.hypot(rel[i]!.x - rel[i - 1]!.x, rel[i]!.y - rel[i - 1]!.y));
  let flickers = 0;
  for (let i = 3; i < heading.length; i++) {
    if (heading[i] !== heading[i - 1] && (heading[i] === heading[i - 2] || heading[i] === heading[i - 3]))
      flickers++;
  }
  return {
    frames: n,
    meanStep: mean,
    speedVariationPct: mean > 0 ? (Math.sqrt(varSum / Math.max(1, n)) / mean) * 100 : 0,
    worstGroundHitch: g.worst,
    rmsGroundHitch: g.rms,
    worstCarHitch: c.worst,
    worstGroundHitchExact: gx.worst,
    worstCarHitchExact: cx.worst,
    worstSnapError: snapError,
    worstRelativeJitter: relJitter,
    alignedPct: (aligned / Math.max(1, n)) * 100,
    headingFlickers: flickers,
  };
}

export const DISPLAYS: Array<{ name: string; model: DisplayModel }> = [
  { name: '60 Hz clean', model: { hz: 60, jitterMs: 0, dropRate: 0, seed: 1 } },
  { name: '90 Hz clean', model: { hz: 90, jitterMs: 0, dropRate: 0, seed: 2 } },
  { name: '120 Hz clean', model: { hz: 120, jitterMs: 0, dropRate: 0, seed: 3 } },
  { name: '60 Hz, timestamps +/-2 ms', model: { hz: 60, jitterMs: 2, dropRate: 0, seed: 4 } },
  { name: '60 Hz, 4% dropped frames', model: { hz: 60, jitterMs: 0, dropRate: 0.04, seed: 5 } },
  { name: '60 Hz, +/-2 ms and 4% dropped', model: { hz: 60, jitterMs: 2, dropRate: 0.04, seed: 6 } },
  { name: '120 Hz, +/-1 ms and 4% dropped', model: { hz: 120, jitterMs: 1, dropRate: 0.04, seed: 7 } },
];

export function formatResult(name: string, r: PacingResult): string {
  const f = (v: number, d = 2) => v.toFixed(d).padStart(7);
  return `${name.padEnd(32)} ${f(r.meanStep)} ${f(r.worstGroundHitchExact)} ${f(r.worstCarHitchExact)} ${f(r.worstGroundHitch)} ${f(r.worstCarHitch)} ${f(r.worstSnapError)} ${f(r.worstRelativeJitter)} ${f(r.alignedPct, 0)} ${String(r.headingFlickers).padStart(5)}`;
}
export const RESULT_HEADER = [
  'Hitch: the most one frame\'s movement differs from the average of its neighbours, device px per refresh.',
  '"exact" columns are before pixel rounding (timing and camera only); "drawn" columns are what reaches the glass.',
  'display                          px/refr | exact: ground  car | drawn: ground  car | snap err | car-vs-ground | on-grid % | heading flicker',
].join('\n');
