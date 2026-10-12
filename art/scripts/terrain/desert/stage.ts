import type { OverlayArt } from '../biome.js';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import { shadowVolume } from '../lighting.js';
import { LEAN_RUN, TILT } from '../oblique.js';
import type { Masks } from './masks.js';

/**
 * The desert stage: everything that has height. Unlike the city, whose raised art never reaches
 * drivable ground, the open desert is drivable almost everywhere, so the split between the two
 * layers is made pixel by pixel: a raised pixel drawn over ground a car can reach goes to the
 * foreground (an overlay above the cars, faded near the player); one drawn over unreachable
 * ground (a rock's own collision disc, a canyon wall's capsule, the land behind the boundary)
 * stays in the ground layer. Nothing raised is ever left in the ground layer over reachable
 * ground, and `coveredDrivable` proves it from the picture.
 *
 * Solid masses are a height field in screen rise units, drawn by marching each screen pixel's
 * line of sight back through the field, so overlapping rocks, cliffs and mesas hide one another
 * correctly and lean east as they rise like the city's buildings (`LEAN_RUN`). Upright sprites
 * (cacti, posts, signs, towers) are drawn with a depth key, the ground row they stand on.
 */

export const KEY_NONE = -32768;

/** Material ids of the height field. */
export const M_NONE = 0;
export const M_BOULDER = 1;
export const M_CLIFF = 2;
export const M_MESA = 3;
export const M_RIDGE = 4;
export const M_PILLAR = 5;

/** Overlay kinds, by code, for naming the foreground pieces. */
export const FG_KINDS = ['ground', 'rock', 'cliff', 'mesa', 'prop', 'sign', 'arch', 'tower'];
export const FG_ROCK = 1;
export const FG_CLIFF = 2;
export const FG_MESA = 3;
export const FG_PROP = 4;
export const FG_SIGN = 5;
export const FG_ARCH = 6;
export const FG_TOWER = 7;

export type HitInfo = {
  /** Ground pixel of the surface point and its rise above the ground. */
  gx: number;
  gy: number;
  r: number;
  /** 0 top, 1 south face, 2 west face. */
  face: 0 | 1 | 2;
  /** True when a taller mass to the north-west shades this point. */
  shaded: boolean;
};

/** Colors a height-field hit; `mat` is the material at the hit's ground pixel. */
export type MassPainter = (mat: number, hit: HitInfo, stage: Stage) => Color;

export class Stage {
  readonly w: number;
  readonly h: number;
  readonly masks: Masks;
  readonly world: Canvas;
  /** World-sized foreground; cut into overlays at the end. */
  readonly fg: Canvas;
  readonly fgKind: Uint8Array;
  readonly wkey: Int16Array;
  readonly fkey: Int16Array;
  /** Height field in screen rise units, and its material. */
  readonly rise: Uint8Array;
  /**
   * Underside of a column, for masses that span open air (arches, overhangs): the column is
   * solid from `floor` up to `rise`. Zero for everything that stands on the ground.
   */
  readonly floor: Uint8Array;
  readonly mat: Uint8Array;
  /** Per-pixel variation seed for materials (strata offsets, owner). */
  readonly tag: Uint16Array;
  /** Ground pixels in the shadow of something that is not in the height field (props). */
  readonly propShadow: Uint8Array;
  /** Screen pixels the raised geometry wrote, in either layer. */
  readonly raised: Uint8Array;
  shade: Uint8Array = new Uint8Array(0);
  maxRise = 0;

  constructor(masks: Masks, world: Canvas) {
    this.w = masks.w;
    this.h = masks.h;
    this.masks = masks;
    this.world = world;
    this.fg = new Canvas(this.w, this.h);
    const n = this.w * this.h;
    this.fgKind = new Uint8Array(n);
    this.wkey = new Int16Array(n).fill(KEY_NONE);
    this.fkey = new Int16Array(n).fill(KEY_NONE);
    this.rise = new Uint8Array(n);
    this.floor = new Uint8Array(n);
    this.mat = new Uint8Array(n);
    this.tag = new Uint16Array(n);
    this.propShadow = new Uint8Array(n);
    this.raised = new Uint8Array(n);
  }

  private roadSat: Int32Array | null = null;

  /** True when the rectangle holds any pavement pixel (where cars race). */
  roadIn(x0: number, y0: number, x1: number, y1: number): boolean {
    const { w, h } = this;
    if (!this.roadSat) {
      const sat = new Int32Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let run = 0;
        for (let x = 0; x < w; x++) {
          run += this.masks.kind[y * w + x] === 1 ? 1 : 0;
          sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + run;
        }
      }
      this.roadSat = sat;
    }
    const a = Math.max(0, Math.min(w, x0));
    const b = Math.max(0, Math.min(h, y0));
    const c = Math.max(0, Math.min(w, x1));
    const d = Math.max(0, Math.min(h, y1));
    if (c <= a || d <= b) return false;
    const W = w + 1;
    const S = this.roadSat;
    return S[d * W + c]! - S[b * W + c]! - S[d * W + a]! + S[b * W + a]! > 0;
  }

  /** Raises one ground pixel of a mass. Taller wins. */
  raise(x: number, y: number, r: number, material: number, tag = 0): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    const v = Math.min(250, Math.max(0, Math.round(r)));
    if (v <= this.rise[p]!) return;
    this.rise[p] = v;
    this.mat[p] = material;
    this.tag[p] = tag;
    if (v > this.maxRise) this.maxRise = v;
  }

  /** Raises a slab that spans open air: solid from `bottom` up to `top`. */
  raiseSlab(x: number, y: number, bottom: number, top: number, material: number, tag = 0): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    const t = Math.min(250, Math.max(0, Math.round(top)));
    const b = Math.max(0, Math.min(t - 1, Math.round(bottom)));
    if (t <= this.rise[p]!) return;
    this.rise[p] = t;
    this.floor[p] = b;
    this.mat[p] = material;
    this.tag[p] = tag;
    if (t > this.maxRise) this.maxRise = t;
  }

  riseAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.rise[y * this.w + x]!;
  }

  /**
   * Writes one raised pixel at a screen position. `key` is the ground row of the surface
   * shown there; a nearer surface (larger key) is never overwritten by a farther one.
   */
  put(x: number, y: number, c: Color, key: number, kind: number, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    if (this.masks.reach[p]) {
      if (key < this.fkey[p]!) return;
      if (alpha === 255) {
        this.fg.setA(x, y, c, 255);
        this.fkey[p] = key;
      } else this.fg.halo(x, y, c, alpha);
      this.fgKind[p] = kind;
    } else {
      if (key < this.wkey[p]!) return;
      if (alpha !== 255) return;
      this.world.set(x, y, c);
      this.wkey[p] = key;
    }
    this.raised[p] = 1;
  }

  /** Forces a pixel into the foreground whatever lies under it (things that hang over roads). */
  putFg(x: number, y: number, c: Color, key: number, kind: number, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    if (key < this.fkey[p]!) return;
    if (alpha === 255) {
      this.fg.setA(x, y, c, 255);
      this.fkey[p] = key;
    } else this.fg.halo(x, y, c, alpha);
    this.fgKind[p] = kind;
    this.raised[p] = 1;
  }

  /** Stands an upright sprite whose bottom row is ground row `baseY`. */
  sprite(art: Canvas, x: number, y: number, baseY: number, kind: number, forceFg = false): void {
    for (let yy = 0; yy < art.h; yy++)
      for (let xx = 0; xx < art.w; xx++) {
        const i = (yy * art.w + xx) * 4;
        const a = art.data[i + 3]!;
        if (a === 0) continue;
        const c = (art.data[i]! << 16) | (art.data[i + 1]! << 8) | art.data[i + 2]!;
        // A sprite carries its own depth when it has a key plane (rounded solids).
        const k = art.keys && art.keys[yy * art.w + xx] !== KEY_NONE ? art.keys[yy * art.w + xx]! : baseY;
        if (forceFg) this.putFg(x + xx, y + yy, c, k, kind, a);
        else this.put(x + xx, y + yy, c, k, kind, a);
      }
  }

  /**
   * The cast shadow of an upright sprite on the ground: each pixel `v` rows above its base
   * falls `2v / drop` pixels south-east, the same rule as the height field's shadow volume.
   */
  spriteShadow(art: Canvas, x: number, y: number, baseY: number, drop: number, from = 0): void {
    const bottom = y + art.h - 1;
    for (let yy = 0; yy < art.h; yy++)
      for (let xx = 0; xx < art.w; xx++) {
        if (art.data[(yy * art.w + xx) * 4 + 3]! < 200) continue;
        // Rows above the sprite's own foot.
        const v = bottom - (y + yy);
        if (v < from) continue;
        const d = Math.round((2 * v) / drop);
        const gx = x + xx + d;
        const gy = baseY + d;
        for (const [ox, oy] of [
          [0, 0],
          [1, 0],
        ] as const) {
          const qx = gx + ox;
          const qy = gy + oy;
          if (qx < 0 || qy < 0 || qx >= this.w || qy >= this.h) continue;
          this.propShadow[qy * this.w + qx] = 1;
        }
      }
  }

  /**
   * Casts the height field's shadow volume. Call once every mass is raised. Slabs over open
   * air are traced ray by ray, so an arch throws an arch-shaped shadow with light under it.
   */
  resolveShadows(drop: number): void {
    const { w, h } = this;
    const solid = this.rise.slice();
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let p = 0; p < w * h; p++) {
      if (this.floor[p]! === 0) continue;
      solid[p] = 0;
      const x = p % w;
      const y = (p / w) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    this.shade = shadowVolume(w, h, solid, drop);
    if (x1 < 0) return;
    const K = Math.ceil((this.maxRise * 2) / drop) + 1;
    for (let y = y0; y <= Math.min(h - 1, y1 + K); y++)
      for (let x = x0; x <= Math.min(w - 1, x1 + K); x++) {
        const p = y * w + x;
        for (let k = 1; k <= K; k++) {
          const qx = x - k;
          const qy = y - k;
          if (qx < 0 || qy < 0) break;
          const q = qy * w + qx;
          if (this.floor[q]! === 0) continue;
          const zr = (k * drop) / 2;
          if (zr >= this.floor[q]! && zr <= this.rise[q]!) {
            if (this.shade[p]! < 1) this.shade[p] = 1;
            break;
          }
        }
      }
  }

  shadedAt(x: number, y: number, r: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.shade[y * this.w + x]! > r;
  }

  /**
   * Draws the height field. For every screen pixel that some mass could reach, the line of
   * sight is walked from the highest rise down: the first ground pixel whose column is at least
   * that tall is what the pixel shows, its top if the column ends there, else a face.
   */
  drawMasses(paint: MassPainter): void {
    const { w, h, rise } = this;
    const R = this.maxRise;
    if (R === 0) return;
    // Tiles of 32 px holding any mass, grown up the screen and east by the tallest rise.
    const T = 32;
    const tc = Math.ceil(w / T);
    const tr = Math.ceil(h / T);
    const has = new Uint8Array(tc * tr);
    const tallest = new Uint8Array(tc * tr);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = rise[y * w + x]!;
        if (v === 0) continue;
        const t = ((y / T) | 0) * tc + ((x / T) | 0);
        has[t] = 1;
        if (v > tallest[t]!) tallest[t] = v;
      }
    const want = new Uint8Array(tc * tr);
    for (let ty = 0; ty < tr; ty++)
      for (let tx = 0; tx < tc; tx++) {
        const t = ty * tc + tx;
        if (!has[t]) continue;
        const up = Math.ceil((tallest[t]! + 1) / T);
        const east = Math.ceil((Math.floor(tallest[t]! / LEAN_RUN) + 1) / T);
        for (let dy = -up; dy <= 0; dy++)
          for (let dx = 0; dx <= east; dx++) {
            const yy = ty + dy;
            const xx = tx + dx;
            if (yy >= 0 && xx < tc) want[yy * tc + xx] = 1;
          }
      }
    const hit: HitInfo = { gx: 0, gy: 0, r: 0, face: 0, shaded: false };
    for (let ty = 0; ty < tr; ty++)
      for (let tx = 0; tx < tc; tx++) {
        if (!want[ty * tc + tx]) continue;
        for (let sy = ty * T; sy < Math.min(h, ty * T + T); sy++)
          for (let sx = tx * T; sx < Math.min(w, tx * T + T); sx++) {
            for (let r = Math.min(R, h - 1 - sy); r >= 1; r--) {
              const gx = sx - Math.floor(r / LEAN_RUN);
              const gy = sy + r;
              if (gx < 0) continue;
              const g = gy * w + gx;
              const v = rise[g]!;
              if (v < r || this.floor[g]! > r) continue;
              hit.gx = gx;
              hit.gy = gy;
              hit.r = r;
              if (v === r) hit.face = 0;
              else {
                // Which neighbour the line of sight came from: south, or west where it leant.
                const lean = Math.floor((r + 1) / LEAN_RUN) !== Math.floor(r / LEAN_RUN);
                hit.face = lean && gx > 0 && rise[g - 1]! <= r ? 2 : 1;
              }
              hit.shaded = this.shade.length > 0 && this.shade[g]! > r;
              const c = paint(this.mat[g]!, hit, this);
              const m = this.mat[g]!;
              const kind = m === M_CLIFF || m === M_RIDGE ? FG_CLIFF : m === M_MESA ? FG_MESA : FG_ROCK;
              this.put(sx, sy, c, gy, kind);
              break;
            }
          }
      }
  }

  /**
   * Cuts the foreground into overlays: pixels grouped into connected pieces on a 16 px grid,
   * and any piece wider or taller than `maxSide` split into tiles, so each overlay is compact
   * and only fades when the player's car is really near it.
   */
  overlays(prefix: string, maxSide = 192): OverlayArt[] {
    const { w, h, fg } = this;
    const C = 16;
    const cc = Math.ceil(w / C);
    const cr = Math.ceil(h / C);
    const cell = new Int32Array(cc * cr);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (fg.data[(y * w + x) * 4 + 3]! > 0) cell[((y / C) | 0) * cc + ((x / C) | 0)] = -1;
    const out: OverlayArt[] = [];
    let label = 0;
    const stack: number[] = [];
    for (let c0 = 0; c0 < cc * cr; c0++) {
      if (cell[c0] !== -1) continue;
      label++;
      cell[c0] = label;
      stack.push(c0);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const members: number[] = [];
      while (stack.length) {
        const c = stack.pop()!;
        members.push(c);
        const cx = c % cc;
        const cy = (c / cc) | 0;
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cc || ny >= cr) continue;
            const q = ny * cc + nx;
            if (cell[q] === -1) {
              cell[q] = label;
              stack.push(q);
            }
          }
      }
      // Tile the piece: split anything too large, and anything whose fade box (its opaque
      // bounds grown by the client's 26 px) would reach the road without the piece itself
      // standing over the road, so driving past a cliff never fades it.
      const emit = (cx0: number, cy0: number, cx1: number, cy1: number): void => {
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        let overRoad = false;
        const px0 = cx0 * C;
        const py0 = cy0 * C;
        const px1 = Math.min(w, (cx1 + 1) * C);
        const py1 = Math.min(h, (cy1 + 1) * C);
        for (let Y = py0; Y < py1; Y++)
          for (let X = px0; X < px1; X++) {
            if (cell[((Y / C) | 0) * cc + ((X / C) | 0)] !== label) continue;
            if (fg.data[(Y * w + X) * 4 + 3]! === 0) continue;
            bx0 = Math.min(bx0, X);
            by0 = Math.min(by0, Y);
            bx1 = Math.max(bx1, X);
            by1 = Math.max(by1, Y);
            if (this.masks.kind[Y * w + X] !== 0) overRoad = true;
          }
        if (bx1 < bx0) return;
        const cw = cx1 - cx0 + 1;
        const ch = cy1 - cy0 + 1;
        const big = (bx1 - bx0 + 1 > maxSide || by1 - by0 + 1 > maxSide) && (cw > 1 || ch > 1);
        const nearRoad = !overRoad && this.roadIn(bx0 - 26, by0 - 26, bx1 + 27, by1 + 27) && (cw > 2 || ch > 2);
        if (big || nearRoad) {
          if (cw >= ch) {
            const mid = cx0 + (cw >> 1) - 1;
            emit(cx0, cy0, mid, cy1);
            emit(mid + 1, cy0, cx1, cy1);
          } else {
            const mid = cy0 + (ch >> 1) - 1;
            emit(cx0, cy0, cx1, mid);
            emit(cx0, mid + 1, cx1, cy1);
          }
          return;
        }
        const cv = new Canvas(px1 - px0, py1 - py0);
        const kinds = new Map<number, number>();
        for (let Y = py0; Y < py1; Y++)
          for (let X = px0; X < px1; X++) {
            if (cell[((Y / C) | 0) * cc + ((X / C) | 0)] !== label) continue;
            const i4 = (Y * w + X) * 4;
            const a = fg.data[i4 + 3]!;
            if (a === 0) continue;
            cv.setA(X - px0, Y - py0, (fg.data[i4]! << 16) | (fg.data[i4 + 1]! << 8) | fg.data[i4 + 2]!, a);
            const k = this.fgKind[Y * w + X]!;
            kinds.set(k, (kinds.get(k) ?? 0) + 1);
          }
        let best = 0;
        let bestN = -1;
        for (const [k, nn] of kinds)
          if (nn > bestN || (nn === bestN && k < best)) {
            best = k;
            bestN = nn;
          }
        const kind = FG_KINDS[best] ?? 'prop';
        out.push({
          id: `${prefix}${String(out.length + 1).padStart(3, '0')}_${kind}`,
          kind: `desert_${kind}`,
          canvas: cv,
          x: px0,
          y: py0,
          fadeNearPlayer: true,
        });
      };
      emit(x0, y0, x1, y1);
      void members;
    }
    return out;
  }
}

/** World height of a screen rise, the inverse of `riseOf`. */
export const heightOf = (rise: number): number => rise / TILT;
