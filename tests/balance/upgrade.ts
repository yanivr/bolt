import type { BlueprintTemplate } from '@bolt/content';
import { CATALOG, CITY_01, conditionsFor, getTemplate, raceEntry } from '@bolt/content';
import type { BuildConditions, VehicleBlueprint } from '@bolt/shared';
import { STARTING_CREDITS, blueprintCost } from '@bolt/shared';
import type { MatchOutcome } from './harness.js';
import { NEON_CLEAR, runBotMatch } from './harness.js';
import { unarmed } from './tow.js';

/**
 * The upgrade test: building the car well must still pay with the tow on (the product owner's
 * "the player must feel rewarded for building the car well"). Each pair is a shipped build and
 * the same build with one clear upgrade bought from what is left of the budget: a stronger
 * engine or better tires, nothing else moved, weapons and all. The upgraded twin must win
 * clearly more than half of its races against the stock one, from both grid slots.
 *
 * Engines open a gap of five to nine seconds over a race, tires one to three: the small ones
 * are where a catch-up would flip a result if it were too strong.
 */
export type UpgradePair = {
  id: string;
  label: string;
  base: string;
  change: Partial<Pick<VehicleBlueprint, 'engineId' | 'tireKitId'>>;
};

export const UPGRADE_PAIRS: UpgradePair[] = [
  {
    id: 'rookie_v6',
    label: 'Rookie, Four-Cylinder to V6',
    base: 'starter_rookie',
    change: { engineId: 'engine_v6' },
  },
  {
    id: 'sprinter_v8',
    label: 'Sprinter, V6 to V8',
    base: 'starter_sprinter',
    change: { engineId: 'engine_v8' },
  },
  {
    id: 'packhorse_v8',
    label: 'Packhorse, V6 to V8',
    base: 'starter_packhorse',
    change: { engineId: 'engine_v8' },
  },
  {
    id: 'sprinter_slicks',
    label: 'Sprinter, Street Tires to Slicks',
    base: 'starter_sprinter',
    change: { tireKitId: 'tires_slick' },
  },
  {
    id: 'tinker_slicks',
    label: 'Tinker, Street Tires to Slicks',
    base: 'starter_tinker',
    change: { tireKitId: 'tires_slick' },
  },
  {
    id: 'trap_slicks',
    label: 'Back-Alley Trap, Street Tires to Slicks',
    base: 'example_back_alley_trap',
    change: { tireKitId: 'tires_slick' },
  },
];

export function baseOf(pair: UpgradePair): BlueprintTemplate {
  const template = getTemplate(pair.base);
  if (!template) throw new Error(`no template ${pair.base}`);
  return template;
}

/** The upgraded twin, under its own id so the tables can tell the two apart. */
export function upgradedOf(pair: UpgradePair): BlueprintTemplate {
  const base = baseOf(pair);
  return {
    ...base,
    id: `${base.id}+${pair.id}`,
    name: `${base.name} (${pair.label.split(', ')[1]})`,
    blueprint: { ...base.blueprint, ...pair.change },
  };
}

/** Both costs, for the table: the upgrade must be one a player could afford. */
export function upgradeCosts(pair: UpgradePair): { base: number; upgraded: number } {
  return {
    base: blueprintCost(baseOf(pair).blueprint, CATALOG).total,
    upgraded: blueprintCost(upgradedOf(pair).blueprint, CATALOG).total,
  };
}

export type UpgradeLine = {
  pair: UpgradePair;
  races: number;
  /** Races the upgraded twin won, and its share of them. */
  wins: number;
  winRate: number;
  /** The car that led after lap 1 won this share of the races. */
  lap1LeaderWins: number;
  /** Mean time gap at the line, seconds, positive when the upgraded twin was ahead. */
  meanGap: number;
  matches: MatchOutcome[];
};

/** Every pair, armed as it ships, from both grid slots, once per seed. */
export function runUpgradeTest(
  seeds: number[],
  tow: boolean,
  weatherPresetId = NEON_CLEAR,
  pairs: UpgradePair[] = UPGRADE_PAIRS,
): UpgradeLine[] {
  return pairs.map((pair) => {
    const base = baseOf(pair);
    const up = upgradedOf(pair);
    let wins = 0;
    let leaderWins = 0;
    let decided = 0;
    let gap = 0;
    const matches: MatchOutcome[] = [];
    for (const seed of seeds)
      for (const slot of [0, 1] as const) {
        const match =
          slot === 0
            ? runBotMatch(up, base, seed, weatherPresetId, tow)
            : runBotMatch(base, up, seed, weatherPresetId, tow);
        matches.push(match);
        if (match.winner === slot) wins++;
        if (match.lap1Leader >= 0) {
          decided++;
          if (match.winner === match.lap1Leader) leaderWins++;
        }
        // The gap is measured from the first car over the line to the other.
        const sign = match.winner === slot ? 1 : -1;
        gap += sign * (match.gapAtFinish ?? 0);
      }
    const races = matches.length;
    return {
      pair,
      races,
      wins,
      winRate: wins / Math.max(1, races),
      lap1LeaderWins: leaderWins / Math.max(1, decided),
      meanGap: gap / Math.max(1, races),
      matches,
    };
  });
}

/**
 * How far apart the two are on pace alone: weapons off, tow off, first seed, both slots. The
 * mean time gap when the first crossed the line, positive when the upgraded twin was ahead.
 */
export function upgradePace(pair: UpgradePair, seed = 1001): number {
  const base = unarmed(baseOf(pair));
  const up = unarmed(upgradedOf(pair));
  const a = runBotMatch(up, base, seed, NEON_CLEAR, false);
  const b = runBotMatch(base, up, seed, NEON_CLEAR, false);
  const signed = (m: MatchOutcome, slot: number) =>
    (m.winner === slot ? 1 : -1) * (m.gapAtFinish ?? 0);
  return (signed(a, 0) + signed(b, 1)) / 2;
}

/** Sanity of the pairs themselves: legal, within budget, and dearer than the stock build. */
export function checkUpgradePair(pair: UpgradePair): string[] {
  const problems: string[] = [];
  const costs = upgradeCosts(pair);
  if (costs.upgraded > STARTING_CREDITS) problems.push(`costs ${costs.upgraded}`);
  if (costs.upgraded <= costs.base) problems.push('is not dearer than the stock build');
  const conditions = conditionsFor(CITY_01.id, NEON_CLEAR) as BuildConditions;
  if (!raceEntry(upgradedOf(pair).blueprint, conditions)) problems.push('is not a legal build');
  return problems;
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export function formatUpgrades(
  off: UpgradeLine[],
  on: UpgradeLine[],
  pace: Map<string, number>,
): string {
  const lines = [
    '| Upgrade | Cost, stock to upgraded | Pace apart, unarmed, tow off s | Races | Upgraded twin wins, tow off | Tow on | Mean gap at the line s, off | On |',
    '| :-- | :-- | --: | --: | --: | --: | --: | --: |',
  ];
  for (const line of on) {
    const before = off.find((l) => l.pair.id === line.pair.id)!;
    const costs = upgradeCosts(line.pair);
    lines.push(
      `| ${line.pair.label} | ${costs.base} to ${costs.upgraded} | ${(pace.get(line.pair.id) ?? 0).toFixed(2)} | ${line.races} | ${pct(before.winRate)} | ${pct(line.winRate)} | ${before.meanGap.toFixed(2)} | ${line.meanGap.toFixed(2)} |`,
    );
  }
  return lines.join('\n');
}
