import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY_01 } from '@bolt/content';
import { bakeTerrainWithReport } from './terrain/index.js';

/** Bakes Neon Cut (city_01) under the clear night preset and writes review previews. */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const presetId = 'city_clear_night';
const outDir = join(root, 'apps', 'web', 'public', 'assets', 'maps', CITY_01.id, presetId);
const previewDir = join(root, 'art', 'preview', 'terrain');
const noPreview = process.argv.includes('--no-preview');

const t0 = performance.now();
const report = bakeTerrainWithReport({
  def: CITY_01,
  presetId,
  outDir,
  previewDir: noPreview ? undefined : previewDir,
});
const seconds = (performance.now() - t0) / 1000;

const digest = createHash('sha256');
let total = 0;
for (const name of readdirSync(outDir).sort()) {
  const bytes = readFileSync(join(outDir, name));
  digest.update(name);
  digest.update(bytes);
  total += bytes.length;
}
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
console.log(`Baked ${CITY_01.id}/${presetId} in ${seconds.toFixed(1)} s`);
console.log(`  ground   ${report.manifest.ground.length} chunks, ${kb(report.bytes.ground)}`);
console.log(`  overlays ${report.manifest.overlays.length}, ${kb(report.bytes.overlays)}`);
console.log(`  animated ${report.manifest.animated.length}, ${kb(report.bytes.animated)}`);
console.log(`  minimap  ${kb(report.bytes.minimap)}, manifest ${kb(report.bytes.manifest)}`);
console.log(`  lights   ${report.manifest.lights.length}`);
console.log(`  total    ${kb(total)}`);
console.log(
  `  chunks color-reduced ${report.reducedChunks} (max ${report.maxChunkColors} colors), truecolor ${report.truecolorChunks}`,
);
console.log(`  sha256   ${digest.digest('hex')}`);
if (report.previews.length > 0)
  console.log(`  previews ${report.previews.length} files in ${previewDir}`);
