import { createLocation, hashString, locate } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext, BiomeModule, BiomeOutput } from '../biome.js';
import { accumulatePools, applyLight, applyShadows, castShadows } from '../lighting.js';
import type { LightPool } from '../lighting.js';
import { Scene } from '../oblique.js';
import { animatedMismatch, buildAnimated, placeSignals, planFeatureSigns } from './anim.js';
import { buildBuildings } from './buildings.js';
import { paintGround } from './ground.js';
import { paintLandmarks, planLandmarks } from './landmarks.js';
import { buildLayout } from './layout.js';
import type { Lot } from './layout.js';
import { buildOverlays } from './overlays.js';
import { litNight, shadeNight, shadeRoad, shadeRoadDeep } from './palette.js';
import { paintBarrier, paintRoad, placeChevrons, planRoad } from './road.js';
import { paintStreet } from './street.js';
import { WET_NIGHT, wetLoops, wetOverlays, wetPass } from './wet.js';
import { paintBackstreet } from './blitz/index.js';

/** Arc length range of Billboard Row on the main line. */
const BILLBOARD_ROW: readonly [number, number] = [4150, 5260];

/**
 * Night city painter, in three stages. First the flat ground: side streets, the road and its
 * paint. Then everything that stands on it is collected into a scene, which also knows where
 * shadows fall. The ground is shadowed and lit, and only then is the scene painted over it,
 * north to south, in the oblique view.
 */
export function paintCity(bake: BakeContext): BiomeOutput {
  // Every weather of a track shares one city plan: the seed of the track's first weather.
  // (For Neon Cut's clear night this is the bake's own seed, so that bake is unchanged.)
  const ctx: BakeContext = { ...bake, seed: citySeed(bake) };
  const { world, field } = ctx;
  const pools: LightPool[] = [];
  const lights: TerrainLight[] = [];
  const out = { pools, lights };
  const scene = new Scene(field, ctx.track.obstacles);

  const landmarks = planLandmarks(ctx, scene);
  const layout = buildLayout(ctx, scene, landmarks.reserves, landmarks.fixed);
  const plan = planRoad(ctx);

  // Flat ground and the things standing on it.
  paintGround(ctx, scene, layout, out);
  paintRoad(ctx, plan);
  paintBarrier(ctx, scene, layout, plan);
  paintLandmarks(ctx, scene, layout, landmarks.sites, out);
  // Billboard Row is the north side of the long top straight.
  const loc = createLocation();
  const onBillboardRow = (lot: Lot): boolean => {
    if (lot.roadDist > 60) return false;
    locate(ctx.track, lot.x + lot.w / 2, lot.y + lot.h / 2, loc);
    return (
      loc.branch === 0 && loc.s > BILLBOARD_ROW[0] && loc.s < BILLBOARD_ROW[1] && loc.lateral < 0
    );
  };
  const signs = planFeatureSigns(layout);
  buildBuildings(
    ctx,
    scene,
    layout,
    onBillboardRow,
    signs.map((s) => s.request),
    out,
  );
  paintStreet(ctx, scene, layout, plan, out);
  const chevrons = placeChevrons(ctx, scene, layout);
  const signals = placeSignals(ctx, scene, plan.zebras[3] ?? 7640);
  buildOverlays(ctx, scene, landmarks.sites, plan.hairpins);

  // Light the ground, then stand the scene on it.
  // Every mass is known now: cast the shadow volume and let the solids paint themselves.
  scene.resolve();
  const shadow = castShadows(field.w, field.h, scene.shadowH, 12, scene.forced);
  // Buildings shade the ground too. Shadow levels: 1 behind the barriers, 2 a building's
  // shadow across drivable ground (a gentle step), 3 the shadow of something standing over the
  // road (deeper, but never below the darkest pavement tone).
  const SHADOW_GROUND = 1;
  const SHADOW_ROAD = 2;
  const SHADOW_ROAD_DEEP = 3;
  for (let p = 0; p < field.w * field.h; p++) {
    if (scene.drive[p]) {
      if (shadow[p]) shadow[p] = SHADOW_ROAD_DEEP;
      else if (scene.shade[p]! > 0) shadow[p] = SHADOW_ROAD;
    } else if (scene.shade[p]! > 0) shadow[p] = SHADOW_GROUND;
  }
  // Contact line: the ground right against the foot of a west wall is always dark.
  for (let p = 0; p < field.w * field.h - 2; p++) {
    if (scene.height[p]! > 0 || scene.drive[p]) continue;
    if (scene.height[p + 1]! > 0 || scene.height[p + 2]! > 0) shadow[p] = SHADOW_GROUND;
  }
  applyShadows(world, shadow, [shadeNight, shadeRoad, shadeRoadDeep]);
  const planes = accumulatePools(field.w, field.h, pools);
  applyLight(world, planes, litNight);
  // Independent proof that nothing raised hides the road: remember the lit flat ground, paint
  // the scene, and count the drivable pixels that changed. Bookkeeping inside the scene is not
  // trusted for this; only the picture is.
  const flat = world.data.slice();
  scene.paint(world, planes, litNight);
  let covered = 0;
  let obstaclePixels = 0;
  for (let p = 0; p < field.w * field.h; p++) {
    if (field.edge[p]! > 0) continue;
    const i = p * 4;
    if (
      world.data[i] === flat[i] &&
      world.data[i + 1] === flat[i + 1] &&
      world.data[i + 2] === flat[i + 2]
    )
      continue;
    // The alley bollards are solid obstacles; their art sits inside their own collision disc.
    if (scene.drive[p]) covered++;
    else obstaclePixels++;
  }

  const animated = buildAnimated(landmarks.sites, signs, signals);
  const overlays = scene.overlays();
  if (ctx.preset.wetness > 0) {
    const wet = wetPass({
      world,
      field,
      drive: scene.drive,
      raised: scene.raised,
      lights,
      seed: bake.seed,
      style: WET_NIGHT,
    });
    wetLoops(WET_NIGHT, world, animated);
    wetOverlays(WET_NIGHT, overlays);
    console.log(
      `  wet      ${wet.puddlePixels} px of puddles, ${wet.reflectedPixels} px of reflections`,
    );
  }
  const checks = {
    coveredDrivable: Math.max(covered, scene.violations()),
    animatedMismatch: animatedMismatch(world, animated),
  };
  console.log(
    `  scene    ${chevrons} chevron boards; ${obstaclePixels} px of obstacle art inside obstacle collision discs`,
  );

  return {
    overlays,
    animated,
    lights,
    checks,
    previewSpots: [
      { name: 'start_line', x: 1900, y: 2341 },
      { name: 'first_sweeper', x: 640, y: 2190 },
      { name: 'clock_tower_kink', x: 620, y: 1315 },
      { name: 'arcade_sweeper', x: 720, y: 680 },
      { name: 'top_straight', x: 1500, y: 440 },
      { name: 'hairpin_one', x: 2240, y: 575 },
      { name: 'alley_entrance', x: 1790, y: 800 },
      { name: 'hairpin_two', x: 1600, y: 825 },
      { name: 'tram_viaduct', x: 3145, y: 1560 },
      { name: 'harbor_bend', x: 2960, y: 2200 },
      { name: 'harbor_cranes', x: 1750, y: 2600 },
      { name: 'market_street', x: 2560, y: 900 },
      { name: 'neon_tower', x: 2000, y: 826 },
      { name: 'harbor_ship', x: 2380, y: 2560 },
    ],
    previewPlain: ['start_line', 'tram_viaduct', 'alley_entrance'],
    previewCars: [
      { name: 'start_line', x: 1930, y: 2341, car: { x: 1990, y: 2372, heading: 48 } },
      { name: 'hairpin_one', x: 2180, y: 575, car: { x: 2290, y: 520, heading: 20 } },
      { name: 'alley', x: 1790, y: 826 },
      { name: 'west_avenue', x: 520, y: 1560, car: { x: 474, y: 1610, heading: 1 } },
      { name: 'clock_tower_kink', x: 620, y: 1315 },
      { name: 'market_street', x: 2560, y: 900 },
      { name: 'arcade_sweeper', x: 720, y: 680 },
      { name: 'harbor', x: 1750, y: 2560 },
      { name: 'dense_block', x: 2000, y: 1500 },
      { name: 'east_blocks', x: 2700, y: 1250 },
    ],
  };
}

/** Seed of a track's city plan: the one its first weather is baked with. */
export function citySeed(ctx: BakeContext): number {
  return hashString(`${ctx.def.id}:${ctx.def.weatherPresetIds[0] ?? ctx.presetId}`);
}

/**
 * The city biome module. Neon Cut's painter places Neon Cut's landmarks by name (`def.props`)
 * and paints its clear and rainy nights; Backstreet Blitz has its own painter (`blitz/`) for
 * its golden-hour clear and its rain (docs/art/tracks/).
 */
export const CITY_BIOME: BiomeModule = {
  biome: 'city',
  // Backstreet Blitz has its own plan, landmarks and look; Neon Cut is the original painter.
  paint: (ctx) => (ctx.def.id === 'city_02' ? paintBackstreet(ctx, citySeed(ctx)) : paintCity(ctx)),
  presets: ['city_clear_night', 'city_rain_night', 'city_clear_day', 'city_rain_day'],
};
