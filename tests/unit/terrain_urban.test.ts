import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTrack, getWeatherPreset } from '@bolt/content';
import { buildTrack } from '@bolt/shared';
import type { TerrainManifest, TrackHazard } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { readPng } from '../../art/scripts/lib/pixels.js';
import type { PixelBuffer } from '../../art/scripts/lib/pixels.js';
import { IND } from '../../art/scripts/terrain/industrial/style.js';

/**
 * The urban bakes: Backstreet Blitz (clear and rain), Steel Circuit (dry night and factory
 * rain) and Neon Cut's rainy night. Their files cover the world, everything the manifest names
 * exists and has the right shape, they fit the download budget, the bake's own self-checks
 * (nothing raised over drivable ground, loops agreeing with the art under them) were run on
 * exactly these bytes, every timed hazard has its timetable loop, and every hazard is visibly
 * marked where the physics has it. Neon Cut's approved clear night is still byte-identical.
 */

const ROOT = resolve('.');
const MAPS = join(ROOT, 'apps/web/public/assets/maps');
const COURSES: ReadonlyArray<readonly [string, string]> = [
  ['city_02', 'city_clear_day'],
  ['city_02', 'city_rain_day'],
  ['industrial_01', 'industrial_dry_night'],
  ['industrial_01', 'industrial_factory_rain'],
  ['city_01', 'city_rain_night'],
];

const digest = (dir: string): string => {
  const h = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    h.update(name);
    h.update(readFileSync(join(dir, name)));
  }
  return h.digest('hex');
};

/** The whole ground layer of a bake as one picture. */
function groundOf(dir: string, m: TerrainManifest): PixelBuffer {
  const first = readPng(join(dir, m.ground[0]!.file));
  const Ctor = first.constructor as new (w: number, h: number) => PixelBuffer;
  const world = new Ctor(m.worldWidth, m.worldHeight);
  for (const c of m.ground) world.blit(readPng(join(dir, c.file)), c.x, c.y);
  return world;
}

const rgb = (p: PixelBuffer, x: number, y: number): number => {
  const c = p.get(x, y);
  return (c[0] << 16) | (c[1] << 8) | c[2];
};

describe.each(COURSES)('terrain bake %s / %s', (trackId, presetId) => {
  const dir = join(MAPS, trackId, presetId);
  const def = getTrack(trackId)!;
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;

  it('is listed in the map index the client reads', () => {
    const index = JSON.parse(readFileSync(join(MAPS, 'index.json'), 'utf8')) as {
      maps: Array<{ trackId: string; presetId: string }>;
    };
    expect(index.maps).toContainEqual({ trackId, presetId });
    expect(def.weatherPresetIds).toContain(presetId);
    expect(getWeatherPreset(presetId)).toBeDefined();
  });

  it('covers the world with chunks, without gaps or overlaps', () => {
    expect(m.trackId).toBe(trackId);
    expect(m.presetId).toBe(presetId);
    expect(m.worldWidth).toBe(def.worldWidth);
    expect(m.worldHeight).toBe(def.worldHeight);
    expect(m.ground).toHaveLength(m.cols * m.rows);
    let area = 0;
    const seen = new Set<string>();
    for (const c of m.ground) {
      expect(c.x).toBe(c.col * m.chunkSize);
      expect(c.y).toBe(c.row * m.chunkSize);
      expect(c.x + c.w).toBeLessThanOrEqual(m.worldWidth);
      expect(c.y + c.h).toBeLessThanOrEqual(m.worldHeight);
      seen.add(`${c.col},${c.row}`);
      const png = readPng(join(dir, c.file));
      expect([png.width, png.height]).toEqual([c.w, c.h]);
      // Every chunk is palette-indexed (byte 25 of a PNG is its color type).
      expect(readFileSync(join(dir, c.file))[25]).toBe(3);
      area += c.w * c.h;
    }
    expect(seen.size).toBe(m.ground.length);
    expect(area).toBe(m.worldWidth * m.worldHeight);
  });

  it('ships every overlay, loop and the minimap it names, in the shapes it names', () => {
    for (const o of m.overlays) {
      const png = readPng(join(dir, o.file));
      expect([png.width, png.height]).toEqual([o.w, o.h]);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
    }
    for (const a of m.animated) {
      const png = readPng(join(dir, a.file));
      // One row of frames or a grid of them, read row by row; within mobile texture limits.
      expect(png.width % a.frameWidth).toBe(0);
      expect(png.height % a.frameHeight).toBe(0);
      const cols = png.width / a.frameWidth;
      const rows = png.height / a.frameHeight;
      expect(cols * rows).toBeGreaterThanOrEqual(a.frameCount);
      expect(cols * (rows - 1)).toBeLessThan(a.frameCount);
      expect(png.width).toBeLessThanOrEqual(4096);
      expect(png.height).toBeLessThanOrEqual(4096);
    }
    expect(existsSync(join(dir, m.minimap.file))).toBe(true);
    // Section 12.10: three ambient loops and foreground framing per track.
    expect(
      m.animated.filter((a) => !a.kind.startsWith('timetable:')).length,
    ).toBeGreaterThanOrEqual(3);
    expect(m.overlays.length).toBeGreaterThanOrEqual(4);
    expect(m.overlays.some((o) => o.fadeNearPlayer)).toBe(true);
    expect(m.lights.length).toBeGreaterThan(20);
  });

  it('fits the download budget', () => {
    let bytes = 0;
    for (const f of [...m.ground, ...m.overlays, ...m.animated])
      bytes += statSync(join(dir, f.file)).size;
    // A course's terrain is under 2.2 MB (Neon Cut's approved clear night is 1.7 MB); with
    // the cars that keeps a first race under the 4 MB the asset test holds Neon Cut to.
    expect(bytes).toBeLessThan(2.2 * 1024 * 1024);
  });

  it('passed its own self-checks on exactly these files', () => {
    const rec = JSON.parse(
      readFileSync(join(ROOT, 'art/manifests', `${trackId}_${presetId}.checks.json`), 'utf8'),
    ) as { sha256: string; checks: { coveredDrivable: number; animatedMismatch: number } };
    expect(rec.sha256).toBe(digest(dir));
    expect(rec.checks.coveredDrivable).toBe(0);
    expect(rec.checks.animatedMismatch).toBe(0);
  });

  it('has a timetable loop for every timed hazard, one period long', () => {
    for (const h of def.hazards) {
      if (!('schedule' in h)) continue;
      const loops = m.animated.filter((a) => a.kind === `timetable:${h.id}`);
      expect(loops.length, h.id).toBeGreaterThan(0);
      for (const a of loops) expect(a.frameCount / a.fps).toBeCloseTo(h.schedule.periodSeconds, 6);
    }
  });

  it('marks every hazard where the physics has it', () => {
    const track = buildTrack(def);
    const world = groundOf(dir, m);
    const sets: Partial<Record<TrackHazard['kind'], Set<number>>> = {
      magnetic_strip: new Set([IND.magnetBase, IND.magnetBar, IND.magnetHi, IND.magnetEdge]),
      oil: new Set([IND.oil, IND.oilMid, IND.oilRim, IND.oilSheen, IND.oilSheenHi]),
      steam_vent: new Set([
        IND.grate,
        IND.grateBar,
        IND.grateHi,
        IND.hazardYellow,
        IND.hazardBlack,
      ]),
    };
    def.hazards.forEach((h, k) => {
      if (h.kind === 'crossing') {
        // The keep-clear box is painted gold over the barrier, across the road.
        let gold = 0;
        let n = 0;
        for (let x = Math.ceil(h.a.x); x <= h.b.x; x++)
          for (const dy of [-20, -15, 15, 20]) {
            const y = Math.round((h.a.y + h.b.y) / 2) + dy;
            const c = world.get(x, y);
            n++;
            if (c[0] > 150 && c[0] > c[2] + 60 && c[1] > c[2]) gold++;
          }
        expect(gold / n, h.id).toBeGreaterThan(0.2);
        return;
      }
      const set = sets[h.kind];
      if (!set || !track.zoneHazard) return;
      let hit = 0;
      let n = 0;
      for (let r = 0; r < track.zoneRows; r++)
        for (let c = 0; c < track.zoneCols; c++) {
          if (track.zoneHazard[r * track.zoneCols + c] !== k + 1) continue;
          const x = c * track.zoneCell + (track.zoneCell >> 1);
          const y = r * track.zoneCell + (track.zoneCell >> 1);
          n++;
          if (set.has(rgb(world, x, y))) hit++;
        }
      expect(n, h.id).toBeGreaterThan(0);
      expect(hit / n, h.id).toBeGreaterThan(h.kind === 'oil' ? 0.7 : 0.85);
    });
  });
});

describe('Neon Cut clear night', () => {
  it('is byte-identical to the approved bake (docs/TRACK_API.md)', () => {
    expect(digest(join(MAPS, 'city_01/city_clear_night'))).toBe(
      '92dba1e3bd9432cb13f64de9a62d4fdc385103211da60dda2e95598bf2b93813',
    );
  });
});
