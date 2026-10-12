import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTrack } from '@bolt/content';
import type { SurfaceId, TerrainManifest, Ground } from '@bolt/shared';
import { buildTrack, createLocation, groundAt, locate, sampleBranch } from '@bolt/shared';
import { PixelBuffer, readPng } from '../../lib/pixels.js';
for (const [t, p] of [['forest_01','forest_clear'],['forest_01','forest_rain'],['forest_02','forest_clear'],['forest_02','forest_heavy_rain'],['snow_01','snow_clear_frost'],['snow_01','snow_snowfall']] as const) {
  const dir = resolve('apps/web/public/assets/maps', t, p);
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;
  const world = new PixelBuffer(m.worldWidth, m.worldHeight);
  for (const c of m.ground) world.blit(readPng(join(dir, c.file)), c.x, c.y);
  const def = getTrack(t)!; const track = buildTrack(def); const loc = createLocation(); const g = {} as Ground;
  const by = new Map<SurfaceId, number[][]>();
  for (const b of track.branches) for (let s = 0; s < b.length; s += 12) { const q = sampleBranch(b, s); for (const f of [-0.35, 0, 0.35]) {
    const x = Math.round(q.x - q.ty * q.halfWidth * f), y = Math.round(q.y + q.tx * q.halfWidth * f);
    locate(track, x + 0.5, y + 0.5, loc); groundAt(track, loc, x + 0.5, y + 0.5, 0, g); if (g.onShoulder) continue;
    const c = world.get(x, y); const l = by.get(g.surface) ?? []; l.push([c[0], c[1], c[2]]); by.set(g.surface, l); } }
  const med = new Map<string, number[]>();
  for (const [k, l] of by) { const mm = [0,1,2].map((i) => l.map((c) => c[i]!).sort((a, b) => a - b)[l.length >> 1]!); med.set(k, mm); }
  const ids = [...med.keys()]; const pairs: string[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = med.get(ids[i]!)!, b = med.get(ids[j]!)!; pairs.push(`${ids[i]}/${ids[j]} ${Math.hypot(a[0]!-b[0]!, a[1]!-b[1]!, a[2]!-b[2]!).toFixed(0)}`); }
  console.log(`${t}/${p}: overlays ${m.overlays.length}, loops ${m.animated.length}; medians ${[...med].map(([k, v]) => `${k} #${v.map((x) => x.toString(16).padStart(2, '0')).join('')}`).join(', ')}; distances ${pairs.join(', ')}`);
}
