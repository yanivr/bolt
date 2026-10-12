import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PixelBuffer, decodePng, hex, writePng } from '../../art/scripts/lib/pixels.js';

/**
 * Small picture tools for reviewing screenshots: crop a region at a whole-number zoom (so a
 * 1:1 crop shows the device pixels themselves), and lay pictures side by side. They use the
 * repository's own PNG writer (`art/scripts/lib/pixels.ts`); the reader here takes what a
 * browser screenshot is, 8-bit RGB or RGBA with any row filter, which the art reader does not.
 *
 *   npx tsx tests/visual/sheet.ts crop <in.png> <out.png> <x> <y> <w> <h> [zoom]
 *   npx tsx tests/visual/sheet.ts row <out.png> <a.png> <b.png> [more.png ...]
 *   npx tsx tests/visual/sheet.ts column <out.png> <a.png> <b.png> [more.png ...]
 */

/** Decodes a browser screenshot: 8-bit RGB or RGBA, any filter. */
export function decodeScreenshot(bytes: Buffer): PixelBuffer {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      // Anything else is a picture this repository wrote itself: its own reader takes those.
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6)) return decodePng(bytes);
      channels = body[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    offset += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new PixelBuffer(width, height);
  const stride = width * channels;
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let value = v;
      if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else if (filter === 4) {
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
      out.data[di] = cur[x * channels]!;
      out.data[di + 1] = cur[x * channels + 1]!;
      out.data[di + 2] = cur[x * channels + 2]!;
      out.data[di + 3] = 255;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return out;
}

export function readScreenshot(path: string): PixelBuffer {
  return decodeScreenshot(readFileSync(path));
}

/** A region of a picture, each of its pixels drawn `zoom` pixels square. */
export function crop(
  src: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom = 1,
): PixelBuffer {
  const out = new PixelBuffer(w * zoom, h * zoom);
  for (let j = 0; j < h * zoom; j++)
    for (let i = 0; i < w * zoom; i++)
      out.set(i, j, src.get(x + Math.floor(i / zoom), y + Math.floor(j / zoom)));
  return out;
}

/** Pictures next to each other (or under each other), a gutter between them. */
export function join(
  pictures: PixelBuffer[],
  direction: 'row' | 'column',
  gutter = 12,
  background = '#0e1320',
): PixelBuffer {
  const row = direction === 'row';
  const long = pictures.reduce((sum, p) => sum + (row ? p.width : p.height), 0);
  const cross = Math.max(...pictures.map((p) => (row ? p.height : p.width)));
  const total = long + gutter * (pictures.length - 1);
  const out = new PixelBuffer(row ? total : cross, row ? cross : total);
  const fill = hex(background);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) out.set(x, y, fill);
  let at = 0;
  for (const p of pictures) {
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) out.set(row ? at + x : x, row ? y : at + y, p.get(x, y));
    at += (row ? p.width : p.height) + gutter;
  }
  return out;
}

if (process.argv[1]?.endsWith('sheet.ts')) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'crop') {
    const [input, output, x, y, w, h, zoom] = rest;
    writePng(
      output!,
      crop(readScreenshot(input!), Number(x), Number(y), Number(w), Number(h), Number(zoom ?? 1)),
    );
  } else if (command === 'row' || command === 'column') {
    const [output, ...inputs] = rest;
    writePng(output!, join(inputs.map(readScreenshot), command));
  } else {
    console.error('usage: sheet.ts crop|row|column ...');
    process.exitCode = 1;
  }
}
