import { PixelBuffer } from '../lib/pixels.js';

/**
 * Integer drawing surface used by every terrain painter. Colors are packed 0xRRGGBB numbers so
 * the hot per-pixel loops never allocate. The world surface and every standing sprite also
 * carry a flag per pixel, which tells the lighting passes what is self-lit.
 */

export type Color = number;

export function col(hex: string): Color {
  const c = hex.startsWith('#') ? hex.slice(1) : hex;
  if (c.length !== 6) throw new Error(`Bad color ${hex}`);
  return parseInt(c, 16);
}

export function toHex(c: Color): string {
  return `#${c.toString(16).padStart(6, '0').toUpperCase()}`;
}

export function mixc(a: Color, b: Color, t: number): Color {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bl = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Pixel is self-lit: the shadow and lamp passes leave it alone. */
export const F_EMISSIVE = 1;
/** Pixel is never darkened by cast shadows (painted lines that must stay readable). */
export const F_NOSHADOW = 2;
/** Pixel already carries a hand-painted contact shadow. */
export const F_SHADED = 4;

export type Stencil = { rows: readonly string[]; w: number; h: number };

export function stencil(rows: readonly string[]): Stencil {
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  return { rows, w, h: rows.length };
}

export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly buf: PixelBuffer;
  readonly data: Uint8ClampedArray;
  /** Optional flag plane, present on the world surface and on sprites. */
  flags: Uint8Array | null = null;
  /** Flags written with every pixel. */
  curFlags = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new PixelBuffer(w, h);
    this.data = this.buf.data;
  }

  static world(w: number, h: number): Canvas {
    const c = new Canvas(w, h);
    c.flags = new Uint8Array(w * h);
    return c;
  }

  /** A sprite surface that remembers which of its pixels are self-lit. */
  static sprite(w: number, h: number): Canvas {
    const c = new Canvas(w, h);
    c.flags = new Uint8Array(w * h);
    return c;
  }

  set(x: number, y: number, c: Color): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    const i = p * 4;
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
    this.data[i + 3] = 255;
    if (this.flags) this.flags[p] = this.curFlags;
  }

  /** Replaces the pixel including alpha, without blending. For crisp overlay halos. */
  setA(x: number, y: number, c: Color, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
    this.data[i + 3] = a;
  }

  /** Writes a translucent halo pixel only where nothing opaque has been drawn yet. */
  halo(x: number, y: number, c: Color, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (this.data[i + 3]! >= a) return;
    this.setA(x, y, c, a);
  }

  get(x: number, y: number): Color {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const i = (y * this.w + x) * 4;
    return (this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!;
  }

  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3]!;
  }

  /** Remaps an existing opaque pixel through `fn`, once. Used for contact shadows. */
  map(x: number, y: number, fn: (c: Color) => Color): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const p = y * this.w + x;
    if (this.data[p * 4 + 3] === 0) return;
    if (this.flags) {
      if (this.flags[p]! & (F_EMISSIVE | F_SHADED)) return;
      this.flags[p] = this.flags[p]! | F_SHADED;
    }
    const i = p * 4;
    const c = fn((this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!);
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
  }

  mapRect(x: number, y: number, w: number, h: number, fn: (c: Color) => Color): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.map(xx, yy, fn);
  }

  mapDisc(cx: number, cy: number, r: number, fn: (c: Color) => Color): void {
    const r2 = (r + 0.35) * (r + 0.35);
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        if ((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= r2) this.map(xx, yy, fn);
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  frame(x: number, y: number, w: number, h: number, c: Color): void {
    for (let xx = x; xx < x + w; xx++) {
      this.set(xx, y, c);
      this.set(xx, y + h - 1, c);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.set(x, yy, c);
      this.set(x + w - 1, yy, c);
    }
  }

  hline(x: number, y: number, len: number, c: Color): void {
    for (let i = 0; i < len; i++) this.set(x + i, y, c);
  }

  vline(x: number, y: number, len: number, c: Color): void {
    for (let i = 0; i < len; i++) this.set(x, y + i, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Filled disc with the classic pixel-art radius bias so small sizes stay round. */
  disc(cx: number, cy: number, r: number, c: Color): void {
    const r2 = (r + 0.35) * (r + 0.35);
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        if ((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= r2) this.set(xx, yy, c);
      }
    }
  }

  /** One pixel wide circle outline. */
  ring(cx: number, cy: number, r: number, c: Color, thickness = 1): void {
    const ro = (r + 0.35) * (r + 0.35);
    const ri = Math.max(0, r - thickness + 0.35);
    const ri2 = ri * ri;
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
        const d = (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy);
        if (d <= ro && d > ri2) this.set(xx, yy, c);
      }
    }
  }

  /** Draws a character stencil. `.` and space are transparent; other glyphs map via `pal`. */
  stamp(x: number, y: number, st: Stencil, pal: Readonly<Record<string, Color>>): void {
    for (let r = 0; r < st.h; r++) {
      const row = st.rows[r]!;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!;
        if (ch === '.' || ch === ' ') continue;
        const color = pal[ch];
        if (color === undefined) continue;
        this.set(x + c, y + r, color);
      }
    }
  }

  /** Copies another canvas with hard alpha (source pixels with any alpha replace the target). */
  blit(src: Canvas, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        const a = src.data[i + 3]!;
        if (a === 0) continue;
        const c = (src.data[i]! << 16) | (src.data[i + 1]! << 8) | src.data[i + 2]!;
        if (a === 255) this.set(dx + x, dy + y, c);
        else this.buf.blend(dx + x, dy + y, [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, a]);
      }
    }
  }

  crop(x: number, y: number, w: number, h: number): Canvas {
    const out = new Canvas(w, h);
    out.buf.copyFrom(this.buf, x, y, w, h, 0, 0);
    return out;
  }
}
