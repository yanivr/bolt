import { hash2 } from '@bolt/shared';
import type { Canvas, Color } from './canvas.js';
import { F_EMISSIVE, F_NOSHADOW } from './canvas.js';

/**
 * Baked ground lighting shared by every biome: hard-edged cast shadows and posterized light
 * pools. Nothing here blurs. Both passes work on the flat ground plane only; raised geometry is
 * painted afterwards, already lit by its own painter.
 */

export type LightPool = {
  x: number;
  y: number;
  /** Outer radius of each step, brightest first. `radii.length` is the peak step. */
  radii: readonly number[];
  /** Index into the biome's tint table. 0 is the key lamp color. */
  tint: number;
  /** Vertical squash of the pool, for light thrown along a wall. Defaults to 1. */
  squashY?: number;
};

/**
 * Marks every ground pixel that sits in the shadow of something taller up and to the left.
 * `height` holds shadow lengths in pixels, so shadows are short, quantized and never smooth.
 */
export function castShadows(
  w: number,
  h: number,
  height: Uint8Array,
  maxLen: number,
  forced: Uint8Array | null,
): Uint8Array {
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

const SECTORS = 12;

/**
 * Accumulates pools into a step plane. A pool is not a ruled circle: its rim wanders in and out
 * by sector and is evaluated on a two pixel grid, which gives an irregular stepped blob with
 * clean pixel clusters instead of a target of concentric rings.
 */
export function accumulatePools(w: number, h: number, pools: readonly LightPool[]): LightPlanes {
  const step = new Uint8Array(w * h);
  const tint = new Uint8Array(w * h);
  pools.forEach((pool, index) => {
    const n = pool.radii.length;
    const outer = pool.radii[n - 1]! * 1.12;
    const sq = pool.squashY ?? 1;
    const wob = new Float32Array(SECTORS * n);
    for (let k = 0; k < n; k++)
      for (let a = 0; a < SECTORS; a++)
        wob[k * SECTORS + a] = 1 + (hash2(a + k * 31, index, 7717) - 0.5) * 0.12;
    const cx = Math.round(pool.x / 2) * 2;
    const cy = Math.round(pool.y / 2) * 2;
    const x0 = Math.max(0, (Math.floor((cx - outer - 2) / 2) * 2) | 0);
    const x1 = Math.min(w - 2, Math.ceil(cx + outer + 2));
    const y0 = Math.max(0, (Math.floor((cy - outer / sq - 2) / 2) * 2) | 0);
    const y1 = Math.min(h - 2, Math.ceil(cy + outer / sq + 2));
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const dx = x + 1 - cx;
        const dy = (y + 1 - cy) * sq;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > outer) continue;
        const af = ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * SECTORS;
        const a0 = Math.floor(af) % SECTORS;
        const a1 = (a0 + 1) % SECTORS;
        const f = af - Math.floor(af);
        let s = 0;
        for (let k = 0; k < n; k++) {
          const m = wob[k * SECTORS + a0]! * (1 - f) + wob[k * SECTORS + a1]! * f;
          if (d <= pool.radii[k]! * m) {
            s = n - k;
            break;
          }
        }
        if (s === 0) continue;
        for (let j = 0; j < 4; j++) {
          const p = (y + (j >> 1)) * w + x + (j & 1);
          if (s > step[p]!) {
            step[p] = s;
            tint[p] = pool.tint;
          }
        }
      }
    }
  });
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
