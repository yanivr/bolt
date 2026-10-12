import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `assets/maps/index.json`: which track and weather pairs have baked terrain. The client reads
 * it at boot; a production build offers only these courses (docs/TRACK_API.md). Written by the
 * terrain bake, and by `npx tsx art/scripts/terrain/mapIndex.ts` on its own.
 */
export type MapIndex = { version: 1; maps: Array<{ trackId: string; presetId: string }> };

export function scanMaps(mapsDir: string): MapIndex {
  const maps: MapIndex['maps'] = [];
  if (existsSync(mapsDir))
    for (const trackId of readdirSync(mapsDir).sort()) {
      const trackDir = join(mapsDir, trackId);
      if (!statSync(trackDir).isDirectory()) continue;
      for (const presetId of readdirSync(trackDir).sort())
        if (existsSync(join(trackDir, presetId, 'manifest.json'))) maps.push({ trackId, presetId });
    }
  return { version: 1, maps };
}

export function writeMapIndex(mapsDir: string): MapIndex {
  const index = scanMaps(mapsDir);
  writeFileSync(join(mapsDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1]?.endsWith('mapIndex.ts')) {
  const dir = process.argv[2] ?? join(process.cwd(), 'apps', 'web', 'public', 'assets', 'maps');
  console.log(JSON.stringify(writeMapIndex(dir)));
}
