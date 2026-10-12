import type {
  AiBrain,
  AiDifficulty,
  AiStyle,
  BuildConditions,
  RaceBrain,
  RaceEntry,
  RaceEnvironment,
  RaceSession,
  TrackRuntime,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  DEFAULT_DIFFICULTY,
  createAiBrain,
  createRace,
  createSparringBrain,
  hashString,
  mulberry32,
} from '@bolt/shared';
import type { AiBuildPick, AiStrategy } from './aiLoadouts.js';
import { AI_STRATEGY_TABLE, pickAiBuild } from './aiLoadouts.js';
import { CATALOG } from './catalog.js';
import { resolveBuild } from './loadout.js';
import type { BlueprintTemplate } from './templates.js';
import { TEMPLATES, getTemplate } from './templates.js';

/**
 * Sparring rivals for the Milestone C two-car race: every starter and example build, each a
 * legal shipped blueprint under the same 1,000 credits as the player (Section 3.1).
 */
export const RIVAL_TEMPLATES: BlueprintTemplate[] = TEMPLATES.filter(
  (t) => t.group === 'starter' || t.group === 'example',
);

/** The rival a seed picks. The same seed always races the same car. */
export function pickRival(seed: number): BlueprintTemplate {
  const roll = mulberry32(seed ^ 0x51ed270b)();
  return RIVAL_TEMPLATES[Math.floor(roll * RIVAL_TEMPLATES.length)]!;
}

/** A rival by template id (any shipped template, the unarmed baseline included), or by seed. */
export function resolveRival(seed: number, templateId?: string): BlueprintTemplate | undefined {
  if (templateId === undefined) return pickRival(seed);
  return getTemplate(templateId);
}

/** Validates a blueprint and derives its coefficients: one entry on a race grid. */
export function raceEntry(
  blueprint: VehicleBlueprint,
  conditions: BuildConditions,
): RaceEntry | null {
  const resolved = resolveBuild(blueprint, conditions);
  if (!resolved.ok) return null;
  return { build: resolved.build, params: resolved.params, buildHash: resolved.buildHash };
}

/** A seed for a room that was not given one: stable for a given player build and track. */
export function defaultRaceSeed(buildHash: string, trackId: string): number {
  return hashString(`${buildHash}:${trackId}`) & 0x7fffffff;
}

export type SparringRace = {
  race: RaceSession;
  /** One brain per car; null for the human on the grid's first slot. */
  brains: Array<RaceBrain | null>;
  rival: BlueprintTemplate;
  seed: number;
};

/**
 * The Milestone C race: the player's car on the first grid slot against a sparring rival on
 * the second. The server room and the offline link both build theirs here, so the same
 * blueprint, track, weather, rival and seed give the same race in both.
 */
export function createSparringRace(
  track: TrackRuntime,
  env: RaceEnvironment,
  conditions: BuildConditions,
  player: RaceEntry,
  seed: number,
  rivalTemplateId?: string,
): SparringRace | null {
  const rival = resolveRival(seed, rivalTemplateId);
  if (!rival) return null;
  const entry = raceEntry(rival.blueprint, conditions);
  if (!entry) return null;
  const race = createRace(track, env, [player, entry], { seed, conditions, catalog: CATALOG });
  return { race, brains: [null, createSparringBrain(seed ^ 0x2545f491)], rival, seed };
}

export type AiRaceOptions = {
  /** Rookie, Racer or Ace (Section 3.1). Racer when not given. */
  difficulty?: AiDifficulty;
  /** Aggressive or tactical. Chosen by seed when not given. */
  style?: AiStyle;
  /** The strategy the AI builds for. Chosen by seed when not given. */
  strategy?: AiStrategy;
  /** Debug and tests: race a named shipped template instead of an AI build. */
  rivalTemplateId?: string;
};

export type AiRace = SparringRace & {
  difficulty: AiDifficulty;
  style: AiStyle;
  /** The strategy pick, or null when a named template was raced. */
  pick: AiBuildPick | null;
  brain: AiBrain;
};

/** Seed of the AI's own choices, apart from the race's. */
export const AI_BRAIN_SEED_SALT = 0x2545f491;

/**
 * The Milestone D race: the player's car on the first grid slot against the AI on the second.
 * The AI builds from the same catalog, budget and validator as the player, for the course and
 * its weather (`pickAiBuild`), or races a named shipped template (a debug and test option).
 * The server room and the offline link both build theirs here, so the same blueprint, course,
 * difficulty and seed give the same race in both.
 */
export function createAiRace(
  track: TrackRuntime,
  presetId: string,
  env: RaceEnvironment,
  conditions: BuildConditions,
  player: RaceEntry,
  seed: number,
  options: AiRaceOptions = {},
): AiRace | null {
  let rival: BlueprintTemplate | undefined;
  let pick: AiBuildPick | null = null;
  if (options.rivalTemplateId !== undefined) rival = getTemplate(options.rivalTemplateId);
  else {
    pick = pickAiBuild(track.def.id, presetId, seed, options.strategy);
    if (pick)
      rival = {
        id: `ai_${pick.frame}`,
        group: 'example',
        name: AI_STRATEGY_TABLE[pick.strategy].frames.find((f) => f.id === pick!.frame)!.name,
        description: AI_STRATEGY_TABLE[pick.strategy].plan,
        blueprint: pick.blueprint,
      };
  }
  if (!rival) return null;
  const entry = raceEntry(rival.blueprint, conditions);
  if (!entry) return null;
  const race = createRace(track, env, [player, entry], { seed, conditions, catalog: CATALOG });
  const brain = createAiBrain({
    seed: seed ^ AI_BRAIN_SEED_SALT,
    difficulty: options.difficulty ?? DEFAULT_DIFFICULTY,
    ...(options.style ? { style: options.style } : {}),
  });
  // The plan of the route is worked out now, at the join, not on the first tick of the race.
  brain.prepare(race, 1);
  return {
    race,
    brains: [null, brain],
    rival,
    seed,
    difficulty: brain.difficulty,
    style: brain.style,
    pick,
    brain,
  };
}
