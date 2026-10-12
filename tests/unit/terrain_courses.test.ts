import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TRACKS, getWeatherPreset } from '@bolt/content';
import { SIM_DT, buildTrack, hazardActive } from '@bolt/shared';
import type { TerrainManifest } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  BODY_HALF,
  BODY_UP,
  FADE_MARGIN,
  FADE_OWN,
  coverageFromAlpha,
  overlayTarget,
  underOverlay,
} from '../../apps/web/src/game/weather/overlayFade.js';
import { isTimetableLoop, timetableFrame } from '../../apps/web/src/game/weather/terrainArt.js';
import { timetableStates } from '../../art/scripts/terrain/city/timetable.js';

/**
 * Every launch course (eight tracks, two weathers each) from what ships: the map index the
 * client reads lists exactly these sixteen, each bake's self-checks were run on exactly the
 * shipped bytes and passed, its files are the ones its manifest names, it fits the per-course
 * download budget (docs/TRACK_API.md, "Download sizes"), and its loops and overlays are what
 * the client can draw. The biome tests (`terrain_urban`, `terrain_desert`, `terrain_nature`)
 * look at the pictures; the client's two terrain rules (the overlay fade by pixels, timetable
 * loops from the race clock) are checked here.
 */

const ROOT = resolve('.');
const MAPS = join(ROOT, 'apps/web/public/assets/maps');
const ATLASES = join(ROOT, 'apps/web/public/assets/atlases');
const COURSES: Array<[string, string]> = Object.values(TRACKS).flatMap((def) =>
  def.weatherPresetIds.map((p): [string, string] => [def.id, p]),
);
/** One course's terrain, everything a race downloads for it (the largest is about 2.3 MB). */
export const COURSE_BUDGET = 2.5 * 1024 * 1024;
/** A first race's images: the course, every car sheet and the effect atlases. */
const FIRST_RACE_IMAGES = 4.5 * 1024 * 1024;

const digest = (dir: string): string => {
  const h = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    h.update(name);
    h.update(readFileSync(join(dir, name)));
  }
  return h.digest('hex');
};
const folderBytes = (dir: string): number =>
  readdirSync(dir).reduce((n, name) => n + statSync(join(dir, name)).size, 0);

describe('the map index', () => {
  it('lists all sixteen launch courses, each once, and nothing else', () => {
    const index = JSON.parse(readFileSync(join(MAPS, 'index.json'), 'utf8')) as {
      version: number;
      maps: Array<{ trackId: string; presetId: string }>;
    };
    expect(index.version).toBe(1);
    expect(COURSES).toHaveLength(16);
    expect(index.maps.map((m) => `${m.trackId}/${m.presetId}`).sort()).toEqual(
      COURSES.map(([t, p]) => `${t}/${p}`).sort(),
    );
  });
});

describe.each(COURSES)('course %s / %s', (trackId, presetId) => {
  const dir = join(MAPS, trackId, presetId);
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as TerrainManifest;
  const def = TRACKS[trackId as keyof typeof TRACKS]!;

  it('is a bake of this track and weather', () => {
    expect(m.version).toBe(1);
    expect([m.trackId, m.presetId]).toEqual([trackId, presetId]);
    expect(getWeatherPreset(presetId)).toBeDefined();
    expect([m.worldWidth, m.worldHeight]).toEqual([def.worldWidth, def.worldHeight]);
    expect(m.ground).toHaveLength(m.cols * m.rows);
  });

  it('passed its own self-checks on exactly the shipped bytes', () => {
    const file = join(ROOT, 'art/manifests', `${trackId}_${presetId}.checks.json`);
    expect(existsSync(file)).toBe(true);
    const rec = JSON.parse(readFileSync(file, 'utf8')) as {
      sha256: string;
      bytes: number;
      checks: { coveredDrivable: number; animatedMismatch: number };
    };
    expect(rec.sha256).toBe(digest(dir));
    expect(rec.bytes).toBe(folderBytes(dir));
    expect(rec.checks).toEqual({ coveredDrivable: 0, animatedMismatch: 0 });
    // The art-side copy of the manifest is the shipped one.
    expect(
      JSON.parse(readFileSync(join(ROOT, 'art/manifests', `${trackId}_${presetId}.json`), 'utf8')),
    ).toEqual(m);
  });

  it('ships exactly the files its manifest names', () => {
    const named = new Set<string>(['manifest.json', m.minimap.file]);
    for (const f of [...m.ground, ...m.overlays, ...m.animated]) named.add(f.file);
    expect(readdirSync(dir).sort()).toEqual([...named].sort());
  });

  it('fits the per-course download budget, and a first race fits with it', () => {
    const bytes = folderBytes(dir);
    expect(bytes).toBeLessThan(COURSE_BUDGET);
    let first = bytes;
    for (const atlas of readdirSync(ATLASES)) first += folderBytes(join(ATLASES, atlas));
    expect(first).toBeLessThan(FIRST_RACE_IMAGES);
  });

  it('draws what the client can draw: textures within mobile limits, three ambient loops', () => {
    for (const o of m.overlays) {
      expect(Math.max(o.w, o.h)).toBeLessThanOrEqual(2048);
      expect(o.x >= 0 && o.y >= 0 && o.x + o.w <= m.worldWidth && o.y + o.h <= m.worldHeight).toBe(
        true,
      );
    }
    for (const a of m.animated) {
      expect(a.frameCount).toBeGreaterThan(0);
      expect(a.fps).toBeGreaterThan(0);
    }
    // Section 12.10: three ambient looping animations a track (timed hazards are not ambience).
    expect(m.animated.filter((a) => !isTimetableLoop(a)).length).toBeGreaterThanOrEqual(3);
    // Section 12.10: four landmarks, named in the data and realized by the art.
    expect(def.landmarks.length).toBeGreaterThanOrEqual(4);
    // Anything a car can pass under fades (Section 9.1).
    expect(m.overlays.some((o) => o.fadeNearPlayer)).toBe(true);
  });

  it('times every timed hazard loop from the race clock, as the physics does', () => {
    const track = buildTrack(def);
    for (const h of track.hazards) {
      if (!('schedule' in h)) continue;
      const loops = m.animated.filter((a) => a.kind === `timetable:${h.id}`);
      expect(loops.length, h.id).toBeGreaterThan(0);
      for (const a of loops) {
        const states = timetableStates(h.schedule, a.fps);
        expect(states).toHaveLength(a.frameCount);
        // Two periods of race ticks: the frame the client shows is closed whenever the
        // physics is active, and the race starts on frame 0.
        expect(timetableFrame(a, 0)).toBe(0);
        const ticks = Math.ceil((2 * h.schedule.periodSeconds) / SIM_DT);
        for (let tick = 0; tick < ticks; tick++) {
          const frame = timetableFrame(a, tick * SIM_DT);
          if (hazardActive(h, tick))
            expect(states[frame]!.touchesActive, `${h.id} tick ${tick}`).toBe(true);
        }
      }
    }
  });
});

describe('the overlay fade, by pixels', () => {
  // An L-shaped overlay 96 x 96 at (1000, 1000): its left column and its bottom row are opaque.
  const def = {
    id: 'l',
    kind: 'test',
    file: 'l.png',
    x: 1000,
    y: 1000,
    w: 96,
    h: 96,
    fadeNearPlayer: true,
  };
  const opaque = (x: number, y: number): number => (x < 16 || y >= 80 ? 255 : 0);
  const coverage = coverageFromAlpha(opaque, 96, 96);
  const none = { present: false, x: 0, y: 0 };

  it('fades under the car where the overlay has pixels', () => {
    expect(underOverlay(def, { present: true, x: 1008, y: 1040 }, coverage)).toBe(true);
    expect(overlayTarget(def, { present: true, x: 1060, y: 1090 }, none, () => coverage)).toBe(
      FADE_OWN,
    );
  });

  it('does not fade for a car beside the empty part of its box', () => {
    // Within the box test (the car's body box reaches the overlay's box) but over its clear
    // corner: no pixel of the overlay is within the body box plus its margin.
    const reach = BODY_HALF + FADE_MARGIN;
    const car = { present: true, x: 1000 + 16 + reach + 4, y: 1000 - BODY_HALF - FADE_MARGIN + 6 };
    expect(underOverlay(def, car)).toBe(true);
    expect(underOverlay(def, car, coverage)).toBe(false);
    expect(overlayTarget(def, car, none, () => coverage)).toBe(1);
    // Reaching up the screen from below, the body's taller side counts.
    const below = { present: true, x: 1060, y: 1096 + BODY_UP + FADE_MARGIN - 2 };
    expect(underOverlay(def, below, coverage)).toBe(true);
  });

  it('asks for the coverage only when a car is near the box', () => {
    let asked = 0;
    const far = { present: true, x: 3000, y: 3000 };
    overlayTarget(def, far, none, () => {
      asked++;
      return coverage;
    });
    expect(asked).toBe(0);
  });
});
