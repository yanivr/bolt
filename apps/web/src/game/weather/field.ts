import { hash2 } from '@bolt/shared';
import type { WeatherAtlas } from './atlas.js';
import { weatherLayerIndex } from './atlas.js';
import type { FieldPlane } from './plan.js';
import type { DrawList } from './pool.js';

/**
 * Planes of falling and blowing particles (rain, snow, sand, grit, leaves), with no stored
 * state. Particle `i` of a plane is born `cycle` times; for each birth its start is a hash of
 * (seed, plane, i, cycle) inside a box one view plus a margin wide, and it moves at the plane's
 * velocity. The camera's scroll times the plane's parallax is taken off and the result wrapped
 * into the box, so the plane always covers the view, a plane with parallax 1 stays put on the
 * ground, and a nearer plane slides past faster. Everything is a pure function of the seed,
 * the index, the time and the camera: the same race clock and camera give the same picture at
 * any frame rate (Section 9.2: cosmetic positions from seeded randomness), and a unit test
 * holds that.
 */

/** Pixels of view a plane extends past each edge, so nothing pops in at the border. */
export const FIELD_MARGIN = 40;
/** The reference view the plane counts are written for. */
export const REFERENCE_AREA = 870 * 370;

export type FieldView = {
  /** Top-left of the view, world pixels (on the device grid). */
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Where a far raindrop lands: called once per drop per birth, cached by the caller. */
export type SplashProbe = (x: number, y: number) => number;
/** For a veil: the chance, 0 to 1, that a particle at a screen point is drawn. */
export type VeilMask = (sx: number, sy: number) => number;

/**
 * The resolved plane: anim ids, the layer index, the count after quality and the view's
 * area, and, for far rain, a cache of what each drop lands on in its current birth.
 */
export class FieldRuntime {
  readonly anims: number[];
  readonly layer: number;
  readonly dirFrame: number[];
  count = 0;
  readonly splashCycle: Int32Array;
  readonly splashKind: Int8Array;
  readonly splashX: Float32Array;
  readonly splashY: Float32Array;
  readonly seed: number;

  constructor(
    readonly plane: FieldPlane,
    atlas: WeatherAtlas,
    seed: number,
    index: number,
    capacity: number,
  ) {
    this.anims = plane.anims.map((name) => atlas.id(name));
    this.layer = weatherLayerIndex(plane.layer);
    // The direction is the plane's own: every streak of a plane leans the same way.
    const heading = Math.atan2(plane.vx, -plane.vy);
    this.dirFrame = this.anims.map((a) => atlas.directionFrame(a, heading));
    this.seed = (seed * 31 + index * 977) | 0;
    this.splashCycle = new Int32Array(capacity).fill(-1);
    this.splashKind = new Int8Array(capacity);
    this.splashX = new Float32Array(capacity);
    this.splashY = new Float32Array(capacity);
  }
}

function wrap(v: number, size: number): number {
  const r = v % size;
  return r < 0 ? r + size : r;
}

/** Splash kinds a probe may return. */
export const SPLASH_NONE = 0;
export const SPLASH_RING = 1;
export const SPLASH_BIG = 2;
export const SPLASH_MUD = 3;

/**
 * Writes one plane into the draw list. `density` scales the count (quality, reduced motion);
 * `speed` scales the velocity (reduced motion). Returns how many were drawn.
 */
export function drawField(
  rt: FieldRuntime,
  atlas: WeatherAtlas,
  list: DrawList,
  time: number,
  view: FieldView,
  density: number,
  speed: number,
  probe: SplashProbe | null,
  splashes: { ring: number; big: number; mud: number } | null,
  veil: VeilMask | null = null,
): number {
  const p = rt.plane;
  const m = FIELD_MARGIN;
  const bw = view.w + m * 2;
  const bh = view.h + m * 2;
  const area = (view.w * view.h) / REFERENCE_AREA;
  const n = Math.min(rt.splashCycle.length, Math.round(p.count * density * Math.min(2.4, area)));
  rt.count = n;
  const k = p.parallax;
  const seed = rt.seed;
  const world = k === 1;
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const life = p.life * (0.85 + hash2(i, 1, seed) * 0.3);
    const t = time + hash2(i, 2, seed) * life;
    const cycle = Math.floor(t / life);
    const age = t - cycle * life;
    const j = 1 + (hash2(i, cycle, seed + 3) - 0.5) * 2 * p.jitter;
    const vx = p.vx * j * speed;
    const vy = p.vy * j * speed;
    let px = hash2(i, cycle, seed + 5) * bw + vx * age - view.x * k;
    const py = hash2(i, cycle, seed + 7) * bh + vy * age - view.y * k;
    if (p.sway) {
      const ph = hash2(i, 9, seed) * Math.PI * 2;
      px += Math.round(Math.sin(ph + (time / (p.swayPeriod ?? 2)) * Math.PI * 2) * p.sway);
    }
    const sx = wrap(px, bw) - m;
    const sy = wrap(py, bh) - m;
    if (p.veil && veil && hash2(i, cycle, seed + 23) >= veil(sx, sy)) continue;
    const pick = Math.floor(hash2(i, cycle, seed + 11) * rt.anims.length);
    const anim = rt.anims[pick]!;

    // The last moments of a far raindrop: a splash where it lands, if the ground takes one.
    if (p.splash && probe && splashes) {
      const splashTime = 0.16;
      if (age > life - splashTime) {
        if (rt.splashCycle[i] !== cycle) {
          rt.splashCycle[i] = cycle;
          rt.splashX[i] = Math.round(view.x + sx);
          rt.splashY[i] = Math.round(view.y + sy);
          rt.splashKind[i] = probe(rt.splashX[i]!, rt.splashY[i]!);
        }
        const kind = rt.splashKind[i]!;
        if (kind !== SPLASH_NONE) {
          const s =
            kind === SPLASH_BIG ? splashes.big : kind === SPLASH_MUD ? splashes.mud : splashes.ring;
          const tf = atlas.timeFrames[s]!;
          const f = Math.min(tf - 1, Math.floor(((age - (life - splashTime)) / splashTime) * tf));
          if (
            list.push(
              rt.layer,
              atlas.frameBase[s]! + f,
              rt.splashX[i]! - atlas.anchorX[s]!,
              rt.splashY[i]! - atlas.anchorY[s]!,
              1,
            )
          )
            drawn++;
        }
        continue;
      }
    }

    let frame = atlas.frameBase[anim]!;
    if (p.frames === 'direction') {
      frame +=
        rt.dirFrame[pick]! + Math.floor(hash2(i, cycle, seed + 13) * atlas.timeFrames[anim]!);
    } else if (p.frames === 'fixed') {
      const choices = p.pick ?? [0];
      frame += choices[Math.floor(hash2(i, cycle, seed + 17) * choices.length)]!;
    } else
      frame +=
        Math.floor(age * atlas.fps[anim]! + hash2(i, 19, seed) * 8) % atlas.timeFrames[anim]!;

    let alpha = p.alpha;
    if (p.fade) {
      const edge = Math.min(age, life - age) / (life * 0.12);
      if (edge < 1) alpha *= Math.ceil(edge * 3) / 3;
    }
    // On the pixel grid: a plane on the ground snaps to the ground's own pixels; a plane that
    // slides with parallax snaps to whole world pixels of the screen.
    const ax = sx - atlas.anchorX[anim]!;
    const ay = sy - atlas.anchorY[anim]!;
    const x = world ? Math.round(view.x + ax) : view.x + Math.round(ax);
    const y = world ? Math.round(view.y + ay) : view.y + Math.round(ay);
    if (list.push(rt.layer, frame, x, y, alpha, p.tint ?? 0xffffff)) drawn++;
  }
  return drawn;
}
