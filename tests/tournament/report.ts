import {
  AI_STRATEGIES,
  RIVAL_TEMPLATES,
  TIRE_LIST,
  getTemplate,
  getTrack,
  getWeatherPreset,
  profileOf,
} from '@bolt/content';
import { UPGRADE_PAIRS } from '../balance/upgrade.js';
import type { CarRecord, MatchRecord } from './harness.js';
import type { PlannedMatch } from './plan.js';
import { COURSES } from './plan.js';

/**
 * Turns tournament records into the report in docs/evidence/tournament. Pure: records in,
 * markdown out, so the report can be rebuilt from the saved JSON.
 */

export type Played = MatchRecord & { spec: PlannedMatch; wallMs?: number };

export type ShortcutRow = {
  trackId: string;
  presetId: string;
  car: string;
  never: number | null;
  always: number | null;
  plan: number | null;
  planMask: number;
  gains: number[];
};

/** One car alone on a course: a shipped build, or a frame on a wheel kit. */
export type ConstructionRow = {
  trackId: string;
  presetId: string;
  car: string;
  seconds: number | null;
  illegal: string | null;
};

/** The frames of the construction matrix: light to heavy, each on its usual engine. */
export const CONSTRUCTION_FRAMES = [
  { frame: 'balanced_arrow', engineId: 'engine_v8', label: 'Arrow (light), V8' },
  { frame: 'speedster_trike', engineId: 'engine_rotary', label: 'Trike (tiny), Rotary' },
  { frame: 'balanced_beetle', engineId: 'engine_v8', label: 'Beetle, V8' },
  { frame: 'balanced_spider', engineId: 'engine_v8', label: 'Spider, V8' },
  { frame: 'trapper_pickup', engineId: 'engine_v8', label: 'Pickup (heavy), V8' },
];
export const CONSTRUCTION_KITS = [
  'tires_street',
  'tires_slick',
  'tires_rain',
  'tires_sand',
  'tires_mud',
  'tires_snow',
];

/** A record as text without its wall-clock fields, for the repeat check. */
export function canonical(m: MatchRecord & { wallMs?: number }): string {
  const { wallMs: _w, ...rest } = m as MatchRecord & { wallMs?: number };
  void _w;
  return JSON.stringify({
    ...rest,
    cars: rest.cars.map((c) => ({ ...c, brainMeanMs: 0, brainWorstMs: 0 })),
  });
}

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const tireName = (id: string) => TIRE_LIST.find((t) => t.id === id)?.displayName ?? id;
const templateName = (id: string) => {
  const [base, up] = id.split('+');
  const name = getTemplate(base!)?.name ?? id;
  return up
    ? `${name} + ${UPGRADE_PAIRS.find((p) => p.id === up)?.label.split(', ')[1] ?? up}`
    : name;
};
const courseName = (trackId: string, presetId: string) =>
  `${getTrack(trackId)?.name ?? trackId}, ${getWeatherPreset(presetId)?.displayName ?? presetId}`;
const shortCourse = (trackId: string, presetId: string) => {
  const preset = getWeatherPreset(presetId)?.displayName ?? presetId;
  return `${getTrack(trackId)?.name ?? trackId} ${preset}`;
};
const courseKey = (m: { spec: { trackId: string; presetId: string } }) =>
  `${m.spec.trackId}/${m.spec.presetId}`;
const keyOf = (c: { trackId: string; presetId: string }) => `${c.trackId}/${c.presetId}`;

/** Wins and races of a key, both cars of each match counted, draws as half. */
function tally<T>(matches: Played[], key: (car: CarRecord, m: Played, i: number) => T | null) {
  const out = new Map<T, { wins: number; races: number }>();
  for (const m of matches) {
    for (let i = 0; i < 2; i++) {
      const k = key(m.cars[i]!, m, i);
      if (k === null) continue;
      const other = key(m.cars[1 - i]!, m, 1 - i);
      if (other === k) continue; // a mirror matchup says nothing about the key
      const row = out.get(k) ?? { wins: 0, races: 0 };
      row.races++;
      if (m.winner === i) row.wins++;
      else if (m.winner === -1) row.wins += 0.5;
      out.set(k, row);
    }
  }
  return out;
}
const rate = (r: { wins: number; races: number } | undefined) =>
  r && r.races > 0 ? r.wins / r.races : NaN;

function targetSeconds(trackId: string): number {
  return getTrack(trackId)?.lengthClass === 'short' ? 105 : 130;
}

/** The car a shipped-build key names: template id (with an upgrade suffix) or null. */
const shippedId = (car: CarRecord) => (car.strategy === 'template' ? car.id : null);

type Summary = {
  races: number;
  cars: number;
  carsFinished: number;
  finished: number;
  timeouts: number;
  problems: number;
  meanRace: number;
  sdRace: number;
  minRace: number;
  maxRace: number;
  lap1LeaderWins: number;
  decided: number;
  leadChanges: number;
  racesWithChange: number;
  weapons: number;
  damage: number;
  wrecks: number;
  hot: number;
  protection: number;
  close: number;
  inRange: number;
  towSeconds: number;
  towShare: number;
  shortcutLaps: number;
  shortcutPayoff: number;
};

function summarize(matches: Played[]): Summary {
  const decided = matches.filter((m) => m.lap1Leader >= 0 && m.winner >= 0);
  let laps = 0;
  let through = 0;
  const gains: number[] = [];
  for (const m of matches)
    for (const car of m.cars) {
      const with_: number[] = [];
      const without: number[] = [];
      car.lapTimes.forEach((t, i) => {
        laps++;
        if (car.lapShortcuts[i]! > 0) through++;
        if (i === 0) return;
        (car.lapShortcuts[i]! > 0 ? with_ : without).push(t);
      });
      if (with_.length && without.length) gains.push(mean(without) - mean(with_));
    }
  const times = matches.filter((m) => m.reason !== 'error').map((m) => m.raceSeconds);
  const cars = matches.flatMap((m) => m.cars);
  return {
    races: matches.length,
    cars: cars.length,
    carsFinished: cars.filter((c) => c.finished).length,
    finished: matches.filter((m) => m.reason === 'finish').length,
    timeouts: matches.filter((m) => m.reason === 'timeout').length,
    problems: matches.filter((m) => m.problems.length > 0).length,
    meanRace: mean(times),
    sdRace: sd(times),
    minRace: times.length ? Math.min(...times) : NaN,
    maxRace: times.length ? Math.max(...times) : NaN,
    lap1LeaderWins:
      decided.filter((m) => m.winner === m.lap1Leader).length / Math.max(1, decided.length),
    decided: decided.length,
    leadChanges: mean(matches.map((m) => m.leadChanges)),
    racesWithChange: matches.filter((m) => m.leadChanges > 0).length / Math.max(1, matches.length),
    weapons: mean(matches.map((m) => m.cars[0].weaponUses + m.cars[1].weaponUses)),
    damage: mean(matches.map((m) => m.cars[0].damageDealt + m.cars[1].damageDealt)),
    wrecks:
      matches.reduce((s, m) => s + (m.cars[0].wrecked ? 1 : 0) + (m.cars[1].wrecked ? 1 : 0), 0) /
      Math.max(1, matches.length),
    hot: mean(cars.map((c) => c.hotSeconds)),
    protection: mean(cars.map((c) => c.protectionSeconds)),
    close: mean(matches.map((m) => m.closeSeconds)),
    inRange: mean(
      matches.map((m) => (m.cars[0].inRangeSeconds ?? 0) + (m.cars[1].inRangeSeconds ?? 0)),
    ),
    towSeconds: mean(cars.map((c) => c.towSeconds ?? 0)),
    towShare: mean(
      matches
        .filter((m) => m.raceSeconds > 0)
        .flatMap((m) => m.cars.map((c) => (c.towSeconds ?? 0) / m.raceSeconds)),
    ),
    shortcutLaps: through / Math.max(1, laps),
    shortcutPayoff: gains.length ? mean(gains) : NaN,
  };
}

export type ReportOptions = {
  command: string;
  seconds: number;
  raceSeconds: number;
  workers: number;
  desync: string[];
  repeats: number;
  quick: boolean;
  shortcuts: ShortcutRow[];
  construction: ConstructionRow[];
  templateSolo: ConstructionRow[];
};

export function buildReport(played: Played[], options: ReportOptions): string {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  const phase = (p: string) => played.filter((m) => m.spec.phase === p);
  const aiRaces = played.filter((m) => !m.cars[0].sparring && !m.cars[1].sparring);
  const strategy = phase('strategy');
  const difficulty = phase('difficulty');
  const roster = phase('roster');
  const balance = phase('balance');
  const upgrade = phase('upgrade');
  const sys = played.filter((m) => m.spec.phase === 'system' && m.cars[0].sparring);
  const sysAi = played.filter((m) => m.spec.phase === 'system' && !m.cars[0].sparring);
  const spar = played.filter((m) => m.spec.phase === 'sparring' && m.cars[0].sparring);
  const sparAi = played.filter((m) => m.spec.phase === 'sparring' && !m.cars[0].sparring);
  const all = summarize(played);
  const seeds = new Set(played.map((m) => m.spec.seed)).size;
  const phases = [...new Set(played.map((m) => m.spec.phase))];

  out(`# Bot tournament${options.quick ? ' (quick)' : ''}`);
  out();
  out(
    `Generated by \`${options.command}\` in ${f(options.seconds, 0)} s of wall time (${f(options.raceSeconds, 0)} s for the races, the rest for the repeat check and the solo runs) on ${options.workers} worker processes of this two-core machine. ` +
      `${played.length} two-car races on all ${COURSES.length} courses (eight tracks in both weathers), ${seeds} seeds, ` +
      `plus ${options.repeats} races run a second time and ${options.shortcuts.length * 3 + options.construction.length + options.templateSolo.length} solo runs. Tow on.`,
  );
  out();
  out(
    "Server-only: every race is the room's own race, headless. `createRace` with the room's options and `stepRaceWithBrains` (the function `DriveRoom` calls each tick), the AI built by `pickAiBuild` and driven by `AiBrain`; the roster races go through `createAiRace` itself, the exact function the room calls on a join, with an AI standing in for the player on the first slot. No network, no client, no clock: as fast as the machine runs it. Records: the JSON next to this file.",
  );
  out();
  out(
    `| Phase | Races | What |\n| :-- | --: | :-- |\n` +
      [
        ['strategy', 'every pair of the six AI strategies, Racer against Racer, from both slots'],
        [
          'difficulty',
          'Ace against Rookie, Ace against Racer, Racer against Rookie, balanced builds',
        ],
        [
          'roster',
          'every starter and example build (AI at Racer driving it) against the room-built AI at Rookie, Racer and Ace',
        ],
        [
          'balance',
          'every starter and example build against every other, AI at Racer in both, from both slots',
        ],
        ['upgrade', 'a shipped build against its twin with one upgrade (tests/balance/upgrade.ts)'],
        ['tires', 'the same Arrow on the profile kit against the other kits'],
        [
          'sparring',
          'shipped pairs, the sparring brain against the AI on the same seeds (before and after)',
        ],
        [
          'system',
          'the old room rival (shipped build, sparring brain) against the new one (course build, AI)',
        ],
      ]
        .filter(([p]) => (phases as string[]).includes(p!))
        .map(([p, what]) => `| ${p} | ${phase(p!).length} | ${what} |`)
        .join('\n'),
  );
  out();

  // --- Reliability ----------------------------------------------------------------------------
  out('## Reliability');
  out();
  const crashed = played.filter((m) => m.reason === 'error');
  const hung = crashed.filter((m) => (m.error ?? '').startsWith('hung'));
  const stuck = played.filter((m) => m.problems.some((p) => /sat still|no progress/.test(p)));
  out(
    `- Races: ${all.races}. Ended normally: ${all.races - crashed.length}. Crashed: ${crashed.length - hung.length}. Hung (no result in 120 s): ${hung.length}. ` +
      `A car stuck (still for 8 s, or under 150 px of progress in 15 s, while racing and not wrecked): ${stuck.length}. Non-finite state: ${played.filter((m) => m.problems.some((p) => /non-finite/.test(p))).length}.`,
  );
  const problems = played.filter((m) => m.problems.length > 0);
  for (const m of problems.slice(0, 25))
    out(
      `  - ${courseName(m.spec.trackId, m.spec.presetId)}, seed ${m.spec.seed}, ${m.spec.phase} ${m.spec.pair}: ${m.problems.join('; ')}`,
    );
  if (problems.length > 25) out(`  - and ${problems.length - 25} more`);
  out(
    `- Repeatable: ${options.repeats - options.desync.length} of ${options.repeats} races run a second time (one in ${options.quick ? 10 : 25}, on whichever worker was free) gave the identical record.`,
  );
  for (const d of options.desync) out(`  - ${d}`);
  const limit = played.filter((m) => m.reason === 'timeout');
  out(
    `- Ran to the 180 s limit with nobody home, and so decided on course progress (Section 3.4, a legal end, listed under Flags): ${limit.length}.`,
  );
  const costs = aiRaces.flatMap((m) => m.cars.filter((c) => !c.sparring && c.brainMeanMs > 0));
  const wall = played.map((m) => m.wallMs ?? 0).filter((x) => x > 0);
  out(
    `- AI cost per car and tick (wall clock, shared two-core machine): mean ${f(mean(costs.map((c) => c.brainMeanMs)), 3)} ms, worst single tick ${f(Math.max(...costs.map((c) => c.brainWorstMs)), 1)} ms ` +
      `(median of each race's worst ${f(median(costs.map((c) => c.brainWorstMs)), 2)} ms), against a 33.3 ms tick. A whole race: mean ${f(mean(wall) / 1000, 2)} s, longest ${f(Math.max(...wall) / 1000, 1)} s of wall time.`,
  );
  out();
  out('### Cars that did not finish, and why');
  out();
  const dnfCars = played
    .flatMap((m) => m.cars.map((c) => ({ c, m })))
    .filter(({ c }) => !c.finished);
  const causes = ['finish window', 'time limit', 'ko', 'wrecked', 'stuck', 'crash'] as const;
  out(
    `${dnfCars.length} of ${all.cars} cars (${pct(dnfCars.length / Math.max(1, all.cars))}) did not finish. By cause: ` +
      causes.map((k) => `${k} ${dnfCars.filter(({ c }) => c.dnf === k).length}`).join(', ') +
      '. "Finish window" is a car still racing when the race closed 8 s after the winner crossed the line (Section 3.4): beaten by more than 8 s, not stuck. "Ko" is a knockout (chassis gone and two core systems down for 3 s); "wrecked" a car with its chassis gone still limping on what works, which the stuck detector leaves alone.',
  );
  out();
  out(`| Course | Cars | Finished | Finish window | Time limit | KO | Wrecked | Stuck | Crash |`);
  out('| :-- | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const c of COURSES) {
    const here = played.filter((m) => courseKey(m) === keyOf(c)).flatMap((m) => m.cars);
    const n = (k: string) => here.filter((x) => !x.finished && x.dnf === k).length;
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${here.length} | ${pct(here.filter((x) => x.finished).length / Math.max(1, here.length))} | ${n('finish window')} | ${n('time limit')} | ${n('ko')} | ${n('wrecked')} | ${n('stuck')} | ${n('crash')} |`,
    );
  }
  out();

  // --- Every course ---------------------------------------------------------------------------
  out('## Every course (all races with the AI in both cars)');
  out();
  out(
    '| Course | Races | Cars home | Race s mean (sd) | Min to max s | Target s | Lap 1 leader wins | Lead changes | Races with one | Shortcut laps | Weapons fired | Damage | In weapon reach s | Within 220 px s | Tow s a car | Wrecks |',
  );
  out(
    '| :-- | --: | --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
  );
  for (const c of COURSES) {
    const s = summarize(aiRaces.filter((m) => courseKey(m) === keyOf(c)));
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${s.races} | ${pct(s.carsFinished / Math.max(1, s.cars))} | ${f(s.meanRace)} (${f(s.sdRace)}) | ${f(s.minRace, 0)} to ${f(s.maxRace, 0)} | ${targetSeconds(c.trackId)} | ` +
        `${pct(s.lap1LeaderWins)} | ${f(s.leadChanges, 2)} | ${pct(s.racesWithChange)} | ${pct(s.shortcutLaps)} | ${f(s.weapons)} | ${f(s.damage)} | ${f(s.inRange)} | ${f(s.close)} | ${f(s.towSeconds)} | ${f(s.wrecks, 2)} |`,
    );
  }
  const ais = summarize(aiRaces);
  out(
    `| All courses | ${ais.races} | ${pct(ais.carsFinished / Math.max(1, ais.cars))} | ${f(ais.meanRace)} (${f(ais.sdRace)}) | ${f(ais.minRace, 0)} to ${f(ais.maxRace, 0)} | | ${pct(ais.lap1LeaderWins)} | ${f(ais.leadChanges, 2)} | ${pct(ais.racesWithChange)} | ${pct(ais.shortcutLaps)} | ${f(ais.weapons)} | ${f(ais.damage)} | ${f(ais.inRange)} | ${f(ais.close)} | ${f(ais.towSeconds)} | ${f(ais.wrecks, 2)} |`,
  );
  out();
  out(
    'Race s is the race clock when the race ended (the winner home plus up to the 8 s window). Target is the Section 9.3 length class for the default car (about 105 s short, 130 s long). In weapon reach: seconds a race that either car had the other within the reach of one of its own weapons. Tow s: seconds a car had any tow (only the trailing car, more than 1 s behind, can).',
  );
  out();

  // --- Builds: race times and win rates ---------------------------------------------------------
  const shippedIds = RIVAL_TEMPLATES.map((t) => t.id);
  out('## Shipped builds: finishing time by course (mean and spread, s)');
  out();
  out(
    'Every finish of each starter and example build in the roster and balance races (the AI at Racer driving it), mean with the standard deviation in brackets; the AI strategies from the strategy races. A dash: never finished there.',
  );
  out();
  out(`| Build | ${COURSES.map((c) => shortCourse(c.trackId, c.presetId)).join(' | ')} |`);
  out(`| :-- |${COURSES.map(() => ' --: |').join('')}`);
  const timeRow = (label: string, races: Played[], pick: (car: CarRecord) => boolean) => {
    const cells = COURSES.map((c) => {
      const xs = races
        .filter((m) => courseKey(m) === keyOf(c))
        .flatMap((m) => m.cars.filter((car) => pick(car) && car.finishSeconds !== null))
        .map((car) => car.finishSeconds!);
      return xs.length ? `${f(mean(xs))} (${f(sd(xs))})` : '-';
    });
    out(`| ${label} | ${cells.join(' | ')} |`);
  };
  for (const id of shippedIds)
    timeRow(templateName(id), [...roster, ...balance], (car) => car.id === id);
  for (const s of AI_STRATEGIES) timeRow(`AI ${s}`, strategy, (car) => car.strategy === s);
  out();

  out('## Win rates per shipped build');
  out();
  out(
    'Against the room-built AI at each difficulty (roster), against every other shipped build (balance, both cars driven by the AI at Racer), and the spread of the balance win rate over the 16 courses.',
  );
  out();
  out(
    '| Build | vs Rookie | vs Racer | vs Ace | vs the other shipped builds | Lowest course | Highest course |',
  );
  out('| :-- | --: | --: | --: | --: | :-- | :-- |');
  const balTally = tally(balance, (car) => shippedId(car));
  for (const id of shippedIds) {
    const vs = (d: string) =>
      rate(
        tally(
          roster.filter((m) => m.cars[1].difficulty === d),
          (car) => (car.strategy === 'template' ? 'shipped' : null),
        ).get('shipped'),
      );
    const per = COURSES.map((c) => ({
      c,
      r: rate(
        tally(
          balance.filter((m) => courseKey(m) === keyOf(c)),
          (car) => shippedId(car),
        ).get(id),
      ),
    })).filter((x) => Number.isFinite(x.r));
    per.sort((a, b) => a.r - b.r);
    const lo = per[0];
    const hi = per.at(-1);
    void vs;
    const vsBuild = (d: string) =>
      rate(
        tally(
          roster.filter((m) => m.cars[1].difficulty === d && m.cars[0].id === id),
          (car) => (car.strategy === 'template' ? 'shipped' : null),
        ).get('shipped'),
      );
    out(
      `| ${templateName(id)} | ${pct(vsBuild('rookie'))} | ${pct(vsBuild('racer'))} | ${pct(vsBuild('ace'))} | ${pct(rate(balTally.get(id)))} | ${lo ? `${pct(lo.r)} ${shortCourse(lo.c.trackId, lo.c.presetId)}` : 'n/a'} | ${hi ? `${pct(hi.r)} ${shortCourse(hi.c.trackId, hi.c.presetId)}` : 'n/a'} |`,
    );
  }
  out();

  // --- Difficulty -------------------------------------------------------------------------------
  out('## Difficulty');
  out();
  out('Win rate of the AI rival, as the room builds it, against the shipped builds (roster):');
  out();
  out(`| Course | Rookie | Racer | Ace |`);
  out('| :-- | --: | --: | --: |');
  const aiRate = (ms: Played[], d: string) =>
    rate(
      tally(
        ms.filter((m) => m.cars[1].difficulty === d),
        (car) => (car.strategy === 'template' ? null : 'ai'),
      ).get('ai'),
    );
  for (const c of COURSES) {
    const ms = roster.filter((m) => courseKey(m) === keyOf(c));
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${pct(aiRate(ms, 'rookie'))} | ${pct(aiRate(ms, 'racer'))} | ${pct(aiRate(ms, 'ace'))} |`,
    );
  }
  out(
    `| All courses | ${pct(aiRate(roster, 'rookie'))} | ${pct(aiRate(roster, 'racer'))} | ${pct(aiRate(roster, 'ace'))} |`,
  );
  out();
  const diffT = (a: string, b: string) => {
    const ms = difficulty.filter((m) => m.spec.pair === `${a}-${b}`);
    let aw = 0;
    for (const m of ms) {
      const i = m.cars.findIndex((c) => c.difficulty === a);
      if (m.winner === i) aw++;
      else if (m.winner === -1) aw += 0.5;
    }
    return { races: ms.length, rate: aw / Math.max(1, ms.length) };
  };
  out('Head to head on the same balanced builds (difficulty phase):');
  out();
  for (const [a, b] of [
    ['ace', 'rookie'],
    ['ace', 'racer'],
    ['racer', 'rookie'],
  ] as const) {
    const r = diffT(a, b);
    out(`- ${a} against ${b}: ${a} wins ${pct(r.rate)} of ${r.races}.`);
  }
  out();
  const diffCars = (d: string) =>
    [...difficulty, ...roster].flatMap((m) =>
      m.cars.filter((c, i) => c.difficulty === d && (m.spec.phase === 'difficulty' || i === 1)),
    );
  out(
    '| Difficulty | Cars | Mean lap s, laps 2 and 3 (balanced builds) | Off its best line, px | Wall hits a race | Recoveries a race | Weapons fired a race | Damage dealt a race | In reach s | Shortcut laps |',
  );
  out('| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: |');
  for (const d of ['rookie', 'racer', 'ace']) {
    const cars = diffCars(d);
    const laps = difficulty
      .flatMap((m) => m.cars.filter((c) => c.difficulty === d))
      .flatMap((c) => c.lapTimes.slice(1));
    const sc = cars.flatMap((c) => c.lapShortcuts);
    out(
      `| ${d} | ${cars.length} | ${f(mean(laps), 2)} | ${f(mean(cars.map((c) => c.lineError).filter(Number.isFinite)))} | ${f(mean(cars.map((c) => c.wallHits)), 2)} | ${f(mean(cars.map((c) => c.recoveries ?? 0)), 2)} | ${f(mean(cars.map((c) => c.weaponUses)))} | ${f(mean(cars.map((c) => c.damageDealt)))} | ${f(mean(cars.map((c) => c.inRangeSeconds ?? 0)))} | ${pct(sc.filter((x) => x > 0).length / Math.max(1, sc.length))} |`,
    );
  }
  out();
  out(
    'The AI cars of the difficulty races (both) and of the roster races (the rival). Lap times are the balanced builds of the difficulty phase over every course together, so they compare difficulties, not courses.',
  );
  out();

  // --- Styles -----------------------------------------------------------------------------------
  out('## Styles at the same difficulty (strategy matchups, Racer)');
  out();
  const st = tally(strategy, (car) => car.style);
  out(
    `- Win rate: aggressive ${pct(rate(st.get('aggressive')))}, tactical ${pct(rate(st.get('tactical')))}.`,
  );
  for (const s of ['aggressive', 'tactical']) {
    const cars = strategy.flatMap((m) => m.cars.filter((c) => c.style === s));
    const sc = cars.flatMap((c) => c.lapShortcuts);
    out(
      `- ${s}: weapons fired a race ${f(mean(cars.map((c) => c.weaponUses)))}, damage dealt ${f(mean(cars.map((c) => c.damageDealt)))}, ` +
        `wall hits ${f(mean(cars.map((c) => c.wallHits)), 2)}, off its best line ${f(mean(cars.map((c) => c.lineError).filter(Number.isFinite)))} px, ` +
        `shortcut laps ${pct(sc.filter((x) => x > 0).length / Math.max(1, sc.length))}.`,
    );
  }
  out();

  // --- Strategy and tires -----------------------------------------------------------------------
  out('## Which AI strategy wins where (Racer against Racer)');
  out();
  out(`| Course | ${AI_STRATEGIES.join(' | ')} |`);
  out(`| :-- |${AI_STRATEGIES.map(() => ' --: |').join('')}`);
  for (const c of COURSES) {
    const t = tally(
      strategy.filter((m) => courseKey(m) === keyOf(c)),
      (car) => car.strategy,
    );
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${AI_STRATEGIES.map((s) => pct(rate(t.get(s)))).join(' | ')} |`,
    );
  }
  const overall = tally(strategy, (car) => car.strategy);
  out(`| All courses | ${AI_STRATEGIES.map((s) => pct(rate(overall.get(s)))).join(' | ')} |`);
  out();

  // --- Surface effect --------------------------------------------------------------------------
  out('## Surface effect: how the best build changes with the ground and the weather');
  out();
  out(
    'Evidence that construction should change with conditions. Each car alone on each course, the AI at Racer driving, three laps (seconds; DNF past the 180 s limit). First the same five frames on six wheel kits, then the shipped builds.',
  );
  out();
  const cons = (c: { trackId: string; presetId: string }) =>
    options.construction.filter((r) => keyOf(r) === keyOf(c));
  out(
    '| Course | Profile | Fastest construction | s | Fastest on Street Tires | s | Light frame (Arrow) on each kit: Street / Slicks / Rain / Sand / Mud / Snow |',
  );
  out('| :-- | :-- | :-- | --: | :-- | --: | :-- |');
  const label = (car: string) => {
    const [frame, kit] = car.split('|');
    return `${CONSTRUCTION_FRAMES.find((x) => x.frame === frame)?.label ?? frame} on ${tireName(kit!)}`;
  };
  const bestByCourse = new Map<string, string>();
  for (const c of COURSES) {
    const rows = cons(c).filter((r) => r.seconds !== null);
    rows.sort((a, b) => a.seconds! - b.seconds!);
    const best = rows[0];
    const street = rows.filter((r) => r.car.endsWith('|tires_street'))[0];
    if (best) bestByCourse.set(keyOf(c), best.car);
    const arrow = CONSTRUCTION_KITS.map((kit) => {
      const r = cons(c).find((x) => x.car === `balanced_arrow|${kit}`);
      return r ? (r.illegal ? 'illegal' : r.seconds === null ? 'DNF' : f(r.seconds)) : '';
    });
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${profileOf(c.trackId, c.presetId)} | ${best ? label(best.car) : 'n/a'} | ${best ? f(best.seconds!) : ''} | ${street ? label(street.car) : 'n/a'} | ${street ? f(street.seconds!) : ''} | ${arrow.join(' / ')} |`,
    );
  }
  out();
  const distinct = new Set(bestByCourse.values());
  out(
    `The fastest construction differs across the courses: ${distinct.size} different frame and kit combinations are fastest somewhere (${[...distinct].map(label).join('; ')}).`,
  );
  out();
  out(
    'Sand Paddles against Street Tires, frame by frame, on the four sand courses (seconds; the gain in brackets):',
  );
  out();
  out(
    `| Frame | ${COURSES.filter((c) => profileOf(c.trackId, c.presetId) === 'sand')
      .map((c) => shortCourse(c.trackId, c.presetId))
      .join(' | ')} |`,
  );
  out(
    `| :-- |${COURSES.filter((c) => profileOf(c.trackId, c.presetId) === 'sand')
      .map(() => ' :-- |')
      .join('')}`,
  );
  for (const fr of CONSTRUCTION_FRAMES) {
    const cells = COURSES.filter((c) => profileOf(c.trackId, c.presetId) === 'sand').map((c) => {
      const s = cons(c).find((r) => r.car === `${fr.frame}|tires_street`)?.seconds ?? null;
      const p = cons(c).find((r) => r.car === `${fr.frame}|tires_sand`)?.seconds ?? null;
      if (s === null || p === null)
        return `${s === null ? 'DNF' : f(s)} / ${p === null ? 'DNF' : f(p)}`;
      return `${f(s)} / ${f(p)} (${f(((s - p) / s) * 100, 0)}%)`;
    });
    out(`| ${fr.label} | ${cells.join(' | ')} |`);
  }
  out();
  out('The shipped builds alone, fastest three and slowest on each course:');
  out();
  out('| Course | Fastest | Second | Third | Slowest |');
  out('| :-- | :-- | :-- | :-- | :-- |');
  for (const c of COURSES) {
    const rows = options.templateSolo.filter((r) => keyOf(r) === keyOf(c));
    const done = rows.filter((r) => r.seconds !== null).sort((a, b) => a.seconds! - b.seconds!);
    const dnf = rows.filter((r) => r.seconds === null);
    const cell = (r: ConstructionRow | undefined) =>
      r ? `${templateName(r.car)} ${f(r.seconds!)}` : '';
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${cell(done[0])} | ${cell(done[1])} | ${cell(done[2])} | ${dnf.length ? `${dnf.map((r) => templateName(r.car)).join(', ')} DNF` : cell(done.at(-1))} |`,
    );
  }
  const soloDnf = options.templateSolo.filter((r) => r.seconds === null);
  out();
  out(
    `Shipped builds alone: ${options.templateSolo.length - soloDnf.length} of ${options.templateSolo.length} runs finished${soloDnf.length ? ` (DNF: ${soloDnf.map((r) => `${templateName(r.car)} on ${courseName(r.trackId, r.presetId)}`).join('; ')})` : ': every starter and example build finishes every course in both weathers'}.`,
  );
  out();

  out('## Which tires win where (every AI-built car, win rate and races)');
  out();
  const tireIds = [...new Set(aiRaces.flatMap((m) => m.cars.map((c) => c.tireKitId)))].filter(
    (t) => t !== '?',
  );
  out(`| Course | ${tireIds.map(tireName).join(' | ')} |`);
  out(`| :-- |${tireIds.map(() => ' --: |').join('')}`);
  for (const c of COURSES) {
    const t = tally(
      aiRaces.filter(
        (m) =>
          courseKey(m) === keyOf(c) && m.spec.phase !== 'balance' && m.spec.phase !== 'upgrade',
      ),
      (car) => (car.strategy === 'template' ? null : car.tireKitId),
    );
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${tireIds
        .map((id) => {
          const row = t.get(id);
          return row ? `${pct(row.wins / row.races)} (${row.races})` : '';
        })
        .join(' | ')} |`,
    );
  }
  out();
  out(
    "AI-built cars only; mirror matchups (both cars on the same kit) are left out of a kit's count.",
  );
  out();

  out('## The same car on different wheel kits (tire duels)');
  out();
  out(
    "The balanced strategy's Arrow (V8, Trail Engine on the desert) against itself, Racer against Racer, from both grid slots; only the wheel kit differs. Win rate of the kit the course's surface profile ranks first, and its mean finishing margin (seconds, positive when ahead).",
  );
  out();
  out('| Course | Profile kit | Against | Races | Profile kit wins | Margin s |');
  out('| :-- | :-- | :-- | --: | --: | --: |');
  const duels = phase('tires');
  for (const c of COURSES) {
    const here = duels.filter((m) => courseKey(m) === keyOf(c));
    for (const pair of [...new Set(here.map((m) => m.spec.pair))]) {
      const ms = here.filter((m) => m.spec.pair === pair);
      const [best, other] = pair.split('-') as [string, string];
      let wins = 0;
      const margins: number[] = [];
      for (const m of ms) {
        const i = m.cars.findIndex((car) => car.tireKitId === best);
        if (i < 0) continue;
        if (m.winner === i) wins++;
        const a = m.cars[i]!.finishSeconds;
        const b = m.cars[1 - i]!.finishSeconds;
        if (a !== null && b !== null) margins.push(b - a);
      }
      out(
        `| ${courseName(c.trackId, c.presetId)} | ${tireName(best)} | ${tireName(other)} | ${ms.length} | ${pct(wins / Math.max(1, ms.length))} | ${f(mean(margins))} |`,
      );
    }
  }
  const bestWins = duels.filter((m) => {
    const best = m.spec.pair.split('-')[0];
    return m.winner === m.cars.findIndex((car) => car.tireKitId === best);
  }).length;
  out();
  out(
    `Over all ${duels.length} duels the profile's kit won ${pct(bestWins / Math.max(1, duels.length))}.`,
  );
  out();

  // --- Shortcuts --------------------------------------------------------------------------------
  out('## Shortcuts');
  out();
  out('Taken in races (share of laps through a shortcut), by course and difficulty, AI races:');
  out();
  out(
    '| Course | Shortcuts | Rookie | Racer | Ace | Payoff s a lap (own laps with against without) |',
  );
  out('| :-- | :-- | --: | --: | --: | --: |');
  for (const c of COURSES) {
    const here = aiRaces.filter((m) => courseKey(m) === keyOf(c));
    const share = (d: string) => {
      const laps = here
        .flatMap((m) => m.cars.filter((car) => car.difficulty === d))
        .flatMap((car) => car.lapShortcuts);
      return laps.length ? laps.filter((x) => x > 0).length / laps.length : NaN;
    };
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${(getTrack(c.trackId)?.shortcuts ?? []).map((s) => s.signName).join(', ')} | ${pct(share('rookie'))} | ${pct(share('racer'))} | ${pct(share('ace'))} | ${f(summarize(here).shortcutPayoff, 2)} |`,
    );
  }
  out();
  out(
    "What they are worth, driven: one car alone, the AI at Racer, every shortcut forced off, every one forced on, and left to its own plan. The estimate is the plan's own (seconds a lap, positive when quicker for that car).",
  );
  out();
  out('| Course | Car | Never s | Always s | Plan s | Plan took | Estimate s a lap |');
  out('| :-- | :-- | --: | --: | --: | :-- | :-- |');
  for (const r of options.shortcuts)
    out(
      `| ${courseName(r.trackId, r.presetId)} | ${r.car} | ${r.never === null ? 'DNF' : f(r.never)} | ${r.always === null ? 'DNF' : f(r.always)} | ${r.plan === null ? 'DNF' : f(r.plan)} | ${
        r.planMask === 0
          ? 'none'
          : r.planMask
              .toString(2)
              .split('')
              .reverse()
              .map((b, i) => (b === '1' ? getTrack(r.trackId)?.shortcuts[i]?.signName : null))
              .filter(Boolean)
              .join(', ')
      } | ${r.gains.map((g) => f(g, 2)).join(' / ')} |`,
    );
  out();

  // --- Weapons ----------------------------------------------------------------------------------
  out('## Weapons');
  out();
  out('Per race (both cars), AI races:');
  out();
  out(
    '| Course | Activations | Damage dealt | Wrecks | Seconds in weapon reach | Seconds within 220 px |',
  );
  out('| :-- | --: | --: | --: | --: | --: |');
  for (const c of COURSES) {
    const s = summarize(aiRaces.filter((m) => courseKey(m) === keyOf(c)));
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${f(s.weapons)} | ${f(s.damage)} | ${f(s.wrecks, 2)} | ${f(s.inRange)} | ${f(s.close)} |`,
    );
  }
  out();
  out('Per weapon, every car that carried it in an AI race:');
  out();
  const weaponRows = new Map<string, { carried: number; uses: number; damage: number }>();
  for (const m of aiRaces)
    for (const car of m.cars)
      for (const w of car.weapons) {
        const row = weaponRows.get(w.id) ?? { carried: 0, uses: 0, damage: 0 };
        row.carried++;
        row.uses += w.uses;
        row.damage += w.damage;
        weaponRows.set(w.id, row);
      }
  out(
    '| Weapon | Carried (car races) | Activations a race | Damage a race | Damage per activation |',
  );
  out('| :-- | --: | --: | --: | --: |');
  for (const [id, v] of [...weaponRows.entries()].sort(
    (a, b) => b[1].damage / b[1].carried - a[1].damage / a[1].carried,
  ))
    out(
      `| ${id.replace(/^weapon_/, '')} | ${v.carried} | ${f(v.uses / v.carried)} | ${f(v.damage / v.carried)} | ${f(v.damage / Math.max(1, v.uses))} |`,
    );
  out();

  // --- Tow ----------------------------------------------------------------------------------------
  out('## Tow activity');
  out();
  out(
    '| Course | Tow s a car | Share of the race a car is towed | Mean tow while on (share of top speed) | Lead changes a race |',
  );
  out('| :-- | --: | --: | --: | --: |');
  for (const c of COURSES) {
    const ms = aiRaces.filter((m) => courseKey(m) === keyOf(c));
    const s = summarize(ms);
    const on = ms.flatMap((m) => m.cars).filter((car) => (car.towSeconds ?? 0) > 0);
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${f(s.towSeconds)} | ${pct(s.towShare)} | ${f(mean(on.map((car) => car.towMean ?? 0)) * 100, 1)}% | ${f(s.leadChanges, 2)} |`,
    );
  }
  out();

  // --- Balance targets -------------------------------------------------------------------------
  out('## The four balance targets, with the real AI (balance and upgrade phases)');
  out();
  out(
    'The targets of the tow entry in docs/BALANCE_CHANGELOG.md, measured on every course with the AI at Racer in both cars instead of the sparring brain: every shipped build against every other from both slots, and the upgrade pairs.',
  );
  out();
  out(
    '| Course | Lap 1 leader wins | Builds outside 30 to 70% | Lowest / highest build | Seconds within 220 px | In weapon reach s | Activations | Damage | Upgraded twin wins |',
  );
  out('| :-- | --: | --: | :-- | --: | --: | --: | --: | --: |');
  const targets = (bal: Played[], up: Played[]) => {
    const s = summarize(bal);
    const t = tally(bal, (car) => shippedId(car));
    const rates = shippedIds
      .map((id) => ({ id, r: rate(t.get(id)) }))
      .filter((x) => Number.isFinite(x.r));
    rates.sort((a, b) => a.r - b.r);
    const outside = rates.filter((x) => x.r < 0.3 || x.r > 0.7).length;
    let upWins = 0;
    for (const m of up) {
      const i = m.cars.findIndex((c) => c.id.includes('+'));
      if (m.winner === i) upWins++;
      else if (m.winner === -1) upWins += 0.5;
    }
    return { s, rates, outside, up: upWins / Math.max(1, up.length), upN: up.length };
  };
  for (const c of COURSES) {
    const r = targets(
      balance.filter((m) => courseKey(m) === keyOf(c)),
      upgrade.filter((m) => courseKey(m) === keyOf(c)),
    );
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${pct(r.s.lap1LeaderWins)} | ${r.outside} of ${r.rates.length} | ${r.rates[0] ? `${templateName(r.rates[0].id)} ${pct(r.rates[0].r)}` : ''} / ${r.rates.at(-1) ? `${templateName(r.rates.at(-1)!.id)} ${pct(r.rates.at(-1)!.r)}` : ''} | ${f(r.s.close)} | ${f(r.s.inRange)} | ${f(r.s.weapons)} | ${f(r.s.damage)} | ${pct(r.up)} of ${r.upN} |`,
    );
  }
  const tAll = targets(balance, upgrade);
  out(
    `| All courses | ${pct(tAll.s.lap1LeaderWins)} | ${tAll.outside} of ${tAll.rates.length} | ${tAll.rates[0] ? `${templateName(tAll.rates[0].id)} ${pct(tAll.rates[0].r)}` : ''} / ${tAll.rates.at(-1) ? `${templateName(tAll.rates.at(-1)!.id)} ${pct(tAll.rates.at(-1)!.r)}` : ''} | ${f(tAll.s.close)} | ${f(tAll.s.inRange)} | ${f(tAll.s.weapons)} | ${f(tAll.s.damage)} | ${pct(tAll.up)} of ${tAll.upN} |`,
  );
  out();
  out('Upgrade pairs over all courses:');
  out();
  for (const pair of UPGRADE_PAIRS) {
    const ms = upgrade.filter((m) => m.spec.pair === pair.id);
    if (!ms.length) continue;
    let w = 0;
    for (const m of ms) {
      const i = m.cars.findIndex((c) => c.id.includes('+'));
      if (m.winner === i) w++;
      else if (m.winner === -1) w += 0.5;
    }
    out(`- ${pair.label}: the upgraded twin wins ${pct(w / ms.length)} of ${ms.length}.`);
  }
  out();
  out('Every shipped build against every other, all courses (balance phase):');
  out();
  out(tAll.rates.map((x) => `${templateName(x.id)} ${pct(x.r)}`).join(', ') + '.');
  out();

  // --- Before and after -----------------------------------------------------------------------
  const compare = (title: string, note: string, before: Played[], after: Played[]) => {
    if (!before.length && !after.length) return;
    const b = summarize(before);
    const a = summarize(after);
    out(title);
    out();
    out(note);
    out();
    out('| Measure | Sparring brain | AI (Racer) |');
    out('| :-- | --: | --: |');
    out(`| Races | ${b.races} | ${a.races} |`);
    out(
      `| Cars home | ${pct(b.carsFinished / Math.max(1, b.cars))} | ${pct(a.carsFinished / Math.max(1, a.cars))} |`,
    );
    out(`| Mean race s | ${f(b.meanRace)} | ${f(a.meanRace)} |`);
    out(`| Lead changes a race | ${f(b.leadChanges, 2)} | ${f(a.leadChanges, 2)} |`);
    out(`| Races with a lead change | ${pct(b.racesWithChange)} | ${pct(a.racesWithChange)} |`);
    out(`| Lap 1 leader wins | ${pct(b.lap1LeaderWins)} | ${pct(a.lap1LeaderWins)} |`);
    out(`| Seconds within 220 px a race | ${f(b.close)} | ${f(a.close)} |`);
    out(`| Seconds in weapon reach a race | ${f(b.inRange)} | ${f(a.inRange)} |`);
    out(`| Weapon activations a race | ${f(b.weapons)} | ${f(a.weapons)} |`);
    out(`| Damage dealt a race | ${f(b.damage)} | ${f(a.damage)} |`);
    out(`| Wrecks a race | ${f(b.wrecks, 2)} | ${f(a.wrecks, 2)} |`);
    out(`| Shortcut laps | ${pct(b.shortcutLaps)} | ${pct(a.shortcutLaps)} |`);
    out(`| Tow s a car | ${f(b.towSeconds)} | ${f(a.towSeconds)} |`);
    out();
  };
  compare(
    '## Before and after: the rival as a player meets it (same seeds)',
    'Before: what the room raced until Milestone D, a shipped build picked by seed, driven by the sparring brain (both cars). After: a build for the course from a strategy picked by seed, driven by the AI at Racer (both cars).',
    sys,
    sysAi,
  );
  compare(
    '## Before and after: the brain alone (same shipped builds, same seeds)',
    'The same pairs of shipped builds from both grid slots, once with the sparring brain in both cars and once with the AI. This isolates the driver from the build.',
    spar,
    sparAi,
  );

  // --- Anomalies --------------------------------------------------------------------------------
  out('## Flags');
  out();
  const flags: string[] = [];
  for (const c of COURSES) {
    const s = summarize(aiRaces.filter((m) => courseKey(m) === keyOf(c)));
    if (s.problems > 0)
      flags.push(`${courseName(c.trackId, c.presetId)}: ${s.problems} races with a problem.`);
    if (s.lap1LeaderWins > 0.9)
      flags.push(
        `${courseName(c.trackId, c.presetId)}: the lap 1 leader wins ${pct(s.lap1LeaderWins)} of decided races.`,
      );
    if (Number.isFinite(s.meanRace) && s.meanRace > 160)
      flags.push(
        `${courseName(c.trackId, c.presetId)}: mean race ${f(s.meanRace)} s, close to the 180 s limit.`,
      );
  }
  for (const r of soloDnf)
    flags.push(
      `${templateName(r.car)} does not finish ${courseName(r.trackId, r.presetId)} alone.`,
    );
  for (const m of played.filter((x) => x.reason === 'timeout'))
    flags.push(
      `${courseName(m.spec.trackId, m.spec.presetId)}, seed ${m.spec.seed}, ${m.spec.phase} ${m.spec.pair}: nobody home in 180 s (${m.cars
        .map(
          (c) =>
            `${c.id}${c.wrecked ? ', wrecked' : ''}${c.protectionSeconds > 0 ? `, ${c.protectionSeconds.toFixed(0)} s in thermal protection` : ''}${c.hotSeconds > 20 ? `, ${c.hotSeconds.toFixed(0)} s hot` : ''}`,
        )
        .join(' against ')}).`,
    );
  for (const r of options.shortcuts)
    if (r.plan !== null && r.never !== null && r.plan > r.never + 1)
      flags.push(
        `${courseName(r.trackId, r.presetId)}, ${r.car}: its shortcut plan is ${f(r.plan - r.never)} s slower than never taking one.`,
      );
  if (!flags.length) out('None.');
  for (const fl of flags) out(`- ${fl}`);
  return lines.join('\n');
}
