import { PixelBuffer, readPng, writePng } from '../../lib/pixels.js';
const [src, x, y, w, h, s, out] = process.argv.slice(2);
const p = readPng(src!);
const c = new PixelBuffer(Number(w), Number(h));
c.copyFrom(p, Number(x), Number(y), Number(w), Number(h), 0, 0);
writePng(out!, c.scaled(Number(s)));
