import { hash2 } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { AnimatedArt, OverlayArt } from '../biome.js';
import { F_EMISSIVE, col, mixc } from '../canvas.js';
import type { Canvas, Color } from '../canvas.js';
import type { CorridorField } from '../field.js';

/**
 * The static wet look shared by every rain bake (Neon Cut's rainy night, Backstreet Blitz in
 * rain, Steel Circuit's factory rain). It runs on the finished picture, after the scene has been
 * painted, and changes only colors: nothing moves, so the art still matches the physics.
 *
 *  1. Every pixel that is not self-lit goes through the weather's wet tone: darker and more
 *     saturated, a little cooler. Bright paint and lamps keep their value, so markings stay
 *     the most readable thing on the road.
 *  2. Puddles: deterministic noise shapes in the gutters (between the edge line and the kerb)
 *     and in a few low spots, on drivable ground only. They mirror the sky with a lit rim.
 *  3. Reflections: self-lit things standing north of a stretch of wet road (shop windows, neon,
 *     lamp heads) are mirrored down the road below the edge they stand on, stretched and broken
 *     into short blocky vertical streaks, strongest in puddles. Street lamps over the road add
 *     their own glare streak.
 *
 * The client draws moving rain, splashes and dynamic reflections on top of this.
 */

export type WetStyle = {
  /** How much darker non-emissive pixels get (0 to 1), on the ground and on raised art. */
  darkGround: number;
  darkRaised: number;
  /** Extra saturation (0 is none). */
  saturate: number;
  /** A color every wet pixel leans toward a little (the sky's cast). */
  cast: Color;
  castAmount: number;
  /** Puddle body (the mirrored sky), its ripple highlight, its lip and its lit far edge. */
  puddle: Color;
  ripple: Color;
  puddleLip: Color;
  puddleEdge: Color;
  /** Share of the gutter that holds water, and of the open pavement (low spots). */
  gutterShare: number;
  spotShare: number;
  /** Strength of mirrored light on wet pavement and in puddles (0 to 1). */
  reflect: number;
  reflectPuddle: number;
  /** Specular glints: pale short streaks scattered on the wet road. */
  glint: Color;
  glintRate: number;
};

export const WET_NIGHT: WetStyle = {
  darkGround: 0.26,
  darkRaised: 0.12,
  saturate: 0.16,
  cast: col('#1A2444'),
  castAmount: 0.14,
  puddle: col('#2C3858'),
  ripple: col('#5C6F9C'),
  puddleLip: col('#1D2336'),
  puddleEdge: col('#46557E'),
  gutterShare: 0.5,
  spotShare: 0.07,
  reflect: 0.62,
  reflectPuddle: 0.95,
  glint: col('#8091B8'),
  glintRate: 0.004,
};

const lum = (c: Color): number =>
  (((c >> 16) & 255) * 3 + ((c >> 8) & 255) * 5 + (c & 255) * 2) / 10;
const chroma = (c: Color): number => {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
};

/** The wet tone of one color. Pure, so the world, loops and overlays all agree. */
export function wetTone(style: WetStyle, c: Color, raised: boolean): Color {
  // Lights and fresh paint keep their value: they are what a wet road shows best.
  if (lum(c) > 196 || chroma(c) > 150) return c;
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const avg = (r + g + b) / 3;
  // Saturation is pushed only on cool colors: warm stone and brick go glossy, not brown.
  const s = 1 + (b >= r ? style.saturate : style.saturate * 0.2);
  const k = 1 - (raised ? style.darkRaised : style.darkGround);
  const f = (v: number): number =>
    Math.max(0, Math.min(255, Math.round((avg + (v - avg) * s) * k)));
  return mixc((f(r) << 16) | (f(g) << 8) | f(b), style.cast, style.castAmount);
}

/** Two octaves of value noise in 0..1. */
function noise(x: number, y: number, seed: number): number {
  const oct = (cell: number, s: number): number => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = x / cell - gx;
    const fy = y / cell - gy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash2(gx, gy, s);
    const b = hash2(gx + 1, gy, s);
    const c = hash2(gx, gy + 1, s);
    const d = hash2(gx + 1, gy + 1, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return oct(26, seed) * 0.65 + oct(9, seed + 1) * 0.35;
}

export type WetInput = {
  world: Canvas;
  field: CorridorField;
  /** 1 where the ground is drivable (obstacles excluded). */
  drive: Uint8Array;
  /** 1 where raised geometry was painted over the ground (buildings, props, barriers). */
  raised: Uint8Array;
  /** Shoulder width at each pixel's nearest centerline sample, for the gutter. */
  lights: readonly TerrainLight[];
  seed: number;
  style: WetStyle;
  /** Pixels that must stay dry (under canopies and bridges, inside halls). Optional. */
  dry?: Uint8Array;
};

export type WetStats = { puddlePixels: number; reflectedPixels: number };

/** Applies the wet look to the finished world in place. */
export function wetPass(input: WetInput): WetStats {
  const { world, field, drive, raised, style, seed } = input;
  const { w, h } = field;
  const data = world.data;
  const flags = world.flags!;
  const tone = new Map<number, number>();
  const toneOf = (c: Color, isRaised: boolean): Color => {
    const key = c * 2 + (isRaised ? 1 : 0);
    let o = tone.get(key);
    if (o === undefined) {
      o = wetTone(style, c, isRaised);
      tone.set(key, o);
    }
    return o;
  };
  const get = (p: number): Color =>
    (data[p * 4]! << 16) | (data[p * 4 + 1]! << 8) | data[p * 4 + 2]!;
  const put = (p: number, c: Color): void => {
    data[p * 4] = (c >> 16) & 255;
    data[p * 4 + 1] = (c >> 8) & 255;
    data[p * 4 + 2] = c & 255;
  };
  // Remember the self-lit pixels before anything changes: they are the reflection sources.
  const original = data.slice();
  const srcColor = (p: number): Color =>
    (original[p * 4]! << 16) | (original[p * 4 + 1]! << 8) | original[p * 4 + 2]!;

  // 1. Wet tone.
  for (let p = 0; p < w * h; p++) {
    if (flags[p]! & F_EMISSIVE) continue;
    if (input.dry && input.dry[p]) continue;
    put(p, toneOf(get(p), raised[p] === 1));
  }

  // 2. Puddles.
  const puddle = new Uint8Array(w * h);
  const track = field.track;
  let puddlePixels = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!drive[p] || raised[p] || (input.dry && input.dry[p])) continue;
      if (flags[p]! & F_EMISSIVE) continue;
      const br = track.branches[field.branch[p]!];
      if (!br) continue;
      const sh = br.shoulder[field.sample[p]!]!;
      // Distance inside the paved edge: 0 at the kerb line, negative toward the centre.
      const k = field.edge[p]! + sh;
      const n = noise(x, y, seed);
      let wet = false;
      if (k > -12 && k < -0.5) wet = n > 1 - style.gutterShare * (1 - (k + 12) / 30);
      else if (k <= -12) wet = n > 1 - style.spotShare && noise(x + 517, y + 211, seed + 7) > 0.55;
      else if (sh > 0 && k >= -0.5) wet = n > 1 - style.gutterShare * 0.35;
      if (!wet) continue;
      // Paint shows through: a lane marking is never swallowed by water.
      if (lum(get(p)) > 150) continue;
      puddle[p] = 1;
      puddlePixels++;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!puddle[p]) continue;
      // The near lip is in shade, the far edge catches light, the body mirrors the sky with a
      // ripple now and then.
      let c: Color;
      if (puddle[p - w] === 0 || puddle[p - 1] === 0) c = style.puddleLip;
      else if (puddle[p + w] === 0 || puddle[p + 1] === 0) c = style.puddleEdge;
      else if ((y & 1) === 0 && hash2(x >> 2, y >> 1, seed + 3) < 0.16) c = style.ripple;
      else c = style.puddle;
      put(p, c);
    }
  }

  // 3. Reflections of self-lit things standing north of the road, column by column: what
  // stands `d` rows above the edge shows `STRETCH * d` rows below it, as broken streaks.
  let reflectedPixels = 0;
  const REACH = 64;
  const STRETCH = 2;
  /** A reflection is drawn in the light's own hue at a few fixed strengths, never as a smear. */
  const streak = (here: Color, src: Color, strength: number): Color => {
    const lvl = Math.round(Math.min(1, strength) * 3);
    if (lvl <= 0) return here;
    // Keep the light's hue: a dim streak is a darker version of the light, not a gray mix.
    const deep = mixc(src, mixc(here, 0x0e1124, 0.5), 0.62);
    if (lvl === 1) return mixc(here, deep, 0.7);
    if (lvl === 2) return mixc(deep, src, 0.45);
    return mixc(deep, src, 0.8);
  };
  for (let x = 1; x < w - 1; x++) {
    // Dashes are phased per group of three columns, so a streak breaks across its width
    // like light on rippled water, and neighboring streaks break at different rows.
    const phase = (hash2(Math.floor(x / 3), 3, seed + 11) * 9) | 0;
    let y = 0;
    while (y < h) {
      if (!drive[y * w + x]) {
        y++;
        continue;
      }
      const top = y;
      // The brightest self-lit thing standing within reach above this edge, and its height.
      let src = -1;
      let height = 0;
      let best = 0;
      for (let k = 2; k <= REACH / STRETCH && top - k >= 0; k++) {
        const q = (top - k) * w + x;
        if (!(flags[q]! & F_EMISSIVE)) continue;
        const l = lum(srcColor(q));
        if (l > best + 8 && l >= 140) {
          best = l;
          src = srcColor(q);
          height = k;
        }
      }
      let end = top;
      while (end < h && drive[end * w + x]) end++;
      if (src >= 0) {
        const len = Math.min(REACH, end - top, height * STRETCH + 6);
        // Vertical striation: one column in three stays dark.
        const striate = (x + ((hash2(Math.floor(x / 7), 5, seed + 14) * 3) | 0)) % 3 === 2;
        for (let dy = 0; dy < len; dy++) {
          const p = (top + dy) * w + x;
          if (raised[p] || (input.dry && input.dry[p])) continue;
          const band = Math.floor((top + dy + phase) / 3);
          if (dy > 2 && hash2(Math.floor(x / 3), band, seed + 12) < 0.38) continue;
          if (striate && !puddle[p]) continue;
          const here = get(p);
          if (lum(here) > 150 && !puddle[p]) continue;
          const fade = 1 - dy / len;
          put(p, streak(here, src, (puddle[p] ? style.reflectPuddle : style.reflect) * fade));
          reflectedPixels++;
        }
      }
      y = end;
    }
  }

  // Lamp glare: a broken streak straight down the wet road from below each lamp head.
  for (const l of input.lights) {
    if (l.intensity < 0.75) continue;
    const c = col(l.color);
    const lx = Math.round(l.x);
    let y0 = Math.round(l.y) + 2;
    // Start where the wet road starts under the lamp.
    while (y0 < h && y0 < l.y + 40 && !(drive[y0 * w + lx] && !raised[y0 * w + lx])) y0++;
    const len = Math.round(l.radius * 0.8);
    for (let dy = 0; dy < len; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = lx + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x;
        if (!drive[p] || raised[p] || (input.dry && input.dry[p])) continue;
        if (hash2(x, Math.floor((y + dx * 2) / 3), seed + 21) < 0.3) continue;
        const here = get(p);
        if (lum(here) > 150 && !puddle[p]) continue;
        const fade = 1 - dy / len;
        const s = (dx === 0 ? 1 : 0.55) * fade * (puddle[p] ? 1.3 : 1) * style.reflect;
        put(p, streak(here, c, s));
      }
    }
  }

  // Glints: pale two-pixel vertical ticks scattered on the wet road.
  for (let y = 1; y < h - 2; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!drive[p] || raised[p] || puddle[p] || (input.dry && input.dry[p])) continue;
      if (hash2(x, y, seed + 31) > style.glintRate) continue;
      if (lum(get(p)) > 130) continue;
      put(p, mixc(get(p), style.glint, 0.5));
      if (drive[p + w] && !raised[p + w]) put(p + w, mixc(get(p + w), style.glint, 0.25));
    }
  }
  return { puddlePixels, reflectedPixels };
}

/**
 * The same wet tone for things drawn outside the world surface. Ground-level loop frames take
 * the world's own emissive flags at their position, so frame 0 still matches the baked art.
 */
export function wetLoops(style: WetStyle, world: Canvas, loops: readonly AnimatedArt[]): void {
  const flags = world.flags!;
  for (const a of loops) {
    for (const f of a.frames) {
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          if (f.alpha(x, y) !== 255) continue;
          const wx = a.x + x;
          const wy = a.y + y;
          if (wx >= 0 && wy >= 0 && wx < world.w && wy < world.h)
            if (flags[wy * world.w + wx]! & F_EMISSIVE) continue;
          f.set(x, y, wetTone(style, f.get(x, y), true));
        }
      }
    }
  }
}

export function wetOverlays(style: WetStyle, overlays: readonly OverlayArt[]): void {
  for (const o of overlays) {
    const cv = o.canvas;
    for (let i = 0; i < cv.w * cv.h; i++) {
      const a = cv.data[i * 4 + 3]!;
      if (a === 0) continue;
      const c = (cv.data[i * 4]! << 16) | (cv.data[i * 4 + 1]! << 8) | cv.data[i * 4 + 2]!;
      const t = wetTone(style, c, true);
      cv.data[i * 4] = (t >> 16) & 255;
      cv.data[i * 4 + 1] = (t >> 8) & 255;
      cv.data[i * 4 + 2] = t & 255;
    }
  }
}
