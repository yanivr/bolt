import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  previewCarSheet: join(
    root,
    'apps',
    'web',
    'public',
    'assets',
    'atlases',
    'cars',
    'chassis_beetle_body.png',
  ),
});
const seconds = (performance.now() - t0) / 1000;

// The art-side copy of the manifest, in the layout the full art build writes.
const manifestDir = join(root, 'art', 'manifests');
mkdirSync(manifestDir, { recursive: true });
writeFileSync(
  join(manifestDir, `${CITY_01.id}_${presetId}.json`),
  `${JSON.stringify(report.manifest, null, 2)}\n`,
);

const digest = createHash('sha256');
let total = 0;
let indexed = 0;
let truecolor = 0;
for (const name of readdirSync(outDir).sort()) {
  const bytes = readFileSync(join(outDir, name));
  // Byte 25 of a PNG is its color type; 3 means palette-indexed.
  if (name.endsWith('.png')) {
    if (bytes[25] === 3) indexed++;
    else truecolor++;
  }
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
  `  png      ${indexed} indexed, ${truecolor} truecolor; ${report.reducedChunks} chunks folded to 256 colors (richest had ${report.maxChunkColors})`,
);
console.log(
  `  checks   drivable pixels covered by raised geometry ${report.checks.coveredDrivable}, ` +
    `animated frame-0 mismatches ${report.checks.animatedMismatch}`,
);
console.log(`  sha256   ${digest.digest('hex')}`);
if (report.previews.length > 0)
  console.log(`  previews ${report.previews.length} files in ${previewDir}`);
if (report.checks.coveredDrivable !== 0) {
  console.error('Raised geometry hides drivable ground. The bake is not shippable.');
  process.exitCode = 1;
}
