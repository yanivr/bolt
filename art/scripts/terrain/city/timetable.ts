import { scheduleState } from '@bolt/shared';
import type { HazardSchedule } from '@bolt/shared';
import type { AnimatedArt } from '../biome.js';
import { Canvas } from '../canvas.js';

/**
 * Loops that follow a hazard's timetable (docs/TRACK_API.md, "Environment hazards"): the
 * crossing's lights and boom, a steam vent's hiss and blast. Such a loop is exactly one period
 * long (`frameCount / fps` is `periodSeconds`) and frame `k` shows race time
 * `[k / fps, (k + 1) / fps)` counted from GO, modulo the period, so the client can pick the
 * frame from the race clock: `floor((raceSeconds mod period) * fps)`. Its `kind` is
 * `timetable:<hazardId>`, which is how the client tells it from an ambient loop.
 *
 * Every frame is opaque over its whole box (the ground is copied in where nothing moves), so a
 * frame never shows a stale state of the art baked underneath; the baked ground under the box
 * is the hazard at rest, which is what a quiet frame shows (checked by `timetableMismatch`).
 */

export const TIMETABLE_PREFIX = 'timetable:';

export type TimetableState = {
  phase: 'idle' | 'warning' | 'active';
  /** Progress through the current phase, 0 to 1, at the middle of the frame. */
  u: number;
  /** Seconds since the phase began, at the middle of the frame. */
  since: number;
  /** True when any part of the frame's time span is active (draw the hazard closed). */
  touchesActive: boolean;
  /** True when any part of it is warning or active. */
  touchesWarning: boolean;
  /** Quiet, and at least a second and a half from either end of the quiet phase. */
  settled: boolean;
  /** Frame index and race time at its middle. */
  frame: number;
  time: number;
};

export function timetableStates(schedule: HazardSchedule, fps: number): TimetableState[] {
  const count = Math.round(schedule.periodSeconds * fps);
  if (Math.abs(count / fps - schedule.periodSeconds) > 1e-6)
    throw new Error(
      `timetable loop: ${schedule.periodSeconds} s is not a whole number of frames at ${fps} fps`,
    );
  const quiet = schedule.periodSeconds - schedule.warnSeconds - schedule.activeSeconds;
  const out: TimetableState[] = [];
  for (let k = 0; k < count; k++) {
    const t0 = k / fps;
    const mid = (k + 0.5) / fps;
    let touchesActive = false;
    let touchesWarning = false;
    for (let j = 0; j <= 8; j++) {
      const s = scheduleState(schedule, t0 + (j / 8) * (1 / fps) * 0.999);
      if (s.phase === 'active') touchesActive = true;
      if (s.phase !== 'idle') touchesWarning = true;
    }
    const s = scheduleState(schedule, mid);
    const start =
      s.phase === 'idle' ? 0 : s.phase === 'warning' ? quiet : quiet + schedule.warnSeconds;
    const len =
      s.phase === 'idle'
        ? quiet
        : s.phase === 'warning'
          ? schedule.warnSeconds
          : schedule.activeSeconds;
    const since = s.periodTime - start;
    out.push({
      phase: s.phase,
      u: Math.max(0, Math.min(1, since / len)),
      since,
      touchesActive,
      touchesWarning,
      settled: s.phase === 'idle' && !touchesWarning && since >= 1.5 && quiet - since >= 0.5,
      frame: k,
      time: mid,
    });
  }
  return out;
}

export type TimetableLoopSpec = {
  id: string;
  hazardId: string;
  schedule: HazardSchedule;
  fps: number;
  /** World box of every frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  above: boolean;
  blend: 'normal' | 'add';
  /** Copy the baked ground into each frame first (ground loops); off for loops above cars. */
  base: Canvas | null;
  draw: (cv: Canvas, state: TimetableState) => void;
  columns?: number;
};

export function timetableLoop(spec: TimetableLoopSpec): AnimatedArt {
  const states = timetableStates(spec.schedule, spec.fps);
  const frames = states.map((st) => {
    const cv = Canvas.sprite(spec.w, spec.h);
    if (spec.base) cv.buf.copyFrom(spec.base.buf, spec.x, spec.y, spec.w, spec.h, 0, 0);
    spec.draw(cv, st);
    return cv;
  });
  const across =
    spec.columns ?? Math.max(1, Math.min(frames.length, Math.floor(4096 / Math.max(1, spec.w))));
  return {
    id: spec.id,
    kind: `${TIMETABLE_PREFIX}${spec.hazardId}`,
    frames,
    x: spec.x,
    y: spec.y,
    fps: spec.fps,
    above: spec.above,
    blend: spec.blend,
    columns: across,
  };
}

/**
 * Pixels where a settled quiet frame of a ground-level timetable loop differs from the baked ground,
 * plus, for every other ground loop, where frame 0 differs (the city's rule).
 */
export function loopMismatch(
  world: Canvas,
  loops: readonly AnimatedArt[],
  schedules: Map<string, HazardSchedule>,
): number {
  let bad = 0;
  for (const a of loops) {
    if (a.above) continue;
    let frames: Canvas[];
    if (a.kind.startsWith(TIMETABLE_PREFIX)) {
      const schedule = schedules.get(a.kind.slice(TIMETABLE_PREFIX.length));
      if (!schedule) {
        bad++;
        continue;
      }
      const states = timetableStates(schedule, a.fps);
      frames = a.frames.filter((_, k) => states[k]!.settled);
    } else frames = a.frames.slice(0, 1);
    for (const f of frames) {
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          if (f.alpha(x, y) !== 255) continue;
          if (world.get(a.x + x, a.y + y) !== f.get(x, y)) bad++;
        }
    }
  }
  return bad;
}
