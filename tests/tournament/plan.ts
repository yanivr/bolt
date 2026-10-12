import type { AiStrategy } from '@bolt/content';
import {
  AI_STRATEGIES,
  PROFILE_TIRES,
  RIVAL_TEMPLATES,
  TRACKS,
  getTemplate,
  profileOf,
} from '@bolt/content';
import type { AiDifficulty, AiStyle } from '@bolt/shared';
import { AI_DIFFICULTIES } from '@bolt/shared';
import { UPGRADE_PAIRS } from '../balance/upgrade.js';
import type { MatchSpec } from './harness.js';

/**
 * Which matches a tournament runs. Every course (the eight tracks in both of their weathers),
 * and on each:
 *
 * - `strategy`: every pair of the six strategies, from both grid slots, Racer against Racer,
 *   one aggressive and one tactical driver (the styles swap with the slots). This is where the
 *   per-course win rates of strategies and tires come from.
 * - `difficulty`: Ace against Rookie, Ace against Racer and Racer against Rookie, both on the
 *   balanced strategy, from both slots and in both styles.
 * - `sparring`: the before and after of the brain: the same pairs of shipped builds and the
 *   same seeds, once with the sparring brain in both cars and once with the AI (Racer) in both.
 * - `system`: the before and after of the whole rival as a player meets it: the old room raced
 *   a shipped build picked by seed with the sparring brain; the new one builds for the course
 *   and drives with the AI. Both cars, same seeds.
 *
 * - `roster`: every starter and example build (the cars a player starts from), driven by the AI
 *   at Racer, against the AI rival exactly as the room builds it (`createAiRace`: strategy,
 *   build and style by seed) at each of the three difficulties, the shipped build on the
 *   player's slot. Win rates per
 *   build and per difficulty, and how the shipped builds fare course by course, come from here.
 * - `balance`: the balance harness's matrix with the real AI in both cars (Racer, styles by
 *   seed): every starter and example build against every other, from both grid slots. The
 *   four balance targets (docs/BALANCE_CHANGELOG.md, the tow) are measured here, per course.
 * - `upgrade`: the upgrade test with the real AI: each shipped build of tests/balance/upgrade.ts
 *   against its twin with one upgrade, from both slots, on the courses where the change is an
 *   upgrade (Slicks on dry pavement; the V8 for the Trail Engine off loose ground).
 * - `tires`: the surface experiment. The same frame and engine (the balanced strategy's Arrow)
 *   on the wheel kit the course's profile ranks first against three others, from both slots.
 *   Nothing but the tires differs, so the win rate and the margin are what the kit is worth here.
 *
 * Quick mode keeps the shape and cuts the counts so it runs in a couple of minutes.
 */

export type Phase =
  'strategy' | 'difficulty' | 'roster' | 'balance' | 'upgrade' | 'sparring' | 'system' | 'tires';
export type PlannedMatch = MatchSpec & { phase: Phase; pair: string };

export const COURSES: Array<{ trackId: string; presetId: string }> = Object.values(TRACKS).flatMap(
  (def) => def.weatherPresetIds.map((presetId) => ({ trackId: def.id, presetId })),
);

/** Shipped builds raced by both brains in the before/after phase. */
export const SPARRING_PAIRS: Array<[string, string]> = [
  ['starter_rookie', 'starter_sprinter'],
  ['starter_packhorse', 'example_tiny_trouble'],
  ['starter_longlegs', 'example_back_alley_trap'],
  ['starter_tinker', 'example_rain_runner'],
  ['example_straight_line_rocket', 'example_dust_spider'],
  ['example_iron_mule', 'starter_sprinter'],
];

/** The kits a course's best kit is raced against: the generalist and each specialist. */
export const TIRE_DUEL_KITS = [
  'tires_street',
  'tires_slick',
  'tires_rain',
  'tires_sand',
  'tires_mud',
];

const DIFFICULTY_PAIRS: Array<[AiDifficulty, AiDifficulty]> = [
  ['ace', 'rookie'],
  ['ace', 'racer'],
  ['racer', 'rookie'],
];

export function plannedMatches(quick: boolean, baseSeed = 7001): PlannedMatch[] {
  const out: PlannedMatch[] = [];
  let seed = baseSeed;
  const styles: AiStyle[] = ['aggressive', 'tactical'];
  const strategyPairs: Array<[AiStrategy, AiStrategy]> = [];
  for (let i = 0; i < AI_STRATEGIES.length; i++)
    for (let j = i + 1; j < AI_STRATEGIES.length; j++)
      strategyPairs.push([AI_STRATEGIES[i]!, AI_STRATEGIES[j]!]);
  for (const [ci, course] of COURSES.entries()) {
    // --- Strategies --------------------------------------------------------------------------
    const pairs = quick ? strategyPairs.filter((_, k) => (k + ci) % 5 === 0) : strategyPairs;
    for (const [a, b] of pairs)
      for (let slot = 0; slot < (quick ? 1 : 2); slot++) {
        const first = slot === 0 ? a : b;
        const second = slot === 0 ? b : a;
        out.push({
          ...course,
          phase: 'strategy',
          pair: `${a}-${b}`,
          seed: seed++,
          cars: [
            { strategy: first, difficulty: 'racer', style: styles[slot]! },
            { strategy: second, difficulty: 'racer', style: styles[1 - slot]! },
          ],
        });
      }
    // --- Difficulty --------------------------------------------------------------------------
    const diffPairs = quick ? DIFFICULTY_PAIRS.slice(0, 1) : DIFFICULTY_PAIRS;
    for (const [a, b] of diffPairs)
      for (let slot = 0; slot < 2; slot++)
        for (let s = 0; s < (quick ? 1 : 2); s++) {
          const first = slot === 0 ? a : b;
          const second = slot === 0 ? b : a;
          out.push({
            ...course,
            phase: 'difficulty',
            pair: `${a}-${b}`,
            seed: seed++,
            cars: [
              { strategy: 'balanced', difficulty: first, style: styles[s]! },
              { strategy: 'balanced', difficulty: second, style: styles[1 - s]! },
            ],
          });
        }
    // --- The roster: every shipped build against the AI at each difficulty ------------------
    const rosterSeeds = quick ? 1 : 2;
    for (const [ti, t] of RIVAL_TEMPLATES.entries())
      for (const d of AI_DIFFICULTIES)
        for (let k = 0; k < rosterSeeds; k++) {
          // As the room races it: the player's car on the first slot, the AI on the second.
          const shipped = {
            templateId: t.id,
            difficulty: 'racer' as const,
            style: (k + ti) % 2 === 0 ? ('tactical' as const) : ('aggressive' as const),
          };
          out.push({
            ...course,
            phase: 'roster',
            pair: `${t.id}-${d}`,
            seed: seed++,
            room: true,
            cars: [shipped, { difficulty: d }],
          });
        }
    // --- Balance: every shipped build against every other, the AI driving both -----------------
    for (let a = 0; a < RIVAL_TEMPLATES.length; a++)
      for (let b = a + 1; b < RIVAL_TEMPLATES.length; b++) {
        if (quick && (a + b + ci) % 6 !== 0) continue;
        for (let slot = 0; slot < 2; slot++) {
          const first = RIVAL_TEMPLATES[slot === 0 ? a : b]!.id;
          const second = RIVAL_TEMPLATES[slot === 0 ? b : a]!.id;
          out.push({
            ...course,
            phase: 'balance',
            pair: `${RIVAL_TEMPLATES[a]!.id}-${RIVAL_TEMPLATES[b]!.id}`,
            seed: seed++,
            cars: [
              { templateId: first, difficulty: 'racer' },
              { templateId: second, difficulty: 'racer' },
            ],
          });
        }
      }
    // --- Upgrade: a shipped build against itself with one upgrade -----------------------------
    // Only where it is an upgrade: Slicks on dry pavement, the V8 for the Trail Engine off loose
    // ground; a bigger engine for a smaller one everywhere.
    const profile_ = profileOf(course.trackId, course.presetId);
    const dryPaved = profile_ === 'dry_road' || profile_ === 'metal';
    const loose = profile_ === 'sand' || profile_ === 'mud' || profile_ === 'dirt';
    const applies = (pair: (typeof UPGRADE_PAIRS)[number]) =>
      pair.change.tireKitId === 'tires_slick'
        ? dryPaved
        : getTemplate(pair.base)?.blueprint.engineId === 'engine_offroad'
          ? !loose
          : true;
    const upgrades = UPGRADE_PAIRS.filter(applies);
    for (const pair of quick ? upgrades.slice(ci % 3, (ci % 3) + 2) : upgrades)
      for (let k = 0; k < (quick ? 2 : 6); k++) {
        const stock = { templateId: pair.base, difficulty: 'racer' as const };
        const better = { templateId: pair.base, upgrade: pair.id, difficulty: 'racer' as const };
        out.push({
          ...course,
          phase: 'upgrade',
          pair: pair.id,
          seed: seed++,
          cars: k % 2 === 0 ? [stock, better] : [better, stock],
        });
      }
    // --- Before and after: the sparring brain and the AI on the same builds and seeds ---------
    const shipped = quick ? SPARRING_PAIRS.slice(ci % 3, (ci % 3) + 2) : SPARRING_PAIRS;
    for (const [a, b] of shipped)
      for (let slot = 0; slot < (quick ? 1 : 2); slot++) {
        const s = seed++;
        const first = slot === 0 ? a : b;
        const second = slot === 0 ? b : a;
        for (const sparring of [true, false])
          out.push({
            ...course,
            phase: 'sparring',
            pair: `${first}-${second}`,
            seed: s,
            cars: [
              { templateId: first, difficulty: 'racer', style: 'aggressive', sparring },
              { templateId: second, difficulty: 'racer', style: 'tactical', sparring },
            ],
          });
      }
    // --- Tires: the same car on different kits ------------------------------------------------
    const profile = profileOf(course.trackId, course.presetId);
    const best = PROFILE_TIRES[profile][0]!;
    const rivals = TIRE_DUEL_KITS.filter((k) => k !== best).slice(0, quick ? 1 : 4);
    for (const other of rivals)
      for (let slot = 0; slot < 2; slot++) {
        const engineId = course.trackId.startsWith('desert') ? 'engine_offroad' : 'engine_v8';
        const a = { frame: 'balanced_arrow', engineId, tireKitId: best };
        const b = { frame: 'balanced_arrow', engineId, tireKitId: other };
        out.push({
          ...course,
          phase: 'tires',
          pair: `${best}-${other}`,
          seed: seed++,
          cars: [
            { build: slot === 0 ? a : b, difficulty: 'racer', style: 'tactical' },
            { build: slot === 0 ? b : a, difficulty: 'racer', style: 'tactical' },
          ],
        });
      }
    // --- Before and after: the whole rival, build choice included ---------------------------
    for (let k = 0; k < (quick ? 2 : 6); k++) {
      const s = seed++;
      const pickA = RIVAL_TEMPLATES[(s * 7 + 3) % RIVAL_TEMPLATES.length]!.id;
      const pickB = RIVAL_TEMPLATES[(s * 13 + 5) % RIVAL_TEMPLATES.length]!.id;
      out.push({
        ...course,
        phase: 'system',
        pair: 'sparring',
        seed: s,
        cars: [
          { templateId: pickA, difficulty: 'racer', style: 'aggressive', sparring: true },
          {
            templateId: pickB === pickA ? RIVAL_TEMPLATES[0]!.id : pickB,
            difficulty: 'racer',
            style: 'tactical',
            sparring: true,
          },
        ],
      });
      out.push({
        ...course,
        phase: 'system',
        pair: 'ai',
        seed: s,
        cars: [
          {
            strategy: AI_STRATEGIES[(s * 7 + 3) % AI_STRATEGIES.length]!,
            difficulty: 'racer',
            style: 'aggressive',
          },
          {
            strategy: AI_STRATEGIES[(s * 13 + 5) % AI_STRATEGIES.length]!,
            difficulty: 'racer',
            style: 'tactical',
          },
        ],
      });
    }
  }
  return out.map((m, index) => ({ ...m, index }));
}
