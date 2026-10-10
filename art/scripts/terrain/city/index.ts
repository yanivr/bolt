import { createLocation, locate } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext, BiomeOutput } from '../biome.js';
import { accumulatePools, applyLight, applyShadows, castShadows } from '../lighting.js';
import type { LightPool } from '../lighting.js';
import { buildAnimated, placeFeatureSigns, signalSites, stampSignals } from './anim.js';
import { paintGround } from './ground.js';
import { paintLandmarks, planLandmarks } from './landmarks.js';
import { buildLayout } from './layout.js';
import type { Lot, Rect } from './layout.js';
import { buildOverlays } from './overlays.js';
import { litNight, shadeNight } from './palette.js';
import { paintRoad, planRoad } from './road.js';
import { dressRoofs, paintRoofBase } from './roofs.js';
import { paintStreet } from './street.js';

/** Arc length range of Billboard Row on the main line. */
const BILLBOARD_ROW: readonly [number, number] = [4150, 5260];

/**
 * Night city painter. Order matters: ground and roofs first, then the corridor (which owns
 * everything up to the wall), then furniture, then the two lighting passes, and finally the
 * self-lit details that must sit on top of finished ground.
 */
export function paintCity(ctx: BakeContext): BiomeOutput {
  const { world } = ctx;
  const pools: LightPool[] = [];
  const lights: TerrainLight[] = [];
  const claimed = new Set<number>();
  const taken = new Map<number, Rect>();

  const landmarks = planLandmarks(ctx);
  const layout = buildLayout(ctx, landmarks.reserves, landmarks.fixed);
  const plan = planRoad(ctx);

  paintGround(ctx, layout, pools);
  paintRoofBase(ctx, layout);
  paintLandmarks(ctx, layout, landmarks.sites, { pools, lights, claimed });
  const signs = placeFeatureSigns(ctx, layout, taken, pools, lights);
  // Billboard Row is the north side of the long top straight.
  const loc = createLocation();
  const onBillboardRow = (lot: Lot): boolean => {
    if (lot.roadDist > 46) return false;
    locate(ctx.track, lot.x + lot.w / 2, lot.y + lot.h / 2, loc);
    return (
      loc.branch === 0 && loc.s > BILLBOARD_ROW[0] && loc.s < BILLBOARD_ROW[1] && loc.lateral < 0
    );
  };
  dressRoofs(ctx, layout, claimed, taken, onBillboardRow, { pools, lights });
  paintRoad(ctx, layout, plan);
  paintStreet(ctx, layout, plan, { pools, lights });

  const forced = new Uint8Array(world.w * world.h);
  const overlays = buildOverlays(ctx, landmarks.sites, plan.hairpins, forced);

  const shadow = castShadows(world, 26, forced);
  applyShadows(world, shadow, shadeNight);
  // Street-level pools first so lamps win ties; rooftop pools follow.
  pools.sort((a, b) => (a.level === 0 ? 0 : 1) - (b.level === 0 ? 0 : 1));
  const planes = accumulatePools(world, pools, layout.roofId, 2, true);
  applyLight(world, planes, litNight);

  const signals = signalSites(ctx, plan.zebras[3] ?? 7640);
  stampSignals(ctx, signals);
  const animated = buildAnimated(landmarks.sites, signs, signals);

  return {
    overlays,
    animated,
    lights,
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
  };
}
