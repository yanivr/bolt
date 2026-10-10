import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Minimal, dependency-free pixel toolkit for the art pipeline: an RGBA buffer, integer drawing
 * helpers, and a PNG codec. Everything is deterministic, so a bake on any machine produces
 * byte-identical atlases (Section 12.7).
 */

export type RGBA = readonly [number, number, number, number];

export function hex(color: string, alpha = 255): RGBA {
  const c = color.startsWith('#') ? color.slice(1) : color;
  if (c.length !== 6) throw new Error(`Bad color ${color}`);
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
    alpha,
  ];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

export function withAlpha(c: RGBA, alpha: number): RGBA {
  return [c[0], c[1], c[2], alpha];
}

export const CLEAR: RGBA = [0, 0, 0, 0];

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Opaque write. Out-of-bounds writes are ignored. */
  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return CLEAR;
    const i = (y * this.width + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  alphaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[(y * this.width + x) * 4 + 3]!;
  }

  /** Source-over blend of a possibly translucent color. */
  blend(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = c[3] / 255;
    if (a <= 0) return;
    const i = (y * this.width + x) * 4;
    const da = this.data[i + 3]! / 255;
    const outA = a + da * (1 - a);
    if (outA <= 0) return;
    this.data[i] = Math.round((c[0] * a + this.data[i]! * da * (1 - a)) / outA);
    this.data[i + 1] = Math.round((c[1] * a + this.data[i + 1]! * da * (1 - a)) / outA);
    this.data[i + 2] = Math.round((c[2] * a + this.data[i + 2]! * da * (1 - a)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  fill(c: RGBA): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = c[3];
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Copies `src` onto this buffer with source-over blending. */
  blit(src: PixelBuffer, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3]!;
        if (a === 0) continue;
        if (a === 255)
          this.set(dx + x, dy + y, [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, 255]);
        else this.blend(dx + x, dy + y, [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, a]);
      }
    }
  }

  /** Copies a sub-rectangle of `src` without blending. */
  copyFrom(
    src: PixelBuffer,
    sx: number,
    sy: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
  ): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!src.inBounds(sx + x, sy + y) || !this.inBounds(dx + x, dy + y)) continue;
        const si = ((sy + y) * src.width + sx + x) * 4;
        const di = ((dy + y) * this.width + dx + x) * 4;
        this.data[di] = src.data[si]!;
        this.data[di + 1] = src.data[si + 1]!;
        this.data[di + 2] = src.data[si + 2]!;
        this.data[di + 3] = src.data[si + 3]!;
      }
    }
  }

  /** Nearest-neighbor integer upscale, for review sheets. */
  scaled(factor: number): PixelBuffer {
    const out = new PixelBuffer(this.width * factor, this.height * factor);
    for (let y = 0; y < out.height; y++) {
      const sy = Math.floor(y / factor);
      for (let x = 0; x < out.width; x++) {
        const si = (sy * this.width + Math.floor(x / factor)) * 4;
        const di = (y * out.width + x) * 4;
        out.data[di] = this.data[si]!;
        out.data[di + 1] = this.data[si + 1]!;
        out.data[di + 2] = this.data[si + 2]!;
        out.data[di + 3] = this.data[si + 3]!;
      }
    }
    return out;
  }

  /** Tight bounds of non-transparent pixels, or null when the buffer is empty. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[(y * this.width + x) * 4 + 3]! === 0) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }
}

// --- PNG ---------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(body.buffer, body.byteOffset, body.byteLength).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encodes a buffer as PNG. Images with 256 or fewer distinct colors are written as indexed
 * PNG with a tRNS chunk, which is what keeps large terrain sheets small; anything richer falls
 * back to 8-bit RGBA.
 */
export function encodePng(buf: PixelBuffer): Buffer {
  const { width, height, data } = buf;
  const palette = new Map<number, number>();
  const order: number[] = [];
  let indexed = true;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    // Fully transparent pixels collapse to one entry so stray RGB never bloats the palette.
    const key =
      a === 0 ? 0 : ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | a) >>> 0;
    if (!palette.has(key)) {
      if (palette.size >= 256) {
        indexed = false;
        break;
      }
      palette.set(key, palette.size);
      order.push(key);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  if (indexed) {
    ihdr[9] = 3;
    const raw = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) {
      const row = y * (width + 1);
      raw[row] = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = data[i + 3]!;
        const key =
          a === 0 ? 0 : ((data[i]! << 24) | (data[i + 1]! << 16) | (data[i + 2]! << 8) | a) >>> 0;
        raw[row + 1 + x] = palette.get(key)!;
      }
    }
    const plte = new Uint8Array(order.length * 3);
    const trns = new Uint8Array(order.length);
    order.forEach((key, idx) => {
      plte[idx * 3] = (key >>> 24) & 0xff;
      plte[idx * 3 + 1] = (key >>> 16) & 0xff;
      plte[idx * 3 + 2] = (key >>> 8) & 0xff;
      trns[idx] = key & 0xff;
    });
    return Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('PLTE', plte),
      chunk('tRNS', trns),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', new Uint8Array(0)),
    ]);
  }

  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    // Sub filter: pixel art compresses far better as left-neighbor deltas.
    raw[row] = 1;
    for (let x = 0; x < stride; x++) {
      const cur = data[y * stride + x]!;
      const left = x >= 4 ? data[y * stride + x - 4]! : 0;
      raw[row + 1 + x] = (cur - left) & 0xff;
    }
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export function writePng(path: string, buf: PixelBuffer): number {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodePng(buf);
  writeFileSync(path, bytes);
  return bytes.length;
}

/** Decoder for the two formats this module writes. Used by tests and the atlas validator. */
export function decodePng(bytes: Buffer): PixelBuffer {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9]!;
      if (body[8] !== 8 || body[12] !== 0) throw new Error('Unsupported PNG variant');
    } else if (type === 'PLTE') plte = Buffer.from(body);
    else if (type === 'tRNS') trns = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    offset += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new PixelBuffer(width, height);
  const bpp = colorType === 3 ? 1 : 4;
  const stride = width * bpp;
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let value: number;
      if (filter === 0) value = v;
      else if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = cur[x]!;
        out.data[di] = plte![idx * 3]!;
        out.data[di + 1] = plte![idx * 3 + 1]!;
        out.data[di + 2] = plte![idx * 3 + 2]!;
        out.data[di + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      } else {
        out.data[di] = cur[x * 4]!;
        out.data[di + 1] = cur[x * 4 + 1]!;
        out.data[di + 2] = cur[x * 4 + 2]!;
        out.data[di + 3] = cur[x * 4 + 3]!;
      }
    }
    prev.set(cur);
  }
  return out;
}

export function readPng(path: string): PixelBuffer {
  return decodePng(readFileSync(path));
}
