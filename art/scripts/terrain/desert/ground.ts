import { hash2 } from '@bolt/shared';
import type { Canvas, Color } from '../canvas.js';
import type { CorridorField } from '../field.js';
import { FAR } from '../field.js';
import { K_OFFROAD } from './masks.js';
import type { Masks } from './masks.js';
import { smooth, vnoise } from './noise.js';
import type { Look } from './palette.js';
import { darker, lighter } from './palette.js';
import { emptyRegion } from './spec.js';
import type { Region, TerrainSpec } from './spec.js';

/**
 * The open ground: dunes, swells, flats and slopes, painted flat on the ground plane in hard
 * posterized steps of one sand ramp. Light comes from the upper left, so a slope facing the
 * north-west is a step lighter and one facing the south-east a step darker; dune crests carry a
 * one pixel highlight and their slip faces lie in the darker steps. Small ripples run across the
 * weather's wind, so the crosswind preset reads in the sand itself.
 */

const CELL = 8;
const HCELL = 4;
const SEED = 4101;

export type RegionGrid = {
  cols: number;
  rows: number;
  data: Float32Array;
  sample(x: number, y: number, out: Region): Region;
};

const KEYS: Array<keyof Region> = [
  'dune',
  'playa',
  'rubble',
  'brush',
  'tone',
  'terrace',
  'streak',
  'alt',
];

export function buildRegionGrid(spec: TerrainSpec, w: number, h: number): RegionGrid {
  const cols = Math.ceil(w / CELL) + 1;
  const rows = Math.ceil(h / CELL) + 1;
  const n = KEYS.length;
  const data = new Float32Array(cols * rows * n);
  const r = emptyRegion();
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      Object.assign(r, emptyRegion());
      spec.region(i * CELL, j * CELL, r);
      const o = (j * cols + i) * n;
      KEYS.forEach((k, q) => (data[o + q] = r[k]));
    }
  return {
    cols,
    rows,
    data,
    sample(x, y, out) {
      const fx = Math.min(cols - 1.001, Math.max(0, x / CELL));
      const fy = Math.min(rows - 1.001, Math.max(0, y / CELL));
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const tx = fx - i;
      const ty = fy - j;
      const o00 = (j * cols + i) * n;
      const o10 = o00 + n;
      const o01 = o00 + cols * n;
      const o11 = o01 + n;
      for (let q = 0; q < n; q++) {
        const a = data[o00 + q]!;
        const b = data[o10 + q]!;
        const c = data[o01 + q]!;
        const d = data[o11 + q]!;
        out[KEYS[q]!] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      }
      return out;
    },
  };
}

/** Relief gradient on a 4 px grid, for hill shading. */
export type SlopeGrid = {
  cols: number;
  rows: number;
  gx: Float32Array;
  gy: Float32Array;
  hgt: Float32Array;
};

export function buildSlopeGrid(spec: TerrainSpec, w: number, h: number): SlopeGrid {
  const cols = Math.ceil(w / HCELL) + 2;
  const rows = Math.ceil(h / HCELL) + 2;
  const hgt = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) hgt[j * cols + i] = spec.height(i * HCELL, j * HCELL);
  const gx = new Float32Array(cols * rows);
  const gy = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const l = hgt[j * cols + Math.max(0, i - 1)]!;
      const r = hgt[j * cols + Math.min(cols - 1, i + 1)]!;
      const u = hgt[Math.max(0, j - 1) * cols + i]!;
      const d = hgt[Math.min(rows - 1, j + 1) * cols + i]!;
      gx[j * cols + i] = (r - l) / (2 * HCELL);
      gy[j * cols + i] = (d - u) / (2 * HCELL);
    }
  return { cols, rows, gx, gy, hgt };
}

function bilinear(arr: Float32Array, cols: number, rows: number, x: number, y: number): number {
  const fx = Math.min(cols - 1.001, Math.max(0, x / HCELL));
  const fy = Math.min(rows - 1.001, Math.max(0, y / HCELL));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const a = arr[j * cols + i]!;
  const b = arr[j * cols + i + 1]!;
  const c = arr[(j + 1) * cols + i]!;
  const d = arr[(j + 1) * cols + i + 1]!;
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Relief gradient at a point (rise per world px, positive toward east and south). */
export function slopeAt(sg: SlopeGrid, x: number, y: number): { x: number; y: number } {
  return { x: bilinear(sg.gx, sg.cols, sg.rows, x, y), y: bilinear(sg.gy, sg.cols, sg.rows, x, y) };
}

export function heightAt(sg: SlopeGrid, x: number, y: number): number {
  return bilinear(sg.hgt, sg.cols, sg.rows, x, y);
}

export type GroundOut = {
  /** Sand ramp step painted at each pixel (0 deep to 5 crest), 255 where not painted. */
  level: Uint8Array;
};

/**
 * Paints every off-road pixel (and the ground under solids and behind the boundary). Road and
 * shoulder pixels are left for the road painter.
 */
export function paintGround(
  world: Canvas,
  field: CorridorField,
  masks: Masks,
  spec: TerrainSpec,
  look: Look,
  regions: RegionGrid,
  slopes: SlopeGrid,
): GroundOut {
  const { w, h } = masks;
  const ramp: Color[] = [
    spec.sand.deep,
    spec.sand.dark,
    spec.sand.mid,
    spec.sand.base,
    spec.sand.light,
    spec.sand.hi,
  ];
  const alt: Color[] = [
    spec.sandAlt.deep,
    spec.sandAlt.dark,
    spec.sandAlt.mid,
    spec.sandAlt.base,
    spec.sandAlt.light,
    spec.sandAlt.hi,
  ];
  const silt: Color[] = [
    darker(spec.sand.mid, 0.08),
    spec.sand.mid,
    lighter(spec.sand.mid, 0.18),
    lighter(spec.sand.base, 0.22),
    lighter(spec.sand.light, 0.25),
    lighter(spec.sand.hi, 0.3),
  ];
  const pw = spec.prevailing;
  const L = spec.duneLength;
  // Ripples lie across the wind of the day when it is strong, else across the prevailing wind.
  const strong = look.wind.speed >= 20;
  const rw = strong ? look.wind : pw;
  const rippleL = strong ? 6 : 7;
  const level = new Uint8Array(w * h).fill(255);
  const data = world.data;
  const reg = emptyRegion();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (masks.kind[p] !== K_OFFROAD) continue;
      const e = field.edge[p]! >= FAR ? 600 : field.edge[p]!;
      regions.sample(x, y, reg);
      const near = e < 24 ? 0 : e > 190 ? 1 : (e - 24) / 166;
      // Hill shading of the swells.
      const hx = bilinear(slopes.gx, slopes.cols, slopes.rows, x, y);
      const hy = bilinear(slopes.gy, slopes.cols, slopes.rows, x, y);
      // Gentle swells stay inside one step; only real slopes change the light.
      const raw = (hx + hy) * 2.6;
      let b = raw > 0.38 ? (raw - 0.38) * 1.5 : raw < -0.38 ? (raw + 0.38) * 1.5 : 0;
      // Dunes: long lit windward slopes, a crest line, a short dark slip face, broken into
      // crescents where a slow noise lets them die away.
      const dune = reg.dune * near;
      let crest = false;
      let foot = false;
      let lee = false;
      let ampHere = 0;
      if (dune > 0.03) {
        const breakup = smooth(0.18, 0.5, vnoise(x, y, 260, SEED + 3));
        const amp = spec.duneHeight * dune * breakup;
        ampHere = amp;
        if (amp > 0.8) {
          const warp =
            (vnoise(x, y, 430, SEED) - 0.5) * L * 0.9 +
            (vnoise(x, y, 120, SEED + 5) - 0.5) * L * 0.2;
          const u = x * pw.x + y * pw.y + warp + (1 - breakup) * L * 0.3;
          const f = u / L - Math.floor(u / L);
          const peak = 0.8;
          let slope: number;
          if (f < peak) slope = amp / (peak * L);
          else {
            slope = -amp / ((1 - peak) * L);
            lee = true;
          }
          b += slope * (pw.x + pw.y) * 2.4;
          if (amp > 5) {
            if (f >= peak - 1.5 / L && f < peak) crest = true;
            if (f > 1 - 1.1 / L) foot = true;
          }
        }
      }
      // Ripple marks: short broken strokes across the wind, in patches, never on slip faces.
      const playa = reg.playa;
      let ripple = 0;
      if (playa < 0.5 && reg.rubble < 0.6 && !lee) {
        const patch = vnoise(x, y, 96, SEED + 7);
        if (patch > 0.56) {
          const q = (x * rw.x + y * rw.y) / rippleL + (vnoise(x, y, 41, SEED + 9) - 0.5) * 1.3;
          const fq = q - Math.floor(q);
          if (fq < 0.17) {
            const t = x * -rw.y + y * rw.x;
            const dash = t / 27 + hash2(Math.floor(q), 0, SEED + 11) * 7;
            if (dash - Math.floor(dash) < 0.72)
              ripple = -0.62 * (0.4 + 0.6 * near) * (1 - playa * 2);
          }
        }
      }
      // Grain: sparse two-pixel flecks.
      let grain = 0;
      const g = hash2(x >> 1, y, SEED + 17);
      if (g < 0.01) grain = -0.9;
      else if (g > 0.995) grain = 0.8;
      let v = 3 + reg.tone + b + ripple + grain;
      // A slip face reads as one clear band of shade behind a bright crest line: the dune's
      // shape has to carry at race speed, where single-step shading is lost.
      if (lee && ampHere > 4) v -= 0.55;
      if (crest) v = Math.max(v, 4.6);
      if (foot) v = Math.min(v, 1.4);
      // Terraces: the lip of each contour ledge catches the light, its foot does not.
      if (reg.terrace > 0.05 && hx * hx + hy * hy > 0.012) {
        const ht = heightAt(slopes, x, y) + (vnoise(x, y, 60, SEED + 21) - 0.5) * 5;
        const t = ht / 15 - Math.floor(ht / 15);
        if (t < 0.06 * reg.terrace) v += 1.1;
        else if (t < 0.14 * reg.terrace) v -= 1.1;
      }
      v = Math.max(0, Math.min(5, v));
      let step = Math.floor(v);
      const frac = v - step;
      if (frac > 0.5) step = Math.min(5, step + 1);
      // The second sand lies in broad patches with ragged, wind-combed edges.
      const useAlt =
        reg.alt > 0.02 &&
        vnoise(x, y, 330, SEED + 31) + (vnoise(x, y, 37, SEED + 32) - 0.5) * 0.12 >
          1.12 - reg.alt * 0.62;
      const c = (playa > 0.5 ? silt : useAlt ? alt : ramp)[step]!;
      level[p] = step;
      const o = p * 4;
      data[o] = (c >> 16) & 255;
      data[o + 1] = (c >> 8) & 255;
      data[o + 2] = c & 255;
      data[o + 3] = 255;
    }
  }
  return { level };
}
