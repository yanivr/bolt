import type {
  AiDifficulty,
  BuildConditions,
  RaceEnvironment,
  VehicleBlueprint,
} from '@bolt/shared';
import { buildTrack, estimateLapSeconds, hashString, mulberry32 } from '@bolt/shared';
import { conditionsFor, environmentFor, resolveBuild } from './loadout.js';
import type { PartSpec } from './templates.js';
import { build } from './templates.js';
import { getTrack } from './tracks.js';

/**
 * What the AI builds (Section 15.9: "select builds from viable strategy templates parameterized
 * by weather and track; introduce variability through a seeded choice among near-optimal
 * alternatives"). Everything here is data: the course's surface profile, the wheel kits worth
 * fitting on each profile, and for each strategy a few frames (chassis, engine and parts). A
 * build is assembled from a frame and a kit, validated by the same validator a player's car
 * goes through (1,000 credits, mounts, load), and weighed by a quick lap estimate on the
 * course; the AI then picks, by seed, among the legal builds within `NEAR_OPTIMAL` of the
 * fastest of its strategy. Nothing an AI car carries is unavailable to a player.
 */

export type AiStrategy = 'speedster' | 'brawler' | 'trapper' | 'tank' | 'sniper' | 'balanced';

export const AI_STRATEGIES: readonly AiStrategy[] = [
  'speedster',
  'brawler',
  'trapper',
  'tank',
  'sniper',
  'balanced',
];

/**
 * Surface profiles: the ground and weather a course is mostly raced on. The wheel kit list for
 * a profile is ranked from the tire study of the default car on each course
 * (docs/evidence/balance/tracks-0.7.0.md): the kit that measured fastest first, then the
 * near alternatives.
 */
export type SurfaceProfile =
  'dry_road' | 'wet_road' | 'sand' | 'mud' | 'dirt' | 'frost' | 'snowfall' | 'metal' | 'wet_metal';

export const COURSE_PROFILE: Readonly<Record<string, SurfaceProfile>> = {
  'city_01/city_clear_night': 'dry_road',
  'city_01/city_rain_night': 'wet_road',
  'city_02/city_clear_day': 'dry_road',
  'city_02/city_rain_day': 'wet_road',
  'desert_01/desert_clear': 'sand',
  'desert_01/desert_crosswind': 'sand',
  'desert_02/desert_dry_heat': 'sand',
  'desert_02/desert_sandstorm': 'sand',
  'forest_01/forest_clear': 'mud',
  'forest_01/forest_rain': 'mud',
  'forest_02/forest_clear': 'dirt',
  'forest_02/forest_heavy_rain': 'wet_road',
  'snow_01/snow_clear_frost': 'frost',
  'snow_01/snow_snowfall': 'snowfall',
  'industrial_01/industrial_dry_night': 'metal',
  'industrial_01/industrial_factory_rain': 'wet_metal',
};

export const PROFILE_TIRES: Readonly<Record<SurfaceProfile, readonly string[]>> = {
  dry_road: ['tires_slick', 'tires_micro', 'tires_soft'],
  wet_road: ['tires_rain', 'tires_soft', 'tires_adaptive'],
  sand: ['tires_sand', 'tires_micro', 'tires_monster'],
  mud: ['tires_mud', 'tires_rain', 'tires_halftrack'],
  dirt: ['tires_slick', 'tires_soft', 'tires_micro'],
  frost: ['tires_snow', 'tires_slick', 'tires_soft'],
  snowfall: ['tires_rain', 'tires_snow', 'tires_soft'],
  metal: ['tires_slick', 'tires_magnetic', 'tires_soft'],
  wet_metal: ['tires_rain', 'tires_magnetic', 'tires_soft'],
};

/** Profiles where the ground is loose enough that a frame should consider its loose-ground engine. */
const LOOSE_PROFILES: ReadonlySet<SurfaceProfile> = new Set(['sand', 'mud', 'frost', 'snowfall']);

export type AiFrame = {
  id: string;
  name: string;
  chassisId: string;
  /** Engines to weigh; `looseEngines` too on loose profiles. */
  engines: readonly string[];
  looseEngines?: readonly string[];
  parts: readonly PartSpec[];
  paintId: string;
};

export type AiStrategyDef = {
  strategy: AiStrategy;
  name: string;
  /** What it is for, in one line. */
  plan: string;
  frames: readonly AiFrame[];
};

export const AI_STRATEGY_TABLE: Readonly<Record<AiStrategy, AiStrategyDef>> = {
  speedster: {
    strategy: 'speedster',
    name: 'Speedster',
    plan: 'Pace first: a strong engine on a light frame, one gun, a boost for the straights.',
    frames: [
      {
        id: 'speedster_arrow',
        name: 'Arrow Speedster',
        chassisId: 'chassis_arrow',
        engines: ['engine_v8', 'engine_supercharger'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_signal',
        parts: [
          { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
          { part: 'utility_nitro', mount: 'roof_mid' },
          { part: 'utility_fan', mount: 'roof_rear' },
          { part: 'weapon_mine', mount: 'rear_center', turn: 2, fire: 1 },
        ],
      },
      {
        id: 'speedster_trike',
        name: 'Trike Speedster',
        chassisId: 'chassis_trike',
        engines: ['engine_rotary', 'engine_small_turbo'],
        paintId: 'paint_cobalt',
        parts: [
          { part: 'weapon_shotgun', mount: 'front_center', fire: 0 },
          { part: 'utility_fan', mount: 'roof_mid' },
          { part: 'weapon_rear_mg', mount: 'right_rear', turn: 2 },
        ],
      },
    ],
  },
  brawler: {
    strategy: 'brawler',
    name: 'Brawler',
    plan: 'Close and heavy: a hammer and a shove up front, blades on the flanks, a repair kit.',
    frames: [
      {
        id: 'brawler_beetle',
        name: 'Beetle Brawler',
        chassisId: 'chassis_beetle',
        engines: ['engine_v8', 'engine_twin_turbo', 'engine_diesel'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_sunflare',
        parts: [
          { part: 'weapon_hammer', mount: 'front_center', fire: 0 },
          { part: 'weapon_air', mount: 'roof_mid', fire: 1 },
          { part: 'defense_rear_bumper', mount: 'rear_center', turn: 2 },
          { part: 'utility_repair', mount: 'left_utility' },
          { part: 'utility_spare', mount: 'right_utility' },
        ],
      },
      {
        id: 'brawler_spider',
        name: 'Spider Brawler',
        chassisId: 'chassis_spider',
        engines: ['engine_v8', 'engine_v6'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_mint',
        parts: [
          { part: 'weapon_shotgun', mount: 'roof_front', fire: 0 },
          { part: 'weapon_saw', mount: 'left_front', turn: 3 },
          { part: 'weapon_saw', mount: 'right_front', turn: 1 },
          { part: 'weapon_air', mount: 'roof_mid', fire: 1 },
        ],
      },
      {
        id: 'brawler_arrow',
        name: 'Arrow Brawler',
        chassisId: 'chassis_arrow',
        engines: ['engine_v8', 'engine_supercharger'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_sunflare',
        parts: [
          { part: 'weapon_shotgun', mount: 'front_center', fire: 0 },
          { part: 'weapon_air', mount: 'roof_rear', fire: 1 },
          { part: 'utility_repair', mount: 'roof_mid' },
          { part: 'defense_rear_bumper', mount: 'rear_center', turn: 2 },
        ],
      },
    ],
  },
  trapper: {
    strategy: 'trapper',
    name: 'Trapper',
    plan: 'Owns the road behind: mines and oil where the follower will drive, a sentry, a sensor.',
    frames: [
      {
        id: 'trapper_beetle',
        name: 'Beetle Trapper',
        chassisId: 'chassis_beetle',
        engines: ['engine_v8', 'engine_twin_turbo', 'engine_hybrid'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_sunflare',
        parts: [
          { part: 'weapon_mine', mount: 'rear_center', turn: 2, fire: 0 },
          { part: 'weapon_rear_mg', mount: 'roof_mid', turn: 2 },
          { part: 'utility_minesensor', mount: 'left_utility' },
          { part: 'utility_repair', mount: 'right_utility' },
        ],
      },
      {
        id: 'trapper_pickup',
        name: 'Pickup Trapper',
        chassisId: 'chassis_pickup',
        engines: ['engine_v8', 'engine_twin_turbo'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_mint',
        parts: [
          { part: 'weapon_mine', mount: 'rear_center', turn: 2, fire: 0 },
          { part: 'weapon_oil', mount: 'bed_rear', turn: 2, fire: 1 },
          { part: 'weapon_rear_mg', mount: 'left_bed', turn: 2 },
          { part: 'utility_repair', mount: 'bed_front' },
        ],
      },
      {
        id: 'trapper_arrow',
        name: 'Arrow Trapper',
        chassisId: 'chassis_arrow',
        engines: ['engine_v8', 'engine_supercharger'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_cobalt',
        parts: [
          { part: 'weapon_mine', mount: 'rear_center', turn: 2, fire: 0 },
          { part: 'weapon_rear_mg', mount: 'roof_rear', turn: 2 },
          { part: 'utility_minesensor', mount: 'roof_mid' },
          { part: 'weapon_front_mg', mount: 'front_center', fire: 1 },
        ],
      },
    ],
  },
  tank: {
    strategy: 'tank',
    name: 'Tank',
    plan: 'Hard to stop: a shield, plates or a mortar, and repairs, at the cost of pace.',
    frames: [
      {
        id: 'tank_pickup',
        name: 'Pickup Tank',
        chassisId: 'chassis_pickup',
        engines: ['engine_v8', 'engine_twin_turbo'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_mint',
        parts: [
          { part: 'weapon_mortar', mount: 'bed_rear', fire: 0 },
          { part: 'defense_energy_shield', mount: 'roof_cab' },
          { part: 'utility_repair', mount: 'bed_front', offset: [-5, 0] },
          { part: 'utility_spare', mount: 'bed_front', offset: [5, 0] },
          { part: 'defense_rear_bumper', mount: 'rear_center', turn: 2 },
        ],
      },
      {
        id: 'tank_beetle',
        name: 'Beetle Tank',
        chassisId: 'chassis_beetle',
        engines: ['engine_twin_turbo', 'engine_v8'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_cobalt',
        parts: [
          { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
          { part: 'defense_energy_shield', mount: 'roof_mid' },
          { part: 'defense_rear_bumper', mount: 'rear_center', turn: 2 },
          { part: 'utility_repair', mount: 'left_utility' },
          { part: 'utility_spare', mount: 'right_utility' },
        ],
      },
      {
        id: 'tank_arrow',
        name: 'Arrow Tank',
        chassisId: 'chassis_arrow',
        engines: ['engine_v8', 'engine_supercharger'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_mint',
        parts: [
          { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
          { part: 'defense_energy_shield', mount: 'roof_mid' },
          { part: 'utility_repair', mount: 'roof_rear' },
          { part: 'defense_rear_bumper', mount: 'rear_center', turn: 2 },
        ],
      },
    ],
  },
  sniper: {
    strategy: 'sniper',
    name: 'Sniper',
    plan: 'Hits from range: a railgun or a seeker, a rocket, and the power to fire them.',
    frames: [
      {
        id: 'sniper_arrow',
        name: 'Arrow Sniper',
        chassisId: 'chassis_arrow',
        engines: ['engine_v8', 'engine_twin_turbo'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_cobalt',
        parts: [
          { part: 'weapon_railshot', mount: 'roof_mid', fire: 0 },
          { part: 'weapon_rocket', mount: 'front_center', fire: 1 },
          { part: 'utility_fan', mount: 'roof_rear' },
        ],
      },
      {
        id: 'sniper_beetle',
        name: 'Beetle Sniper',
        chassisId: 'chassis_beetle',
        engines: ['engine_v8', 'engine_twin_turbo'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_signal',
        parts: [
          { part: 'weapon_homing', mount: 'roof_mid', fire: 0 },
          { part: 'weapon_rocket', mount: 'front_center', fire: 1 },
          { part: 'utility_decoy', mount: 'left_utility' },
          { part: 'utility_repair', mount: 'right_utility' },
        ],
      },
    ],
  },
  balanced: {
    strategy: 'balanced',
    name: 'Balanced',
    plan: 'A bit of everything: a gun each way, a turret or a rocket, and a repair.',
    frames: [
      {
        id: 'balanced_beetle',
        name: 'Beetle Allrounder',
        chassisId: 'chassis_beetle',
        engines: ['engine_v8', 'engine_twin_turbo', 'engine_v6'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_signal',
        parts: [
          { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
          { part: 'weapon_turret', mount: 'roof_mid', fire: 1 },
          { part: 'weapon_rear_mg', mount: 'rear_center', turn: 2 },
          { part: 'utility_repair', mount: 'left_utility' },
          { part: 'utility_spare', mount: 'right_utility' },
        ],
      },
      {
        id: 'balanced_spider',
        name: 'Spider Allrounder',
        chassisId: 'chassis_spider',
        engines: ['engine_v8', 'engine_v6'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_mint',
        parts: [
          { part: 'weapon_front_mg', mount: 'roof_front', fire: 0 },
          { part: 'weapon_rocket', mount: 'roof_mid', fire: 1 },
          { part: 'defense_light_plate', mount: 'left_front', turn: 3 },
          { part: 'defense_light_plate', mount: 'right_front', turn: 1 },
          { part: 'utility_repair', mount: 'rear_utility' },
        ],
      },
      {
        id: 'balanced_arrow',
        name: 'Arrow Allrounder',
        chassisId: 'chassis_arrow',
        engines: ['engine_v8', 'engine_supercharger'],
        looseEngines: ['engine_offroad'],
        paintId: 'paint_signal',
        parts: [
          { part: 'weapon_front_mg', mount: 'front_center', fire: 0 },
          { part: 'weapon_rocket', mount: 'roof_rear', fire: 1 },
          { part: 'weapon_rear_mg', mount: 'rear_center', turn: 2 },
          { part: 'utility_repair', mount: 'roof_mid' },
        ],
      },
    ],
  },
};

/** Builds within this share of the fastest of their strategy count as near-optimal. */
export const NEAR_OPTIMAL = 0.02;

export type AiBuildOption = {
  strategy: AiStrategy;
  frame: string;
  engineId: string;
  tireKitId: string;
  blueprint: VehicleBlueprint;
  cost: number;
  /** Quick lap estimate on the course, seconds. */
  lapSeconds: number;
  /** Within `NEAR_OPTIMAL` of the fastest legal build of the strategy. */
  nearOptimal: boolean;
};

export function profileOf(trackId: string, presetId: string): SurfaceProfile {
  return COURSE_PROFILE[`${trackId}/${presetId}`] ?? 'dry_road';
}

const OPTIONS = new Map<string, AiBuildOption[]>();

/**
 * Every legal build of a strategy for a course, fastest first, with the near-optimal ones
 * marked. Cached per course and strategy.
 */
export function aiBuildOptions(
  trackId: string,
  presetId: string,
  strategy: AiStrategy,
): AiBuildOption[] {
  const key = `${trackId}/${presetId}/${strategy}`;
  const cached = OPTIONS.get(key);
  if (cached) return cached;
  const def = getTrack(trackId);
  const conditions = conditionsFor(trackId, presetId) as BuildConditions | undefined;
  const env = environmentFor(presetId) as RaceEnvironment | undefined;
  if (!def || !conditions || !env) return [];
  const track = buildTrack(def);
  const profile = profileOf(trackId, presetId);
  const loose = LOOSE_PROFILES.has(profile);
  const options: AiBuildOption[] = [];
  for (const frame of AI_STRATEGY_TABLE[strategy].frames) {
    const engines = [...frame.engines, ...(loose ? (frame.looseEngines ?? []) : [])];
    for (const engineId of engines)
      for (const tireKitId of PROFILE_TIRES[profile]) {
        const blueprint = build(
          `AI ${frame.name}`,
          frame.chassisId,
          engineId,
          tireKitId,
          frame.paintId,
          [...frame.parts],
        );
        const resolved = resolveBuild(blueprint, conditions);
        if (!resolved.ok) continue;
        options.push({
          strategy,
          frame: frame.id,
          engineId,
          tireKitId,
          blueprint: resolved.build.blueprint,
          cost: resolved.totalCost,
          lapSeconds: estimateLapSeconds(track, resolved.params, env),
          nearOptimal: false,
        });
      }
  }
  options.sort((a, b) => a.lapSeconds - b.lapSeconds);
  const best = options[0]?.lapSeconds ?? 0;
  for (const o of options) o.nearOptimal = o.lapSeconds <= best * (1 + NEAR_OPTIMAL);
  OPTIONS.set(key, options);
  return options;
}

export type AiBuildPick = AiBuildOption & { seed: number };

/** The strategy a seed picks for a course, when none is asked for. */
export function pickStrategy(seed: number): AiStrategy {
  const roll = mulberry32(seed ^ 0x3c6ef372)();
  return AI_STRATEGIES[Math.floor(roll * AI_STRATEGIES.length)]!;
}

/** The wheel kit of a Rookie's build: the generalist, whatever the ground. */
export const ROOKIE_TIRES = 'tires_street';

const ROOKIE_OPTIONS = new Map<string, AiBuildOption[]>();

/**
 * A Rookie's builds for a strategy (Section 3.1, "recognizable viable builds"): each frame of
 * the strategy as it stands, on the first engine it lists and on Street Tires, whatever the
 * course. The same catalog, budget and validator as anyone; what a Rookie does not do is tune
 * the car to the ground and the weather, which is the planning depth Section 15.9 lets
 * difficulty change. A course-built car beat the shipped starters nine races in ten.
 */
export function rookieBuildOptions(
  trackId: string,
  presetId: string,
  strategy: AiStrategy,
): AiBuildOption[] {
  const key = `${trackId}/${presetId}/${strategy}`;
  const cached = ROOKIE_OPTIONS.get(key);
  if (cached) return cached;
  const def = getTrack(trackId);
  const conditions = conditionsFor(trackId, presetId) as BuildConditions | undefined;
  const env = environmentFor(presetId) as RaceEnvironment | undefined;
  if (!def || !conditions || !env) return [];
  const track = buildTrack(def);
  const options: AiBuildOption[] = [];
  for (const frame of AI_STRATEGY_TABLE[strategy].frames) {
    const engineId = frame.engines[0]!;
    const blueprint = build(
      `AI ${frame.name}`,
      frame.chassisId,
      engineId,
      ROOKIE_TIRES,
      frame.paintId,
      [...frame.parts],
    );
    const resolved = resolveBuild(blueprint, conditions);
    if (!resolved.ok) continue;
    options.push({
      strategy,
      frame: frame.id,
      engineId,
      tireKitId: ROOKIE_TIRES,
      blueprint: resolved.build.blueprint,
      cost: resolved.totalCost,
      lapSeconds: estimateLapSeconds(track, resolved.params, env),
      nearOptimal: true,
    });
  }
  ROOKIE_OPTIONS.set(key, options);
  return options;
}

/**
 * The AI's build for a course: a seeded choice among the near-optimal builds of a strategy
 * (Racer: "track-aware loadouts"; Ace the same), or, for a Rookie, among the strategy's frames
 * as they stand (`rookieBuildOptions`).
 */
export function pickAiBuild(
  trackId: string,
  presetId: string,
  seed: number,
  strategy: AiStrategy = pickStrategy(seed),
  difficulty?: AiDifficulty,
): AiBuildPick | null {
  let near = difficulty === 'rookie' ? rookieBuildOptions(trackId, presetId, strategy) : [];
  if (near.length === 0)
    near = aiBuildOptions(trackId, presetId, strategy).filter((o) => o.nearOptimal);
  if (near.length === 0) return null;
  const roll = mulberry32(seed ^ hashString(strategy) ^ 0xa54ff53a)();
  const pick = near[Math.floor(roll * near.length)]!;
  return { ...pick, seed };
}

export function isAiStrategy(value: unknown): value is AiStrategy {
  return typeof value === 'string' && (AI_STRATEGIES as readonly string[]).includes(value);
}
