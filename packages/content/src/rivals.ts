import type {
  BuildConditions,
  RaceBrain,
  RaceEntry,
  RaceEnvironment,
  RaceSession,
  TrackRuntime,
  VehicleBlueprint,
} from '@bolt/shared';
import { createRace, createSparringBrain, hashString, mulberry32 } from '@bolt/shared';
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
