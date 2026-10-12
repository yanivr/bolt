import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrack } from '@bolt/content';
import { buildTrack, sampleBranch } from '@bolt/shared';
import type { TerrainManifest } from '@bolt/shared';
import { PixelBuffer, readPng, writePng } from '../../lib/pixels.js';

/**
 * Review frames of a baked course, composed from the shipped files exactly as the client
 * layers them: ground chunks, ground loops (frame 0), the car with its shadow, loops above the
 * cars, then overlays, faded to 28 percent where the car is near one (RaceScene's rule). Never
 * shipped; the frames go to `art/preview/terrain/<track>_<preset>/`.
 *
 *   npx tsx art/scripts/terrain/desert/frames.ts <track> <preset> route [count]
 *       Close-camera frames (870 x 390 world px, shown at 2x) along the main line and the
 *       shortcut, each with a car on the road.
 *   npx tsx art/scripts/terrain/desert/frames.ts <track> <preset> crop <x> <y> <w> <h> [scale] [name]
 *   npx tsx art/scripts/terrain/desert/frames.ts <track> <preset> overview [factor]
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const VIEW_W = 870;
const VIEW_H = 390;
const CELL = 96;
const COLUMNS = 8;

type Course = {
  manifest: TerrainManifest;
  world: PixelBuffer;
  below: Array<{ buf: PixelBuffer; x: number; y: number }>;
  above: Array<{ buf: PixelBuffer; x: number; y: number }>;
  overlays: Array<{ buf: PixelBuffer; x: number; y: number; w: number; h: number; fade: boolean }>;
};

function frame0(strip: PixelBuffer, w: number, h: number): PixelBuffer {
  const out = new PixelBuffer(w, h);
  out.copyFrom(strip, 0, 0, w, h, 0, 0);
  return out;
}

export function loadCourse(dir: string): Course {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;
  const world = new PixelBuffer(manifest.worldWidth, manifest.worldHeight);
  for (const c of manifest.ground) world.copyFrom(readPng(join(dir, c.file)), 0, 0, c.w, c.h, c.x, c.y);
  const below: Course['below'] = [];
  const above: Course['above'] = [];
  for (const a of manifest.animated) {
    const buf = frame0(readPng(join(dir, a.file)), a.frameWidth, a.frameHeight);
    (a.above ? above : below).push({ buf, x: a.x, y: a.y });
  }
  const overlays = manifest.overlays.map((o) => ({
    buf: readPng(join(dir, o.file)),
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    fade: o.fadeNearPlayer,
  }));
  return { manifest, world, below, above, overlays };
}

function blitAlpha(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number, alpha: number): void {
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = Math.round(src.data[i + 3]! * alpha);
      if (a === 0) continue;
      dst.blend(dx + x, dy + y, [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!, a]);
    }
}

/** One frame of the given world rectangle with an optional car, composed like the client. */
export function compose(
  course: Course,
  x0: number,
  y0: number,
  w: number,
  h: number,
  car: { x: number; y: number; heading: number } | null,
  sheet: PixelBuffer | null,
): PixelBuffer {
  const view = new PixelBuffer(w, h);
  view.copyFrom(course.world, x0, y0, w, h, 0, 0);
  for (const b of course.below) view.blit(b.buf, b.x - x0, b.y - y0);
  if (car && sheet) {
    const frame = ((Math.round((car.heading / (Math.PI * 2)) * 64) % 64) + 64) % 64;
    const cell = new PixelBuffer(CELL, CELL);
    cell.copyFrom(sheet, (frame % COLUMNS) * CELL, Math.floor(frame / COLUMNS) * CELL, CELL, CELL, 0, 0);
    const cx = Math.round(car.x - x0 - CELL / 2);
    const cy = Math.round(car.y - y0 - CELL / 2);
    for (let yy = 0; yy < CELL; yy++)
      for (let xx = 0; xx < CELL; xx++)
        if (cell.alphaAt(xx, yy) !== 0) view.blend(cx + xx + 2, cy + yy + 3, [10, 12, 26, 110]);
    view.blit(cell, cx, cy);
  }
  for (const a of course.above) view.blit(a.buf, a.x - x0, a.y - y0);
  for (const o of course.overlays) {
    let alpha = 1;
    if (car && o.fade) {
      const near =
        car.x > o.x - 26 && car.x < o.x + o.w + 26 && car.y > o.y - 26 && car.y < o.y + o.h + 26;
      if (near) alpha = 0.28;
    }
    blitAlpha(view, o.buf, o.x - x0, o.y - y0, alpha);
  }
  return view;
}

function downscale(src: PixelBuffer, f: number): PixelBuffer {
  const w = Math.floor(src.width / f);
  const h = Math.floor(src.height / f);
  const out = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = 0; yy < f; yy++)
        for (let xx = 0; xx < f; xx++) {
          const i = ((y * f + yy) * src.width + x * f + xx) * 4;
          r += src.data[i]!;
          g += src.data[i + 1]!;
          b += src.data[i + 2]!;
        }
      const n = f * f;
      out.set(x, y, [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255]);
    }
  return out;
}

function main(): void {
  const [trackId, presetId, mode = 'route', ...rest] = process.argv.slice(2);
  if (!trackId || !presetId) throw new Error('usage: frames.ts <track> <preset> <mode> ...');
  const dir = join(root, 'apps', 'web', 'public', 'assets', 'maps', trackId, presetId);
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`No bake in ${dir}`);
  const course = loadCourse(dir);
  const out = join(root, 'art', 'preview', 'terrain', `${trackId}_${presetId}`);
  mkdirSync(out, { recursive: true });
  const sheetPath = join(root, 'apps', 'web', 'public', 'assets', 'atlases', 'cars', 'chassis_beetle_body.png');
  const sheet = existsSync(sheetPath) ? readPng(sheetPath) : null;
  const W = course.manifest.worldWidth;
  const H = course.manifest.worldHeight;
  if (mode === 'overview') {
    const f = Number(rest[0] ?? 4);
    const full = compose(course, 0, 0, W, H, null, null);
    writePng(join(out, `overview_${f}x.png`), downscale(full, f));
    return;
  }
  if (mode === 'crop') {
    const [x, y, w, h, scale = '2', name = 'crop'] = rest;
    const v = compose(course, Number(x), Number(y), Number(w), Number(h), null, null);
    writePng(join(out, `${name}.png`), v.scaled(Number(scale)));
    return;
  }
  const def = getTrack(trackId);
  if (!def) throw new Error(`No track ${trackId}`);
  const track = buildTrack(def);
  const count = Number(rest[0] ?? 12);
  const shots: Array<{ branch: number; s: number; name: string }> = [];
  for (let k = 0; k < count; k++)
    shots.push({ branch: 0, s: track.startS + (track.main.length * k) / count, name: `route_${String(k).padStart(2, '0')}` });
  track.branches.slice(1).forEach((b) => {
    for (const f of [0.3, 0.7]) shots.push({ branch: b.index, s: b.length * f, name: `${b.id}_${Math.round(f * 100)}` });
  });
  for (const shot of shots) {
    const b = track.branches[shot.branch]!;
    const p = sampleBranch(b, shot.s);
    // The camera leads the car: the car sits a little behind the middle of the view.
    const lead = { x: p.tx * VIEW_W * 0.12, y: p.ty * VIEW_H * 0.27 };
    const cx = Math.max(0, Math.min(W - VIEW_W, Math.round(p.x + lead.x - VIEW_W / 2)));
    const cy = Math.max(0, Math.min(H - VIEW_H, Math.round(p.y + lead.y - VIEW_H / 2)));
    const heading = Math.atan2(p.tx, -p.ty);
    const lat = -p.halfWidth * 0.35;
    const car = { x: p.x - p.ty * lat, y: p.y + p.tx * lat, heading };
    const v = compose(course, cx, cy, VIEW_W, VIEW_H, car, sheet);
    writePng(join(out, `${shot.name}.png`), v.scaled(2));
  }
  console.log(`${shots.length} frames in ${out}`);
}

if (process.argv[1]?.endsWith('frames.ts')) main();
