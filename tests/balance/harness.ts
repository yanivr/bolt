import type { BlueprintTemplate } from '@bolt/content';
import {
  ACCESSORIES,
  CATALOG,
  CITY_01,
  RIVAL_TEMPLATES,
  WEAPON_LIST,
  conditionsFor,
  environmentFor,
  raceEntry,
} from '@bolt/content';
import type {
  BuildConditions,
  RaceBrain,
  RaceEntry,
  RaceEnvironment,
  RaceResult,
  RaceSession,
  TrackRuntime,
} from '@bolt/shared';
import {
  SIM_DT,
  blueprintCost,
  buildHash,
  buildTrack,
  createRace,
  createSparringBrain,
  deriveVehicleParams,
  resolveBlueprint,
  stepRaceWithBrains,
} from '@bolt/shared';
import type { TestPart } from '../helpers/combat.js';
import { testBlueprint } from '../helpers/combat.js';

/**
 * The combat balance harness: sparring brain against sparring brain, every starter and example
 * build against every other on Neon Cut, over a set of seeds. It measures what Section 13 asks
 * to be watched: who wins, how long a car lasts, and what a weapon's price buys in damage.
 *
 * Both cars are driven by the same honest sparring driver, so the numbers compare builds, not
 * drivers. They are not predictions of what skilled players will do with the same cars.
 */

export const NEON_CLEAR = 'city_clear_night';
export const NEON_RAIN = 'city_rain_night';

let neon: TrackRuntime | null = null;
export function neonCut(): TrackRuntime {
  neon ??= buildTrack(CITY_01);
  return neon;
}

export type BotMatch = {
  race: RaceSession;
  brains: RaceBrain[];
};

/** What the harness needs to know of a car: an id for the tables and a grid entry. */
export type Contender = { id: string; entry: (conditions: BuildConditions) => RaceEntry };

function contenderOf(template: BlueprintTemplate): Contender {
  return {
    id: template.id,
    entry: (conditions) => {
      const entry = raceEntry(template.blueprint, conditions);
      if (!entry) throw new Error(`${template.id} is not a legal build`);
      return entry;
    },
  };
}

/** A race between two cars with a sparring brain in each. */
export function createBotMatch(
  a: BlueprintTemplate | Contender,
  b: BlueprintTemplate | Contender,
  seed: number,
  weatherPresetId = NEON_CLEAR,
): BotMatch {
  const env = environmentFor(weatherPresetId) as RaceEnvironment;
  const conditions = conditionsFor(CITY_01.id, weatherPresetId) as BuildConditions;
  const entries = [a, b].map((car) => ('entry' in car ? car : contenderOf(car)).entry(conditions));
  const race = createRace(neonCut(), env, entries, { seed, conditions, catalog: CATALOG });
  return {
    race,
    brains: [createSparringBrain(seed ^ 0x1b873593), createSparringBrain(seed ^ 0x2545f491)],
  };
}

export type WeaponTally = {
  /** Integrity removed, shields and armor included. */
  damage: number;
  uses: number;
};

export type CarOutcome = {
  templateId: string;
  finished: boolean;
  finishSeconds: number | null;
  ko: boolean;
  /** Race time at which the chassis first reached zero, or null. */
  wreckSeconds: number | null;
  damageDealt: number;
  damageTaken: number;
  chassisLeft: number;
  /** Per mounted weapon, in mount order. */
  weapons: Array<{ id: string; tally: WeaponTally }>;
};

export type MatchOutcome = {
  seed: number;
  winner: number;
  reason: RaceResult['reason'];
  raceSeconds: number;
  ticks: number;
  cars: [CarOutcome, CarOutcome];
};

const TICK_LIMIT = 60 * 60 * 4;

/** Runs a bot match to its result. */
export function runBotMatch(
  a: BlueprintTemplate | Contender,
  b: BlueprintTemplate | Contender,
  seed: number,
  weatherPresetId = NEON_CLEAR,
): MatchOutcome {
  const { race, brains } = createBotMatch(a, b, seed, weatherPresetId);
  const wreck: Array<number | null> = [null, null];
  let ticks = 0;
  while (race.phase !== 'FINISHED' && ticks < TICK_LIMIT) {
    stepRaceWithBrains(race, [], brains);
    ticks++;
    for (const car of race.cars)
      if (wreck[car.index] === null && car.chassis <= 0) wreck[car.index] = race.raceTicks * SIM_DT;
  }
  const result = race.result;
  if (!result) throw new Error(`${a.id} against ${b.id} (seed ${seed}) never ended`);
  const outcome = (index: number, template: { id: string }): CarOutcome => {
    const car = race.cars[index]!;
    const summary = result.cars[index]!;
    return {
      templateId: template.id,
      finished: summary.finished,
      finishSeconds: summary.finishTimeMs === null ? null : summary.finishTimeMs / 1000,
      ko: summary.ko,
      wreckSeconds: wreck[index] ?? null,
      damageDealt: summary.damageDealt,
      damageTaken: summary.damageTaken,
      chassisLeft: car.chassis / car.chassisMax,
      weapons: car.specs
        .filter((spec) => spec.category === 'weapon')
        .map((spec) => ({
          id: spec.id,
          tally: {
            damage: car.stats.damageByPart[spec.part] ?? 0,
            uses: car.stats.usesByPart[spec.part] ?? 0,
          },
        })),
    };
  };
  return {
    seed,
    winner: result.winner,
    reason: result.reason,
    raceSeconds: result.raceTimeMs / 1000,
    ticks,
    cars: [outcome(0, a), outcome(1, b)],
  };
}

export type TemplateLine = {
  id: string;
  name: string;
  cost: number;
  matches: number;
  wins: number;
  draws: number;
  winRate: number;
  koWins: number;
  koLosses: number;
  /** Matches in which the chassis reached zero, and the mean race time at which it did. */
  wrecked: number;
  meanWreckSeconds: number | null;
  meanDamageDealt: number;
  meanDamageTaken: number;
  meanFinishSeconds: number | null;
  dnf: number;
};

export type WeaponLine = {
  id: string;
  name: string;
  price: number;
  /** Car-matches the weapon was mounted for (a car with two counts twice). */
  mounted: number;
  meanDamage: number;
  meanUses: number;
  /** Mean damage a match for each 100 credits of its price. */
  damagePer100: number;
  /** `damagePer100` over the median of all weapons that were raced. */
  ratio: number;
};

export type BalanceReport = {
  weatherPresetId: string;
  seeds: number[];
  matches: number;
  meanRaceSeconds: number;
  reasons: Record<string, number>;
  templates: TemplateLine[];
  weapons: WeaponLine[];
  medianDamagePer100: number;
  /** winRate[a][b]: share of its matches against b that a won, by template id. */
  matrix: Record<string, Record<string, number>>;
  flags: string[];
};

export const WIN_RATE_HIGH = 0.7;
export const WIN_RATE_LOW = 0.3;
export const DAMAGE_RATIO_HIGH = 2;
export const DAMAGE_RATIO_LOW = 0.5;

/**
 * Weapons whose job is not damage: they slow, blind, shove or hold. They are measured, but
 * they neither set the median damage per credit nor are flagged against it; what they are
 * worth shows in the win rate and the lead at the finish.
 */
export const CONTROL_WEAPONS: ReadonlySet<string> = new Set([
  'weapon_oil',
  'weapon_foam',
  'weapon_emp',
  'weapon_frost',
  'weapon_harpoon',
  'weapon_air',
]);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Every template against every other, from both grid slots, once per seed.
 * `templates` defaults to the eleven starter and example builds.
 */
export function runBalance(
  seeds: number[],
  weatherPresetId = NEON_CLEAR,
  templates: BlueprintTemplate[] = RIVAL_TEMPLATES,
): BalanceReport {
  type Acc = {
    matches: number;
    wins: number;
    draws: number;
    koWins: number;
    koLosses: number;
    wrecked: number;
    wreckSeconds: number;
    dealt: number;
    taken: number;
    finishes: number;
    finishSeconds: number;
  };
  const acc = new Map<string, Acc>();
  const pair = new Map<string, { wins: number; matches: number }>();
  const weapon = new Map<string, { mounted: number; damage: number; uses: number }>();
  const reasons: Record<string, number> = {};
  let matches = 0;
  let seconds = 0;
  const of = (id: string) => {
    let entry = acc.get(id);
    if (!entry) {
      entry = {
        matches: 0,
        wins: 0,
        draws: 0,
        koWins: 0,
        koLosses: 0,
        wrecked: 0,
        wreckSeconds: 0,
        dealt: 0,
        taken: 0,
        finishes: 0,
        finishSeconds: 0,
      };
      acc.set(id, entry);
    }
    return entry;
  };

  for (const a of templates)
    for (const b of templates) {
      if (a.id === b.id) continue;
      for (const seed of seeds) {
        const match = runBotMatch(a, b, seed, weatherPresetId);
        matches++;
        seconds += match.raceSeconds;
        reasons[match.reason] = (reasons[match.reason] ?? 0) + 1;
        match.cars.forEach((car, index) => {
          const entry = of(car.templateId);
          const other = match.cars[1 - index]!;
          entry.matches++;
          if (match.winner === index) entry.wins++;
          else if (match.winner < 0) entry.draws++;
          if (match.reason === 'ko' && match.winner === index) entry.koWins++;
          if (car.ko) entry.koLosses++;
          if (car.wreckSeconds !== null) {
            entry.wrecked++;
            entry.wreckSeconds += car.wreckSeconds;
          }
          entry.dealt += car.damageDealt;
          entry.taken += car.damageTaken;
          if (car.finishSeconds !== null) {
            entry.finishes++;
            entry.finishSeconds += car.finishSeconds;
          }
          const key = `${car.templateId}>${other.templateId}`;
          const versus = pair.get(key) ?? { wins: 0, matches: 0 };
          versus.matches++;
          if (match.winner === index) versus.wins++;
          pair.set(key, versus);
          for (const mounted of car.weapons) {
            const line = weapon.get(mounted.id) ?? { mounted: 0, damage: 0, uses: 0 };
            line.mounted++;
            line.damage += mounted.tally.damage;
            line.uses += mounted.tally.uses;
            weapon.set(mounted.id, line);
          }
        });
      }
    }

  const templateLines: TemplateLine[] = templates.map((template) => {
    const entry = of(template.id);
    const n = Math.max(1, entry.matches);
    const cost = blueprintCost(template.blueprint, CATALOG).total;
    return {
      id: template.id,
      name: template.name,
      cost,
      matches: entry.matches,
      wins: entry.wins,
      draws: entry.draws,
      winRate: entry.wins / n,
      koWins: entry.koWins,
      koLosses: entry.koLosses,
      wrecked: entry.wrecked,
      meanWreckSeconds: entry.wrecked > 0 ? entry.wreckSeconds / entry.wrecked : null,
      meanDamageDealt: entry.dealt / n,
      meanDamageTaken: entry.taken / n,
      meanFinishSeconds: entry.finishes > 0 ? entry.finishSeconds / entry.finishes : null,
      dnf: entry.matches - entry.finishes,
    };
  });

  const raw = [...weapon].map(([id, line]) => {
    const def = ACCESSORIES[id];
    const price = def?.price ?? 0;
    const meanDamage = line.damage / Math.max(1, line.mounted);
    return {
      id,
      name: def?.displayName ?? id,
      price,
      mounted: line.mounted,
      meanDamage,
      meanUses: line.uses / Math.max(1, line.mounted),
      damagePer100: price > 0 ? (meanDamage / price) * 100 : 0,
    };
  });
  const damaging = raw.filter((line) => !CONTROL_WEAPONS.has(line.id));
  const mid = median(damaging.map((line) => line.damagePer100));
  const weapons: WeaponLine[] = raw
    .map((line) => ({ ...line, ratio: mid > 0 ? line.damagePer100 / mid : 0 }))
    .sort((x, y) => y.damagePer100 - x.damagePer100);

  const matrix: Record<string, Record<string, number>> = {};
  for (const [key, versus] of pair) {
    const [x, y] = key.split('>') as [string, string];
    (matrix[x] ??= {})[y] = versus.wins / Math.max(1, versus.matches);
  }

  const flags: string[] = [];
  for (const line of templateLines) {
    if (line.winRate > WIN_RATE_HIGH)
      flags.push(`${line.name} wins ${(line.winRate * 100).toFixed(0)}% of its matches`);
    if (line.winRate < WIN_RATE_LOW)
      flags.push(`${line.name} wins only ${(line.winRate * 100).toFixed(0)}% of its matches`);
  }
  for (const line of weapons) {
    if (CONTROL_WEAPONS.has(line.id)) continue;
    if (line.ratio > DAMAGE_RATIO_HIGH)
      flags.push(`${line.name} deals ${line.ratio.toFixed(1)}x the median damage per credit`);
    if (line.ratio < DAMAGE_RATIO_LOW)
      flags.push(`${line.name} deals ${line.ratio.toFixed(2)}x the median damage per credit`);
  }

  return {
    weatherPresetId,
    seeds,
    matches,
    meanRaceSeconds: seconds / Math.max(1, matches),
    reasons,
    templates: templateLines,
    weapons,
    medianDamagePer100: mid,
    matrix,
    flags,
  };
}

const f = (v: number | null, d = 1) => (v === null ? 'n/a' : v.toFixed(d));
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** The report as Markdown. */
export function formatBalance(report: BalanceReport): string {
  const lines: string[] = [];
  lines.push(
    `Weather \`${report.weatherPresetId}\`, seeds ${report.seeds.join(', ')}: ${report.matches} matches, ` +
      `mean race ${f(report.meanRaceSeconds)} s. Ended by: ` +
      Object.entries(report.reasons)
        .map(([reason, n]) => `${reason} ${n}`)
        .join(', ') +
      '.',
  );
  lines.push('');
  lines.push(
    '| Build | Cost | Matches | Win rate | KO wins | KO losses | Wrecked (chassis 0) | Mean time to wreck s | Damage dealt | Damage taken | Mean finish s | DNF |',
  );
  lines.push('| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const t of [...report.templates].sort((x, y) => y.winRate - x.winRate))
    lines.push(
      `| ${t.name} | ${t.cost} | ${t.matches} | ${pct(t.winRate)} | ${t.koWins} | ${t.koLosses} | ${t.wrecked} | ${f(t.meanWreckSeconds)} | ${f(t.meanDamageDealt)} | ${f(t.meanDamageTaken)} | ${f(t.meanFinishSeconds)} | ${t.dnf} |`,
    );
  lines.push('');
  lines.push(
    `| Weapon | Price | Car-matches | Mean uses | Mean damage | Damage per 100 credits | Against median (${f(report.medianDamagePer100)}) |`,
  );
  lines.push('| :-- | --: | --: | --: | --: | --: | --: |');
  for (const w of report.weapons)
    lines.push(
      `| ${w.name} | ${w.price} | ${w.mounted} | ${f(w.meanUses)} | ${f(w.meanDamage)} | ${f(w.damagePer100)} | ${CONTROL_WEAPONS.has(w.id) ? 'control' : `${f(w.ratio, 2)}x`} |`,
    );
  lines.push('');
  lines.push(report.flags.length > 0 ? 'Flags:' : 'Flags: none.');
  for (const flag of report.flags) lines.push(`- ${flag}`);
  return lines.join('\n');
}

// --- Weapon bench ----------------------------------------------------------------------------

/**
 * Only seven of the twenty weapons are on a shipped build, so the template matrix cannot price
 * the rest. The bench gives every weapon the same ride: one copy on a stock Spider, against the
 * same Spider with nothing mounted. Identical cars stay in each other's company for the whole
 * race, so this is close to the most a weapon can do in two minutes, not a typical race.
 */
function benchCar(id: string, parts: TestPart[], massOf?: Contender): Contender {
  const blueprint = testBlueprint({ chassis: 'chassis_spider', parts }, id);
  return {
    id,
    entry: (conditions) => {
      const built = resolveBlueprint(blueprint, CATALOG);
      if (!built || built.unresolved.length > 0) throw new Error(`${id} does not resolve`);
      const params = deriveVehicleParams(built, conditions);
      // The unarmed twin carries dead weight equal to the weapon, so the two cars have the same
      // pace and the weapon is the only difference between them.
      if (massOf) params.massKg = massOf.entry(conditions).params.massKg;
      return { build: built, params, buildHash: buildHash(blueprint) };
    },
  };
}

function benchMount(id: string): TestPart {
  const def = ACCESSORIES[id]!;
  const pressed = def.triggerMode === 'automatic' || def.triggerMode === 'passive' ? undefined : 0;
  if (id === 'weapon_mine' || id === 'weapon_oil')
    return { id, mount: 'rear_utility', turn: 2, fire: 0 };
  if (id === 'weapon_rear_mg') return { id, mount: 'roof_mid', turn: 2 };
  if (id === 'weapon_saw') return { id, mount: 'right_front', turn: 1 };
  if (id === 'weapon_turret' || id === 'weapon_mortar')
    return { id, mount: 'roof_front', fire: 'auto' };
  return pressed === undefined
    ? { id, mount: 'roof_front' }
    : { id, mount: 'roof_front', fire: pressed };
}

export type BenchLine = {
  id: string;
  name: string;
  price: number;
  matches: number;
  meanUses: number;
  meanDamage: number;
  damagePer100: number;
  ratio: number;
  /** Share of matches the armed car won against its unarmed twin. */
  winRate: number;
  /** Mean finish time of the unarmed twin less the armed car's, seconds: what the weapon cost its victim. */
  meanLeadSeconds: number | null;
  wrecks: number;
};

export type WeaponBench = {
  weatherPresetId: string;
  seeds: number[];
  lines: BenchLine[];
  medianDamagePer100: number;
  flags: string[];
};

export function runWeaponBench(
  seeds: number[],
  weatherPresetId = NEON_CLEAR,
  ids: string[] = WEAPON_LIST.map((w) => w.id),
): WeaponBench {
  const raw = ids.map((id) => {
    const def = ACCESSORIES[id]!;
    const armed = benchCar(`bench_${id}`, [benchMount(id)]);
    const twin = benchCar('bench_unarmed', [], armed);
    let matches = 0;
    let uses = 0;
    let damage = 0;
    let wins = 0;
    let lead = 0;
    let leads = 0;
    let wrecks = 0;
    for (const seed of seeds)
      for (const slot of [0, 1] as const) {
        const match =
          slot === 0
            ? runBotMatch(armed, twin, seed, weatherPresetId)
            : runBotMatch(twin, armed, seed, weatherPresetId);
        const mine = match.cars[slot];
        const theirs = match.cars[1 - slot]!;
        matches++;
        uses += mine.weapons[0]?.tally.uses ?? 0;
        damage += mine.weapons[0]?.tally.damage ?? 0;
        if (match.winner === slot) wins++;
        if (theirs.wreckSeconds !== null) wrecks++;
        if (mine.finishSeconds !== null && theirs.finishSeconds !== null) {
          lead += theirs.finishSeconds - mine.finishSeconds;
          leads++;
        }
      }
    const meanDamage = damage / matches;
    return {
      id,
      name: def.displayName,
      price: def.price,
      matches,
      meanUses: uses / matches,
      meanDamage,
      damagePer100: (meanDamage / def.price) * 100,
      winRate: wins / matches,
      meanLeadSeconds: leads > 0 ? lead / leads : null,
      wrecks,
    };
  });
  const mid = median(
    raw.filter((line) => !CONTROL_WEAPONS.has(line.id)).map((line) => line.damagePer100),
  );
  const lines = raw
    .map((line) => ({ ...line, ratio: mid > 0 ? line.damagePer100 / mid : 0 }))
    .sort((x, y) => y.damagePer100 - x.damagePer100);
  const flags: string[] = [];
  for (const line of lines) {
    if (CONTROL_WEAPONS.has(line.id)) continue;
    if (line.ratio > DAMAGE_RATIO_HIGH)
      flags.push(`${line.name} deals ${line.ratio.toFixed(1)}x the median damage per credit`);
    if (line.ratio < DAMAGE_RATIO_LOW)
      flags.push(`${line.name} deals ${line.ratio.toFixed(2)}x the median damage per credit`);
  }
  return { weatherPresetId, seeds, lines, medianDamagePer100: mid, flags };
}

export function formatBench(bench: WeaponBench): string {
  const lines: string[] = [];
  lines.push(
    `Weapon bench, weather \`${bench.weatherPresetId}\`, seeds ${bench.seeds.join(', ')}: one copy on a stock Spider against the same Spider with ballast in place of the weapon, from both grid slots.`,
  );
  lines.push('');
  lines.push(
    `| Weapon | Price | Matches | Mean uses | Mean damage | Damage per 100 credits | Against median (${f(bench.medianDamagePer100)}) | Wins against unarmed twin | Mean lead at the finish s | Twin wrecked |`,
  );
  lines.push('| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const w of bench.lines)
    lines.push(
      `| ${w.name} | ${w.price} | ${w.matches} | ${f(w.meanUses)} | ${f(w.meanDamage)} | ${f(w.damagePer100)} | ${CONTROL_WEAPONS.has(w.id) ? 'control' : `${f(w.ratio, 2)}x`} | ${pct(w.winRate)} | ${f(w.meanLeadSeconds, 2)} | ${w.wrecks} |`,
    );
  lines.push('');
  lines.push(bench.flags.length > 0 ? 'Flags:' : 'Flags: none.');
  for (const flag of bench.flags) lines.push(`- ${flag}`);
  return lines.join('\n');
}
