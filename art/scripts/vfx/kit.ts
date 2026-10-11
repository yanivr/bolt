import type { VfxLayer } from '@bolt/shared';
import { hash2 } from '@bolt/shared';
import type { RGBA } from '../lib/pixels.js';
import { PixelBuffer, hex } from '../lib/pixels.js';

/**
 * Drawing kit for the combat effects atlas. Everything here is pure pixel arithmetic: seeded
 * hashes only, no clock and no `Math.random`, so a second bake is byte-identical.
 *
 * House rules (docs/ART_GUIDE.md, docs/VFX_GUIDE.md):
 * - Hard pixel edges. A pixel is fully opaque or fully clear, except the ground glows, the
 *   shadows and the decals, which use a few fixed alpha steps and never a gradient.
 * - Limited ramps. Every color in the atlas comes from the ramps below.
 * - Direction is baked. A sprite that points somewhere is drawn once per heading from a shape
 *   written in its own space; nothing is rotated or scaled as a bitmap, here or at run time.
 * - Shapes are clusters, not circles: fields of drifting lobes with coherent noise on the
 *   edge, quantized into the bands of a ramp and eroded in two-pixel cells as they die.
 */

export type Put = (x: number, y: number, c: RGBA) => void;

export type FxStrip = {
  id: string;
  frameWidth: number;
  frameHeight: number;
  frames: PixelBuffer[];
  fps: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
  layer: VfxLayer;
  blend: 'normal' | 'add';
  directions: number;
  fallback: string | null;
};

export type FxOptions = {
  fps?: number;
  loop?: boolean;
  /** Defaults to the centre of the frame. */
  anchor?: [number, number];
  layer?: VfxLayer;
  blend?: 'normal' | 'add';
  fallback?: string;
};

// --- Ramps ------------------------------------------------------------------------------------

const ramp = (...colors: string[]): RGBA[] => colors.map((c) => hex(c));

/** Hottest first. Fire, muzzle flashes, sparks. */
export const FIRE = ramp(
  '#ffffff',
  '#fff3b0',
  '#ffd35a',
  '#ff9a3c',
  '#f0602c',
  '#c8322e',
  '#7a2430',
  '#3b1a2a',
);
/** Blast smoke, lightest first. Shadows lean blue-violet; nothing is a pure gray. */
export const SOOT = ramp('#b9bdd0', '#8d91aa', '#62667f', '#3b3d55', '#232438');
/** Light smoke and steam, tintable at run time. */
export const VAPOR = ramp('#f2f4fa', '#c4cad8', '#8b93a8');
export const DUST = ramp('#eadab4', '#c9ae80', '#9c8562', '#6f5f4e');
export const CYAN = ramp('#ffffff', '#c8fbff', '#7fe9f5', '#46d5e6', '#2a8fc0', '#1f4f8a');
export const VIOLET = ramp('#ffffff', '#f3e4ff', '#c9a4ff', '#9a6cf0', '#6d59a2', '#40306e');
export const ICE = ramp('#ffffff', '#d8f6ff', '#9fe8ff', '#62b8e8', '#3a78b8', '#274a80');
export const FOAM = ramp('#fffdf2', '#f0ead6', '#d4cdb4', '#b0a6b8', '#857c96');
export const OIL = ramp('#3a4470', '#232a4a', '#161a30', '#0d1020');
export const SHEEN = ramp('#e8d060', '#d86aa0', '#7c6cf0', '#3fb8c0');
export const STEEL = ramp('#f2f4fa', '#c4cad8', '#8b93a8', '#565f78', '#2e3448', '#1b2134');
export const MINT = ramp('#eafff4', '#a8f5cf', '#67dea7', '#2f9e78', '#1c5a50');
export const BRASS = ramp('#ffe9a0', '#e0b040', '#9a7020', '#5c4018');
export const PINK = ramp('#ffffff', '#ffe0f0', '#ff9ac0', '#f46b58', '#c8322e', '#7a2430');
export const ROAD = ramp('#8e93a8', '#666b82', '#474b62', '#2e3146');
export const AMBER = hex('#ffb454');
export const CORAL = hex('#f46b58');
export const RED = hex('#d83f49');
export const INK = hex('#0a0d18');

/** A color that the directional outline pass leaves alone: flames, glows, trails. */
export function glow(c: RGBA): RGBA {
  return [c[0], c[1], c[2], 254];
}

export function alpha(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], a];
}

// --- Noise ------------------------------------------------------------------------------------

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0, 1). `z` is time: neighbouring frames change a little, not wholly. */
export function vnoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const h = (dx: number, dy: number, dz: number) =>
    hash2(ix + dx, iy + dy, seed * 131 + (iz + dz) * 977);
  const a = h(0, 0, 0) + (h(1, 0, 0) - h(0, 0, 0)) * fx;
  const b = h(0, 1, 0) + (h(1, 1, 0) - h(0, 1, 0)) * fx;
  const c = h(0, 0, 1) + (h(1, 0, 1) - h(0, 0, 1)) * fx;
  const d = h(0, 1, 1) + (h(1, 1, 1) - h(0, 1, 1)) * fx;
  const lo = a + (b - a) * fy;
  const hi = c + (d - c) * fy;
  return lo + (hi - lo) * fz;
}

/** Value noise that repeats every `period` lattice cells in y, for loops that scroll upward. */
export function loopNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const wrap = (v: number) => ((v % period) + period) % period;
  const h = (dx: number, dy: number) => hash2(ix + dx, wrap(iy + dy), seed);
  const a = h(0, 0) + (h(1, 0) - h(0, 0)) * fx;
  const b = h(0, 1) + (h(1, 1) - h(0, 1)) * fx;
  return a + (b - a) * fy;
}

// --- Strips -----------------------------------------------------------------------------------

export function fx(
  id: string,
  w: number,
  h: number,
  frames: number,
  opts: FxOptions,
  draw: (frame: number, put: Put, t: number) => void,
): FxStrip {
  const out: PixelBuffer[] = [];
  for (let f = 0; f < frames; f++) {
    const image = new PixelBuffer(w, h);
    draw(
      f,
      (x, y, c) => {
        const px = Math.floor(x);
        const py = Math.floor(y);
        if (px < 0 || py < 0 || px >= w || py >= h) return;
        image.set(px, py, c[3] === 254 ? [c[0], c[1], c[2], 255] : c);
      },
      frames > 1 ? f / (frames - 1) : 0,
    );
    out.push(image);
  }
  return {
    id,
    frameWidth: w,
    frameHeight: h,
    frames: out,
    fps: opts.fps ?? 12,
    loop: opts.loop ?? false,
    anchorX: opts.anchor ? opts.anchor[0] : Math.floor(w / 2),
    anchorY: opts.anchor ? opts.anchor[1] : Math.floor(h / 2),
    layer: opts.layer ?? 'body',
    blend: opts.blend ?? 'normal',
    directions: 1,
    fallback: opts.fallback ?? null,
  };
}

export type DirContext = {
  /** Heading of this frame, radians, 0 up the screen and clockwise. */
  heading: number;
  /** Time frame within the heading. */
  frame: number;
  /** True when a surface whose normal is toward positive `v` faces the upper-left key light. */
  litRight: boolean;
};

/**
 * A sprite with a direction, drawn once per heading from a shape in its own space: `u` runs
 * forward and `v` to the right, in pixels from the anchor. The shape is sampled at pixel
 * centres, so every heading is drawn fresh and none is a rotated bitmap. Opaque colors get a
 * one-pixel `outline`; colors passed through `glow()` do not.
 */
export function directional(
  id: string,
  size: number,
  directions: number,
  timeFrames: number,
  opts: FxOptions & { outline?: RGBA },
  shape: (u: number, v: number, ctx: DirContext) => RGBA | null,
): FxStrip {
  const frames: PixelBuffer[] = [];
  const c = size / 2;
  for (let d = 0; d < directions; d++) {
    const heading = (d / directions) * Math.PI * 2;
    const fxv = Math.sin(heading);
    const fyv = -Math.cos(heading);
    // Right-hand side of the direction of travel, on screen.
    const rx = -fyv;
    const ry = fxv;
    for (let f = 0; f < timeFrames; f++) {
      const image = new PixelBuffer(size, size);
      const solid = new Uint8Array(size * size);
      const ctx: DirContext = { heading, frame: f, litRight: rx * -0.6 + ry * -0.8 > 0 };
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x + 0.5 - c;
          const dy = y + 0.5 - c;
          const color = shape(dx * fxv + dy * fyv, dx * rx + dy * ry, ctx);
          if (!color) continue;
          if (color[3] === 254) image.set(x, y, [color[0], color[1], color[2], 255]);
          else {
            image.set(x, y, color);
            if (color[3] === 255) solid[y * size + x] = 1;
          }
        }
      }
      if (opts.outline) {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (image.alphaAt(x, y) !== 0) continue;
            const near =
              (x > 0 && solid[y * size + x - 1]) ||
              (x < size - 1 && solid[y * size + x + 1]) ||
              (y > 0 && solid[(y - 1) * size + x]) ||
              (y < size - 1 && solid[(y + 1) * size + x]);
            if (near) image.set(x, y, opts.outline);
          }
        }
      }
      frames.push(image);
    }
  }
  return {
    id,
    frameWidth: size,
    frameHeight: size,
    frames,
    fps: opts.fps ?? 20,
    loop: opts.loop ?? false,
    anchorX: opts.anchor ? opts.anchor[0] : Math.floor(c),
    anchorY: opts.anchor ? opts.anchor[1] : Math.floor(c),
    layer: opts.layer ?? 'body',
    blend: opts.blend ?? 'normal',
    directions,
    fallback: opts.fallback ?? null,
  };
}

// --- Fields -----------------------------------------------------------------------------------

export type Lobe = { x: number; y: number; r: number };

/** 1 at the middle of the nearest lobe, 0 on its edge, negative outside. */
export function lobeField(lobes: readonly Lobe[], x: number, y: number): number {
  let best = -9;
  for (const l of lobes) {
    if (l.r <= 0) continue;
    const v = 1 - Math.hypot(x - l.x, y - l.y) / l.r;
    if (v > best) best = v;
  }
  return best;
}

/** Index of the first threshold `value` clears, for picking a band of a ramp. */
export function band(value: number, thresholds: readonly number[]): number {
  for (let i = 0; i < thresholds.length; i++) if (value >= thresholds[i]!) return i;
  return thresholds.length;
}

export type CloudOptions = {
  seed: number;
  /** Colors from the middle outward. */
  ramp: readonly RGBA[];
  /** Field values at which each color of the ramp gives way to the next. */
  thresholds: readonly number[];
  /** Added to the field before banding: positive is hotter (inner colors reach further out). */
  heat?: number;
  /** Ragged edge: amplitude in field units and feature size in pixels. */
  noise?: number;
  grain?: number;
  /** Time coordinate of the noise, so the edge crawls from frame to frame. */
  z?: number;
  /** Share of two-pixel cells knocked out, 0 to 1. */
  erode?: number;
  /** Cell size of the erosion, pixels. */
  cell?: number;
  /** Darkest ramp color on the side away from the light, in a band this wide (field units). */
  rim?: number;
  rimColor?: RGBA;
  /** Only pixels the mask accepts are drawn. */
  mask?: (x: number, y: number) => boolean;
};

/**
 * Draws a cluster: the union of the lobes with a noisy edge, colored in hard bands. This is
 * the one routine behind every fireball, smoke blossom, dust puff, puddle and splat.
 */
export function cloud(
  put: Put,
  w: number,
  h: number,
  lobes: readonly Lobe[],
  o: CloudOptions,
): void {
  const grain = o.grain ?? 4;
  const noise = o.noise ?? 0;
  const cell = o.cell ?? 2;
  const erode = o.erode ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (o.mask && !o.mask(px, py)) continue;
      let f = lobeField(lobes, px, py);
      if (f < -0.5) continue;
      if (noise > 0) f += (vnoise(px / grain, py / grain, o.z ?? 0, o.seed) - 0.5) * 2 * noise;
      if (f <= 0) continue;
      if (
        erode > 0 &&
        hash2(Math.floor(x / cell), Math.floor(y / cell), o.seed + 71) < erode * (1.15 - f * 0.6)
      )
        continue;
      let index = band(f + (o.heat ?? 0), o.thresholds);
      if (index >= o.ramp.length) index = o.ramp.length - 1;
      let color = o.ramp[index]!;
      if (o.rim && o.rimColor && f < o.rim) {
        // The rim is drawn where the edge faces away from the upper-left light.
        const g =
          lobeField(lobes, px - 1.2, py - 1.6) +
          (noise > 0
            ? (vnoise((px - 1.2) / grain, (py - 1.6) / grain, o.z ?? 0, o.seed) - 0.5) * 2 * noise
            : 0);
        if (g > f) color = o.rimColor;
      }
      put(x, y, color);
    }
  }
}

/** Lobes that start together and drift apart: the skeleton of a burst. */
export function burstLobes(
  cx: number,
  cy: number,
  count: number,
  seed: number,
  spread: number,
  radius: number,
  rise = 0,
): Lobe[] {
  const out: Lobe[] = [];
  for (let k = 0; k < count; k++) {
    const a = ((k + hash2(k, seed, 3) * 0.8) / count) * Math.PI * 2 + hash2(seed, 5, 9) * 6;
    const d = spread * (0.45 + hash2(k, seed, 4) * 0.75);
    out.push({
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d - rise,
      r: radius * (0.6 + hash2(k, seed, 6) * 0.55),
    });
  }
  return out;
}

// --- Primitives -------------------------------------------------------------------------------

export function line(put: Put, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard++) {
    put(ax, ay, c);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

export function disc(put: Put, cx: number, cy: number, r: number, c: RGBA): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) put(x, y, c);
}

/** A one-pixel ring, optionally broken into `dashes` arcs of which `fill` (0 to 1) is drawn. */
export function ring(
  put: Put,
  cx: number,
  cy: number,
  r: number,
  thickness: number,
  c: RGBA,
  dashes = 0,
  fill = 1,
  phase = 0,
): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r || d <= r - thickness) continue;
      if (dashes > 0) {
        const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1 + phase) % 1;
        if ((a * dashes) % 1 > fill) continue;
      }
      put(x, y, c);
    }
  }
}

/**
 * A spiked flash: `arms` rays of uneven length around a hot disc, colored from the middle out.
 * Rays taper to one pixel, which is what keeps a flash reading as light and not as a blob.
 */
export function star(
  put: Put,
  cx: number,
  cy: number,
  arms: number,
  length: number,
  core: number,
  colors: readonly RGBA[],
  seed: number,
  twist = 0,
): void {
  for (let y = Math.floor(cy - length - 1); y <= Math.ceil(cy + length + 1); y++) {
    for (let x = Math.floor(cx - length - 1); x <= Math.ceil(cx + length + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + twist;
      const turn = ((a / (Math.PI * 2)) * arms + arms * 4) % 1;
      const arm = Math.floor(((a / (Math.PI * 2)) * arms + arms * 4 + 0.5) % arms);
      const off = Math.abs(turn - 0.5) * 2;
      // `off` is 1 on a ray's axis and 0 midway between rays.
      // Long and short rays alternate, each a little uneven: a burst, not a drawn sun.
      const share =
        arm % 2 === 0 ? 0.72 + hash2(arm, seed, 21) * 0.28 : 0.3 + hash2(arm, seed, 21) * 0.3;
      const reach = core + (length - core) * share;
      const half = Math.max(0.55, (1 - d / reach) * (core * 0.8));
      const across = (1 - off) * ((Math.PI * 2) / arms / 2) * d;
      const inside = d <= core || (d <= reach && across <= half);
      if (!inside) continue;
      const k = d <= core ? (d / core) * 0.35 : 0.35 + (d / reach) * 0.65;
      put(x, y, colors[Math.min(colors.length - 1, Math.floor(k * colors.length))]!);
    }
  }
}

/** Rotates a small integer shape in quarter-free steps by resampling its own definition. */
export function tumble(
  put: Put,
  size: number,
  angle: number,
  shape: (u: number, v: number) => RGBA | null,
  outline?: RGBA,
): void {
  const c = size / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const filled = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const color = shape(dx * cos + dy * sin, -dx * sin + dy * cos);
      if (!color) continue;
      put(x, y, color);
      filled[y * size + x] = 1;
    }
  }
  if (!outline) return;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (filled[y * size + x]) continue;
      const near =
        (x > 0 && filled[y * size + x - 1]) ||
        (x < size - 1 && filled[y * size + x + 1]) ||
        (y > 0 && filled[(y - 1) * size + x]) ||
        (y < size - 1 && filled[(y + 1) * size + x]);
      if (near) put(x, y, outline);
    }
  }
}
