import { resolve } from 'node:path';
import { TRACKS, WEATHER_PRESETS, getWeatherPreset } from '@bolt/content';
import type { TerrainOverlay } from '@bolt/shared';
import { WEATHER_LAYERS, hazardState, weatherFrameRect } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  WEATHER_ANIMS,
  WL_ADDITIVE,
  WL_COUNT,
  WL_AIR,
  WL_NEAR,
  WL_OVER_CARS,
  WL_SCREEN,
} from '../../apps/web/src/game/weather/atlas.js';
import {
  FADE_OWN,
  FADE_RIVAL,
  easeOverlay,
  overlayTarget,
} from '../../apps/web/src/game/weather/overlayFade.js';
import {
  WEATHER_LAYER_IDS,
  courseList,
  planWeather,
} from '../../apps/web/src/game/weather/plan.js';
import { DRAW_CAPACITY, PARTICLE_CAP } from '../../apps/web/src/game/weather/pool.js';
import {
  AHEAD_MIN,
  OWN_RADIUS,
  RIVAL_RADIUS,
} from '../../apps/web/src/game/weather/readability.js';
import { readPng } from '../../art/scripts/lib/pixels.js';
import { buildWeatherVfx, packWeatherAtlas } from '../../art/scripts/vfx/weather.js';
import { weatherManifest, weatherRig } from '../helpers/weather.js';

/**
 * The weather and environment layer (Milestone D): the atlas, which layers each course gets,
 * the fixed stores, determinism of the cosmetic seeds, the readability guard, lightning
 * limits, the overlay fade, and what a frame costs.
 */

const atlasImage = readPng(
  resolve('apps/web/public/assets/atlases/vfx_weather', weatherManifest.file),
);
const COURSES = courseList(Object.values(TRACKS));
const anims = Object.values(weatherManifest.anims);
/** Global frame index to [animation, frame]: the order the view registers frames in. */
const frameOwner: Array<[number, number]> = [];
anims.forEach((anim, a) => {
  for (let i = 0; i < anim.frames; i++) frameOwner.push([a, i]);
});

describe('weather atlas', () => {
  it('is what the pipeline bakes, byte for byte', () => {
    const { image, manifest } = packWeatherAtlas(buildWeatherVfx());
    expect(manifest).toEqual(weatherManifest);
    expect(image.width).toBe(atlasImage.width);
    expect(image.height).toBe(atlasImage.height);
    expect(Buffer.from(image.data).equals(Buffer.from(atlasImage.data))).toBe(true);
  });

  it('names exactly the strips the runtime uses, and keeps every frame inside the sheet', () => {
    expect(new Set(Object.keys(weatherManifest.anims))).toEqual(new Set(WEATHER_ANIMS));
    for (const anim of anims) {
      for (let f = 0; f < anim.frames; f++) {
        const r = weatherFrameRect(anim, f, weatherManifest.padding);
        expect(r.x + r.w, anim.id).toBeLessThanOrEqual(weatherManifest.width);
        expect(r.y + r.h, anim.id).toBeLessThanOrEqual(weatherManifest.height);
      }
      expect(WEATHER_LAYERS).toContain(anim.layer);
    }
    expect(weatherManifest.padding).toBeGreaterThanOrEqual(2);
  });

  it('bakes every animation for the blend of its layer', () => {
    for (const anim of anims) {
      const layer = WEATHER_LAYERS.indexOf(anim.layer);
      expect(anim.blend === 'add', anim.id).toBe(WL_ADDITIVE[layer]);
    }
  });

  it('stays indexed and small', () => {
    const colors = new Set<number>();
    const d = atlasImage.data;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 3]! > 0)
        colors.add((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!);
    expect(colors.size).toBeLessThan(256);
  });
});

describe('weather layers per course', () => {
  it('gives every one of the sixteen courses a defined set of layers', () => {
    expect(COURSES).toHaveLength(16);
    for (const [def, presetId] of COURSES) {
      const preset = getWeatherPreset(presetId)!;
      const plan = planWeather(preset, def);
      expect(plan.layers.size, `${def.id}/${presetId}`).toBeGreaterThan(0);
      expect(plan.layers.has('surface_particles')).toBe(true);
      for (const id of plan.layers) expect(WEATHER_LAYER_IDS).toContain(id);
    }
  });

  it('every preset has its weather', () => {
    for (const preset of Object.values(WEATHER_PRESETS)) {
      const def = COURSES.find(([, p]) => p === preset.id)![0];
      const plan = planWeather(preset, def);
      const has = (id: string) => plan.layers.has(id as never);
      const label = preset.id;
      if (preset.weather === 'rain' || preset.weather === 'heavy_rain') {
        for (const id of ['rain', 'splashes', 'spray', 'wet_tracks', 'reflections'])
          expect(has(id), `${label} ${id}`).toBe(true);
        expect(plan.planes.map((p) => p.id).filter((id) => id.startsWith('rain'))).toEqual([
          'rain_far',
          'rain_mid',
          'rain_near',
        ]);
      } else expect(has('rain'), label).toBe(false);
      expect(has('lightning'), label).toBe(preset.weather === 'heavy_rain');
      if (preset.weather === 'snowfall') {
        expect(has('snow') && has('frost_vignette') && has('snow_tracks'), label).toBe(true);
        expect(plan.planes.map((p) => p.id).filter((id) => id.startsWith('snow'))).toEqual([
          'snow_far',
          'snow_mid',
          'snow_near',
        ]);
      }
      if (preset.weather === 'clear_frost')
        expect(has('ice_glints') && has('frost_vignette') && has('diamond_dust'), label).toBe(true);
      if (preset.weather === 'sandstorm')
        expect(has('sand_streaks') && has('dust_bands') && has('grit'), label).toBe(true);
      if (preset.id === 'desert_crosswind')
        expect(has('sand_streaks') && has('tumbleweeds')).toBe(true);
      if (preset.weather === 'dry_heat') expect(has('heat_haze'), label).toBe(true);
      if (def.biome === 'forest') expect(has('leaves'), label).toBe(true);
      if (preset.id === 'forest_clear') expect(has('light_shafts'), label).toBe(true);
      if (preset.id === 'industrial_dry_night' || preset.id === 'industrial_factory_rain')
        expect(has('steam_vents') && has('smelter_sparks') && has('embers'), label).toBe(true);
      // The sim's visibility modifier is shown wherever it is below clear.
      expect(has('visibility_haze'), label).toBe(preset.visibility < 0.97);
      if (plan.haze) expect(plan.haze.maxAlpha).toBeLessThanOrEqual(0.48);
    }
  });

  it('uses every layer on some course, except fireflies, which wait for a dusk or night forest', () => {
    const used = new Set<string>();
    for (const [def, presetId] of COURSES)
      for (const id of planWeather(getWeatherPreset(presetId)!, def).layers) used.add(id);
    expect(WEATHER_LAYER_IDS.filter((id) => !used.has(id))).toEqual(['fireflies']);
  });

  it('draws something moving on every course with weather, and runs every course clean', () => {
    for (const [def, presetId] of COURSES) {
      const rig = weatherRig(def.id, presetId);
      let peak = 0;
      for (let f = 0; f < 240; f++) {
        rig.step();
        peak = Math.max(peak, rig.weather.list.total());
      }
      // Dry city and the dry factory are quiet away from their anchors (vents, the smelter).
      const quiet = ['city_clear_night', 'city_clear_day', 'industrial_dry_night'].includes(
        presetId,
      );
      if (!quiet) expect(peak, `${def.id}/${presetId}`).toBeGreaterThan(10);
      expect(rig.weather.list.dropped, `${def.id}/${presetId}`).toBe(0);
    }
  });
});

describe('weather stores', () => {
  it.each([false, true])(
    'holds every cap with both cars spraying in a downpour (low tier %s)',
    (low) => {
      const rig = weatherRig('forest_02', 'forest_heavy_rain', { low, stress: true, speed: 290 });
      let peakSprites = 0;
      for (let f = 0; f < 1200; f++) {
        rig.step();
        peakSprites = Math.max(peakSprites, rig.weather.list.total());
        if (f > 120)
          for (let l = 0; l < WL_COUNT; l++) {
            expect(rig.weather.pool.live[l]!).toBeLessThanOrEqual(
              PARTICLE_CAP[l]! * (low ? 0.5 : 1),
            );
            expect(rig.weather.list.count[l]!).toBeLessThanOrEqual(DRAW_CAPACITY[l]!);
          }
      }
      for (let l = 0; l < WL_COUNT; l++)
        expect(rig.weather.pool.peak[l]!).toBeLessThanOrEqual(PARTICLE_CAP[l]!);
      expect(rig.weather.list.dropped).toBe(0);
      // The low tier really thins: fewer sprites than high at the same moment.
      if (!low) expect(peakSprites).toBeGreaterThan(450);
      else expect(peakSprites).toBeLessThan(560);
    },
  );

  it('fits the widest camera step without dropping a sprite', () => {
    for (const [track, preset] of [
      ['snow_01', 'snow_snowfall'],
      ['forest_02', 'forest_heavy_rain'],
      ['desert_02', 'desert_sandstorm'],
    ] as const) {
      const rig = weatherRig(track, preset);
      // `Far` on a phone at two device pixels: 1,740 world pixels across.
      rig.frame.viewW = 1740;
      rig.frame.viewH = 740;
      for (let f = 0; f < 240; f++) rig.step();
      expect(rig.weather.list.dropped, `${track}/${preset}`).toBe(0);
    }
  });

  it('the low tier and Reduced Motion draw fewer sprites than high', () => {
    const count = (opts: { low?: boolean; reducedMotion?: boolean }) => {
      const rig = weatherRig('desert_02', 'desert_sandstorm', opts);
      let sum = 0;
      for (let f = 0; f < 300; f++) {
        rig.step();
        if (f >= 200) sum += rig.weather.list.total();
      }
      return sum / 100;
    };
    const high = count({});
    expect(count({ low: true })).toBeLessThan(high * 0.75);
    expect(count({ reducedMotion: true })).toBeLessThan(high * 0.75);
  });

  it('does not allocate in steady state', () => {
    const rig = weatherRig('forest_02', 'forest_heavy_rain', { stress: true });
    for (let f = 0; f < 600; f++) rig.step();
    const floor = (frames: number) => {
      let low = Infinity;
      for (let f = 0; f < frames; f++) {
        rig.step();
        if (f % 20 === 0) low = Math.min(low, process.memoryUsage().heapUsed);
      }
      return low;
    };
    const before = floor(600);
    const after = floor(3000);
    expect(after - before).toBeLessThan(1_500_000);
  });

  it('costs little: the stage alone, heaviest weather, both cars spraying', () => {
    const rig = weatherRig('forest_02', 'forest_heavy_rain', { stress: true });
    for (let f = 0; f < 120; f++) rig.step();
    const started = performance.now();
    for (let f = 0; f < 900; f++) rig.step();
    const ms = (performance.now() - started) / 900;
    // A generous bound for a shared machine; the measured mean is in docs/VFX_GUIDE.md.
    expect(ms).toBeLessThan(4);
  });
});

describe('cosmetic seeds', () => {
  const snapshot = (rig: ReturnType<typeof weatherRig>) => {
    const l = rig.weather.list;
    const out: number[] = [];
    for (let layer = 0; layer < WL_COUNT; layer++)
      for (let k = 0; k < l.count[layer]!; k++) {
        const i = l.start[layer]! + k;
        out.push(layer, l.frame[i]!, l.x[i]!, l.y[i]!, l.alpha[i]!, l.tint[i]!);
      }
    return out;
  };

  it('the same course and frames give the same picture', () => {
    for (const [track, preset] of [
      ['forest_02', 'forest_heavy_rain'],
      ['desert_02', 'desert_sandstorm'],
      ['snow_01', 'snow_snowfall'],
      ['industrial_01', 'industrial_factory_rain'],
    ] as const) {
      const a = weatherRig(track, preset);
      const b = weatherRig(track, preset);
      for (let f = 0; f < 400; f++) {
        a.step();
        b.step();
        if (f % 50 === 49) expect(snapshot(a)).toEqual(snapshot(b));
      }
    }
  });

  it('raindrops and flakes are where the clock and the camera put them, at any frame rate', () => {
    for (const [track, preset] of [
      ['city_01', 'city_rain_night'],
      ['snow_01', 'snow_snowfall'],
    ] as const) {
      const a = weatherRig(track, preset);
      const b = weatherRig(track, preset);
      for (let f = 0; f < 240; f++) a.step(1 / 60);
      for (let f = 0; f < 120; f++) b.step(1 / 30);
      const near = (rig: typeof a) => {
        const l = rig.weather.list;
        const out: number[] = [];
        for (let k = 0; k < l.count[WL_NEAR]!; k++) {
          const i = l.start[WL_NEAR]! + k;
          out.push(l.frame[i]!, l.x[i]!, l.y[i]!);
        }
        return out;
      };
      expect(near(a).length).toBeGreaterThan(20);
      expect(near(a)).toEqual(near(b));
    }
  });

  it('a different seed gives a different picture', () => {
    const a = weatherRig('city_01', 'city_rain_night', { seed: 1 });
    const b = weatherRig('city_01', 'city_rain_night', { seed: 2 });
    for (let f = 0; f < 60; f++) {
      a.step();
      b.step();
    }
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });
});

/** Composites the sprites of the given layers over the view, as alpha (software, no Phaser). */
function coverage(
  rig: ReturnType<typeof weatherRig>,
  layers: (l: number) => boolean,
): Float32Array {
  const { viewX, viewY, viewW, viewH } = rig.frame;
  const w = Math.ceil(viewW);
  const h = Math.ceil(viewH);
  const cov = new Float32Array(w * h);
  const l = rig.weather.list;
  for (let layer = 0; layer < WL_COUNT; layer++) {
    if (!layers(layer)) continue;
    for (let k = 0; k < l.count[layer]!; k++) {
      const i = l.start[layer]! + k;
      const [a, f] = frameOwner[l.frame[i]!]!;
      const anim = anims[a]!;
      const r = weatherFrameRect(anim, f, weatherManifest.padding);
      const ox = Math.round(l.x[i]! - viewX);
      const oy = Math.round(l.y[i]! - viewY);
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const px = ox + x;
          const py = oy + y;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const src = atlasImage.alphaAt(r.x + x, r.y + y) / 255;
          if (src === 0) continue;
          const alpha = src * l.alpha[i]!;
          const at = py * w + px;
          cov[at] = 1 - (1 - cov[at]!) * (1 - alpha);
        }
    }
  }
  return cov;
}

describe('readability guard', () => {
  // Every course whose weather lays anything over the picture: all but the three dry,
  // windless ones (Neon Cut's clear night, Backstreet Blitz's golden hour, Steel Circuit's dry
  // night), which draw only what the wheels throw up.
  const QUIET = ['city_clear_night', 'city_clear_day', 'industrial_dry_night'];
  const HEAVY = COURSES.filter(([, p]) => !QUIET.includes(p)).map(
    ([def, p]) => [def.id, p] as const,
  );

  it.each(HEAVY)(
    '%s %s: no haze or frost round the car, ahead of it or round the rival',
    (track, preset) => {
      for (const gap of [70, 260]) {
        const rig = weatherRig(track, preset, { gap });
        for (let f = 0; f < 300; f++) rig.step();
        for (let sample = 0; sample < 4; sample++) {
          for (let f = 0; f < 37; f++) rig.step();
          const cov = coverage(rig, (l) => l === WL_SCREEN);
          const w = Math.ceil(rig.frame.viewW);
          const zone = rig.weather.zone;
          let inside = 0;
          let worst = 0;
          for (let y = 0; y < rig.frame.viewH; y += 2)
            for (let x = 0; x < w; x += 2) {
              if (!zone.contains(rig.frame.viewX + x, rig.frame.viewY + y)) continue;
              inside++;
              worst = Math.max(worst, cov[y * w + x]!);
            }
          expect(inside).toBeGreaterThan(1000);
          expect(worst, `${track}/${preset}`).toBeLessThan(0.02);
        }
      }
    },
  );

  it.each(HEAVY)(
    '%s %s: the layers over the cars cover little of the car and the road ahead',
    (track, preset) => {
      const rig = weatherRig(track, preset);
      for (let f = 0; f < 300; f++) rig.step();
      let sum = 0;
      let n = 0;
      for (let sample = 0; sample < 6; sample++) {
        for (let f = 0; f < 23; f++) rig.step();
        const cov = coverage(rig, (l) => WL_OVER_CARS[l]!);
        const w = Math.ceil(rig.frame.viewW);
        const own = rig.combat.cars[0]!;
        const sp = Math.hypot(own.vx, own.vy);
        for (let y = 0; y < rig.frame.viewH; y++)
          for (let x = 0; x < w; x++) {
            const wx = rig.frame.viewX + x - own.x;
            const wy = rig.frame.viewY + y - own.y;
            const along = (wx * own.vx + wy * own.vy) / sp;
            const across = Math.abs((wx * own.vy - wy * own.vx) / sp);
            const onCar = Math.hypot(wx, wy) < 40;
            const ahead = along > 0 && along < AHEAD_MIN * 2 && across < 40;
            if (!onCar && !ahead) continue;
            sum += cov[y * w + x]!;
            n++;
          }
      }
      // Rain, sand and snow over the cars are thin streaks and flakes: a few percent at most.
      expect(sum / n, `${track}/${preset}`).toBeLessThan(0.08);
    },
  );

  it('the zone covers the car, a second of road ahead and the rival', () => {
    const rig = weatherRig('desert_02', 'desert_sandstorm', { gap: 200 });
    rig.step();
    const zone = rig.weather.zone;
    const own = rig.combat.cars[0]!;
    const rival = rig.combat.cars[1]!;
    expect(zone.contains(own.x + OWN_RADIUS - 2, own.y)).toBe(true);
    expect(zone.contains(rival.x, rival.y + RIVAL_RADIUS - 2)).toBe(true);
    const sp = Math.hypot(own.vx, own.vy);
    expect(zone.contains(own.x + (own.vx / sp) * 280, own.y + (own.vy / sp) * 280)).toBe(true);
  });
});

describe('steam vents', () => {
  it('follow the hazard timetable: a wisp when quiet, growing puffs in the warning, the blast', () => {
    const rig = weatherRig('industrial_01', 'industrial_dry_night', { speed: 0 });
    const track = rig.track;
    const index = track.hazards.findIndex((h) => h.kind === 'steam_vent');
    const vent = track.hazards[index]!;
    expect(vent.kind).toBe('steam_vent');
    const shape = vent.kind === 'steam_vent' ? vent.shape : null;
    const cx = shape && shape.type === 'circle' ? shape.x : 0;
    const cy = shape && shape.type === 'circle' ? shape.y : 0;
    const byPhase: Record<string, number[]> = { idle: [], warning: [], active: [] };
    for (let f = 0; f < 60 * 12; f++) {
      rig.step();
      // Hold the view on the vent; the cars are elsewhere.
      rig.frame.viewX = Math.round(cx - 435);
      rig.frame.viewY = Math.round(cy - 185);
      rig.weather.frame(rig.frame, rig.combat.cars, null);
      const phase = hazardState(vent, rig.frame.clockTicks).phase;
      // Steam over this vent: rising from its grate, not the other vent's.
      const pool = rig.weather.pool;
      let n = 0;
      for (let i = pool.layerStart[WL_AIR]!; i < pool.layerEnd[WL_AIR]!; i++)
        if (
          pool.active[i] &&
          Math.abs(pool.x[i]! - cx) < 50 &&
          pool.y[i]! > cy - 60 &&
          pool.y[i]! < cy + 30
        )
          n++;
      byPhase[phase]!.push(n);
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    expect(mean(byPhase.idle!)).toBeGreaterThan(0);
    expect(mean(byPhase.warning!)).toBeGreaterThan(mean(byPhase.idle!) * 2);
    expect(mean(byPhase.active!)).toBeGreaterThan(mean(byPhase.warning!));
  });
});

/** Only the clock matters to lightning: a tiny view and no cars keep these runs quick. */
function skyStep(rig: ReturnType<typeof weatherRig>): void {
  rig.frame.clockTicks += 0.5;
  rig.weather.frame({ ...rig.frame, dt: 1 / 60, viewW: 16, viewH: 16 }, [], null);
}

describe('lightning', () => {
  it('flashes in a heavy storm no more than once every 20 seconds, never white', () => {
    const rig = weatherRig('forest_02', 'forest_heavy_rain');
    let last = -1e9;
    let flashes = 0;
    let was = false;
    for (let f = 0; f < 60 * 300; f++) {
      skyStep(rig);
      const w = rig.weather;
      expect(w.flash).toBeLessThanOrEqual(0.16);
      if (w.flash > 0 && !was) {
        if (w.lastFlashAt !== last) {
          expect(w.lastFlashAt - last).toBeGreaterThanOrEqual(20);
          last = w.lastFlashAt;
          flashes++;
        }
      }
      was = w.flash > 0;
    }
    expect(flashes).toBeGreaterThanOrEqual(6);
    expect(flashes).toBeLessThanOrEqual(15);
    expect(rig.weather.flashTint).not.toBe(0xffffff);
  });

  it('never flashes with Reduce Flashes, with Reduced Motion, or in any other weather', () => {
    const cases = [
      weatherRig('forest_02', 'forest_heavy_rain'),
      weatherRig('forest_02', 'forest_heavy_rain', { reducedMotion: true }),
      weatherRig('city_01', 'city_rain_night'),
    ];
    cases[0]!.frame.reduceFlashes = true;
    for (const rig of cases) {
      for (let f = 0; f < 60 * 90; f++) {
        skyStep(rig);
        expect(rig.weather.flash).toBe(0);
      }
      expect(rig.weather.flashes).toBe(0);
    }
  });
});

describe('foreground fade', () => {
  const overlay = (kind: string, fade = true): TerrainOverlay => ({
    id: kind,
    kind,
    file: '',
    x: 1000,
    y: 1000,
    w: 300,
    h: 160,
    fadeNearPlayer: fade,
  });

  it('fades every marked overlay kind under the local car, and less under the rival', () => {
    for (const kind of [
      'tree_canopy',
      'canopy',
      'cliff_ledge',
      'bridge',
      'sign_bridge',
      'gantry',
    ]) {
      const o = overlay(kind);
      expect(
        overlayTarget(o, { present: true, x: 1150, y: 1080 }, { present: false, x: 0, y: 0 }),
      ).toBe(FADE_OWN);
      // The car's body reaches above its origin: just below the overlay still counts.
      expect(
        overlayTarget(o, { present: true, x: 1150, y: 1180 }, { present: false, x: 0, y: 0 }),
      ).toBe(FADE_OWN);
      expect(
        overlayTarget(o, { present: true, x: 600, y: 600 }, { present: true, x: 1100, y: 1050 }),
      ).toBe(FADE_RIVAL);
      expect(
        overlayTarget(o, { present: true, x: 600, y: 600 }, { present: true, x: 1900, y: 600 }),
      ).toBe(1);
    }
    expect(
      overlayTarget(
        overlay('tower_top', false),
        { present: true, x: 1150, y: 1080 },
        { present: false, x: 0, y: 0 },
      ),
    ).toBe(1);
  });

  it('eases and settles exactly on its target', () => {
    let a = 1;
    for (let f = 0; f < 60; f++) a = easeOverlay(a, FADE_OWN, 1 / 60);
    expect(a).toBe(FADE_OWN);
    for (let f = 0; f < 60; f++) a = easeOverlay(a, 1, 1 / 60);
    expect(a).toBe(1);
  });
});
