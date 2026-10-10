import type { Canvas, Color } from './canvas.js';
import { F_EMISSIVE, F_NOSHADOW } from './canvas.js';

/**
 * Baked lighting shared by every biome: hard-edged cast shadows from the height plane and
 * posterized light pools. Nothing here blurs; a pool is a stack of hard rings with an optional
 * one pixel checker band between them.
 */

export type LightPool = {
  x: number;
  y: number;
  /** Outer radius of each step, brightest first. `radii.length` is the peak step. */
  radii: readonly number[];
  /** Index into the biome's tint table. 0 is the key lamp color. */
  tint: number;
  /**
   * 0 lights the ground plane (pixels at or below `groundHeight`); any other value lights only
   * pixels whose id in the supplied id map equals it, so rooftop neon stays on its own roof.
   */
  level: number;
  /** Vertical squash of the rings, for pools thrown along a wall. Defaults to 1. */
  squashY?: number;
};

/**
 * Marks every pixel that sits in the shadow of something taller up and to the left. Shadow
 * length equals the height difference, so shadows are short, quantized and never smooth.
 */
export function castShadows(world: Canvas, maxLen: number, forced: Uint8Array | null): Uint8Array {
  const { w, h } = world;
  const height = world.height!;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (forced && forced[p]) {
        out[p] = 1;
        continue;
      }
      const hp = height[p]!;
      const lim = Math.min(maxLen, x, y);
      for (let k = 1; k <= lim; k++) {
        if (height[p - k * (w + 1)]! - hp >= k) {
          out[p] = 1;
          break;
        }
      }
    }
  }
  return out;
}

export function applyShadows(world: Canvas, shadow: Uint8Array, shade: (c: Color) => Color): void {
  const { w, h, data } = world;
  const flags = world.flags!;
  const cache = new Map<number, number>();
  for (let p = 0; p < w * h; p++) {
    if (!shadow[p] || flags[p]! & (F_EMISSIVE | F_NOSHADOW)) continue;
    const i = p * 4;
    const c = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    let o = cache.get(c);
    if (o === undefined) {
      o = shade(c);
      cache.set(c, o);
    }
    data[i] = (o >> 16) & 255;
    data[i + 1] = (o >> 8) & 255;
    data[i + 2] = o & 255;
  }
}

export type LightPlanes = { step: Uint8Array; tint: Uint8Array };

export function accumulatePools(
  world: Canvas,
  pools: readonly LightPool[],
  idMap: Uint16Array,
  groundHeight: number,
  dither: boolean,
): LightPlanes {
  const { w, h } = world;
  const height = world.height!;
  const step = new Uint8Array(w * h);
  const tint = new Uint8Array(w * h);
  for (const pool of pools) {
    const n = pool.radii.length;
    const outer = pool.radii[n - 1]!;
    const sq = pool.squashY ?? 1;
    const x0 = Math.max(0, Math.floor(pool.x - outer - 2));
    const x1 = Math.min(w - 1, Math.ceil(pool.x + outer + 2));
    const y0 = Math.max(0, Math.floor(pool.y - outer / sq - 2));
    const y1 = Math.min(h - 1, Math.ceil(pool.y + outer / sq + 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * w + x;
        if (pool.level === 0) {
          if (height[p]! > groundHeight) continue;
        } else if (idMap[p] !== pool.level) continue;
        const dx = x + 0.5 - pool.x;
        const dy = (y + 0.5 - pool.y) * sq;
        const d = Math.sqrt(dx * dx + dy * dy);
        let s = 0;
        for (let k = 0; k < n; k++) {
          const r = pool.radii[k]!;
          if (d <= r) {
            s = n - k;
            break;
          }
          // One pixel checker band just outside each ring softens the step without blur.
          if (dither && d <= r + 1.6 && ((x + y) & 1) === 0) {
            s = n - k;
            break;
          }
        }
        if (s > step[p]!) {
          step[p] = s;
          tint[p] = pool.tint;
        }
      }
    }
  }
  return { step, tint };
}

export function applyLight(
  world: Canvas,
  planes: LightPlanes,
  lit: (c: Color, step: number, tint: number) => Color,
): void {
  const { w, h, data } = world;
  const flags = world.flags!;
  const cache = new Map<number, number>();
  for (let p = 0; p < w * h; p++) {
    const s = planes.step[p]!;
    if (s === 0 || flags[p]! & F_EMISSIVE) continue;
    const i = p * 4;
    const c = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    const key = c * 64 + s * 8 + planes.tint[p]!;
    let o = cache.get(key);
    if (o === undefined) {
      o = lit(c, s, planes.tint[p]!);
      cache.set(key, o);
    }
    data[i] = (o >> 16) & 255;
    data[i + 1] = (o >> 8) & 255;
    data[i + 2] = o & 255;
  }
}
