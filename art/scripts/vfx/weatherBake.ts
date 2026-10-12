import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PixelBuffer, encodePng, hex } from '../lib/pixels.js';
import { buildWeatherVfx, packWeatherAtlas } from './weather.js';

/**
 * Bakes the weather and environment atlas (`vfx_weather`).
 *
 *   npx tsx art/scripts/vfx/weatherBake.ts            bake and write
 *   npx tsx art/scripts/vfx/weatherBake.ts --check    bake to memory and fail if files differ
 *
 * `pnpm art` and `pnpm art:check` run it after the combat atlas (`bake-vfx.ts`). Output:
 * `apps/web/public/assets/atlases/vfx_weather` (one indexed PNG and its manifest), a copy of
 * the manifest in `art/manifests`, and review sheets `art/preview/vfx/weather_<n>.png` with
 * every strip on three grounds (wet asphalt, sand, snow) at three times its size.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT_DIR = join(ROOT, 'apps/web/public/assets/atlases/vfx_weather');
const MANIFEST_DIR = join(ROOT, 'art/manifests');
const PREVIEW_DIR = join(ROOT, 'art/preview/vfx');

export function bakeWeatherVfx(check = false): void {
  const started = performance.now();
  const strips = buildWeatherVfx();
  const { image, manifest } = packWeatherAtlas(strips);
  const png = encodePng(image);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const digest = createHash('sha256').update(png).update(text).digest('hex').slice(0, 16);
  if (check) {
    const pngPath = join(OUT_DIR, 'atlas.png');
    const jsonPath = join(OUT_DIR, 'manifest.json');
    const same =
      existsSync(pngPath) &&
      existsSync(jsonPath) &&
      readFileSync(pngPath).equals(png) &&
      readFileSync(jsonPath, 'utf8') === text;
    if (!same) throw new Error('vfx_weather differs from the pipeline output: run `pnpm art`');
    console.log(`vfx_weather: up to date, sha256 ${digest}`);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'atlas.png'), png);
  writeFileSync(join(OUT_DIR, 'manifest.json'), text);
  writeFileSync(join(MANIFEST_DIR, 'vfx_weather.json'), text);

  // Review sheets: every strip, frames left to right, on three grounds side by side.
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const grounds = [hex('#2c3142'), hex('#d6b46e'), hex('#e6edf5')];
  const gap = 4;
  const column = 300;
  let page: Array<{ s: (typeof strips)[number]['strip']; perRow: number; rows: number }> = [];
  let used = gap;
  let index = 0;
  const flush = () => {
    if (page.length === 0) return;
    const sheet = new PixelBuffer(column * grounds.length, used);
    grounds.forEach((g, gi) => {
      for (let y = 0; y < used; y++)
        for (let x = 0; x < column; x++) sheet.set(gi * column + x, y, g);
    });
    let y = gap;
    for (const { s, perRow, rows } of page) {
      grounds.forEach((_g, gi) => {
        s.frames.forEach((frame, i) => {
          const fx = gi * column + gap + (i % perRow) * (s.frameWidth + 2);
          const fy = y + Math.floor(i / perRow) * (s.frameHeight + 2);
          for (let py = 0; py < s.frameHeight; py++)
            for (let px = 0; px < s.frameWidth; px++) {
              const a = frame.alphaAt(px, py);
              if (a === 0) continue;
              const p = (py * frame.width + px) * 4;
              const src = [frame.data[p]!, frame.data[p + 1]!, frame.data[p + 2]!] as const;
              const q = ((fy + py) * sheet.width + fx + px) * 4;
              if (s.blend === 'add') {
                for (let c = 0; c < 3; c++)
                  sheet.data[q + c] = Math.min(255, sheet.data[q + c]! + src[c]!);
              } else {
                const k = a / 255;
                for (let c = 0; c < 3; c++)
                  sheet.data[q + c] = Math.round(sheet.data[q + c]! * (1 - k) + src[c]! * k);
              }
            }
        });
      });
      y += rows * (s.frameHeight + 2) + gap;
    }
    writeFileSync(join(PREVIEW_DIR, `weather_${index}.png`), encodePng(sheet.scaled(3)));
    writeFileSync(
      join(PREVIEW_DIR, `weather_${index}.txt`),
      `${page.map((p) => p.s.id).join(' ')}\n`,
    );
    index++;
    page = [];
    used = gap;
  };
  for (const { strip } of strips) {
    const perRow = Math.max(1, Math.floor((column - gap * 2) / (strip.frameWidth + 2)));
    const rows = Math.ceil(strip.frames.length / perRow);
    const h = rows * (strip.frameHeight + 2) + gap;
    if (used + h > 320) flush();
    page.push({ s: strip, perRow, rows });
    used += h;
  }
  flush();
  console.log(
    `vfx_weather: ${strips.length} strips, ${strips.reduce((n, s) => n + s.strip.frames.length, 0)} frames, ` +
      `${manifest.width} x ${manifest.height}, ${(png.length / 1024).toFixed(1)} KB, sha256 ${digest}, ` +
      `${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  bakeWeatherVfx(process.argv.includes('--check'));
