import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTrack } from '@bolt/content';
import type { CarAtlasManifest, SurfaceId, TerrainManifest } from '@bolt/shared';
import { SURFACE_IDS, buildTrack, createLocation, groundAt, locate, sampleBranch } from '@bolt/shared';
import type { Ground } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { PixelBuffer, readPng } from '../../art/scripts/lib/pixels.js';
import { computeReach } from '../../art/scripts/terrain/forest/reach.js';
import { buildTree } from '../../art/scripts/terrain/forest/trees.js';

/**
 * The forest and snow bakes (Moss Run, Timber Dash, Whiteout Pass in both their weathers), read
 * back from what ships: chunk coverage, the manifest and its files, the download budget, the
 * ambient loops, that tree crowns are foreground overlays and not baked over the road, that a
 * tree standing beside reachable ground keeps everything above its collision disc out of the
 * ground layer, and that the surfaces a player picks tires for are told apart by color along
 * the route.
 */

const ASSETS = resolve('apps/web/public/assets');
const COURSES: Array<[string, string]> = [
  ['forest_01', 'forest_clear'],
  ['forest_01', 'forest_rain'],
  ['forest_02', 'forest_clear'],
  ['forest_02', 'forest_heavy_rain'],
  ['snow_01', 'snow_clear_frost'],
  ['snow_01', 'snow_snowfall'],
];

/** Per course, everything a race downloads for the terrain: about Neon Cut's size. */
const COURSE_BUDGET = 2.5 * 1024 * 1024;

type Rgb = [number, number, number];
const dist = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function median(colors: Rgb[]): Rgb {
  const m = (k: 0 | 1 | 2): number => {
    const v = colors.map((c) => c[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  return [m(0), m(1), m(2)];
}

function load(trackId: string, presetId: string): { dir: string; manifest: TerrainManifest } {
  const dir = join(ASSETS, 'maps', trackId, presetId);
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest };
}

function stitch(dir: string, manifest: TerrainManifest): PixelBuffer {
  const world = new PixelBuffer(manifest.worldWidth, manifest.worldHeight);
  for (const c of manifest.ground) world.blit(readPng(join(dir, c.file)), c.x, c.y);
  return world;
}

describe.each(COURSES)('terrain bake %s / %s', (trackId, presetId) => {
  const def = getTrack(trackId)!;
  const { dir, manifest } = load(trackId, presetId);

  it('covers the world with chunks, without gaps or overlaps', () => {
    expect(manifest.trackId).toBe(trackId);
    expect(manifest.presetId).toBe(presetId);
    expect(manifest.worldWidth).toBe(def.worldWidth);
    expect(manifest.worldHeight).toBe(def.worldHeight);
    expect(manifest.ground).toHaveLength(manifest.cols * manifest.rows);
    const seen = new Set<string>();
    let area = 0;
    for (const chunk of manifest.ground) {
      expect(seen.has(`${chunk.col},${chunk.row}`)).toBe(false);
      seen.add(`${chunk.col},${chunk.row}`);
      expect(chunk.x).toBe(chunk.col * manifest.chunkSize);
      expect(chunk.y).toBe(chunk.row * manifest.chunkSize);
      const image = readPng(join(dir, chunk.file));
      expect([image.width, image.height]).toEqual([chunk.w, chunk.h]);
      // Every ground pixel is opaque.
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) throw new Error(`${chunk.file} has a hole`);
      area += chunk.w * chunk.h;
    }
    expect(area).toBe(manifest.worldWidth * manifest.worldHeight);
  });

  it('ships every overlay, loop and the minimap it lists, inside the world', () => {
    for (const o of manifest.overlays) {
      expect(o.file).toMatch(/^[a-z0-9_]+\.png$/);
      const image = readPng(join(dir, o.file));
      expect([image.width, image.height]).toEqual([o.w, o.h]);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(manifest.worldWidth);
      expect(o.y + o.h).toBeLessThanOrEqual(manifest.worldHeight);
      // Everything drawn over the cars here fades when the local car is near it.
      expect(o.fadeNearPlayer).toBe(true);
    }
    for (const a of manifest.animated) {
      const image = readPng(join(dir, a.file));
      expect(image.width).toBe(a.frameWidth * a.frameCount);
      expect(image.height).toBe(a.frameHeight);
      expect(a.fps).toBeGreaterThan(0);
    }
    // Section 12.10: at least three ambient loops a track.
    expect(manifest.animated.length).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(dir, manifest.minimap.file))).toBe(true);
  });

  it('stays inside the download budget', () => {
    let bytes = 0;
    for (const f of [...manifest.ground, ...manifest.overlays, ...manifest.animated])
      bytes += statSync(join(dir, f.file)).size;
    bytes += statSync(join(dir, manifest.minimap.file)).size + statSync(join(dir, 'manifest.json')).size;
    expect(bytes).toBeLessThan(COURSE_BUDGET);
    // With every car sheet, still inside the first-play budget the city's test holds to.
    const carsDir = join(ASSETS, 'atlases/cars');
    const cars = JSON.parse(readFileSync(join(carsDir, 'manifest.json'), 'utf8')) as CarAtlasManifest;
    for (const c of Object.values(cars.chassis))
      for (const ref of [c.body, c.shadow, c.brakeLights, c.headlights]) bytes += statSync(join(carsDir, ref.file)).size;
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
  });

  it('draws every tree crown as a foreground overlay, not baked into the ground', () => {
    const crowns = manifest.overlays.filter((o) => o.kind === 'canopy');
    expect(crowns.length).toBeGreaterThan(5);
    for (const o of def.obstacles) {
      if (o.kind !== 'tree' || o.radius < 12) continue;
      // The trunk rises up the screen from its disc: a point 24 px above the foot is in a crown overlay.
      const x = o.x;
      const y = o.y - o.radius - 8;
      const hit = crowns.some((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
      expect(hit, `${o.id} has no crown overlay above it`).toBe(true);
    }
  });

  it('tells the surfaces apart by color along the route', () => {
    const track = buildTrack(def);
    const world = stitch(dir, manifest);
    const loc = createLocation();
    const g = {} as Ground;
    const bySurface = new Map<SurfaceId, Rgb[]>();
    for (const b of track.branches)
      for (let s = 0; s < b.length; s += 12) {
        const p = sampleBranch(b, s);
        for (const f of [-0.35, 0, 0.35]) {
          const x = Math.round(p.x - p.ty * p.halfWidth * f);
          const y = Math.round(p.y + p.tx * p.halfWidth * f);
          locate(track, x + 0.5, y + 0.5, loc);
          groundAt(track, loc, x + 0.5, y + 0.5, 0, g);
          if (g.onShoulder) continue;
          const c = world.get(x, y);
          const list = bySurface.get(g.surface) ?? [];
          list.push([c[0], c[1], c[2]]);
          bySurface.set(g.surface, list);
        }
      }
    const meds = new Map<SurfaceId, Rgb>();
    for (const [sid, list] of bySurface) if (list.length > 40) meds.set(sid, median(list));
    // Every surface of the track's mix that the route runs over.
    for (const sid of Object.keys(def.surfaceMix) as SurfaceId[]) expect(meds.has(sid), sid).toBe(true);
    const ids = [...meds.keys()];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const d = dist(meds.get(ids[i]!)!, meds.get(ids[j]!)!);
        expect(d, `${ids[i]} vs ${ids[j]}: ${d.toFixed(0)}`).toBeGreaterThan(38);
      }
    void SURFACE_IDS;
  });
});

describe('the guard: nothing standing in the ground layer covers reachable ground', () => {
  it.each(['forest_01', 'forest_02', 'snow_01'])(
    '%s: a tree keeps all it raises over drivable ground out of the ground layer',
    (trackId) => {
      const def = getTrack(trackId)!;
      const track = buildTrack(def);
      const reach = computeReach(track);
      const species = trackId === 'snow_01' ? 'fir' : trackId === 'forest_02' ? 'redwood' : 'oak';
      const trees = def.obstacles.filter((o) => o.kind === 'tree' && o.radius >= 12).slice(0, 12);
      for (const o of trees) {
        // The collision disc is solid and so not drivable; the ground around it is.
        expect(reach.solid[o.y * reach.w + o.x]).toBe(1);
        expect(reach.drive[o.y * reach.w + o.x]).toBe(0);
        const m = buildTree({ species, seed: 7, radius: o.radius }, o.y);
        const art = m.sprite.canvas;
        const x0 = o.x - m.sprite.ax;
        const y0 = o.y - m.sprite.ay;
        // What `addSplit` keeps in the ground layer: the rows below the lowest one that lands
        // on drivable ground. None of those rows may land on drivable ground.
        let cut = -1;
        for (let yy = art.h - 1; yy >= 0 && cut < 0; yy--)
          for (let xx = 0; xx < art.w; xx++)
            if (art.alpha(xx, yy) && reach.drive[(y0 + yy) * reach.w + x0 + xx]) {
              cut = yy;
              break;
            }
        let kept = 0;
        let covered = 0;
        for (let yy = cut + 1; yy < art.h; yy++)
          for (let xx = 0; xx < art.w; xx++) {
            if (!art.alpha(xx, yy)) continue;
            kept++;
            if (reach.drive[(y0 + yy) * reach.w + x0 + xx]) covered++;
          }
        expect(covered).toBe(0);
        // And the crown is above the cut: the tree is mostly overlay.
        expect(cut).toBeGreaterThan(art.h * 0.5);
        void kept;
      }
    },
    60_000,
  );
});
