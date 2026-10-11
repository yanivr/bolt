import type { RGBA } from './pixels.js';
import { PixelBuffer, hex, mix } from './pixels.js';

/**
 * Sprite modeller. A vehicle part is described once as a stack of top-down solids: a 2D
 * outline (a signed distance function), a height profile, and a material ramp. The renderer
 * then draws that description at any heading with consistent upper-left lighting, quantized
 * ramp shading, cast shadows and a selective outline.
 *
 * This is how sixteen coherent directional frames per chassis stay in agreement with each
 * other and with every mounted part (Sections 12.7 and 14.2): the shapes are authored, the
 * rotation is not hand-redrawn. Output is fully deterministic.
 */

// --- Signed distance shapes --------------------------------------------------------------------

/** Negative inside, positive outside, in model units (world pixels). */
export type Shape = (x: number, y: number) => number;

export function circle(cx: number, cy: number, r: number): Shape {
  return (x, y) => Math.hypot(x - cx, y - cy) - r;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): Shape {
  const m = Math.min(rx, ry);
  return (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * m;
}

export function roundRect(cx: number, cy: number, hw: number, hh: number, r: number): Shape {
  const rr = Math.min(r, hw, hh);
  return (x, y) => {
    const qx = Math.abs(x - cx) - (hw - rr);
    const qy = Math.abs(y - cy) - (hh - rr);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
  };
}

export function capsule(ax: number, ay: number, bx: number, by: number, r: number): Shape {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby || 1;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / len2));
    return Math.hypot(x - (ax + abx * t), y - (ay + aby * t)) - r;
  };
}

/** Closed polygon, optionally rounded by `r` (the points describe the inset skeleton). */
export function polygon(points: Array<[number, number]>, r = 0): Shape {
  const n = points.length;
  return (x, y) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = points[i]!;
      const [xj, yj] = points[j]!;
      const ex = xj - xi;
      const ey = yj - yi;
      const wx = x - xi;
      const wy = y - yi;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      const dx = wx - ex * t;
      const dy = wy - ey * t;
      d = Math.min(d, dx * dx + dy * dy);
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(d) - r;
  };
}

export function union(...shapes: Shape[]): Shape {
  return (x, y) => {
    let d = Infinity;
    for (const s of shapes) d = Math.min(d, s(x, y));
    return d;
  };
}

export function subtract(a: Shape, b: Shape): Shape {
  return (x, y) => Math.max(a(x, y), -b(x, y));
}

export function intersect(a: Shape, b: Shape): Shape {
  return (x, y) => Math.max(a(x, y), b(x, y));
}

export function grow(shape: Shape, amount: number): Shape {
  return (x, y) => shape(x, y) - amount;
}

/** Mirrors a shape authored for the right-hand side onto both sides. */
export function mirrorX(shape: Shape): Shape {
  return (x, y) => shape(Math.abs(x), y);
}

export function translate(shape: Shape, dx: number, dy: number): Shape {
  return (x, y) => shape(x - dx, y - dy);
}

export function rotate(shape: Shape, rad: number, cx = 0, cy = 0): Shape {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return shape(cx + dx * c + dy * s, cy - dx * s + dy * c);
  };
}

/** Half-plane helpers for clipping decals. */
export const above =
  (yLimit: number): Shape =>
  (_x, y) =>
    y - yLimit;
export const below =
  (yLimit: number): Shape =>
  (_x, y) =>
    yLimit - y;
export const band =
  (y0: number, y1: number): Shape =>
  (_x, y) =>
    Math.max(y0 - y, y - y1);
export const strip =
  (x0: number, x1: number): Shape =>
  (x) =>
    Math.max(x0 - x, x - x1);

// --- Materials ---------------------------------------------------------------------------------

export type Material = {
  /** Five steps, darkest first: deep shadow, shadow, base, light, highlight. */
  ramp: [RGBA, RGBA, RGBA, RGBA, RGBA];
  outline: RGBA;
  /** Shifts every quantized shade up or down, for materials that should read brighter. */
  bias?: number;
  /** Flat materials ignore lighting and always use the base step plus bias. */
  flat?: boolean;
};

export function ramp(
  deep: string,
  shadow: string,
  base: string,
  light: string,
  high: string,
  outline: string,
  extra: Partial<Material> = {},
): Material {
  return {
    ramp: [hex(deep), hex(shadow), hex(base), hex(light), hex(high)],
    outline: hex(outline),
    ...extra,
  };
}

// --- Model -------------------------------------------------------------------------------------

export type Solid = {
  shape: Shape;
  material: string;
  /** Height at the outline and on the plateau. */
  z0: number;
  z1: number;
  /** Distance from the outline over which the surface rises from z0 to z1. Zero is a sheer wall. */
  bevel?: number;
  profile?: 'round' | 'linear';
  /** Optional custom height, replacing the bevel profile. `d` is the signed distance (negative). */
  height?: (x: number, y: number, d: number) => number;
  /** Height this part rests at when it sits on another sprite layer; no side is drawn below it. */
  floor?: number;
  /** Free-form label used to target decals and to extract overlay layers. */
  tag?: string;
  /** Solids that do not throw shadows (lights, glass, thin trim). */
  noShadow?: boolean;
};

export type Decal = {
  shape: Shape;
  /** Restrict to solids with one of these tags. Omit to apply to every solid. */
  on?: string[];
  /** Replace the material. */
  material?: string;
  /** Shift the quantized shade by this many ramp steps. */
  shade?: number;
};

export type Model = {
  solids: Solid[];
  decals: Decal[];
  materials: Record<string, Material>;
};

export type RenderOptions = {
  /** Clockwise heading in radians; 0 points up the image. */
  heading: number;
  width: number;
  height: number;
  /** Camera tilt: pixels a point rises on screen per unit of height. 0 looks straight down. */
  tilt?: number;
  /** Exaggerates part heights so the tilted view reads clearly at small sizes. */
  zScale?: number;
  /** Uniform magnification of the model, for icons. 1 is game size. */
  scale?: number;
  /** Supersampling grid per pixel edge. */
  samples?: number;
  /** Where the model origin lands in the image. Defaults to the image centre. */
  originX?: number;
  originY?: number;
  outline?: boolean;
  /**
   * One color for the whole outline, all the way round, in place of the selective outline
   * that takes the color family of the part it borders. Mounted parts use it so that they
   * stand off the bodywork whatever paint is under them.
   */
  outlineColor?: RGBA;
  /** Keep only pixels whose winning solid has one of these tags. */
  onlyTags?: string[];
  /** Skip solids with these tags entirely. */
  skipTags?: string[];
};

export type RenderResult = {
  image: PixelBuffer;
  /** Index of the winning solid per pixel, or -1. Used for layer extraction and validation. */
  solidIndex: Int16Array;
  /** 1 where the part stands on the ground, regardless of what is drawn there. */
  footprint: Uint8Array;
};

// Upper-left key light, raised. A flat top lands on the base ramp step.
const LIGHT = (() => {
  const v = [-0.5, -0.6, 0.62];
  const len = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / len, v[1]! / len, v[2]! / len] as const;
})();
const SHADE_STEPS = [0.28, 0.5, 0.7, 0.88];

function quantize(shade: number): number {
  let idx = 0;
  for (const edge of SHADE_STEPS) if (shade >= edge) idx++;
  return idx;
}

function solidHeight(solid: Solid, x: number, y: number, d: number): number {
  if (solid.height) return solid.height(x, y, d);
  const bevel = solid.bevel ?? 0;
  if (bevel <= 0) return solid.z1;
  const t = Math.max(0, Math.min(1, -d / bevel));
  const f = solid.profile === 'linear' ? t : Math.sqrt(1 - (1 - t) * (1 - t));
  return solid.z0 + (solid.z1 - solid.z0) * f;
}

type Hit = { solid: number; z: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Conservative model-space bounds per shape, found once by coarse sampling. Shapes are cheap
 * individually but a frame evaluates them millions of times; rejecting by box first keeps a
 * full bake fast without changing a single output pixel.
 */
const boxCache = new WeakMap<Shape, Box>();
const BOX_EXTENT = 64;
function boundsOf(shape: Shape): Box {
  const cached = boxCache.get(shape);
  if (cached) return cached;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = -BOX_EXTENT; y <= BOX_EXTENT; y += 1) {
    for (let x = -BOX_EXTENT; x <= BOX_EXTENT; x += 1) {
      if (shape(x, y) > 1.5) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const box =
    x1 < x0 ? { x0: 0, y0: 0, x1: -1, y1: -1 } : { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 };
  boxCache.set(shape, box);
  return box;
}

function topSolid(solids: Solid[], active: boolean[], x: number, y: number, out: Hit): boolean {
  let best = -1;
  let bestZ = -Infinity;
  for (let i = 0; i < solids.length; i++) {
    if (!active[i]) continue;
    const s = solids[i]!;
    const box = boundsOf(s.shape);
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
    const d = s.shape(x, y);
    if (d > 0) continue;
    const z = solidHeight(s, x, y, d);
    if (z >= bestZ) {
      bestZ = z;
      best = i;
    }
  }
  out.solid = best;
  out.z = bestZ;
  return best >= 0;
}

function heightOf(solid: Solid, x: number, y: number): number {
  const d = solid.shape(x, y);
  // Outside the outline the surface falls away, which is what lights the rim of a part.
  if (d > 0) return solid.z0 - Math.min(3, d * 2.2);
  return solidHeight(solid, x, y, d);
}

/**
 * Renders one model at one heading.
 *
 * The camera looks down from the south at an angle: a point at height z is drawn `tilt * z`
 * pixels up the image. Parts are sampled on a fine ground grid and painted north to south, so
 * nearer geometry covers what stands behind it and the south-facing sides of tall parts
 * become visible walls. With `tilt` 0 this is a straight-down view.
 */
export function renderModel(model: Model, opts: RenderOptions): RenderResult {
  const { width, height } = opts;
  const n = opts.samples ?? 3;
  const tilt = opts.tilt ?? 0;
  const scale = opts.scale ?? 1;
  const zScale = (opts.zScale ?? 1) * scale;
  const ox = opts.originX ?? width / 2;
  const oy = opts.originY ?? height / 2;
  const cos = Math.cos(opts.heading);
  const sin = Math.sin(opts.heading);
  const solids = model.solids;
  const active = solids.map((s) => !(opts.skipTags && s.tag && opts.skipTags.includes(s.tag)));

  const names = Object.keys(model.materials);
  const nameIndex = new Map(names.map((name, i) => [name, i]));
  const sw = width * n;
  const sh = height * n;
  const cellMat = new Int16Array(sw * sh).fill(-1);
  const cellSolid = new Int16Array(sw * sh).fill(-1);
  const cellShade = new Float32Array(sw * sh);
  const ground = new Uint8Array(sw * sh);

  // The light is fixed in screen space, so bring it into model space once per frame.
  const lx = LIGHT[0] * cos + LIGHT[1] * sin;
  const ly = -LIGHT[0] * sin + LIGHT[1] * cos;
  const lz = LIGHT[2];
  const toLightLen = Math.hypot(lx, ly) || 1;
  const sx = lx / toLightLen;
  const sy = ly / toLightLen;
  const slope = lz / toLightLen;

  const hit: Hit = { solid: -1, z: 0 };
  const probe: Hit = { solid: -1, z: 0 };
  const eps = 0.3;
  const stackSolid: number[] = [];
  const stackZ: number[] = [];

  const put = (gx: number, row: number, mat: number, solid: number, shade: number) => {
    if (row < 0 || row >= sh) return;
    const i = row * sw + gx;
    cellMat[i] = mat;
    cellSolid[i] = solid;
    cellShade[i] = shade;
  };

  for (let gy = 0; gy < sh; gy++) {
    for (let gx = 0; gx < sw; gx++) {
      const px = ((gx + 0.5) / n - ox) / scale;
      const py = ((gy + 0.5) / n - oy) / scale;
      // Screen-aligned ground position to model space: undo the clockwise heading rotation.
      const mx = px * cos + py * sin;
      const my = -px * sin + py * cos;

      // Every solid standing on this ground point, lowest first.
      stackSolid.length = 0;
      stackZ.length = 0;
      for (let i = 0; i < solids.length; i++) {
        if (!active[i]) continue;
        const s = solids[i]!;
        const box = boundsOf(s.shape);
        if (mx < box.x0 || mx > box.x1 || my < box.y0 || my > box.y1) continue;
        const d = s.shape(mx, my);
        if (d > 0) continue;
        const z = solidHeight(s, mx, my, d);
        let at = stackZ.length;
        while (at > 0 && stackZ[at - 1]! > z) at--;
        stackZ.splice(at, 0, z);
        stackSolid.splice(at, 0, i);
      }
      const count = stackZ.length;
      if (count === 0) continue;
      ground[gy * sw + gx] = 1;

      // Sides first, from the ground up: each band belongs to the lowest part that reaches it.
      if (tilt > 0) {
        let from = 0;
        for (let k = 0; k < count; k++) {
          const z = stackZ[k]! * zScale;
          if (z <= from) continue;
          const solid = solids[stackSolid[k]!]!;
          const mat = model.materials[solid.material];
          if (!mat) throw new Error(`Unknown material ${solid.material}`);
          let level = 2;
          if (!mat.flat) {
            const gx2 = solid.shape(mx + eps, my) - solid.shape(mx - eps, my);
            const gy2 = solid.shape(mx, my + eps) - solid.shape(mx, my - eps);
            const gl = Math.hypot(gx2, gy2) || 1;
            const facing = (gx2 * lx + gy2 * ly) / gl;
            level = facing > 0.38 ? 2 : facing > -0.1 ? 1 : 0;
          }
          level = Math.max(0, Math.min(4, level + (mat.bias ?? 0)));
          // A part that rides on another (an engine lid on a deck) has no side below its floor.
          const lo = Math.max(from, (solid.floor ?? 0) * zScale);
          const top = gy - Math.floor(tilt * z * n);
          const bottom = gy - Math.floor(tilt * Math.min(lo, z) * n);
          const m = nameIndex.get(solid.material)!;
          for (let row = bottom; row > top; row--) put(gx, row, m, stackSolid[k]!, level);
          from = z;
        }
      }

      // Then the visible top.
      hit.solid = stackSolid[count - 1]!;
      hit.z = stackZ[count - 1]!;
      const solid = solids[hit.solid]!;
      let material = solid.material;
      let delta = 0;
      for (const decal of model.decals) {
        if (decal.on && !(solid.tag && decal.on.includes(solid.tag))) continue;
        const dbox = boundsOf(decal.shape);
        if (mx < dbox.x0 || mx > dbox.x1 || my < dbox.y0 || my > dbox.y1) continue;
        if (decal.shape(mx, my) > 0) continue;
        if (decal.material) material = decal.material;
        if (decal.shade) delta += decal.shade;
      }
      const mat = model.materials[material];
      if (!mat) throw new Error(`Unknown material ${material}`);
      let level = 2;
      if (!mat.flat) {
        const gxh = (heightOf(solid, mx + eps, my) - heightOf(solid, mx - eps, my)) / (2 * eps);
        const gyh = (heightOf(solid, mx, my + eps) - heightOf(solid, mx, my - eps)) / (2 * eps);
        const nl = Math.hypot(gxh, gyh, 1);
        let shade = (-gxh * lx - gyh * ly + lz) / nl;
        // Cast shadow: march toward the light and see whether anything stands in the way.
        for (const step of [1.4, 2.8, 4.4]) {
          if (
            topSolid(solids, active, mx + sx * step, my + sy * step, probe) &&
            !solids[probe.solid]!.noShadow
          ) {
            if (probe.z - hit.z > step * slope + 0.6) {
              shade -= 0.26;
              break;
            }
          }
        }
        level = quantize(shade);
      }
      level = Math.max(0, Math.min(4, level + delta + (mat.bias ?? 0)));
      put(
        gx,
        gy - Math.floor(tilt * hit.z * zScale * n),
        nameIndex.get(material)!,
        hit.solid,
        level,
      );
    }
  }

  // Resolve each pixel from its sub-cells: majority material, average shade.
  const image = new PixelBuffer(width, height);
  const solidIndex = new Int16Array(width * height).fill(-1);
  const footprint = new Uint8Array(width * height);
  const materialAt: string[] = new Array<string>(width * height).fill('');
  const tally = new Map<number, { count: number; shade: number; solid: number }>();
  const total = n * n;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      tally.clear();
      let covered = 0;
      let grounded = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = (py * n + j) * sw + px * n + i;
          if (ground[c]) grounded++;
          const m = cellMat[c]!;
          if (m < 0) continue;
          covered++;
          const slot = tally.get(m);
          if (slot) {
            slot.count++;
            slot.shade += cellShade[c]!;
          } else {
            tally.set(m, { count: 1, shade: cellShade[c]!, solid: cellSolid[c]! });
          }
        }
      }
      if (grounded * 2 >= total) footprint[py * width + px] = 1;
      if (covered * 2 < total) continue;
      let win = -1;
      let best: { count: number; shade: number; solid: number } | null = null;
      for (const [m, slot] of tally) {
        if (!best || slot.count > best.count) {
          best = slot;
          win = m;
        }
      }
      if (!best) continue;
      const winSolid = solids[best.solid]!;
      if (opts.onlyTags && !(winSolid.tag && opts.onlyTags.includes(winSolid.tag))) continue;
      const name = names[win]!;
      const mat = model.materials[name]!;
      const idx = Math.max(0, Math.min(4, Math.round(best.shade / best.count)));
      image.set(px, py, mat.ramp[idx]!);
      solidIndex[py * width + px] = best.solid;
      materialAt[py * width + px] = name;
    }
  }

  if (opts.outline !== false) {
    const edge = new PixelBuffer(width, height);
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (image.alphaAt(px, py) !== 0) continue;
        // Selective outline: the rim takes the color family of the part it borders, and the
        // side facing the light is a step lighter than the side in shadow.
        const order: Array<[number, number, boolean]> = [
          [1, 0, true],
          [0, 1, true],
          [-1, 0, false],
          [0, -1, false],
        ];
        for (const [dx, dy, lit] of order) {
          const qx = px + dx;
          const qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
          const name = materialAt[qy * width + qx];
          if (!name) continue;
          const mat = model.materials[name]!;
          edge.set(
            px,
            py,
            opts.outlineColor ?? (lit ? mix(mat.outline, mat.ramp[1], 0.32) : mat.outline),
          );
          break;
        }
      }
    }
    image.blit(edge, 0, 0);
  }
  return { image, solidIndex, footprint };
}

/**
 * Pulls the pixels of tagged parts out of a finished render and recolors them, for emissive
 * overlays such as lit headlights. Uses the same pixels as the body, so overlays always align.
 */
export function extractTagged(
  result: RenderResult,
  model: Model,
  tags: string[],
  color: RGBA,
): PixelBuffer {
  const { image, solidIndex } = result;
  const out = new PixelBuffer(image.width, image.height);
  for (let i = 0; i < solidIndex.length; i++) {
    const s = solidIndex[i]!;
    if (s < 0) continue;
    const tag = model.solids[s]!.tag;
    if (tag && tags.includes(tag)) out.set(i % image.width, Math.floor(i / image.width), color);
  }
  return out;
}

/** Flat ground shadow from the footprint of a render: where the part actually stands. */
export function footprintShadow(result: RenderResult, color: RGBA): PixelBuffer {
  const out = new PixelBuffer(result.image.width, result.image.height);
  for (let i = 0; i < result.footprint.length; i++) {
    if (result.footprint[i]) out.set(i % out.width, Math.floor(i / out.width), color);
  }
  return out;
}

/** Flat silhouette of a rendered sprite, for ground shadows. */
export function silhouette(src: PixelBuffer, color: RGBA, rim: RGBA): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.alphaAt(x, y) !== 0) out.set(x, y, color);
    }
  }
  // One translucent pixel of rim keeps the shadow pixel-edged but not harsh.
  const rimmed = new PixelBuffer(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (out.alphaAt(x, y) !== 0) {
        rimmed.set(x, y, color);
        continue;
      }
      if (
        out.alphaAt(x + 1, y) ||
        out.alphaAt(x - 1, y) ||
        out.alphaAt(x, y + 1) ||
        out.alphaAt(x, y - 1)
      ) {
        rimmed.set(x, y, rim);
      }
    }
  }
  return rimmed;
}

/** Adds a one-pixel translucent halo around every opaque pixel of an emissive overlay. */
export function addGlow(src: PixelBuffer, glow: RGBA): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.alphaAt(x, y) !== 0) continue;
      if (
        src.alphaAt(x + 1, y) ||
        src.alphaAt(x - 1, y) ||
        src.alphaAt(x, y + 1) ||
        src.alphaAt(x, y - 1)
      ) {
        out.set(x, y, glow);
      }
    }
  }
  out.blit(src, 0, 0);
  return out;
}

/** Rotates a model-space point into sprite pixels for a given heading. */
export function projectPoint(x: number, y: number, heading: number): { x: number; y: number } {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}
