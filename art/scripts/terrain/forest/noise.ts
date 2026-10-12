import { hash2 } from '@bolt/shared';

/**
 * Deterministic value noise for natural ground: smooth fields built from `hash2` lattices, so
 * patches of moss, mud, drifts and puddles have soft, coherent shapes and the same seed always
 * gives the same picture.
 */

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1) with features about `scale` pixels across. */
export function vnoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
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

/** Three octaves of value noise, normalized to [0, 1). */
export function fbm(x: number, y: number, scale: number, seed: number): number {
  return (
    (vnoise(x, y, scale, seed) * 4 +
      vnoise(x, y, scale / 2.1, seed + 17) * 2 +
      vnoise(x, y, scale / 4.3, seed + 31)) /
    7
  );
}

/**
 * Cellular noise: distance to the nearest and second nearest jittered point of a grid of
 * `cell` pixels, and a stable hash of the nearest cell. Stones, clumps and cobbles.
 */
export type Cell = { d1: number; d2: number; id: number; ox: number; oy: number };

export function cellular(x: number, y: number, cell: number, seed: number, out: Cell): Cell {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  let d1 = 1e9;
  let d2 = 1e9;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i + 0.15 + hash2(gx + i, gy + j, seed) * 0.7) * cell;
      const cy = (gy + j + 0.15 + hash2(gx + i, gy + j, seed + 1) * 0.7) * cell;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        out.id = hash2(gx + i, gy + j, seed + 2);
        out.ox = dx;
        out.oy = dy;
      } else if (d < d2) d2 = d;
    }
  out.d1 = d1;
  out.d2 = d2;
  return out;
}

export function newCell(): Cell {
  return { d1: 0, d2: 0, id: 0, ox: 0, oy: 0 };
}

/** Seeded generator, for placing things. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
