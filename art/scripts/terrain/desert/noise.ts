import { hash2 } from '@bolt/shared';

/**
 * Deterministic smooth noise for landforms. Value noise on an integer lattice with a quintic
 * fade, built on the shared `hash2`, so a bake is the same on every machine.
 */

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1) at a point, lattice spacing `cell`. */
export function vnoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fade(fx - ix);
  const ty = fade(fy - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal sum of `octaves` value noises, halving the cell each time, normalized to [0, 1). */
export function fbm(x: number, y: number, cell: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let c = cell;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, y, c, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return sum / norm;
}

/** Smooth step from 0 at `a` to 1 at `b`. */
export function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Value noise stretched along a unit wind vector: streaks and fingers that run with the wind. */
export function windNoise(
  x: number,
  y: number,
  wind: { x: number; y: number },
  cell: number,
  seed: number,
  stretch = 0.22,
): number {
  const along = x * wind.x + y * wind.y;
  const across = -x * wind.y + y * wind.x;
  return vnoise(along * stretch + 5000, across + 5000, cell, seed);
}
