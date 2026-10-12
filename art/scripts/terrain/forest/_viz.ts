import { getTrack } from '@bolt/content';
import { buildTrack } from '@bolt/shared';
import { Canvas } from '../canvas.js';
import { drawText } from '../font.js';
import { buildCorridorField } from '../field.js';
import { writePng } from '../../lib/pixels.js';
import { computeReach } from './reach.js';
const id = process.argv[2]!;
const def = getTrack(id)!;
const t = buildTrack(def);
let t0 = performance.now();
const field = buildCorridorField(t);
console.log('field ms', (performance.now() - t0).toFixed(0));
t0 = performance.now();
const r = computeReach(t);
console.log('reach ms', (performance.now() - t0).toFixed(0));
const s = 2;
const cv = new Canvas(Math.floor(r.w / s), Math.floor(r.h / s));
for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
  const p = y * s * r.w + x * s;
  let c = r.solid[p] ? 0xc83c3c : r.drive[p] ? 0x9a9682 : 0x1e3c1e;
  if (field.edge[p]! <= 0) c = field.zone[p] === 1 ? 0x505a70 : 0x7a6a50;
  const zc = t.zoneSurface ? t.zoneSurface[Math.floor(y*s/t.zoneCell)*t.zoneCols+Math.floor(x*s/t.zoneCell)] : 0;
  if (zc && field.edge[p]! <= 0) c = 0x6a4a6a;
  cv.set(x, y, c);
}
for (const a of def.anchors) for (const p of a.points) { cv.rect(Math.round(p.x/s)-3, Math.round(p.y/s)-3, 7, 7, 0xffe040); drawText(cv, Math.round(p.x/s)+5, Math.round(p.y/s)-3, a.id.toUpperCase(), 0xffffff, 'micro', 1, 0); }
writePng(`/tmp/claude-0/-home-claude/9a9c2fd5-f17b-5127-9c0e-ccddc4d2f788/scratchpad/plan_${id}.png`, cv.buf);
