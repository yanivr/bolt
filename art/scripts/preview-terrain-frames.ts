import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrack } from '@bolt/content';
import { buildTrack, sampleBranch } from '@bolt/shared';
import type { TerrainManifest, TerrainOverlay } from '@bolt/shared';
import { coverageFromRgba, overlayTarget } from '../../apps/web/src/game/weather/overlayFade.js';
import { PixelBuffer, readPng, writePng } from './lib/pixels.js';

/**
 * Game-camera review frames of a baked course, composed from the shipped files exactly as the
 * client stacks them: ground chunks, ground loops at their first frame, the car with its
 * shadow, loops above the cars, then overlays faded by the client's own rule
 * (`apps/web/src/game/weather/overlayFade.ts`: the car's body box against the overlay's own
 * pixels). Frames are taken at evenly spaced points round the lap and on every shortcut.
 *
 *   npx tsx art/scripts/preview-terrain-frames.ts <track> <preset> [count]
 *       [--dir=<bake folder>]   frames of another bake (a `--out` bake, to compare)
 *       [--out=<folder>]        where to write (default art/preview/terrain/<track>_<preset>/frames)
 *       [--view=870x370]        the view in world pixels (`Close` on the owner's phone)
 *       [--branch-only]         only the shortcuts
 *
 * Writes `frame_<k>.png` (2x), `far.png` (the `Far` step: 1.5 times the view, the next whole
 * scale out on a phone at three device pixels, DECISIONS 200), `sheet.png` (every frame at 1x)
 * and `contact.png` (six lap frames, a shortcut frame, the `Far` frame and the minimap: the
 * evidence sheet of `docs/evidence/tracks`). Prints how many overlays the car faded. Never shipped.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const flag = (name: string): string | undefined =>
  process.argv
    .slice(2)
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const [trackId, presetId, countArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!trackId || !presetId) throw new Error('usage: preview-terrain-frames.ts <track> <preset>');
const def = getTrack(trackId);
if (!def) throw new Error(`No track ${trackId}`);
const track = buildTrack(def);
const dir = flag('dir')
  ? resolve(flag('dir')!)
  : join(root, 'apps', 'web', 'public', 'assets', 'maps', trackId, presetId);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;
const out = flag('out')
  ? resolve(flag('out')!)
  : join(root, 'art', 'preview', 'terrain', `${trackId}_${presetId}`, 'frames');
mkdirSync(out, { recursive: true });

const [VIEW_W, VIEW_H] = (flag('view') ?? '870x370').split('x').map(Number) as [number, number];
const CELL = 96;
const COLUMNS = 8;
const world = new PixelBuffer(def.worldWidth, def.worldHeight);
for (const c of manifest.ground) world.blit(readPng(join(dir, c.file)), c.x, c.y);
const overlays = manifest.overlays.map((o) => {
  const img = readPng(join(dir, o.file));
  return { o, img, coverage: coverageFromRgba(img.data, img.width, img.height) };
});
const firstFrame = (a: TerrainManifest['animated'][number]): PixelBuffer => {
  const sheet = readPng(join(dir, a.file));
  const f = new PixelBuffer(a.frameWidth, a.frameHeight);
  f.copyFrom(sheet, 0, 0, a.frameWidth, a.frameHeight, 0, 0);
  return f;
};
const below = manifest.animated.filter((a) => !a.above).map((a) => ({ a, f: firstFrame(a) }));
const above = manifest.animated.filter((a) => a.above).map((a) => ({ a, f: firstFrame(a) }));
const car = readPng(
  join(root, 'apps', 'web', 'public', 'assets', 'atlases', 'cars', 'chassis_beetle_body.png'),
);
const minimap = readPng(join(dir, manifest.minimap.file));
const NO_RIVAL = { present: false, x: 0, y: 0 };
let faded = 0;

function blitAlpha(
  view: PixelBuffer,
  img: PixelBuffer,
  ox: number,
  oy: number,
  k: number,
  x0: number,
  y0: number,
): void {
  for (let yy = 0; yy < img.height; yy++)
    for (let xx = 0; xx < img.width; xx++) {
      const c = img.get(xx, yy);
      if (c[3] === 0) continue;
      view.blend(ox - x0 + xx, oy - y0 + yy, [c[0], c[1], c[2], Math.round(c[3] * k)]);
    }
}

function frameAt(branchIndex: number, s: number, w: number, h: number): PixelBuffer {
  const branch = track.branches[branchIndex]!;
  const p = sampleBranch(branch, s);
  const heading = Math.atan2(p.tx, -p.ty);
  const frame = (Math.round((heading / (Math.PI * 2)) * 64) + 64) % 64;
  // The camera leads the car by a share of the view in the direction of travel.
  const cx = p.x + p.tx * w * 0.12;
  const cy = p.y + p.ty * h * 0.27;
  const x0 = Math.max(0, Math.min(def!.worldWidth - w, Math.round(cx - w / 2)));
  const y0 = Math.max(0, Math.min(def!.worldHeight - h, Math.round(cy - h / 2)));
  const view = new PixelBuffer(w, h);
  view.copyFrom(world, x0, y0, w, h, 0, 0);
  for (const { a, f } of below) blitAlpha(view, f, a.x, a.y, 1, x0, y0);
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
  for (const { a, f } of above) blitAlpha(view, f, a.x, a.y, 1, x0, y0);
  const own = { present: true, x: p.x, y: p.y };
  for (const { o, img, coverage } of overlays) {
    if (o.x > x0 + w || o.y > y0 + h || o.x + o.w < x0 || o.y + o.h < y0) continue;
    const k = overlayTarget(o as TerrainOverlay, own, NO_RIVAL, () => coverage);
    if (k < 1) faded++;
    blitAlpha(view, img, o.x, o.y, k, x0, y0);
  }
  return view;
}

const count = Number(countArg ?? 10);
const shots: PixelBuffer[] = [];
const onlyBranches = process.argv.includes('--branch-only');
if (!onlyBranches)
  for (let k = 0; k < count; k++) {
    const s = (track.startS + (k * track.main.length) / count) % track.main.length;
    shots.push(frameAt(0, s, VIEW_W, VIEW_H));
  }
const lapShots = shots.length;
for (const b of track.branches.slice(1)) {
  shots.push(frameAt(b.index, b.length * 0.3, VIEW_W, VIEW_H));
  shots.push(frameAt(b.index, b.length * 0.7, VIEW_W, VIEW_H));
}
shots.forEach((shot, k) =>
  writePng(join(out, `frame_${String(k).padStart(2, '0')}.png`), shot.scaled(2)),
);
const farW = Math.round(VIEW_W * 1.5);
const farH = Math.round(VIEW_H * 1.5);
const far = frameAt(0, (track.startS + track.main.length * 0.55) % track.main.length, farW, farH);
writePng(join(out, 'far.png'), far);

// Contact sheet at 1x, two columns.
const gap = 6;
const ink: [number, number, number, number] = [16, 19, 31, 255];
const cols = 2;
const rows = Math.ceil(shots.length / cols);
const sheet = new PixelBuffer(cols * (VIEW_W + gap) + gap, rows * (VIEW_H + gap) + gap);
sheet.fill(ink);
shots.forEach((shot, k) =>
  sheet.blit(shot, gap + (k % cols) * (VIEW_W + gap), gap + Math.floor(k / cols) * (VIEW_H + gap)),
);
writePng(join(out, 'sheet.png'), sheet);

// The evidence sheet: six lap frames and one shortcut frame at 1x in two columns, then the
// `Far` frame shrunk to a column's width beside the minimap at 3x.
const pick: PixelBuffer[] = [];
for (let k = 0; k < 6 && lapShots > 0; k++) pick.push(shots[Math.floor((k * lapShots) / 6)]!);
if (shots.length > lapShots) pick.push(shots[lapShots]!);
const mini = minimap.scaled(
  Math.max(1, Math.floor(Math.min(VIEW_W / minimap.width, farH / 1.5 / minimap.height))),
);
const farSmall = new PixelBuffer(VIEW_W, Math.round((farH * VIEW_W) / farW));
for (let y = 0; y < farSmall.height; y++)
  for (let x = 0; x < farSmall.width; x++)
    farSmall.set(
      x,
      y,
      far.get(Math.floor((x * farW) / VIEW_W), Math.floor((y * farH) / farSmall.height)),
    );
const pickRows = Math.ceil(pick.length / 2);
const lastH = Math.max(farSmall.height, mini.height);
const contact = new PixelBuffer(
  2 * (VIEW_W + gap) + gap,
  pickRows * (VIEW_H + gap) + lastH + 2 * gap,
);
contact.fill(ink);
pick.forEach((shot, k) =>
  contact.blit(shot, gap + (k % 2) * (VIEW_W + gap), gap + Math.floor(k / 2) * (VIEW_H + gap)),
);
const lastY = gap + pickRows * (VIEW_H + gap);
contact.blit(farSmall, gap, lastY);
contact.blit(
  mini,
  gap + VIEW_W + gap + Math.floor((VIEW_W - mini.width) / 2),
  lastY + Math.floor((lastH - mini.height) / 2),
);
writePng(join(out, 'contact.png'), contact);
console.log(
  `${shots.length} frames and far.png in ${out}; overlays faded by the car in them: ${faded}`,
);
