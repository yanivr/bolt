import { PixelBuffer, writePng } from '../../lib/pixels.js';
import { Canvas } from '../canvas.js';
import { buildTree } from './trees.js';
import type { Species } from './trees.js';
const SCR = '/tmp/claude-0/-home-claude/9a9c2fd5-f17b-5127-9c0e-ccddc4d2f788/scratchpad';
const rows: Array<[Species, number, number]> = [['oak', 15, 0], ['birch', 15, 0], ['redwood', 16, 0], ['redwood', 34, 0], ['pine', 15, 0], ['fir', 15, 0.8]];
const W = 1400, H = 1700;
const cv = new Canvas(W, H);
cv.rect(0, 0, W, H, 0x325834);
let y = 40;
const t0 = performance.now();
for (const [sp, r, snow] of rows) {
  let x = 60;
  let maxh = 0;
  for (let k = 0; k < (r > 30 ? 2 : 5); k++) {
    const m = buildTree({ species: sp, seed: 100 + k * 7 + r, radius: r, snow });
    const s = m.sprite;
    maxh = Math.max(maxh, s.canvas.h);
    cv.blit(s.canvas, x, y);
    // collision disc
    cv.ring(x + s.ax, y + s.ay, r, 0xff3030);
    x += s.canvas.w + 20;
  }
  y += maxh + 20;
}
console.log('ms', performance.now() - t0);
writePng(`${SCR}/trees.png`, cv.buf);
const zx = Number(process.argv[2] ?? 0), zy = Number(process.argv[3] ?? 0);
const big = new PixelBuffer(460, 260); big.copyFrom(cv.buf, zx, zy, 460, 260, 0, 0);
writePng(`${SCR}/trees_zoom.png`, big.scaled(3));
