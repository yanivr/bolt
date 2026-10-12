import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrack } from '@bolt/content';
import { buildTrack, sampleBranch } from '@bolt/shared';
import type { TerrainManifest } from '@bolt/shared';
import { PixelBuffer, readPng, writePng } from '../../lib/pixels.js';

/**
 * Game-camera review frames for a baked course (never shipped). Reads exactly what ships (the
 * manifest, chunks, overlays and loops), walks the route, and composes 870 x 390 frames the
 * size of the Close camera on a phone: ground, ground loops, a car on the road at the route's
 * heading, then the overlays, faded the way the client fades them when the car is under one.
 *
 *   npx tsx art/scripts/terrain/forest/review.ts forest_01 forest_clear [frames]
 *
 * Writes `art/preview/terrain/<track>_<preset>/route_NN.png` and a contact sheet.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const VW = 870;
const VH = 390;

function blitAlpha(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number, alpha = 1): void {
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = (src.data[i + 3]! / 255) * alpha;
      if (a <= 0) continue;
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const o = (ty * dst.width + tx) * 4;
      for (let k = 0; k < 3; k++) dst.data[o + k] = Math.round(dst.data[o + k]! * (1 - a) + src.data[i + k]! * a);
      dst.data[o + 3] = 255;
    }
}

export function reviewCourse(trackId: string, presetId: string, frames = 12): string[] {
  const def = getTrack(trackId);
  if (!def) throw new Error(`No track ${trackId}`);
  const dir = join(root, 'apps', 'web', 'public', 'assets', 'maps', trackId, presetId);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;
  const track = buildTrack(def);
  const world = new PixelBuffer(manifest.worldWidth, manifest.worldHeight);
  for (const c of manifest.ground) world.blit(readPng(join(dir, c.file)), c.x, c.y);
  for (const a of manifest.animated) {
    if (a.above) continue;
    const strip = readPng(join(dir, a.file));
    const f0 = new PixelBuffer(a.frameWidth, a.frameHeight);
    f0.copyFrom(strip, 0, 0, a.frameWidth, a.frameHeight, 0, 0);
    world.blit(f0, a.x, a.y);
  }
  const overlays = manifest.overlays.map((o) => ({ o, img: readPng(join(dir, o.file)) }));
  const above = manifest.animated
    .filter((a) => a.above)
    .map((a) => {
      const strip = readPng(join(dir, a.file));
      const f0 = new PixelBuffer(a.frameWidth, a.frameHeight);
      f0.copyFrom(strip, 0, 0, a.frameWidth, a.frameHeight, 0, 0);
      return { a, f0 };
    });
  const carPath = join(root, 'apps', 'web', 'public', 'assets', 'atlases', 'cars', 'chassis_beetle_body.png');
  const sheet = existsSync(carPath) ? readPng(carPath) : null;
  const out = join(root, 'art', 'preview', 'terrain', `${trackId}_${presetId}`);
  mkdirSync(out, { recursive: true });
  const written: string[] = [];
  const shots: PixelBuffer[] = [];
  const routes = track.branches.map((b) => ({ b, n: b.index === 0 ? frames : 2 }));
  let k = 0;
  for (const { b, n } of routes) {
    for (let j = 0; j < n; j++) {
      const s = b.index === 0 ? (track.startS + (j / n) * b.length) % b.length : ((j + 0.5) / n) * b.length;
      const p = sampleBranch(b, s);
      // The camera looks ahead of the car, as the client's does.
      const ahead = sampleBranch(b, (s + 150) % b.length);
      const cx = Math.round((p.x * 2 + ahead.x) / 3);
      const cy = Math.round((p.y * 2 + ahead.y) / 3);
      const x0 = Math.max(0, Math.min(manifest.worldWidth - VW, cx - VW / 2));
      const y0 = Math.max(0, Math.min(manifest.worldHeight - VH, cy - VH / 2));
      const view = new PixelBuffer(VW, VH);
      view.copyFrom(world, x0, y0, VW, VH, 0, 0);
      const carX = Math.round(p.x - x0 - p.ty * 18);
      const carY = Math.round(p.y - y0 + p.tx * 18);
      if (sheet) {
        const heading = Math.round(((Math.atan2(p.tx, -p.ty) / (Math.PI * 2) + 1) % 1) * 64) % 64;
        const cell = new PixelBuffer(96, 96);
        cell.copyFrom(sheet, (heading % 8) * 96, Math.floor(heading / 8) * 96, 96, 96, 0, 0);
        const shadow = new PixelBuffer(96, 96);
        for (let yy = 0; yy < 96; yy++)
          for (let xx = 0; xx < 96; xx++) if (cell.alphaAt(xx, yy)) shadow.set(xx, yy, [10, 12, 26, 110]);
        blitAlpha(view, shadow, carX - 48 + 2, carY - 48 + 3);
        blitAlpha(view, cell, carX - 48, carY - 48);
      }
      const wx = carX + x0;
      const wy = carY + y0;
      for (const { o, img } of overlays) {
        const near = o.fadeNearPlayer && wx > o.x - 26 && wx < o.x + o.w + 26 && wy > o.y - 26 && wy < o.y + o.h + 26;
        blitAlpha(view, img, o.x - x0, o.y - y0, near ? 0.28 : 1);
      }
      for (const { a, f0 } of above) blitAlpha(view, f0, a.x - x0, a.y - y0);
      const name = `route_${String(k).padStart(2, '0')}${b.index > 0 ? `_${b.id}` : ''}.png`;
      writePng(join(out, name), view);
      written.push(name);
      shots.push(view);
      k++;
    }
  }
  // Contact sheet at half size, two columns.
  const cols = 2;
  const sw = VW / 2;
  const sh = VH / 2;
  const rows = Math.ceil(shots.length / cols);
  const contact = new PixelBuffer(cols * sw + 6 * (cols + 1), rows * sh + 6 * (rows + 1));
  contact.fill([20, 22, 30, 255]);
  shots.forEach((v, i) => {
    const small = new PixelBuffer(sw, sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const o = (y * 2 * VW + x * 2) * 4;
        small.set(x, y, [v.data[o]!, v.data[o + 1]!, v.data[o + 2]!, 255]);
      }
    contact.blit(small, 6 + (i % cols) * (sw + 6), 6 + Math.floor(i / cols) * (sh + 6));
  });
  writePng(join(out, 'route_contact.png'), contact);
  written.push('route_contact.png');
  return written;
}

if (process.argv[1]?.endsWith('review.ts')) {
  const [trackId, presetId, n] = process.argv.slice(2);
  if (!trackId || !presetId) throw new Error('usage: review.ts <track> <preset> [frames]');
  const files = reviewCourse(trackId, presetId, n ? Number(n) : 12);
  console.log(`${files.length} review frames in art/preview/terrain/${trackId}_${presetId}`);
}
