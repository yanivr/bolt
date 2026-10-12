import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTrack, getWeatherPreset } from '@bolt/content';
import {
  buildTrack,
  createGround,
  createLocation,
  groundAt,
  locate,
  sampleBranch,
} from '@bolt/shared';
import type { TerrainManifest, TrackRuntime } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { PixelBuffer, readPng } from '../../art/scripts/lib/pixels.js';
import { Canvas } from '../../art/scripts/terrain/canvas.js';
import type { Masks } from '../../art/scripts/terrain/desert/masks.js';
import { lookFor } from '../../art/scripts/terrain/desert/palette.js';
import { fitRise, raiseBoulder } from '../../art/scripts/terrain/desert/rocks.js';
import { M_BOULDER, Stage } from '../../art/scripts/terrain/desert/stage.js';

/**
 * The desert biome's four courses (Dust Devil clear and crosswind, Canyon Switch dry heat and
 * sandstorm), checked from what ships: chunks, references, budget, loops, how far sand and
 * asphalt are apart on the road, and the stage's rule that raised art over ground a car can
 * reach always goes to an overlay. A full re-bake of each course, byte-compared with what is
 * committed and with its own picture-based guard, runs with BOLT_TERRAIN_REBAKE=1 (it takes
 * minutes on a shared machine).
 */

const MAPS = resolve('apps/web/public/assets/maps');
const COURSES = [
  ['desert_01', 'desert_clear'],
  ['desert_01', 'desert_crosswind'],
  ['desert_02', 'desert_dry_heat'],
  ['desert_02', 'desert_sandstorm'],
] as const;
/** Download budget of one course's terrain (ground, overlays, loops, minimap, manifest). */
const COURSE_BUDGET = 1.6 * 1024 * 1024;

function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function loadWorld(dir: string, m: TerrainManifest): PixelBuffer {
  const world = new PixelBuffer(m.worldWidth, m.worldHeight);
  for (const c of m.ground) world.copyFrom(readPng(join(dir, c.file)), 0, 0, c.w, c.h, c.x, c.y);
  return world;
}

const luma = (r: number, g: number, b: number): number => r * 0.3 + g * 0.59 + b * 0.11;

function percentile(values: number[], q: number): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!;
}

/**
 * Pavement samples along every branch with the surface the physics reports there, away from
 * paint, curbs, the start, overlays and zone edges.
 */
function roadSamples(
  track: TrackRuntime,
  world: PixelBuffer,
  overlayMask: Uint8Array,
): { asphalt: number[]; sand: number[]; drift: number[]; rgbA: number[]; rgbS: number[] } {
  const loc = createLocation();
  const ground = createGround();
  const bare = buildTrack({ ...track.def, surfaceZones: [] });
  const out = { asphalt: [] as number[], sand: [] as number[], drift: [] as number[], rgbA: [0, 0, 0], rgbS: [0, 0, 0] };
  const surfaceAt = (x: number, y: number): string => {
    locate(track, x, y, loc);
    return groundAt(track, loc, x, y, 0, ground).surface;
  };
  for (const b of track.branches) {
    for (let s = 0; s < b.length; s += 9) {
      if (b.index === 0 && Math.abs(((s - track.startS + b.length * 1.5) % b.length) - b.length / 2) < 80) continue;
      const p = sampleBranch(b, s);
      for (const f of [-0.62, -0.35, -0.12, 0.12, 0.35, 0.62]) {
        const lat = f * p.halfWidth;
        const x = Math.round(p.x - p.ty * lat);
        const y = Math.round(p.y + p.tx * lat);
        if (x < 8 || y < 8 || x >= world.width - 8 || y >= world.height - 8) continue;
        if (overlayMask[y * world.width + x]) continue;
        const here = surfaceAt(x + 0.5, y + 0.5);
        // Keep away from zone edges: the art follows the authored shape, the physics an 8 px grid.
        let edge = false;
        for (const [dx, dy] of [
          [7, 0],
          [-7, 0],
          [0, 7],
          [0, -7],
        ] as const)
          if (surfaceAt(x + 0.5 + dx, y + 0.5 + dy) !== here) edge = true;
        if (edge) continue;
        const i = (y * world.width + x) * 4;
        const r = world.data[i]!;
        const g = world.data[i + 1]!;
        const bl = world.data[i + 2]!;
        const l = luma(r, g, bl);
        if (here === 'asphalt') {
          out.asphalt.push(l);
          out.rgbA[0]! += r;
          out.rgbA[1]! += g;
          out.rgbA[2]! += bl;
        } else if (here === 'sand') {
          out.sand.push(l);
          out.rgbS[0]! += r;
          out.rgbS[1]! += g;
          out.rgbS[2]! += bl;
          locate(bare, x + 0.5, y + 0.5, loc);
          if (bare.branches[loc.branch]!.surface[loc.index] === 'asphalt') out.drift.push(l);
        }
      }
    }
  }
  return out;
}

describe.each(COURSES)('desert terrain %s / %s', (trackId, presetId) => {
  const dir = join(MAPS, trackId, presetId);
  const def = getTrack(trackId)!;
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;

  it('has a manifest for this track and weather', () => {
    expect(m.version).toBe(1);
    expect(m.trackId).toBe(trackId);
    expect(m.presetId).toBe(presetId);
    expect(def.weatherPresetIds).toContain(presetId);
    expect(getWeatherPreset(presetId)).toBeDefined();
    expect([m.worldWidth, m.worldHeight]).toEqual([def.worldWidth, def.worldHeight]);
    expect(m.chunkSize).toBe(512);
    expect(m.cols).toBe(Math.ceil(def.worldWidth / 512));
    expect(m.rows).toBe(Math.ceil(def.worldHeight / 512));
    const index = JSON.parse(readFileSync(join(MAPS, 'index.json'), 'utf8')) as {
      maps: Array<{ trackId: string; presetId: string }>;
    };
    expect(index.maps).toContainEqual({ trackId, presetId });
  });

  it('covers the world with chunks, without gaps or overlaps', () => {
    expect(m.ground).toHaveLength(m.cols * m.rows);
    const seen = new Set<string>();
    let area = 0;
    for (const c of m.ground) {
      expect(seen.has(`${c.col},${c.row}`)).toBe(false);
      seen.add(`${c.col},${c.row}`);
      expect([c.x, c.y]).toEqual([c.col * 512, c.row * 512]);
      expect(c.w).toBe(Math.min(512, m.worldWidth - c.x));
      expect(c.h).toBe(Math.min(512, m.worldHeight - c.y));
      expect(pngSize(join(dir, c.file))).toEqual([c.w, c.h]);
      // Indexed PNG: one palette per chunk.
      expect(readFileSync(join(dir, c.file))[25]).toBe(3);
      area += c.w * c.h;
    }
    expect(area).toBe(m.worldWidth * m.worldHeight);
  });

  it('ships every file it references, and nothing it does not', () => {
    const referenced = new Set<string>(['manifest.json', m.minimap.file]);
    for (const c of m.ground) referenced.add(c.file);
    for (const o of m.overlays) {
      referenced.add(o.file);
      expect(pngSize(join(dir, o.file))).toEqual([o.w, o.h]);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(m.worldWidth);
      expect(o.y + o.h).toBeLessThanOrEqual(m.worldHeight);
      // Everything a car can pass under or behind fades near the player.
      expect(o.fadeNearPlayer).toBe(true);
      // Compact pieces, so a fade is local.
      expect(Math.max(o.w, o.h)).toBeLessThanOrEqual(200);
    }
    for (const a of m.animated) {
      referenced.add(a.file);
      expect(pngSize(join(dir, a.file))).toEqual([a.frameWidth * a.frameCount, a.frameHeight]);
      expect(a.fps).toBeGreaterThan(0);
    }
    expect(existsSync(join(dir, m.minimap.file))).toBe(true);
    expect(m.minimap.width / m.minimap.worldScale).toBeCloseTo(m.worldWidth, -1);
    expect(readdirSync(dir).sort()).toEqual([...referenced].sort());
  });

  it('fades an overlay from the road only where it stands over the road or its verge', () => {
    const track = buildTrack(def);
    const loc = createLocation();
    const onCorridor = (x: number, y: number): boolean => {
      locate(track, x + 0.5, y + 0.5, loc);
      return loc.edge <= 0;
    };
    const onPavement = (x: number, y: number): boolean => {
      locate(track, x + 0.5, y + 0.5, loc);
      return Math.abs(loc.lateral) <= loc.halfWidth && loc.edge <= 0;
    };
    let misses = 0;
    for (const o of m.overlays) {
      const img = readPng(join(dir, o.file));
      let over = false;
      for (let y = 0; y < o.h && !over; y++)
        for (let x = 0; x < o.w && !over; x++) if (img.alphaAt(x, y) > 0 && onCorridor(o.x + x, o.y + y)) over = true;
      if (over) continue;
      // The client fades an overlay while the car is within 26 px of its box.
      for (let y = o.y - 26; y <= o.y + o.h + 26; y += 3)
        for (let x = o.x - 26; x <= o.x + o.w + 26; x += 3) if (onPavement(x, y)) misses++;
    }
    expect(misses).toBe(0);
  }, 60_000);

  it('stays inside its download budget', () => {
    let bytes = 0;
    for (const name of readdirSync(dir)) bytes += statSync(join(dir, name)).size;
    expect(bytes).toBeLessThan(COURSE_BUDGET);
  });

  it('has at least three ambient loops, and wind loops for the wind of the day', () => {
    expect(m.animated.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(m.animated.map((a) => a.kind));
    expect(kinds.has('wind_sock') || kinds.has('flag')).toBe(true);
    // Section 12.10: four landmarks; the art realizes them, the data names them.
    expect(def.landmarks.length).toBeGreaterThanOrEqual(4);
  });

  it('tells sand from asphalt at a glance on the road', () => {
    const world = loadWorld(dir, m);
    const overlayMask = new Uint8Array(m.worldWidth * m.worldHeight);
    for (const o of m.overlays) {
      const img = readPng(join(dir, o.file));
      for (let y = 0; y < o.h; y++)
        for (let x = 0; x < o.w; x++) if (img.alphaAt(x, y) > 0) overlayMask[(o.y + y) * m.worldWidth + o.x + x] = 1;
    }
    const track = buildTrack(def);
    const s = roadSamples(track, world, overlayMask);
    expect(s.asphalt.length).toBeGreaterThan(1000);
    expect(s.sand.length).toBeGreaterThan(1000);
    // Nearly every asphalt pixel is darker than nearly every sand pixel, by a wide margin.
    const a95 = percentile(s.asphalt, 0.95);
    const s05 = percentile(s.sand, 0.05);
    expect(s05 - a95).toBeGreaterThan(30);
    const mean = (v: number[], n: number): number[] => v.map((x) => x / n);
    const ma = mean(s.rgbA, s.asphalt.length);
    const ms = mean(s.rgbS, s.sand.length);
    expect(Math.hypot(ma[0]! - ms[0]!, ma[1]! - ms[1]!, ma[2]! - ms[2]!)).toBeGreaterThan(90);
    // Sand laid over the tarmac (the surface zones) reads as sand, not as tarmac.
    if (s.drift.length > 0) expect(percentile(s.drift, 0.05) - a95).toBeGreaterThan(30);
  }, 120_000);
});

describe('desert stage', () => {
  /** A small world: reachable everywhere but a disc at (20, 30) of radius 8 and a band at the top. */
  function syntheticMasks(): Masks {
    const w = 48;
    const h = 48;
    const solid = new Uint8Array(w * h);
    const reach = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (y < 6) continue;
        if ((x + 0.5 - 20) ** 2 + (y + 0.5 - 30) ** 2 <= 64) solid[p] = 2;
        else reach[p] = 1;
      }
    return {
      w,
      h,
      solid,
      owner: new Int32Array(w * h),
      reach,
      kind: new Uint8Array(w * h),
      surf: new Uint8Array(w * h),
      hazard: new Uint8Array(w * h),
      reachCount: reach.reduce((a, b) => a + b, 0),
    };
  }

  it('sends raised pixels over reachable ground to the foreground, never to the ground layer', () => {
    const masks = syntheticMasks();
    const world = Canvas.world(masks.w, masks.h);
    const stage = new Stage(masks, world);
    stage.put(30, 30, 0x123456, 30, 1);
    expect(world.alpha(30, 30)).toBe(0);
    expect(stage.fg.alpha(30, 30)).toBe(255);
    stage.put(20, 30, 0x123456, 30, 1);
    expect(world.get(20, 30)).toBe(0x123456);
    expect(stage.fg.alpha(20, 30)).toBe(0);
  });

  it('keeps a boulder, top included, inside its own collision disc', () => {
    const masks = syntheticMasks();
    const world = Canvas.world(masks.w, masks.h);
    const stage = new Stage(masks, world);
    raiseBoulder(stage, { id: 'r', kind: 'rock', x: 20, y: 30, radius: 8 }, 0, 7);
    stage.resolveShadows(lookFor(getWeatherPreset('desert_clear')!).drop);
    stage.drawMasses(() => 0xaa5533);
    let inside = 0;
    for (let y = 0; y < masks.h; y++)
      for (let x = 0; x < masks.w; x++) {
        const p = y * masks.w + x;
        if (stage.raised[p]) {
          expect(masks.reach[p]).toBe(0);
          inside++;
        }
        expect(stage.fg.alpha(x, y)).toBe(0);
      }
    expect(inside).toBeGreaterThan(60);
    for (let p = 0; p < masks.w * masks.h; p++) if (stage.mat[p] === M_BOULDER) expect(masks.solid[p]).toBe(2);
  });

  it('never lets a fitted column lean over reachable ground', () => {
    const masks = syntheticMasks();
    for (let y = 22; y <= 38; y++)
      for (let x = 12; x <= 28; x++) {
        const r = fitRise(masks, x, y, 40);
        for (let v = 1; v <= r; v++) expect(masks.reach[(y - v) * masks.w + x + Math.floor(v / 3)]).toBe(0);
      }
    // Behind the boundary band nothing is reachable: a column at the band can rise to the top.
    expect(fitRise(masks, 10, 5, 40)).toBe(5);
  });
});

describe.runIf(process.env.BOLT_TERRAIN_REBAKE === '1')('desert re-bake', () => {
  it.each(COURSES)(
    '%s / %s bakes byte-identically with nothing raised over drivable ground',
    async (trackId, presetId) => {
      const { mkdtempSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { bakeTerrainWithReport } = await import('../../art/scripts/terrain/index.js');
      const out = mkdtempSync(join(tmpdir(), 'desert-rebake-'));
      try {
        const report = bakeTerrainWithReport({ def: getTrack(trackId)!, presetId, outDir: out });
        expect(report.checks.coveredDrivable).toBe(0);
        expect(report.checks.animatedMismatch).toBe(0);
        const dir = join(MAPS, trackId, presetId);
        for (const name of readdirSync(dir)) expect(readFileSync(join(out, name)).equals(readFileSync(join(dir, name)))).toBe(true);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    900_000,
  );
});

