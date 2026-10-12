import { sampleBranch } from '@bolt/shared';
import type { HazardSchedule, TerrainLight } from '@bolt/shared';
import type { AnimatedArt, BakeContext, BiomeOutput } from '../../biome.js';
import { Canvas } from '../../canvas.js';
import { accumulatePools, applyLight, applyShadows, castShadows } from '../../lighting.js';
import type { LightPool } from '../../lighting.js';
import { Scene } from '../../oblique.js';
import { buildBuildings } from '../buildings.js';
import type { SignRequest } from '../buildings.js';
import { paintGround } from '../ground.js';
import { buildLayout } from '../layout.js';
import type { LayoutOptions } from '../layout.js';
import { drawNeonSign, neonSignSize } from '../neon.js';
import type { NeonSignSpec } from '../neon.js';
import { TINT_WARM, withCityStyle } from '../palette.js';
import { paintBarrier } from '../road.js';
import { paintStreet } from '../street.js';
import { loopMismatch } from '../timetable.js';
import { wetLoops, wetOverlays, wetPass } from '../wet.js';
import {
  boulevardLamps,
  cafeAwning,
  laundryLines,
  lotNear,
  marketHoarding,
  placeCornerSigns,
  placeShortcutBoards,
  startBanner,
  trafficLight,
  trafficLoop,
} from './dressing.js';
import {
  bakeBoomUp,
  barricadeBlinkers,
  crossingLoop,
  paintBarricades,
  paintCrossingPosts,
  paintObstacles,
  wallDiscs,
} from './hazards.js';
import type { Crossing } from './hazards.js';
import {
  paintClockTower,
  paintGate,
  paintSilos,
  paintSquare,
  paintTram,
  paintTramBed,
  planBlitz,
} from './landmarks.js';
import { cobbleTone, paintBlitzRoad, planBlitzRoad } from './road.js';
import {
  GOLDEN,
  OVERCAST,
  WET_DAY,
  goldenShadeDeep,
  goldenShadeGround,
  goldenShadeRoad,
  litGolden,
  litOvercast,
  overcastShadeDeep,
  overcastShadeGround,
  overcastShadeRoad,
} from './style.js';

/**
 * Backstreet Blitz (city_02): the old downtown next to Neon Cut, at golden hour or in rain
 * (docs/art/tracks/city_02.md). It runs the city biome's machinery with its own style, plan,
 * road, landmarks and hazard art.
 */

/** Older and denser than Neon Cut: narrow side streets, small lots, almost no towers. */
const LAYOUT: LayoutOptions = {
  streetScale: 0.72,
  regionMax: 250,
  regionMay: 170,
  lotMax: 112,
  lotSquare: 74,
  parkRate: 0.035,
  parkingRate: 0.06,
  plazaRate: 0.085,
  towerRate: 0.02,
};

export function paintBackstreet(bake: BakeContext, seed: number): BiomeOutput {
  const rain = bake.preset.wetness > 0;
  return withCityStyle(rain ? OVERCAST : GOLDEN, () => paint({ ...bake, seed }, bake.seed, rain));
}

function paint(ctx: BakeContext, presetSeed: number, rain: boolean): BiomeOutput {
  const { world, field, track, def } = ctx;
  const pools: LightPool[] = [];
  const lights: TerrainLight[] = [];
  const out = { pools, lights };
  const scene = new Scene(field, [...track.obstacles, ...wallDiscs(ctx)]);
  const crossing = def.hazards.find((h) => h.kind === 'crossing') as Crossing;

  const planned = planBlitz(ctx, scene);
  const sites = planned.sites;
  const layout = buildLayout(ctx, scene, planned.reserves, planned.fixed, LAYOUT);
  const plan = planBlitzRoad(ctx);

  paintGround(ctx, scene, layout, out);
  paintTramBed(ctx, sites, layout.roofId);
  paintBlitzRoad(ctx, plan);
  paintBarrier(ctx, scene, layout, plan);
  paintSquare(ctx, scene, sites, out, (x, y) => cobbleTone(x, y, 4417));
  for (const lot of layout.lots) if (lot?.tag === 'clock') paintClockTower(scene, lot, out);
  paintGate(scene, sites, out);
  paintSilos(scene, sites, out);
  paintTram(ctx, scene, sites, out);
  paintCrossingPosts(scene, crossing);
  const blinkerLamps = paintBarricades(ctx, scene);

  // The market's pink sign, on the roof nearest its anchor.
  const neonAnchor = def.anchors.find((a) => a.id === 'market_neon')?.points[0];
  const marketSpec: NeonSignSpec = { text: 'MARKET', color: 1, accent: 3, scale: 2, glyph: -1 };
  const requests: SignRequest[] = [];
  if (neonAnchor) {
    const lot = lotNear(layout, neonAnchor.x, neonAnchor.y, neonSignSize(marketSpec).w);
    if (lot) requests.push({ lot, spec: marketSpec, placed: null });
  }
  buildBuildings(ctx, scene, layout, () => false, requests, out, {
    neonNear: 0.07,
    neonFar: 0.02,
    roofs: 'old',
    escapeRate: 0.8,
  });
  // The boulevard has its own lamps at its anchors.
  const bl = def.anchors.find((a) => a.id === 'boulevard_lamps')?.points ?? [];
  const blS = bl.map((p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < track.main.count; i++) {
      const d = Math.hypot(track.main.x[i]! - p.x, track.main.y[i]! - p.y);
      if (d < bd) {
        bd = d;
        best = track.main.s[i]!;
      }
    }
    return best;
  });
  const noLamps: Array<[number, number]> =
    blS.length > 1 ? [[Math.min(...blS) - 90, Math.max(...blS) + 90]] : [];
  paintStreet(ctx, scene, layout, plan, out, {
    obstacles: (s) => paintObstacles(ctx, s),
    alleyTints: [TINT_WARM],
    noLamps,
  });
  boulevardLamps(ctx, scene, out);
  const chevrons = placeCornerSigns(ctx, scene, layout);
  const boards = placeShortcutBoards(ctx, scene, out);
  cafeAwning(ctx, scene, out);
  startBanner(ctx, scene, out);
  marketHoarding(ctx, scene);
  const signal = trafficLight(ctx, scene);
  const laundry = laundryLines(ctx, scene);

  // Light the ground, then stand the scene on it. A low sun throws long shadows.
  scene.resolve(rain ? 6 : 3);
  const shadow = castShadows(field.w, field.h, scene.shadowH, 12, scene.forced);
  for (let p = 0; p < field.w * field.h; p++) {
    if (scene.drive[p]) {
      if (shadow[p]) shadow[p] = 3;
      else if (scene.shade[p]! > 0) shadow[p] = 2;
    } else if (scene.shade[p]! > 0) shadow[p] = 1;
  }
  for (let p = 0; p < field.w * field.h - 2; p++) {
    if (scene.height[p]! > 0 || scene.drive[p]) continue;
    if (scene.height[p + 1]! > 0 || scene.height[p + 2]! > 0) shadow[p] = 1;
  }
  applyShadows(
    world,
    shadow,
    rain
      ? [overcastShadeGround, overcastShadeRoad, overcastShadeDeep]
      : [goldenShadeGround, goldenShadeRoad, goldenShadeDeep],
  );
  const lit = rain ? litOvercast : litGolden;
  const planes = accumulatePools(field.w, field.h, pools);
  applyLight(world, planes, lit);
  const flat = world.data.slice();
  scene.paint(world, planes, lit);
  let covered = 0;
  for (let p = 0; p < field.w * field.h; p++) {
    if (field.edge[p]! > 0 || !scene.drive[p]) continue;
    const i = p * 4;
    if (
      world.data[i] !== flat[i] ||
      world.data[i + 1] !== flat[i + 1] ||
      world.data[i + 2] !== flat[i + 2]
    ) {
      if (covered < 400 && covered % 20 === 0)
        console.log(`  covered  ${p % field.w},${Math.floor(p / field.w)}`);
      covered++;
    }
  }

  const overlays = scene.overlays();
  // Loops drawn fresh (not copied from the world) take the wet tone with it.
  const fresh: AnimatedArt[] = [];
  for (const sign of requests) {
    const placed = sign.placed;
    if (!placed) continue;
    // Steady, a tube drops out, a brown-out, steady again.
    const masks = [
      0xffffffff, 0xffffffff, 0xffffffff, 0xffffffef, 0xffffffff, 0x40000000, 0xffffffff,
      0xffffffff,
    ];
    fresh.push({
      id: 'market_neon',
      kind: 'neon_sign_flicker',
      frames: masks.map((mask) => {
        const cv = new Canvas(placed.w, placed.h);
        drawNeonSign(cv, 0, 0, sign.spec, mask);
        return cv;
      }),
      x: placed.x,
      y: placed.y,
      fps: 7,
      above: false,
      blend: 'normal',
    });
  }
  if (signal) fresh.push(trafficLoop(signal));
  fresh.push(...laundry);
  if (rain) {
    const wet = wetPass({
      world,
      field,
      drive: scene.drive,
      raised: scene.raised,
      lights,
      seed: presetSeed,
      style: WET_DAY,
    });
    wetLoops(WET_DAY, world, fresh);
    wetOverlays(WET_DAY, overlays);
    console.log(
      `  wet      ${wet.puddlePixels} px of puddles, ${wet.reflectedPixels} px of reflections`,
    );
  }
  // The crossing: its loop copies the finished ground without the boom, then the raised boom
  // is baked in, which is what every settled frame of the loop shows.
  const noBoom = world.crop(0, 0, world.w, world.h);
  bakeBoomUp(world, crossing);
  const animated: AnimatedArt[] = [
    crossingLoop(world, crossing, noBoom),
    ...fresh,
    ...barricadeBlinkers(world, blinkerLamps),
  ];

  const schedules = new Map<string, HazardSchedule>();
  for (const h of def.hazards) if ('schedule' in h) schedules.set(h.id, h.schedule);
  const checks = {
    coveredDrivable: Math.max(covered, scene.violations()),
    animatedMismatch: loopMismatch(world, animated, schedules),
  };
  console.log(`  scene    ${chevrons} chevron boards, ${boards} shortcut boards`);

  const s = sites;
  const startP = sampleBranch(track.main, track.startS);
  return {
    overlays,
    animated,
    lights,
    checks,
    previewSpots: [
      { name: 'start_line', x: Math.round(startP.x), y: Math.round(startP.y) },
      { name: 'boulevard', x: Math.round(startP.x) + 420, y: Math.round(startP.y) },
      { name: 'bakers_row', x: 520, y: 1110 },
      { name: 'laundry_lane', x: 1250, y: 1343 },
      { name: 'tram_crossing', x: Math.round((crossing.a.x + crossing.b.x) / 2), y: s.tram.y },
      { name: 'tram_stop', x: s.tram.stop.x + 60, y: s.tram.y },
      { name: 'old_town_gate', x: s.gate.x, y: Math.round((s.gate.yN + s.gate.yS) / 2) },
      {
        name: 'clock_market',
        x: s.square.x + (s.square.w >> 1),
        y: s.square.y + (s.square.h >> 1),
      },
      { name: 'silos', x: s.silos.x - 60, y: s.silos.y },
      ...(neonAnchor
        ? [{ name: 'market', x: Math.round(neonAnchor.x), y: Math.round(neonAnchor.y + 40) }]
        : []),
    ],
    previewPlain: ['tram_crossing', 'old_town_gate'],
    previewCars: [],
  };
}
