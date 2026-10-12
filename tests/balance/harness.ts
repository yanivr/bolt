import type { BlueprintTemplate } from '@bolt/content';
import {
  ACCESSORIES,
  CATALOG,
  CITY_01,
  RIVAL_TEMPLATES,
  WEAPON_LIST,
  conditionsFor,
  environmentFor,
  getTrack,
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
  TOW,
  blueprintCost,
  buildHash,
  buildTrack,
  createRace,
  createSparringBrain,
  deriveVehicleParams,
  towShareOf,
  expBlend,
  resolveBlueprint,
  stepRaceWithBrains,
  towTimeGap,
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

/**
 * Where a harness race is run. Every function here takes a weather preset id where it used to
 * mean Neon Cut, and still does; `courseId(trackId, presetId)` names any track and weather as
 * `track/preset`, so the same harness runs on all eight tracks (Milestone D).
 */
export function courseId(trackId: string, presetId: string): string {
  return `${trackId}/${presetId}`;
}

export function courseOf(id: string): { track: TrackRuntime; trackId: string; presetId: string } {
  const slash = id.indexOf('/');
  if (slash < 0) return { track: neonCut(), trackId: CITY_01.id, presetId: id };
  const trackId = id.slice(0, slash);
  const presetId = id.slice(slash + 1);
  const def = getTrack(trackId);
  if (!def) throw new Error(`no track ${trackId}`);
  return { track: buildTrack(def), trackId, presetId };
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
  tow = true,
): BotMatch {
  const course = courseOf(weatherPresetId);
  const env = environmentFor(course.presetId) as RaceEnvironment;
  const conditions = conditionsFor(course.trackId, course.presetId) as BuildConditions;
  const entries = [a, b].map((car) => ('entry' in car ? car : contenderOf(car)).entry(conditions));
  const race = createRace(course.track, env, entries, { seed, conditions, catalog: CATALOG, tow });
  return {
    race,
    brains: [createSparringBrain(seed ^ 0x1b873593), createSparringBrain(seed ^ 0x2545f491)],
  };
}

export type WeaponTally = {
  /** Integrity removed, shields and armor included. */
  damage: number;
  /** Activations: a burst of the machine gun is one. */
  uses: number;
  /** Rounds and beams that left the weapon: a three-round burst is three (`shot` and `beam` events). */
  rounds: number;
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
  /** Share of the race the car spent at or above its thermal performance threshold. */
  heatLimited: number;
  /** Highest core heat it reached (performance falls from 90, protection is at 110). */
  peakHeat: number;
  /** Share of the race the car was in thermal protection: weapons that heat refuse ("Too hot"). */
  thermalBlocked: number;
  /** Per mounted weapon, in mount order. */
  weapons: Array<{ id: string; tally: WeaponTally }>;
};

/**
 * How close a race was, tick by tick, while both cars were racing. The time gap is the tow's
 * own measure (distance along the course over the trailing car's recent average speed), kept
 * here by the harness so it reads the same with the tow off.
 */
export type Closeness = {
  /** Ticks both cars were racing. Every share below is of these. */
  ticks: number;
  meanGapSeconds: number;
  /** Share of the race with a time gap of at most 1 s, at most 1.5 s, and more than 3 s. */
  within1: number;
  within15: number;
  beyond3: number;
  /** Share of the race the two cars were within the bullet guns' reach of each other. */
  withinReach: number;
  /** The same in seconds: how long the race gave the two cars to fight at that reach. */
  reachSeconds: number;
};

/** Distance between the cars, centre to centre, the three bullet guns reach. */
export const WEAPON_REACH_PX = 220;
/** Changes of the lead are counted from here on, so the scramble off the grid is not one. */
export const LEAD_CHANGE_FROM_SECONDS = 5;
/** A pass counts against the tow if the passing car had any within this long before it. */
export const TOW_PASS_WINDOW_SECONDS = 1;

export type MatchOutcome = {
  seed: number;
  winner: number;
  reason: RaceResult['reason'];
  raceSeconds: number;
  ticks: number;
  cars: [CarOutcome, CarOutcome];
  closeness: Closeness;
  /** Changes of the lead after the first five seconds. */
  leadChanges: number;
  /** Of those, the ones made by a car that had tow at the time or within the second before. */
  towPasses: number;
  /** The car that completed the first lap first, or -1 if none did. */
  lap1Leader: number;
  /** The time gap between the cars when the first of them crossed the line, seconds. */
  gapAtFinish: number | null;
  /** Share of the racing ticks each car had any tow. */
  towShare: [number, number];
};

const TICK_LIMIT = 60 * 60 * 4;

/** Runs a bot match to its result. */
export function runBotMatch(
  a: BlueprintTemplate | Contender,
  b: BlueprintTemplate | Contender,
  seed: number,
  weatherPresetId = NEON_CLEAR,
  tow = true,
): MatchOutcome {
  const { race, brains } = createBotMatch(a, b, seed, weatherPresetId, tow);
  const wreck: Array<number | null> = [null, null];
  let ticks = 0;
  const blend = expBlend(SIM_DT, TOW.speedAverageSeconds);
  const average = [0, 0];
  const peakHeat = [0, 0];
  const blocked = [0, 0];
  const rounds = new Map<string, number>();
  const lastTow = [-1e9, -1e9];
  const towTicks = [0, 0];
  let both = 0;
  let gapSum = 0;
  let within1 = 0;
  let within15 = 0;
  let beyond3 = 0;
  let withinReach = 0;
  let leadChanges = 0;
  let towPasses = 0;
  let lap1Leader = -1;
  let gapAtFinish: number | null = null;
  const leadFrom = LEAD_CHANGE_FROM_SECONDS / SIM_DT;
  const passWindow = TOW_PASS_WINDOW_SECONDS / SIM_DT;
  while (race.phase !== 'FINISHED' && ticks < TICK_LIMIT) {
    stepRaceWithBrains(race, [], brains);
    ticks++;
    for (const car of race.cars)
      if (wreck[car.index] === null && car.chassis <= 0) wreck[car.index] = race.raceTicks * SIM_DT;
    if (race.raceTicks === 0) continue;
    const [c0, c1] = race.cars as [(typeof race.cars)[0], (typeof race.cars)[0]];
    for (const car of race.cars) {
      average[car.index]! += (car.session.telemetry.speed - average[car.index]!) * blend;
      peakHeat[car.index] = Math.max(peakHeat[car.index]!, car.session.motion.coreHeat);
      if (car.session.motion.thermalLimited) blocked[car.index]!++;
      if (towShareOf(car) > 0) {
        lastTow[car.index] = race.raceTicks;
        towTicks[car.index]!++;
      }
    }
    for (const event of race.events) {
      if (event.type === 'shot' || event.type === 'beam') {
        const key = `${event.car}:${event.part}`;
        rounds.set(key, (rounds.get(key) ?? 0) + 1);
      }
      if (event.type === 'lap' && event.lap === 1 && lap1Leader < 0) lap1Leader = event.car;
      if (event.type === 'finish' && event.finished && gapAtFinish === null) {
        const other = race.cars[1 - event.car]!;
        gapAtFinish = towTimeGap(
          race.cars[event.car]!.session.progress.courseProgress -
            other.session.progress.courseProgress,
          average[other.index]!,
        );
      }
      if (event.type === 'position' && race.raceTicks > leadFrom) {
        leadChanges++;
        if (race.raceTicks - lastTow[event.leader]! <= passWindow) towPasses++;
      }
    }
    if (c0.session.phase === 'RACING' && c1.session.phase === 'RACING' && !c0.ko && !c1.ko) {
      const d = c0.session.progress.courseProgress - c1.session.progress.courseProgress;
      const gap = towTimeGap(Math.abs(d), average[d >= 0 ? 1 : 0]!);
      both++;
      gapSum += gap;
      if (gap <= 1) within1++;
      if (gap <= 1.5) within15++;
      if (gap > 3) beyond3++;
      const m0 = c0.session.motion;
      const m1 = c1.session.motion;
      if (Math.hypot(m0.x - m1.x, m0.y - m1.y) <= WEAPON_REACH_PX) withinReach++;
    }
  }
  const n = Math.max(1, both);
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
      heatLimited: car.stats.heatLimitedTicks / Math.max(1, race.raceTicks),
      peakHeat: peakHeat[index]!,
      thermalBlocked: blocked[index]! / Math.max(1, race.raceTicks),
      weapons: car.specs
        .filter((spec) => spec.category === 'weapon')
        .map((spec) => ({
          id: spec.id,
          tally: {
            damage: car.stats.damageByPart[spec.part] ?? 0,
            uses: car.stats.usesByPart[spec.part] ?? 0,
            rounds: rounds.get(`${index}:${spec.part}`) ?? 0,
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
    closeness: {
      ticks: both,
      meanGapSeconds: gapSum / n,
      within1: within1 / n,
      within15: within15 / n,
      beyond3: beyond3 / n,
      withinReach: withinReach / n,
      reachSeconds: withinReach * SIM_DT,
    },
    leadChanges,
    towPasses,
    lap1Leader,
    gapAtFinish,
    towShare: [towTicks[0]! / n, towTicks[1]! / n],
  };
}

/** Means of a set of matches: what the report says about how close the racing was. */
export type RacingSummary = {
  matches: number;
  meanGapSeconds: number;
  within1: number;
  within15: number;
  beyond3: number;
  withinReach: number;
  /** Share of matches by how much of the race was spent within 1.5 s: under a tenth, a tenth to a half, more. */
  within15Spread: [number, number, number];
  /** Mean seconds a race the cars spent within `WEAPON_REACH_PX` of each other. */
  reachSecondsPerRace: number;
  /** Share of matches by seconds within reach, in the bands of `REACH_BANDS`. */
  reachSpread: number[];
  leadChangesPerRace: number;
  /** Share of matches with 0, 1, 2 and 3 or more changes of the lead. */
  leadChangeSpread: [number, number, number, number];
  towPasses: number;
  /** Share of matches the car that led at the end of the first lap went on to win. */
  lap1LeaderWins: number;
  lap1Decided: number;
  /** Weapon activations a race, both cars together, and rounds that left a weapon. */
  usesPerRace: number;
  roundsPerRace: number;
  damagePerRace: number;
  /** Share of the race a car spent with any tow, averaged over both cars. */
  towShare: number;
};

/** Bands for the distribution of seconds within reach in a race: [from, to). */
export const REACH_BANDS: Array<[number, number]> = [
  [0, 1],
  [1, 5],
  [5, 15],
  [15, 30],
  [30, 60],
  [60, Infinity],
];

export function reachBandLabel([from, to]: [number, number]): string {
  if (from === 0) return `under ${to} s`;
  return to === Infinity ? `${from} s or more` : `${from} to ${to} s`;
}

export function summarize(matches: readonly MatchOutcome[]): RacingSummary {
  const n = Math.max(1, matches.length);
  const mean = (pick: (m: MatchOutcome) => number) =>
    matches.reduce((sum, m) => sum + pick(m), 0) / n;
  const decided = matches.filter((m) => m.lap1Leader >= 0);
  const spread: [number, number, number] = [0, 0, 0];
  const reach = REACH_BANDS.map(() => 0);
  const changes: [number, number, number, number] = [0, 0, 0, 0];
  for (const m of matches) {
    spread[m.closeness.within15 < 0.1 ? 0 : m.closeness.within15 < 0.5 ? 1 : 2]++;
    const band = REACH_BANDS.findIndex(
      ([from, to]) => m.closeness.reachSeconds >= from && m.closeness.reachSeconds < to,
    );
    reach[band]!++;
    changes[Math.min(3, m.leadChanges) as 0 | 1 | 2 | 3]++;
  }
  return {
    matches: matches.length,
    meanGapSeconds: mean((m) => m.closeness.meanGapSeconds),
    within1: mean((m) => m.closeness.within1),
    within15: mean((m) => m.closeness.within15),
    beyond3: mean((m) => m.closeness.beyond3),
    withinReach: mean((m) => m.closeness.withinReach),
    within15Spread: [spread[0] / n, spread[1] / n, spread[2] / n],
    reachSecondsPerRace: mean((m) => m.closeness.reachSeconds),
    reachSpread: reach.map((count) => count / n),
    leadChangesPerRace: mean((m) => m.leadChanges),
    leadChangeSpread: [changes[0] / n, changes[1] / n, changes[2] / n, changes[3] / n],
    towPasses: matches.reduce((sum, m) => sum + m.towPasses, 0),
    lap1LeaderWins:
      decided.filter((m) => m.winner === m.lap1Leader).length / Math.max(1, decided.length),
    lap1Decided: decided.length,
    usesPerRace: mean((m) =>
      m.cars.reduce((sum, car) => sum + car.weapons.reduce((s, w) => s + w.tally.uses, 0), 0),
    ),
    roundsPerRace: mean((m) =>
      m.cars.reduce((sum, car) => sum + car.weapons.reduce((s, w) => s + w.tally.rounds, 0), 0),
    ),
    damagePerRace: mean((m) => m.cars[0].damageDealt + m.cars[1].damageDealt),
    towShare: mean((m) => (m.towShare[0] + m.towShare[1]) / 2),
  };
}

export function formatSummary(label: string, s: RacingSummary): string {
  return (
    `${label}: mean time gap ${f(s.meanGapSeconds, 2)} s; share of the race within 1 s ${pct(s.within1)}, ` +
    `within 1.5 s ${pct(s.within15)}, within ${WEAPON_REACH_PX} px ${pct(s.withinReach)} (${f(s.reachSecondsPerRace)} s a race), beyond 3 s ${pct(s.beyond3)}; ` +
    `races that spent under 10% / 10 to 50% / over 50% of their length within 1.5 s: ` +
    `${pct(s.within15Spread[0])} / ${pct(s.within15Spread[1])} / ${pct(s.within15Spread[2])}; ` +
    `lead changes a race ${f(s.leadChangesPerRace, 2)} (${s.towPasses} of them by a car with tow in the second before); ` +
    `the lap 1 leader won ${pct(s.lap1LeaderWins)} of ${s.lap1Decided}; ` +
    `weapon activations a race ${f(s.usesPerRace)} (${f(s.roundsPerRace)} rounds); damage a race ${f(s.damagePerRace)}; ` +
    `share of the race a car had tow ${pct(s.towShare)}.`
  );
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
  meanRounds: number;
  /** Mean damage a match for each 100 credits of its price. */
  damagePer100: number;
  /** `damagePer100` over the median of all weapons that were raced. */
  ratio: number;
  /** Mean share of the race the carrying car was in thermal protection ("Too hot"). */
  thermalBlocked: number;
};

export type BalanceReport = {
  /** Whether the tow was on. */
  tow: boolean;
  racing: RacingSummary;
  /** Every match that was played, in order: both grid slots of every pairing, seed by seed. */
  played: MatchOutcome[];
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
  tow = true,
): BalanceReport {
  const played: MatchOutcome[] = [];
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
  const weapon = new Map<
    string,
    { mounted: number; damage: number; uses: number; rounds: number; blocked: number }
  >();
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
        const match = runBotMatch(a, b, seed, weatherPresetId, tow);
        played.push(match);
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
            const line = weapon.get(mounted.id) ?? {
              mounted: 0,
              damage: 0,
              uses: 0,
              rounds: 0,
              blocked: 0,
            };
            line.mounted++;
            line.damage += mounted.tally.damage;
            line.uses += mounted.tally.uses;
            line.rounds += mounted.tally.rounds;
            line.blocked += car.thermalBlocked;
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
      meanRounds: line.rounds / Math.max(1, line.mounted),
      damagePer100: price > 0 ? (meanDamage / price) * 100 : 0,
      thermalBlocked: line.blocked / Math.max(1, line.mounted),
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
    tow,
    racing: summarize(played),
    played,
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
    `Tow ${report.tow ? 'on' : 'off'}. Weather \`${report.weatherPresetId}\`, seeds ${report.seeds.join(', ')}: ${report.matches} matches, ` +
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
    `| Weapon | Price | Car-matches | Mean uses | Mean rounds | Mean damage | Damage per 100 credits | Against median (${f(report.medianDamagePer100)}) | Carrier in thermal protection |`,
  );
  lines.push('| :-- | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const w of report.weapons)
    lines.push(
      `| ${w.name} | ${w.price} | ${w.mounted} | ${f(w.meanUses)} | ${f(w.meanRounds)} | ${f(w.meanDamage)} | ${f(w.damagePer100)} | ${CONTROL_WEAPONS.has(w.id) ? 'control' : `${f(w.ratio, 2)}x`} | ${pct(w.thermalBlocked)} |`,
    );
  lines.push('');
  lines.push(formatSummary('How close the racing was', report.racing));
  lines.push('');
  lines.push(report.flags.length > 0 ? 'Flags:' : 'Flags: none.');
  for (const flag of report.flags) lines.push(`- ${flag}`);
  return lines.join('\n');
}

/**
 * The matchup matrix as Markdown: the share of its matches against the column that the row
 * won, both grid slots and every seed. A row and its column add up to 100 percent less draws.
 */
export function formatMatrix(report: BalanceReport, templates = RIVAL_TEMPLATES): string {
  // The last word of the name: Rookie, Sprinter, Rocket, Mule, Trap.
  const short = (t: BlueprintTemplate) => t.name.split(/[\s-]+/).pop() ?? t.name;
  const lines = [
    `| Row beats column | ${templates.map(short).join(' | ')} | Overall |`,
    `| :-- | ${templates.map(() => '--:').join(' | ')} | --: |`,
  ];
  for (const row of templates) {
    const overall = report.templates.find((t) => t.id === row.id)?.winRate ?? 0;
    const cells = templates.map((col) =>
      col.id === row.id ? '' : pct(report.matrix[row.id]?.[col.id] ?? 0),
    );
    lines.push(`| ${row.name} | ${cells.join(' | ')} | ${pct(overall)} |`);
  }
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
  /** Share of the race the armed car spent thermally limited, and the highest heat it reached. */
  heatLimited: number;
  peakHeat: number;
  /** Share of the race it was in thermal protection, when a weapon that heats refuses ("Too hot"). */
  thermalBlocked: number;
  meanRounds: number;
};

export type WeaponBench = {
  tow: boolean;
  racing: RacingSummary;
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
  tow = true,
): WeaponBench {
  const played: MatchOutcome[] = [];
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
    let heatLimited = 0;
    let blocked = 0;
    let rounds = 0;
    let peak = 0;
    for (const seed of seeds)
      for (const slot of [0, 1] as const) {
        const match =
          slot === 0
            ? runBotMatch(armed, twin, seed, weatherPresetId, tow)
            : runBotMatch(twin, armed, seed, weatherPresetId, tow);
        played.push(match);
        const mine = match.cars[slot];
        const theirs = match.cars[1 - slot]!;
        matches++;
        uses += mine.weapons[0]?.tally.uses ?? 0;
        rounds += mine.weapons[0]?.tally.rounds ?? 0;
        damage += mine.weapons[0]?.tally.damage ?? 0;
        if (match.winner === slot) wins++;
        if (theirs.wreckSeconds !== null) wrecks++;
        heatLimited += mine.heatLimited;
        blocked += mine.thermalBlocked;
        peak = Math.max(peak, mine.peakHeat);
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
      heatLimited: heatLimited / matches,
      thermalBlocked: blocked / matches,
      meanRounds: rounds / matches,
      peakHeat: peak,
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
  return {
    tow,
    racing: summarize(played),
    weatherPresetId,
    seeds,
    lines,
    medianDamagePer100: mid,
    flags,
  };
}

export function formatBench(bench: WeaponBench): string {
  const lines: string[] = [];
  lines.push(
    `Weapon bench, tow ${bench.tow ? 'on' : 'off'}, weather \`${bench.weatherPresetId}\`, seeds ${bench.seeds.join(', ')}: one copy on a stock Spider against the same Spider with ballast in place of the weapon, from both grid slots.`,
  );
  lines.push('');
  lines.push(
    `| Weapon | Price | Matches | Mean uses | Mean rounds | Mean damage | Damage per 100 credits | Against median (${f(bench.medianDamagePer100)}) | Wins against unarmed twin | Mean lead at the finish s | Twin wrecked | Peak heat | Over the heat threshold | In thermal protection |`,
  );
  lines.push(
    '| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
  );
  for (const w of bench.lines)
    lines.push(
      `| ${w.name} | ${w.price} | ${w.matches} | ${f(w.meanUses)} | ${f(w.meanRounds)} | ${f(w.meanDamage)} | ${f(w.damagePer100)} | ${CONTROL_WEAPONS.has(w.id) ? 'control' : `${f(w.ratio, 2)}x`} | ${pct(w.winRate)} | ${f(w.meanLeadSeconds, 2)} | ${w.wrecks} | ${f(w.peakHeat, 0)} | ${pct(w.heatLimited)} | ${pct(w.thermalBlocked)} |`,
    );
  lines.push('');
  lines.push(formatSummary('How close the racing was', bench.racing));
  lines.push('');
  lines.push(bench.flags.length > 0 ? 'Flags:' : 'Flags: none.');
  for (const flag of bench.flags) lines.push(`- ${flag}`);
  return lines.join('\n');
}
