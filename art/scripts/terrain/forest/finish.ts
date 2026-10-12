import type { AnimatedArt, BiomeOutput, OverlayArt } from '../biome.js';
import type { Canvas, Color } from '../canvas.js';
import { applyShadows, castShadows } from '../lighting.js';
import type { Env } from './env.js';
import { K_OFF } from './maps.js';
import { shadeDay, sunDay } from './palette.js';

/**
 * The last steps every open-track painter shares: the ground is shadowed (crowns, trunks,
 * masses), lifted where sun gets through, the scene is stood on it, and the weather grade is
 * applied to the ground, the overlays and every loop alike, so frame 0 of a loop still matches
 * the ground under it. Then the two self-checks: nothing raised in the ground layer may cover
 * a pixel a car can reach, and ground loops must start on the baked picture.
 */

export type Grade = (c: Color) => Color;

function gradeCanvas(cv: Canvas, grade: Grade, cache: Map<number, number>): void {
  const d = cv.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const c = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    let o = cache.get(c);
    if (o === undefined) {
      o = grade(c);
      cache.set(c, o);
    }
    d[i] = (o >> 16) & 255;
    d[i + 1] = (o >> 8) & 255;
    d[i + 2] = o & 255;
  }
}

export function animatedMismatch(world: Canvas, art: readonly AnimatedArt[]): number {
  let bad = 0;
  for (const a of art) {
    if (a.above) continue;
    const f = a.frames[0];
    if (!f) continue;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        if (f.alpha(x, y) !== 255) continue;
        if (world.get(a.x + x, a.y + y) !== f.get(x, y)) bad++;
      }
  }
  return bad;
}

export type FinishOpts = {
  grade: Grade;
  /** Shade strength on drivable pavement relative to the ground (keeps paint readable). */
  roadShade: number;
  /** Optional late painter, run on the shadowed ground before the scene stands on it. */
  beforeScene?: () => void;
  /** Ground loops (frame 0 must match the ground): built after the scene is painted. */
  loops?: () => AnimatedArt[];
  shade?: (c: Color, k: number) => Color;
};

export function finish(env: Env, opts: FinishOpts): BiomeOutput {
  const { world, scene, maps } = env;
  const { w, h } = maps;
  scene.resolve();
  // Shadows of extruded walls and of footprints, and of the solid masses.
  const cast = castShadows(w, h, scene.shadowH, 12, scene.forced);
  const shade = opts.shade ?? shadeDay;
  const level = env.shadow;
  for (let p = 0; p < w * h; p++) {
    if (cast[p] && level[p]! < 3) level[p] = 3;
    if (scene.shade[p]! > 0 && level[p]! < 3) level[p] = 3;
  }
  // Road pixels use the gentler set (levels 4 to 6).
  const lv = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const l = level[p]!;
    if (l === 0) continue;
    lv[p] = maps.kind[p] === K_OFF ? l : l + 3;
  }
  const r = opts.roadShade;
  applyShadows(world, lv, [
    (c) => shade(c, 0.45),
    (c) => shade(c, 1),
    (c) => shade(c, 1.25),
    (c) => shade(c, 0.45 * r),
    (c) => shade(c, r),
    (c) => shade(c, 1.15 * r),
  ]);
  // Sun patches.
  const sunCache = new Map<number, number>();
  for (let p = 0; p < w * h; p++) {
    if (!env.sun[p] || lv[p]) continue;
    const o = p * 4;
    const c = (world.data[o]! << 16) | (world.data[o + 1]! << 8) | world.data[o + 2]!;
    let s = sunCache.get(c);
    if (s === undefined) {
      s = sunDay(c, 0.6);
      sunCache.set(c, s);
    }
    world.data[o] = (s >> 16) & 255;
    world.data[o + 1] = (s >> 8) & 255;
    world.data[o + 2] = s & 255;
  }
  opts.beforeScene?.();
  const flat = world.data.slice();
  scene.paint(world, null, (c) => c);
  let covered = 0;
  for (let p = 0; p < w * h; p++) {
    if (!maps.reach.drive[p]) continue;
    const i = p * 4;
    if (world.data[i] !== flat[i] || world.data[i + 1] !== flat[i + 1] || world.data[i + 2] !== flat[i + 2])
      covered++;
  }
  const overlays: OverlayArt[] = scene.overlays();
  const loops = opts.loops?.() ?? [];
  const animated = [...env.animated, ...loops];
  const cache = new Map<number, number>();
  gradeCanvas(world, opts.grade, cache);
  for (const o of overlays) gradeCanvas(o.canvas, opts.grade, cache);
  for (const a of animated) for (const f of a.frames) gradeCanvas(f, opts.grade, cache);
  const checks = {
    coveredDrivable: Math.max(covered, scene.violations()),
    animatedMismatch: animatedMismatch(world, animated),
  };
  for (const line of env.log) console.log(`  ${line}`);
  return {
    overlays,
    animated,
    lights: [],
    previewSpots: env.previewSpots,
    previewCars: env.previewCars,
    checks,
  };
}
