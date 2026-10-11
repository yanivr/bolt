import { resolve } from 'node:path';
import { PixelBuffer, hex, writePng } from '../lib/pixels.js';
import { buildCombatVfx } from './index.js';

/**
 * Review helper: lays the named strips out on the road color at a chosen scale.
 *
 *   npx tsx art/scripts/vfx/montage.ts out.png 3 fireball_a mortar_core ...
 */
const [out, scale, ...ids] = process.argv.slice(2);
if (!out || ids.length === 0) throw new Error('usage: montage.ts <out.png> <scale> <id...>');
const strips = buildCombatVfx().filter((s) => ids.includes(s.id));
const width = 420;
let height = 4;
const rows = strips.map((s) => {
  const perRow = Math.max(1, Math.floor((width - 8) / (s.frameWidth + 2)));
  const n = Math.ceil(s.frames.length / perRow);
  const y = height;
  height += n * (s.frameHeight + 2) + 4;
  return { s, perRow, y };
});
const sheet = new PixelBuffer(width, height);
sheet.fill(hex('#3a4058'));
for (const { s, perRow, y } of rows)
  s.frames.forEach((frame, i) =>
    sheet.blit(
      frame,
      4 + (i % perRow) * (s.frameWidth + 2),
      y + Math.floor(i / perRow) * (s.frameHeight + 2),
    ),
  );
writePng(resolve(out), sheet.scaled(Number(scale) || 3));
