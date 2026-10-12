import { hash2 } from '@bolt/shared';
import type { AnimatedArt } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { Env } from './env.js';
import { NAT } from './palette.js';

/**
 * Ambient loops for the nature biomes. A loop on the ground is cut from the finished picture,
 * so its frame 0 is the baked ground pixel for pixel and a client that never plays it still
 * shows the right thing; only the few pixels that move differ from frame to frame. Loops above
 * the cars (birds, smoke, falling snow) are small sprites on transparency.
 */

export function crop(env: Env, x: number, y: number, w: number, h: number): Canvas {
  const cv = new Canvas(w, h);
  cv.buf.copyFrom(env.world.buf, x, y, w, h, 0, 0);
  return cv;
}

/** Glints that come and go on water: each spark lives two frames at its own phase. */
export function sparkleLoop(
  env: Env,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  frames = 8,
  colors: readonly Color[] = [NAT.waterGlint, NAT.waterSpark],
): AnimatedArt | null {
  const { maps } = env;
  const base = crop(env, x, y, w, h);
  const spots: Array<{ x: number; y: number; t: number; len: number }> = [];
  for (let k = 0; k < (w * h) / 90; k++) {
    const sx = Math.floor(hash2(k, 1, seed) * w);
    const sy = Math.floor(hash2(k, 2, seed) * h);
    const wi = (y + sy) * maps.w + x + sx;
    if (!maps.water[wi]) continue;
    spots.push({ x: sx, y: sy, t: Math.floor(hash2(k, 3, seed) * frames), len: 1 + Math.floor(hash2(k, 4, seed) * 3) });
  }
  if (spots.length === 0) return null;
  const out: Canvas[] = [];
  for (let f = 0; f < frames; f++) {
    const cv = crop(env, x, y, w, h);
    if (f > 0)
      for (const s of spots) {
        const age = (f - s.t + frames) % frames;
        if (age > 1) continue;
        for (let k = 0; k < s.len; k++) {
          const wi = (y + s.y) * maps.w + x + s.x + k;
          if (!maps.water[wi]) continue;
          cv.set(s.x + k, s.y, colors[age === 0 ? 1 : 0]!);
        }
      }
    out.push(cv);
  }
  void base;
  return { id, kind: 'water_sparkle', frames: out, x, y, fps: 8, above: false, blend: 'normal' };
}

/** A loop that redraws a region frame by frame with a painter (over the frozen ground). */
export function regionLoop(
  env: Env,
  id: string,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
  frames: number,
  fps: number,
  draw: (cv: Canvas, f: number) => void,
): AnimatedArt {
  const out: Canvas[] = [];
  for (let f = 0; f < frames; f++) {
    const cv = crop(env, x, y, w, h);
    if (f > 0) draw(cv, f);
    out.push(cv);
  }
  return { id, kind, frames: out, x, y, fps, above: false, blend: 'normal' };
}

/** A small flock circling: dark wing pairs that flap, above everything. */
export function birdsLoop(id: string, cx: number, cy: number, seed: number, count = 4): AnimatedArt {
  const W = 72;
  const H = 40;
  const frames: Canvas[] = [];
  const F = 12;
  const birds = Array.from({ length: count }, (_, k) => ({
    r: 10 + hash2(k, 1, seed) * 16,
    a: hash2(k, 2, seed) * Math.PI * 2,
    flap: Math.floor(hash2(k, 3, seed) * 4),
  }));
  for (let f = 0; f < F; f++) {
    const cv = new Canvas(W, H);
    for (const b of birds) {
      const a = b.a + (f / F) * Math.PI * 2;
      const x = Math.round(W / 2 + Math.cos(a) * b.r * 1.3);
      const y = Math.round(H / 2 + Math.sin(a) * b.r * 0.6);
      const up = (f + b.flap) % 4 < 2;
      const c = 0x2a2a34;
      cv.set(x, y, c);
      cv.set(x - 1, y + (up ? -1 : 0), c);
      cv.set(x + 1, y + (up ? -1 : 0), c);
      cv.set(x - 2, y + (up ? -2 : 1), c);
      cv.set(x + 2, y + (up ? -2 : 1), c);
    }
    frames.push(cv);
  }
  return { id, kind: 'birds', frames, x: cx - W / 2, y: cy - H / 2, fps: 10, above: true, blend: 'normal' };
}

/** Chimney smoke: a column of puffs that rise, drift with the wind and thin out. */
export function smokeLoop(id: string, x: number, y: number, seed: number, windX: number, light: Color, dark: Color): AnimatedArt {
  const W = 40;
  const H = 52;
  const F = 10;
  const frames: Canvas[] = [];
  const drift = Math.max(-1, Math.min(1, windX / 12));
  for (let f = 0; f < F; f++) {
    const cv = new Canvas(W, H);
    for (let k = 0; k < 5; k++) {
      const t = ((f / F + k / 5) % 1) as number;
      const px = W / 2 - 8 + drift * t * 14 + Math.sin((t + k) * 5) * 1.5;
      const py = H - 4 - t * (H - 10);
      const r = 2 + t * 5;
      for (let yy = Math.floor(py - r); yy <= py + r; yy++)
        for (let xx = Math.floor(px - r); xx <= px + r; xx++) {
          const d = Math.hypot(xx - px, (yy - py) * 1.2);
          if (d > r) continue;
          if (t > 0.6 && hash2(xx, yy, seed + f) < (t - 0.6) * 2.2) continue;
          const lit = xx - px + (yy - py) < -r * 0.3;
          cv.setA(xx, yy, lit ? light : dark, t > 0.75 ? 150 : 220);
        }
    }
    frames.push(cv);
  }
  return { id, kind: 'chimney_smoke', frames, x: Math.round(x - W / 2 + 8), y: Math.round(y - H + 4), fps: 8, above: true, blend: 'normal' };
}

/** Butterflies flitting in a small area. */
export function butterfliesLoop(id: string, cx: number, cy: number, seed: number): AnimatedArt {
  const W = 40;
  const H = 28;
  const F = 8;
  const colors = [0xf2d24a, 0xf2f0e6, 0xa894e0];
  const frames: Canvas[] = [];
  for (let f = 0; f < F; f++) {
    const cv = new Canvas(W, H);
    for (let k = 0; k < 3; k++) {
      const a = (f / F) * Math.PI * 2 + k * 2.1;
      const x = Math.round(W / 2 + Math.cos(a) * (8 + k * 3) + Math.sin(a * 3) * 2);
      const y = Math.round(H / 2 + Math.sin(a * 2) * 6);
      const c = colors[(hash2(k, 1, seed) * colors.length) | 0]!;
      const open = (f + k) % 2 === 0;
      cv.set(x, y, 0x3a3030);
      if (open) {
        cv.set(x - 1, y, c);
        cv.set(x + 1, y, c);
        cv.set(x - 1, y - 1, c);
        cv.set(x + 1, y - 1, c);
      } else {
        cv.set(x, y - 1, c);
      }
    }
    frames.push(cv);
  }
  return { id, kind: 'butterflies', frames, x: cx - W / 2, y: cy - H / 2, fps: 8, above: true, blend: 'normal' };
}
