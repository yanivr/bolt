import type { AnimatedArt, BakeContext, BiomeModule, BiomeOutput } from '../biome.js';
import { createEnv } from './env.js';
import type { Env } from './env.js';
import { finish } from './finish.js';
import { paintForestFloor, paintShrubs, paintSunShafts } from './ground.js';
import type { FloorStyle } from './ground.js';
import { buildMossRun, paintMossRunWater } from './mossRun.js';
import { shadeDay } from './palette.js';
import { plantStats } from './place.js';
import { paintStart, placeCornerSigns, placeShortcutSign } from './props.js';
import { FOREST_ROAD, paintCorridor } from './road.js';
import { buildTimberDash, paintTimberDashGround } from './timberDash.js';
import { weatherLook } from './weather.js';

/**
 * The forest biome: Moss Run (forest_01) and Timber Dash (forest_02) under clear skies, rain
 * and heavy rain. Shared steps are here; each track's own art is in its module.
 */

type TrackArt = {
  floor: FloorStyle;
  shrubs: number;
  /** Before the floor: water and anything else the floor must leave alone. */
  before?: (env: Env) => void;
  /** After the road: everything that stands, and the loops. */
  build: (env: Env) => { loops: () => AnimatedArt[] };
};

const TRACKS: Record<string, () => TrackArt> = {
  forest_01: () => {
    let dist: Float32Array | null = null;
    return {
      floor: { litter: 0.3, ferns: 0.5 },
      shrubs: 0.55,
      before: (env) => {
        dist = paintMossRunWater(env).dist;
      },
      build: (env) => buildMossRun(env, dist!),
    };
  },
  forest_02: () => ({
    floor: { litter: 0.6, ferns: 0.65 },
    shrubs: 0.45,
    before: (env) => paintTimberDashGround(env),
    build: (env) => buildTimberDash(env),
  }),
};

export function paintForest(ctx: BakeContext): BiomeOutput {
  const make = TRACKS[ctx.def.id];
  if (!make) throw new Error(`The forest module has no art for ${ctx.def.id}`);
  const art = make();
  const look = weatherLook(ctx.presetId);
  const env = createEnv(ctx, look.shadowK);
  art.before?.(env);
  paintForestFloor(env, art.floor);
  env.log.push(`shrubs   ${paintShrubs(env, 6101, art.shrubs)}`);
  if (look.sunShafts > 0) paintSunShafts(env, 6201, look.sunShafts);
  paintCorridor(env, FOREST_ROAD, (i) => env.maps.hazard[i]! > 0);
  paintStart(env);
  const t0 = performance.now();
  const plan = art.build(env);
  env.log.push(`signs    ${placeCornerSigns(env)} corner boards`);
  for (const br of ctx.track.branches.slice(1)) {
    const sc = ctx.def.shortcuts.find((s) => s.id === br.id);
    placeShortcutSign(env, br, (sc?.signName ?? br.id).toUpperCase());
  }
  env.log.push(`scene    ${plantStats()}; built in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return finish(env, {
    grade: look.grade,
    roadShade: 0.7,
    loops: plan.loops,
    shade: (c, k) => shadeDay(c, k * look.shadowStrength),
  });
}

export const FOREST_BIOME: BiomeModule = {
  biome: 'forest',
  paint: paintForest,
  presets: ['forest_clear', 'forest_rain', 'forest_heavy_rain'],
};
