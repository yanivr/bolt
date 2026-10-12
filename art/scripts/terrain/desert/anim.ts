import { mulberry32 } from '@bolt/shared';
import type { AnimatedArt } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { Look } from './palette.js';
import { PAL, darker, lighter } from './palette.js';
import { flag, windSock, windWheel } from './props.js';

/**
 * Ambient loops. Things on poles (socks, flags, the windmill's wheel, the mast's lamps, dust
 * devils) are drawn above the cars, since they stand over open sand a car may cross. Loops on
 * the ground (tumbleweeds, blowing sand, heat shimmer) start from an empty frame 0, so the
 * baked ground under them is never contradicted. Wind-driven loops read their direction and
 * speed from the weather preset.
 */

/** How far a sock or flag stands out (0 hanging, 1 straight) and how fast it flutters. */
export function windReach(look: Look): { reach: number; fps: number } {
  const s = look.wind.speed;
  return { reach: Math.max(0.15, Math.min(1, s / 55)), fps: s > 40 ? 12 : s > 15 ? 9 : 6 };
}

export function sockLoop(id: string, gx: number, gy: number, look: Look): AnimatedArt {
  const { reach, fps } = windReach(look);
  const frames = [0, 1, 2, 3, 4, 5].map((k) => windSock(look.wind, reach, (k / 6) * Math.PI * 2));
  const f0 = frames[0]!;
  return { id, kind: 'wind_sock', frames, x: gx - 27, y: gy - (f0.h - 1), fps, above: true, blend: 'normal' };
}

export function flagLoop(id: string, gx: number, gy: number, look: Look, color: Color, phase: number): AnimatedArt {
  const { reach, fps } = windReach(look);
  const frames = [0, 1, 2, 3, 4, 5].map((k) => flag(look.wind, reach, phase + (k / 6) * Math.PI * 2, color));
  const f0 = frames[0]!;
  return { id, kind: 'flag', frames, x: gx - 16, y: gy - (f0.h - 1), fps, above: true, blend: 'normal' };
}

export function wheelLoop(id: string, cx: number, cy: number, look: Look): AnimatedArt {
  const frames = [0, 1, 2, 3].map((k) => windWheel(k));
  const fps = look.wind.speed > 40 ? 14 : look.wind.speed > 8 ? 8 : 4;
  return { id, kind: 'windmill_wheel', frames, x: cx - 11, y: cy - 11, fps, above: true, blend: 'normal' };
}

/** Red obstruction lamp: dark, glowing, bright, glowing, dark, dark. */
export function beaconLoop(id: string, x: number, y: number): AnimatedArt {
  const frames = [0, 1, 2, 1, 0, 0].map((level) => {
    const cv = new Canvas(7, 7);
    if (level === 0) {
      cv.setA(3, 3, PAL.lampDim, 255);
      return cv;
    }
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d === 0) cv.setA(3 + dx, 3 + dy, level === 2 ? PAL.lampHi : PAL.lamp, 255);
        else if (d === 1) cv.setA(3 + dx, 3 + dy, PAL.lamp, level === 2 ? 255 : 200);
        else if (d === 2 && level === 2) cv.setA(3 + dx, 3 + dy, PAL.lamp, 110);
        else if (d === 3 && level === 2 && (dx === 0 || dy === 0)) cv.setA(3 + dx, 3 + dy, PAL.lamp, 50);
      }
    return cv;
  });
  return { id, kind: 'beacon', frames, x: x - 3, y: y - 3, fps: 4, above: true, blend: 'normal' };
}

/**
 * A dust devil: a leaning, twisting column of dust in stepped transparency, its foot swirling
 * on the ground. Twelve frames, drawn above the cars (it is only dust).
 */
export function dustDevilLoop(id: string, gx: number, gy: number, look: Look, seed: number, sand: Color): AnimatedArt {
  const W = 46;
  const H = 78;
  const lean = look.wind.x * 8;
  const frames: Canvas[] = [];
  const light = lighter(sand, 0.35);
  const dark = darker(sand, 0.12);
  for (let f = 0; f < 12; f++) {
    const cv = new Canvas(W, H);
    const rnd = mulberry32((seed + f * 977) >>> 0);
    const phase = (f / 12) * Math.PI * 2;
    for (let y = 0; y < H; y++) {
      const t = 1 - y / (H - 1);
      // Wider at the top, a narrow waist above the swirling foot.
      const radius = 3 + t * 15 + (y > H - 10 ? (y - (H - 10)) * 1.2 : 0);
      const cx = W / 2 + lean * t + Math.sin(phase + t * 5) * 3 * t;
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x + 0.5 - cx) / radius;
        if (d > 1) continue;
        // Spiral bands of denser dust turning with the frame.
        const band = Math.sin((x - cx) * 0.6 + y * 0.35 - phase * 2);
        let a = d > 0.85 ? 60 : band > 0.4 ? 150 : 100;
        if (t > 0.85) a = Math.round(a * 0.6);
        if (rnd() < 0.08) a = 0;
        cv.setA(x, y, band > 0.4 ? light : dark, a);
      }
    }
    frames.push(cv);
  }
  return { id, kind: 'dust_devil', frames, x: gx - W / 2, y: gy - H + 4, fps: 10, above: true, blend: 'normal' };
}

/**
 * A tumbleweed rolling from one point toward another, bouncing, then gone: an empty first
 * frame, the run, and empty frames to rest. Drawn on the ground layer, under the cars.
 */
export function tumbleweedLoop(
  id: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  look: Look,
): AnimatedArt {
  const pad = 10;
  const x0 = Math.floor(Math.min(a.x, b.x)) - pad;
  const y0 = Math.floor(Math.min(a.y, b.y)) - pad - 12;
  const W = Math.ceil(Math.abs(b.x - a.x)) + pad * 2;
  const H = Math.ceil(Math.abs(b.y - a.y)) + pad * 2 + 12;
  const run = 18;
  const frames: Canvas[] = [new Canvas(W, H)];
  for (let f = 0; f < run; f++) {
    const cv = new Canvas(W, H);
    const t = f / (run - 1);
    const px = a.x + (b.x - a.x) * t - x0;
    const py = a.y + (b.y - a.y) * t - y0;
    const hop = Math.abs(Math.sin(t * Math.PI * 4)) * 6;
    // Shadow on the sand, then the ball of twigs above it.
    for (let dx = -4; dx <= 4; dx++) cv.setA(Math.round(px + dx + 2), Math.round(py + 1), PAL.ink, 70);
    const spin = f * 0.9;
    for (let k = 0; k < 26; k++) {
      const ang = k * 2.4 + spin;
      const r = 1.5 + (k % 5);
      const x = Math.round(px + Math.cos(ang) * r);
      const y = Math.round(py - hop - 5 + Math.sin(ang) * r * 0.85);
      const lit = Math.cos(ang) + Math.sin(ang) < 0;
      cv.setA(x, y, lit ? PAL.brushHi : k % 3 === 0 ? PAL.brushDark : PAL.brush, 255);
    }
    frames.push(cv);
  }
  for (let k = 0; k < 8; k++) frames.push(new Canvas(W, H));
  const fps = look.wind.speed > 40 ? 14 : 10;
  return { id, kind: 'tumbleweed', frames, x: x0, y: y0, fps, above: false, blend: 'normal' };
}

/** Faint wavering bright lines over hot ground, added to whatever is under them. */
export function heatShimmerLoop(id: string, x: number, y: number, w: number, strength: number): AnimatedArt {
  const H = 12;
  const frames: Canvas[] = [new Canvas(w, H)];
  for (let f = 1; f < 8; f++) {
    const cv = new Canvas(w, H);
    for (let row = 2; row < H; row += 4) {
      for (let xx = 0; xx < w; xx++) {
        const yy = row + Math.round(Math.sin(xx * 0.21 + f * 0.8 + row) * 1.2);
        const on = Math.sin(xx * 0.05 + f * 0.6 + row * 3) > 0.2;
        if (!on) continue;
        cv.setA(xx, yy, PAL.signWhite, Math.round(26 * strength));
      }
    }
    frames.push(cv);
  }
  return { id, kind: 'heat_shimmer', frames, x, y, fps: 8, above: false, blend: 'add' };
}

/** Streaks of sand skating over the ground downwind, in stepped transparency. */
export function dustRibbonLoop(
  id: string,
  gx: number,
  gy: number,
  look: Look,
  sand: Color,
  seed: number,
  length = 220,
): AnimatedArt {
  const wx = look.wind.x;
  const wy = look.wind.y;
  const W = Math.ceil(Math.abs(wx) * length + 40);
  const H = Math.ceil(Math.abs(wy) * length + 40);
  const ox = gx - (wx < 0 ? W - 20 : 20);
  const oy = gy - (wy < 0 ? H - 20 : 20);
  const frames: Canvas[] = [new Canvas(W, H)];
  const streaks = 7;
  const rnd = mulberry32(seed >>> 0);
  const lanes = Array.from({ length: streaks }, () => ({ off: (rnd() - 0.5) * 30, start: rnd(), len: 18 + rnd() * 30 }));
  const light = lighter(sand, 0.3);
  for (let f = 1; f < 12; f++) {
    const cv = new Canvas(W, H);
    for (const lane of lanes) {
      const t0 = ((lane.start + f / 11) % 1) * length;
      for (let u = 0; u < lane.len; u++) {
        const along = t0 + u;
        if (along > length) break;
        const x = Math.round(gx - ox + wx * along - wy * lane.off);
        const y = Math.round(gy - oy + wy * along + wx * lane.off + Math.sin(along * 0.08) * 2);
        const a = u < 4 || u > lane.len - 5 ? 70 : 130;
        cv.setA(x, y, light, a);
        if (u % 3 === 0) cv.setA(x, y + 1, sand, 70);
      }
    }
    frames.push(cv);
  }
  return { id, kind: 'blowing_sand', frames, x: ox, y: oy, fps: 12, above: false, blend: 'normal' };
}

/** Grades every frame of every loop into the preset's light. */
export function gradeLoops(loops: AnimatedArt[], grade: (c: Color) => Color, posterize = 1): void {
  for (const a of loops)
    for (const f of a.frames) {
      const d = f.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const c = grade((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
        const q = posterize;
        d[i] = Math.min(255, Math.round(((c >> 16) & 255) / q) * q);
        d[i + 1] = Math.min(255, Math.round(((c >> 8) & 255) / q) * q);
        d[i + 2] = Math.min(255, Math.round((c & 255) / q) * q);
      }
    }
}
