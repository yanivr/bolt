import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CarAtlasManifest } from '@bolt/shared';
import { PixelBuffer, encodePng, hex, readPng } from './lib/pixels.js';
import { bakeDamageOverlays } from './vfx/damage.js';
import { buildCombatVfx } from './vfx/index.js';
import { packAtlas } from './vfx/pack.js';
import { bakeWeatherVfx } from './vfx/weatherBake.js';

/**
 * Bakes the combat effects atlas (Milestone C part 2).
 *
 *   npx tsx art/scripts/bake-vfx.ts            bake and write
 *   npx tsx art/scripts/bake-vfx.ts --check    bake to memory and fail if the files differ
 *
 * `pnpm art` runs this as its last step. Output: `apps/web/public/assets/atlases/vfx_combat`
 * (one PNG and its manifest), a copy of the manifest in `art/manifests`, and a review sheet in
 * `art/preview/vfx` with every strip laid out and named at four times its size.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = join(ROOT, 'apps/web/public/assets/atlases/vfx_combat');
const DAMAGE_DIR = join(ROOT, 'apps/web/public/assets/atlases/vfx_damage');
const CARS_DIR = join(ROOT, 'apps/web/public/assets/atlases/cars');
const MANIFEST_DIR = join(ROOT, 'art/manifests');
const PREVIEW_DIR = join(ROOT, 'art/preview/vfx');

/** Overlays are drawn from the committed body sheets, so they always fit the cars that ship. */
function bakeDamage(check: boolean): void {
  const cars = JSON.parse(
    readFileSync(join(CARS_DIR, 'manifest.json'), 'utf8'),
  ) as CarAtlasManifest;
  const { manifest, sheets } = bakeDamageOverlays(cars, (file) => readPng(join(CARS_DIR, file)));
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  let bytes = 0;
  if (!check) mkdirSync(DAMAGE_DIR, { recursive: true });
  for (const [file, sheet] of sheets) {
    const png = encodePng(sheet);
    bytes += png.length;
    const path = join(DAMAGE_DIR, file);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(png))
        throw new Error(`vfx_damage/${file} differs from the pipeline output: run \`pnpm art\``);
    } else writeFileSync(path, png);
  }
  const jsonPath = join(DAMAGE_DIR, 'manifest.json');
  if (check) {
    if (!existsSync(jsonPath) || readFileSync(jsonPath, 'utf8') !== text)
      throw new Error('vfx_damage manifest differs from the pipeline output: run `pnpm art`');
    console.log('vfx_damage: up to date');
    return;
  }
  writeFileSync(jsonPath, text);
  writeFileSync(join(MANIFEST_DIR, 'vfx_damage.json'), text);
  console.log(`vfx_damage: ${sheets.size} sheets, ${(bytes / 1024).toFixed(1)} KB`);
}

export function bakeCombatVfx(check = false): void {
  const started = performance.now();
  mkdirSync(MANIFEST_DIR, { recursive: true });
  bakeDamage(check);
  // The weather and environment atlas (Milestone D) bakes with the effects.
  bakeWeatherVfx(check);
  const strips = buildCombatVfx();
  const { image, manifest } = packAtlas(strips, 'atlas.png');
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
    if (!same) throw new Error('vfx_combat differs from the pipeline output: run `pnpm art`');
    console.log(`vfx_combat: up to date, sha256 ${digest}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(MANIFEST_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'atlas.png'), png);
  writeFileSync(join(OUT_DIR, 'manifest.json'), text);
  writeFileSync(join(MANIFEST_DIR, 'vfx_combat.json'), text);

  // Review sheets: each strip on the road color, frames left to right, split over a few pages.
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const road = hex('#3a4058');
  const gap = 6;
  const pageWidth = 420;
  let page: Array<{ strip: (typeof strips)[number]; rows: number; perRow: number }> = [];
  let used = gap;
  let pageIndex = 0;
  const flush = () => {
    if (page.length === 0) return;
    const sheet = new PixelBuffer(pageWidth, used);
    sheet.fill(road);
    let y = gap;
    for (const { strip, rows, perRow } of page) {
      strip.frames.forEach((frame, i) => {
        sheet.blit(
          frame,
          gap + (i % perRow) * (strip.frameWidth + 2),
          y + Math.floor(i / perRow) * (strip.frameHeight + 2),
        );
      });
      y += rows * (strip.frameHeight + 2) + gap;
    }
    const names = page.map((p) => p.strip.id).join(' ');
    writeFileSync(join(PREVIEW_DIR, `sheet_${pageIndex}.png`), encodePng(sheet.scaled(3)));
    writeFileSync(join(PREVIEW_DIR, `sheet_${pageIndex}.txt`), `${names}\n`);
    pageIndex++;
    page = [];
    used = gap;
  };
  for (const strip of strips) {
    const perRow = Math.max(1, Math.floor((pageWidth - gap * 2) / (strip.frameWidth + 2)));
    const rows = Math.ceil(strip.frames.length / perRow);
    const h = rows * (strip.frameHeight + 2) + gap;
    if (used + h > 300) flush();
    page.push({ strip, rows, perRow });
    used += h;
  }
  flush();

  console.log(
    `vfx_combat: ${strips.length} strips, ${strips.reduce((n, s) => n + s.frames.length, 0)} frames, ` +
      `${manifest.width} x ${manifest.height}, ${(png.length / 1024).toFixed(1)} KB, sha256 ${digest}, ` +
      `${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  bakeCombatVfx(process.argv.includes('--check'));
