import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrack } from '@bolt/content';
import { bakeTerrainWithReport } from './terrain/index.js';
import { writeMapIndex } from './terrain/mapIndex.js';

/**
 * Bakes the terrain of one track under one weather preset and writes review previews.
 *
 *   npx tsx art/scripts/bake-terrain.ts                         Neon Cut, clear night
 *   npx tsx art/scripts/bake-terrain.ts --track city_01 --preset city_clear_night
 *   npx tsx art/scripts/bake-terrain.ts city_02 city_rain_day   the same, positionally
 *   npx tsx art/scripts/bake-terrain.ts city_02                 a track's first weather
 *   npx tsx art/scripts/bake-terrain.ts --out /tmp/bake          bake somewhere else (to compare)
 *   npx tsx art/scripts/bake-terrain.ts --no-preview
 *   npx tsx art/scripts/bake-terrain.ts --check                 bake to a temporary folder and
 *                                                               fail unless it is byte-identical
 *                                                               to the committed bake
 *
 * Baking into the game's own maps folder also refreshes `assets/maps/index.json`. Previews go
 * to `art/preview/terrain/` for Neon Cut's clear night (as they always have) and to
 * `art/preview/terrain/<track>_<preset>/` for every other course, so courses never overwrite
 * one another's review sheets (`--preview-dir` picks another folder).
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const VALUED = new Set(['--track', '--preset', '--out', '--preview-dir']);
const positional = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith('--') && !(i > 0 && VALUED.has(all[i - 1]!)));
const trackId = arg('--track') ?? positional[0] ?? 'city_01';
const def = getTrack(trackId);
if (!def) throw new Error(`No track ${trackId}`);
const presetId =
  arg('--preset') ??
  positional[1] ??
  (trackId === 'city_01' ? 'city_clear_night' : def.weatherPresetIds[0]!);
const check = process.argv.includes('--check');
const mapsDir = join(root, 'apps', 'web', 'public', 'assets', 'maps');
const committedDir = join(mapsDir, def.id, presetId);
const custom = check ? mkdtempSync(join(tmpdir(), 'bolt-terrain-check-')) : arg('--out');
const outDir = custom ? resolve(custom) : committedDir;
const isNeonCutClear = def.id === 'city_01' && presetId === 'city_clear_night';
const previewDir = arg('--preview-dir')
  ? resolve(arg('--preview-dir')!)
  : isNeonCutClear
    ? join(root, 'art', 'preview', 'terrain')
    : join(root, 'art', 'preview', 'terrain', `${def.id}_${presetId}`);
const noPreview = process.argv.includes('--no-preview') || custom !== undefined;

const digestOf = (
  dir: string,
): { hex: string; total: number; indexed: number; truecolor: number } => {
  const digest = createHash('sha256');
  let total = 0;
  let indexed = 0;
  let truecolor = 0;
  for (const name of readdirSync(dir).sort()) {
    const bytes = readFileSync(join(dir, name));
    // Byte 25 of a PNG is its color type; 3 means palette-indexed.
    if (name.endsWith('.png')) {
      if (bytes[25] === 3) indexed++;
      else truecolor++;
    }
    digest.update(name);
    digest.update(bytes);
    total += bytes.length;
  }
  return { hex: digest.digest('hex'), total, indexed, truecolor };
};

const t0 = performance.now();
const report = bakeTerrainWithReport({
  def,
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

if (!custom) {
  // The art-side copy of the manifest, in the layout the full art build writes.
  const manifestDir = join(root, 'art', 'manifests');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, `${def.id}_${presetId}.json`),
    `${JSON.stringify(report.manifest, null, 2)}\n`,
  );
  const index = writeMapIndex(mapsDir);
  console.log(`  index    ${index.maps.map((m) => `${m.trackId}/${m.presetId}`).join(', ')}`);
}

const baked = digestOf(outDir);
if (!custom) {
  // The bake's own self-checks, tied to the exact files they were made on (the sha256 of the
  // shipped folder), so a test can hold the shipped bytes to them without rebaking.
  writeFileSync(
    join(root, 'art', 'manifests', `${def.id}_${presetId}.checks.json`),
    `${JSON.stringify({ sha256: baked.hex, checks: report.checks, bytes: baked.total }, null, 2)}\n`,
  );
}
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
console.log(`Baked ${def.id}/${presetId} in ${seconds.toFixed(1)} s`);
console.log(`  ground   ${report.manifest.ground.length} chunks, ${kb(report.bytes.ground)}`);
console.log(`  overlays ${report.manifest.overlays.length}, ${kb(report.bytes.overlays)}`);
console.log(`  animated ${report.manifest.animated.length}, ${kb(report.bytes.animated)}`);
console.log(`  minimap  ${kb(report.bytes.minimap)}, manifest ${kb(report.bytes.manifest)}`);
console.log(`  lights   ${report.manifest.lights.length}`);
console.log(`  total    ${kb(baked.total)}`);
console.log(
  `  png      ${baked.indexed} indexed, ${baked.truecolor} truecolor; ${report.reducedChunks} chunks folded to 256 colors (richest had ${report.maxChunkColors})`,
);
console.log(
  `  checks   drivable pixels covered by raised geometry ${report.checks.coveredDrivable}, ` +
    `animated frame-0 mismatches ${report.checks.animatedMismatch}`,
);
console.log(`  sha256   ${baked.hex}`);
if (report.previews.length > 0)
  console.log(`  previews ${report.previews.length} files in ${previewDir}`);
if (report.checks.coveredDrivable !== 0) {
  console.error('Raised geometry hides drivable ground. The bake is not shippable.');
  process.exitCode = 1;
}
if (check) {
  rmSync(outDir, { recursive: true, force: true });
  if (!existsSync(join(committedDir, 'manifest.json'))) {
    console.error(`check    no committed bake in ${committedDir}`);
    process.exitCode = 1;
  } else {
    const committed = digestOf(committedDir);
    if (committed.hex === baked.hex) console.log(`check    identical to the committed bake`);
    else {
      console.error(`check    DIFFERS from the committed bake (sha256 ${committed.hex})`);
      process.exitCode = 1;
    }
  }
}
