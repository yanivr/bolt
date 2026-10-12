import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrack } from '@bolt/content';
import { buildTrack, sampleBranch } from '@bolt/shared';
import type { TerrainManifest } from '@bolt/shared';
import { PixelBuffer, readPng, writePng } from './lib/pixels.js';

/**
 * Game-camera review frames of a baked course: what the race shows at the `Close` camera step
 * on the owner's phone (870 x 390 world pixels), composed from the shipped files exactly as the
 * client stacks them (ground chunks, the car with its shadow, overlays faded near the car the
 * way the client fades them, loops above the cars at their first frame), at evenly spaced
 * points round the lap and on every shortcut.
 *
 *   npx tsx art/scripts/preview-terrain-frames.ts <track> <preset> [count] [--branch-only]
 *
 * Writes `art/preview/terrain/<track>_<preset>/frames/frame_<k>.png` (2x) and a contact sheet.
 * Never shipped.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [trackId, presetId, countArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!trackId || !presetId) throw new Error('usage: preview-terrain-frames.ts <track> <preset>');
const def = getTrack(trackId);
if (!def) throw new Error(`No track ${trackId}`);
const track = buildTrack(def);
const dir = join(root, 'apps', 'web', 'public', 'assets', 'maps', trackId, presetId);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;
const out = join(root, 'art', 'preview', 'terrain', `${trackId}_${presetId}`, 'frames');
mkdirSync(out, { recursive: true });

const VIEW_W = 870;
const VIEW_H = 390;
const CELL = 96;
const COLUMNS = 8;
const world = new PixelBuffer(def.worldWidth, def.worldHeight);
for (const c of manifest.ground) world.blit(readPng(join(dir, c.file)), c.x, c.y);
const overlays = manifest.overlays.map((o) => ({ o, img: readPng(join(dir, o.file)) }));
const above = manifest.animated
  .filter((a) => a.above)
  .map((a) => {
    const sheet = readPng(join(dir, a.file));
    const f = new PixelBuffer(a.frameWidth, a.frameHeight);
    f.copyFrom(sheet, 0, 0, a.frameWidth, a.frameHeight, 0, 0);
    return { a, f };
  });
const car = readPng(
  join(root, 'apps', 'web', 'public', 'assets', 'atlases', 'cars', 'chassis_beetle_body.png'),
);

function frameAt(branchIndex: number, s: number): PixelBuffer {
  const branch = track.branches[branchIndex]!;
  const p = sampleBranch(branch, s);
  const heading = Math.atan2(p.tx, -p.ty);
  const frame = (Math.round((heading / (Math.PI * 2)) * 64) + 64) % 64;
  // The camera leads the car by a share of the view in the direction of travel.
  const cx = p.x + p.tx * VIEW_W * 0.12;
  const cy = p.y + p.ty * VIEW_H * 0.27;
  const x0 = Math.max(0, Math.min(def!.worldWidth - VIEW_W, Math.round(cx - VIEW_W / 2)));
  const y0 = Math.max(0, Math.min(def!.worldHeight - VIEW_H, Math.round(cy - VIEW_H / 2)));
  const view = new PixelBuffer(VIEW_W, VIEW_H);
  view.copyFrom(world, x0, y0, VIEW_W, VIEW_H, 0, 0);
  const cell = new PixelBuffer(CELL, CELL);
  cell.copyFrom(
    car,
    (frame % COLUMNS) * CELL,
    Math.floor(frame / COLUMNS) * CELL,
    CELL,
    CELL,
    0,
    0,
  );
  const px = Math.round(p.x - x0);
  const py = Math.round(p.y - y0);
  for (let yy = 0; yy < CELL; yy++)
    for (let xx = 0; xx < CELL; xx++)
      if (cell.alphaAt(xx, yy) !== 0)
        view.blend(px - CELL / 2 + xx + 2, py - CELL / 2 + yy + 3, [10, 12, 26, 110]);
  view.blit(cell, px - CELL / 2, py - CELL / 2);
  const blitAlpha = (img: PixelBuffer, ox: number, oy: number, k: number): void => {
    for (let yy = 0; yy < img.height; yy++)
      for (let xx = 0; xx < img.width; xx++) {
        const c = img.get(xx, yy);
        if (c[3] === 0) continue;
        view.blend(ox - x0 + xx, oy - y0 + yy, [c[0], c[1], c[2], Math.round(c[3] * k)]);
      }
  };
  for (const { o, img } of overlays) {
    if (o.x > x0 + VIEW_W || o.y > y0 + VIEW_H || o.x + o.w < x0 || o.y + o.h < y0) continue;
    const near =
      o.fadeNearPlayer &&
      p.x > o.x - 26 &&
      p.x < o.x + o.w + 26 &&
      p.y > o.y - 26 &&
      p.y < o.y + o.h + 26;
    blitAlpha(img, o.x, o.y, near ? 0.28 : 1);
  }
  for (const { a, f } of above) blitAlpha(f, a.x, a.y, 1);
  return view;
}

const count = Number(countArg ?? 10);
const shots: PixelBuffer[] = [];
const onlyBranches = process.argv.includes('--branch-only');
if (!onlyBranches)
  for (let k = 0; k < count; k++) {
    const s = (track.startS + (k * track.main.length) / count) % track.main.length;
    shots.push(frameAt(0, s));
  }
for (const b of track.branches.slice(1)) {
  shots.push(frameAt(b.index, b.length * 0.3));
  shots.push(frameAt(b.index, b.length * 0.7));
}
shots.forEach((shot, k) =>
  writePng(join(out, `frame_${String(k).padStart(2, '0')}.png`), shot.scaled(2)),
);
// Contact sheet at 1x, two columns.
const gap = 6;
const cols = 2;
const rows = Math.ceil(shots.length / cols);
const sheet = new PixelBuffer(cols * (VIEW_W + gap) + gap, rows * (VIEW_H + gap) + gap);
sheet.fill([16, 19, 31, 255]);
shots.forEach((shot, k) =>
  sheet.blit(shot, gap + (k % cols) * (VIEW_W + gap), gap + Math.floor(k / cols) * (VIEW_H + gap)),
);
writePng(join(out, 'sheet.png'), sheet);
console.log(`${shots.length} frames in ${out}`);
