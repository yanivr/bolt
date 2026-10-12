import type { BlueprintTemplate } from '@bolt/content';
import { ACCESSORIES, RIVAL_TEMPLATES, raceEntry } from '@bolt/content';
import type { TowTuning } from '@bolt/shared';
import { TOW } from '@bolt/shared';
import type { Contender, MatchOutcome, RacingSummary } from './harness.js';
import { runUpgradeTest } from './upgrade.js';
import {
  NEON_CLEAR,
  WIN_RATE_HIGH,
  WIN_RATE_LOW,
  runBalance,
  runBotMatch,
  runWeaponBench,
  summarize,
} from './harness.js';

/**
 * The tow study: the measurements the tow was tuned against, for one setting of its table at a
 * time, with the tow off as the reference. `npx tsx tests/balance/towStudy.ts` prints one row;
 * docs/evidence/balance/tow-study.md is those rows, every setting that was tried.
 *
 * The four targets of the brief, and two guards:
 * 1. Leading still pays: how often the car ahead at the end of lap 1 wins (aim 60 to 75
 *    percent; under 60 the tow is too strong).
 * 2. No shipped build wins more than 70 percent or less than 30 percent of its races.
 * 3. Combat happens: seconds a race within weapon reach, weapon activations and damage a race.
 * 4. Building well still pays: a build with one clear upgrade against its stock twin, armed
 *    (tests/balance/upgrade.ts), must win clearly more than half.
 * Guards: a faster car still beats a slower one when nobody shoots (the shipped builds with
 * their weapons taken off, every pairing; the car that wins with the tow off must win with it
 * on), and the tow never passes anyone by itself (changes of the lead made by a car that had tow
 * at the time or within the second before).
 */

/** Runs `fn` with the tow table changed, and puts the table back. */
export function withTow<T>(override: Partial<TowTuning> | null, fn: () => T): T {
  const saved = { ...TOW };
  if (override) Object.assign(TOW, override);
  try {
    return fn();
  } finally {
    Object.assign(TOW, saved);
  }
}

/**
 * A shipped build with its weapons taken off and their weight left in as ballast: the same
 * pace as the build that ships, and nothing to shoot with.
 */
export function unarmed(template: BlueprintTemplate): Contender {
  return {
    id: template.id,
    entry: (conditions) => {
      const full = raceEntry(template.blueprint, conditions);
      const bare = raceEntry(
        {
          ...template.blueprint,
          parts: template.blueprint.parts.filter(
            (part) => ACCESSORIES[part.partId]?.category !== 'weapon',
          ),
        },
        conditions,
      );
      if (!full || !bare) throw new Error(`${template.id} is not a legal build`);
      return { build: bare.build, params: full.params, buildHash: bare.buildHash };
    },
  };
}

export type UnarmedRace = {
  /** `a>b#seed`: grid slot 0, grid slot 1, seed. */
  key: string;
  winner: number;
  gapAtFinish: number | null;
  leadChanges: number;
  towPasses: number;
};

/** Every shipped build against every other with no weapons, from both grid slots. */
export function runUnarmedPairs(
  seeds: number[],
  tow: boolean,
  templates: BlueprintTemplate[] = RIVAL_TEMPLATES,
): { races: UnarmedRace[]; matches: MatchOutcome[] } {
  const races: UnarmedRace[] = [];
  const matches: MatchOutcome[] = [];
  for (const a of templates)
    for (const b of templates) {
      if (a.id === b.id) continue;
      for (const seed of seeds) {
        const match = runBotMatch(unarmed(a), unarmed(b), seed, NEON_CLEAR, tow);
        matches.push(match);
        races.push({
          key: `${a.id}>${b.id}#${seed}`,
          winner: match.winner,
          gapAtFinish: match.gapAtFinish,
          leadChanges: match.leadChanges,
          towPasses: match.towPasses,
        });
      }
    }
  return { races, matches };
}

/** One armed race of the study, reduced to what the tables by pace need. */
export type ArmedRace = {
  key: string;
  winner: number;
  uses: number;
  damage: number;
  within15: number;
  withinReach: number;
  beyond3: number;
};

export type TowStudyRow = {
  label: string;
  /** Null for the reference row with the tow off. */
  tuning: TowTuning | null;
  seeds: number[];
  /** The eleven shipped builds, armed, every pairing. */
  armed: RacingSummary;
  winRates: Array<{ id: string; name: string; winRate: number }>;
  outside: string[];
  /** Mean uses a race of each weapon a shipped build carries. */
  weaponUses: Array<{ id: string; meanUses: number; meanDamage: number }>;
  armedRaces?: ArmedRace[];
  unarmed: RacingSummary;
  unarmedRaces: UnarmedRace[];
  /** Target 4: each upgrade pair, armed, the upgraded twin's share of wins and mean gap. */
  upgrades?: Array<{ id: string; label: string; winRate: number; meanGap: number; races: number }>;
  bench: null | {
    racing: RacingSummary;
    lines: Array<{
      id: string;
      meanUses: number;
      meanDamage: number;
      damagePer100: number;
      ratio: number;
      winRate: number;
      wrecks: number;
      heatLimited?: number;
      peakHeat?: number;
    }>;
    medianDamagePer100: number;
  };
  seconds: number;
};

export function measureSetting(
  label: string,
  override: Partial<TowTuning> | null,
  seeds: number[],
  withBench: boolean,
): TowStudyRow {
  const started = Date.now();
  const on = override !== null;
  return withTow(override, () => {
    const balance = runBalance(seeds, NEON_CLEAR, RIVAL_TEMPLATES, on);
    const pairs = runUnarmedPairs(seeds, on);
    const bench = withBench ? runWeaponBench(seeds, NEON_CLEAR, undefined, on) : null;
    const upgrades = runUpgradeTest(seeds, on).map((line) => ({
      id: line.pair.id,
      label: line.pair.label,
      winRate: line.winRate,
      meanGap: line.meanGap,
      races: line.races,
    }));
    return {
      label,
      tuning: on ? { ...TOW } : null,
      seeds,
      armed: balance.racing,
      winRates: balance.templates
        .map((t) => ({ id: t.id, name: t.name, winRate: t.winRate }))
        .sort((x, y) => y.winRate - x.winRate),
      outside: balance.templates
        .filter((t) => t.winRate > WIN_RATE_HIGH || t.winRate < WIN_RATE_LOW)
        .map((t) => `${t.name} ${(t.winRate * 100).toFixed(0)}%`),
      weaponUses: balance.weapons.map((w) => ({
        id: w.id,
        meanUses: w.meanUses,
        meanDamage: w.meanDamage,
      })),
      armedRaces: balance.played.map((m) => ({
        key: `${m.cars[0].templateId}>${m.cars[1].templateId}#${m.seed}`,
        winner: m.winner,
        uses: m.cars.reduce(
          (sum, car) => sum + car.weapons.reduce((n, w) => n + w.tally.uses, 0),
          0,
        ),
        damage: m.cars[0].damageDealt + m.cars[1].damageDealt,
        within15: m.closeness.within15,
        withinReach: m.closeness.withinReach,
        beyond3: m.closeness.beyond3,
      })),
      unarmed: summarize(pairs.matches),
      unarmedRaces: pairs.races,
      upgrades,
      bench: bench && {
        racing: bench.racing,
        lines: bench.lines.map((l) => ({
          id: l.id,
          meanUses: l.meanUses,
          meanDamage: l.meanDamage,
          damagePer100: l.damagePer100,
          ratio: l.ratio,
          winRate: l.winRate,
          wrecks: l.wrecks,
          heatLimited: l.heatLimited,
          peakHeat: l.peakHeat,
        })),
        medianDamagePer100: bench.medianDamagePer100,
      },
      seconds: (Date.now() - started) / 1000,
    };
  });
}

export type UnarmedVerdict = {
  races: number;
  /** Races whose winner with the tow off also won with it on. */
  held: number;
  /** The ones that did not, with the gap the off race was won by. */
  flipped: Array<{ key: string; offGap: number | null; onGap: number | null }>;
  meanGapOff: number;
  meanGapOn: number;
  towPasses: number;
  leadChanges: number;
};

/** Target 4 and 5: the unarmed races of a row against the same races with the tow off. */
export function unarmedVerdict(off: TowStudyRow, on: TowStudyRow): UnarmedVerdict {
  const reference = new Map(off.unarmedRaces.map((race) => [race.key, race]));
  let held = 0;
  let gapOff = 0;
  let gapOn = 0;
  let gaps = 0;
  const flipped: UnarmedVerdict['flipped'] = [];
  for (const race of on.unarmedRaces) {
    const before = reference.get(race.key);
    if (!before) continue;
    if (before.winner === race.winner) held++;
    else flipped.push({ key: race.key, offGap: before.gapAtFinish, onGap: race.gapAtFinish });
    if (before.gapAtFinish !== null && race.gapAtFinish !== null) {
      gapOff += before.gapAtFinish;
      gapOn += race.gapAtFinish;
      gaps++;
    }
  }
  return {
    races: on.unarmedRaces.length,
    held,
    flipped,
    meanGapOff: gapOff / Math.max(1, gaps),
    meanGapOn: gapOn / Math.max(1, gaps),
    towPasses: on.unarmedRaces.reduce((sum, race) => sum + race.towPasses, 0),
    leadChanges: on.unarmedRaces.reduce((sum, race) => sum + race.leadChanges, 0),
  };
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export const STUDY_HEADER = [
  '| Setting | threshold / engage / full s | bonus | ramp up / down per s | 1. Lap 1 leader wins | 2. Builds outside 30 to 70% | 3. s within 220 px a race | 3. Activations a race | 3. Damage a race | 4. Upgraded twin wins, each pair | Within 1.5 s | Beyond 3 s | Lead changes a race | Passes with tow, armed | Unarmed: off winner still wins | Unarmed: gap at finish s, off to on | Unarmed: passes with tow |',
  '| :-- | :-- | --: | :-- | --: | :-- | --: | --: | --: | :-- | --: | --: | --: | --: | --: | :-- | --: |',
];

export function formatStudyRow(row: TowStudyRow, off: TowStudyRow): string {
  const t = row.tuning;
  const v = unarmedVerdict(off, row);
  return (
    `| ${row.label} | ${t ? `${t.thresholdGap} / ${t.engageGap} / ${t.fullGap}` : 'n/a'} | ${t ? pct(t.maxBonus) : 'off'} | ` +
    `${t ? `${t.rampUpPerSecond} / ${t.rampDownPerSecond}` : 'n/a'} | ${pct(row.armed.lap1LeaderWins)} | ` +
    `${row.outside.length}: ${row.outside.join(', ')} | ${row.armed.reachSecondsPerRace.toFixed(1)} | ` +
    `${row.armed.usesPerRace.toFixed(1)} | ${row.armed.damagePerRace.toFixed(0)} | ` +
    `${(row.upgrades ?? []).map((u) => pct(u.winRate)).join(' ')} | ${pct(row.armed.within15)} | ` +
    `${pct(row.armed.beyond3)} | ${row.armed.leadChangesPerRace.toFixed(2)} | ${row.armed.towPasses} | ` +
    `${v.held} of ${v.races} | ${v.meanGapOff.toFixed(2)} to ${v.meanGapOn.toFixed(2)} | ${v.towPasses} of ${v.leadChanges} |`
  );
}

/**
 * The armed races sorted by how far apart the two builds are on pace alone: the mean gap at the
 * line of the same pairing unarmed with the tow off. This is the table that says where the tow
 * can hold two cars together and where the builds are simply too far apart for it.
 */
export const PACE_BANDS: Array<{ label: string; below: number }> = [
  { label: 'under 2 s', below: 2 },
  { label: '2 to 5 s', below: 5 },
  { label: '5 to 12 s', below: 12 },
  { label: 'over 12 s', below: Infinity },
];

export type PaceBandLine = {
  label: string;
  pairings: number;
  races: number;
  uses: [number, number];
  damage: [number, number];
  within15: [number, number];
  withinReach: [number, number];
  beyond3: [number, number];
};

export function byPace(off: TowStudyRow, on: TowStudyRow): PaceBandLine[] {
  const pairOf = (key: string) => key.split('#')[0]!.split('>').sort().join(' v ');
  const pace = new Map<string, { sum: number; n: number }>();
  for (const race of off.unarmedRaces) {
    const entry = pace.get(pairOf(race.key)) ?? { sum: 0, n: 0 };
    entry.sum += race.gapAtFinish ?? 0;
    entry.n++;
    pace.set(pairOf(race.key), entry);
  }
  const before = new Map((off.armedRaces ?? []).map((race) => [race.key, race]));
  return PACE_BANDS.map((band, index) => {
    const low = index === 0 ? -Infinity : PACE_BANDS[index - 1]!.below;
    const inBand = (key: string) => {
      const entry = pace.get(pairOf(key));
      const gap = entry ? entry.sum / Math.max(1, entry.n) : Infinity;
      return gap >= low && gap < band.below;
    };
    const races = (on.armedRaces ?? []).filter((race) => inBand(race.key));
    const n = Math.max(1, races.length);
    const mean = (pick: (race: ArmedRace) => number): [number, number] => [
      races.reduce((sum, race) => sum + pick(before.get(race.key) ?? race), 0) / n,
      races.reduce((sum, race) => sum + pick(race), 0) / n,
    ];
    return {
      label: band.label,
      pairings: new Set(races.map((race) => pairOf(race.key))).size,
      races: races.length,
      uses: mean((race) => race.uses),
      damage: mean((race) => race.damage),
      within15: mean((race) => race.within15),
      withinReach: mean((race) => race.withinReach),
      beyond3: mean((race) => race.beyond3),
    };
  });
}
