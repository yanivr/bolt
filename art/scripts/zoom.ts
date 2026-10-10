import { PixelBuffer, readPng, writePng } from './lib/pixels.js';

/** Review helper: crop a region of a PNG and upscale it. `tsx zoom.ts in out x y w h scale` */
const [input, output, x, y, w, h, scale] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: zoom.ts <in> <out> <x> <y> <w> <h> <scale>');
const src = readPng(input);
const crop = new PixelBuffer(Number(w), Number(h));
crop.copyFrom(src, Number(x), Number(y), Number(w), Number(h), 0, 0);
writePng(output, crop.scaled(Number(scale ?? 1)));
