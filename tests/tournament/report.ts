import { TRACKS, getTrack, getWeatherPreset, TIRE_LIST, AI_STRATEGIES } from '@bolt/content';
import type { CarRecord, MatchRecord } from './harness.js';
import type { PlannedMatch } from './plan.js';
import { COURSES } from './plan.js';

/**
 * Turns tournament records into the report in docs/evidence/tournament. Pure: records in,
 * markdown out, so the report can be rebuilt from saved records.
 */

export type Played = MatchRecord & { spec: PlannedMatch };

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const tireName = (id: string) => TIRE_LIST.find((t) => t.id === id)?.displayName ?? id;
const courseName = (trackId: string, presetId: string) =>
  `${getTrack(trackId)?.name ?? trackId}, ${getWeatherPreset(presetId)?.displayName ?? presetId}`;
const courseKey = (m: { spec: { trackId: string; presetId: string } }) =>
  `${m.spec.trackId}/${m.spec.presetId}`;

/** Wins and races of a key, both cars of each match counted, draws as half. */
function tally<T>(matches: Played[], key: (car: CarRecord) => T | null) {
  const out = new Map<T, { wins: number; races: number }>();
  for (const m of matches) {
    for (let i = 0; i < 2; i++) {
      const k = key(m.cars[i]!);
      if (k === null) continue;
      const other = key(m.cars[1 - i]!);
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

function targetSeconds(trackId: string): number {
  return getTrack(trackId)?.lengthClass === 'short' ? 105 : 130;
}

type Summary = {
  races: number;
  finished: number;
  timeouts: number;
  problems: number;
  meanRace: number;
  medianRace: number;
  lap1LeaderWins: number;
  leadChanges: number;
  weapons: number;
  damage: number;
  wrecks: number;
  hot: number;
  protection: number;
  close: number;
  shortcutLaps: number;
  shortcutPayoff: number;
};

function summarize(matches: Played[]): Summary {
  const decided = matches.filter((m) => m.lap1Leader >= 0 && m.winner >= 0);
  // Shortcut payoff: a car's laps through a shortcut against its own laps without, laps 2 and 3.
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
  return {
    races: matches.length,
    finished: matches.filter((m) => m.reason === 'finish').length,
    timeouts: matches.filter((m) => m.reason === 'timeout').length,
    problems: matches.filter((m) => m.problems.length > 0).length,
    meanRace: mean(matches.map((m) => m.raceSeconds)),
    medianRace: median(matches.map((m) => m.raceSeconds)),
    lap1LeaderWins:
      decided.filter((m) => m.winner === m.lap1Leader).length / Math.max(1, decided.length),
    leadChanges: mean(matches.map((m) => m.leadChanges)),
    weapons: mean(matches.map((m) => m.cars[0].weaponUses + m.cars[1].weaponUses)),
    damage: mean(matches.map((m) => m.cars[0].damageDealt + m.cars[1].damageDealt)),
    wrecks:
      matches.reduce((s, m) => s + (m.cars[0].wrecked ? 1 : 0) + (m.cars[1].wrecked ? 1 : 0), 0) /
      Math.max(1, matches.length),
    hot: mean(matches.map((m) => m.cars[0].hotSeconds + m.cars[1].hotSeconds)) / 2,
    protection:
      mean(matches.map((m) => m.cars[0].protectionSeconds + m.cars[1].protectionSeconds)) / 2,
    close: mean(matches.map((m) => m.closeSeconds)),
    shortcutLaps: through / Math.max(1, laps),
    shortcutPayoff: gains.length ? mean(gains) : NaN,
  };
}

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

export function buildReport(
  played: Played[],
  options: {
    command: string;
    seconds: number;
    desync: string[];
    quick: boolean;
    shortcuts: ShortcutRow[];
  },
): string {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  const ai = played.filter((m) => !m.cars[0].sparring);
  const strategy = played.filter((m) => m.spec.phase === 'strategy');
  const difficulty = played.filter((m) => m.spec.phase === 'difficulty');
  const sys = played.filter((m) => m.spec.phase === 'system' && m.cars[0].sparring);
  const sysAi = played.filter((m) => m.spec.phase === 'system' && !m.cars[0].sparring);
  const spar = played.filter((m) => m.spec.phase === 'sparring' && m.cars[0].sparring);
  const sparAi = played.filter((m) => m.spec.phase === 'sparring' && !m.cars[0].sparring);
  const all = summarize(played);

  out(`# Bot tournament${options.quick ? ' (quick)' : ''}`);
  out();
  out(
    `Generated by \`${options.command}\` in ${f(options.seconds, 0)} s. ${played.length} server-only races ` +
      `(the room's own race setup and step, headless) on all ${COURSES.length} courses: ` +
      `${strategy.length} strategy matchups (Racer against Racer, every pair of the six strategies), ` +
      `${difficulty.length} difficulty matchups (balanced strategy) and ${spar.length + sparAi.length + sys.length + sysAi.length} before/after races ` +
      `against the sparring brain on the same seeds. Tow on. ` +
      'Every number below is measured in these races; see docs/AI_GUIDE.md for how to read it.',
  );
  out();
  out('## Reliability');
  out();
  out(
    `- Races: ${all.races}. Finished: ${all.finished} (${pct(all.finished / Math.max(1, all.races))}). ` +
      `Ran to the time limit: ${all.timeouts}. With a problem (crash, stuck car over 8 s, non-finite state, timeout): ${all.problems}.`,
  );
  const problems = played.filter((m) => m.problems.length > 0);
  for (const m of problems.slice(0, 20))
    out(
      `  - ${courseName(m.spec.trackId, m.spec.presetId)}, seed ${m.spec.seed}, ${m.spec.phase} ${m.spec.pair}: ${m.problems.join('; ')}`,
    );
  if (problems.length > 20) out(`  - and ${problems.length - 20} more`);
  for (const d of options.desync) out(`- ${d}`);
  const costs = ai.flatMap((m) => m.cars.filter((c) => !c.sparring));
  out(
    `- AI cost per car and tick (wall clock, this shared two-core machine, other work running): mean ` +
      `${f(mean(costs.map((c) => c.brainMeanMs)), 3)} ms, worst single tick ${f(Math.max(...costs.map((c) => c.brainWorstMs)), 1)} ms ` +
      `(median of each race's worst ${f(median(costs.map((c) => c.brainWorstMs)), 2)} ms), against a 33.3 ms tick.`,
  );
  out();

  out('## Every course (AI races: strategy and difficulty matchups)');
  out();
  out(
    '| Course | Races | Finished | Mean / median race s | Target s | Top strategy | Top tire | Lap 1 leader wins | Lead changes | Shortcut laps | Shortcut payoff s/lap | Weapons fired | Damage | Wrecks | Hot s / car |',
  );
  out(
    '| :-- | --: | --: | :-- | --: | :-- | :-- | --: | --: | --: | --: | --: | --: | --: | --: |',
  );
  for (const c of COURSES) {
    const ms = played.filter(
      (m) =>
        courseKey(m) === `${c.trackId}/${c.presetId}` &&
        (m.spec.phase === 'strategy' || m.spec.phase === 'difficulty'),
    );
    const s = summarize(ms);
    const strat = [
      ...tally(
        ms.filter((m) => m.spec.phase === 'strategy'),
        (car) => car.strategy,
      ).entries(),
    ]
      .map(([k, v]) => [k, v.wins / Math.max(1, v.races)] as const)
      .sort((a, b) => b[1] - a[1]);
    const tires = [...tally(ms, (car) => car.tireKitId).entries()]
      .filter(([, v]) => v.races >= 3)
      .map(([k, v]) => [k, v.wins / v.races, v.races] as const)
      .sort((a, b) => b[1] - a[1]);
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${s.races} | ${pct(s.finished / Math.max(1, s.races))} | ${f(s.meanRace)} / ${f(s.medianRace)} | ${targetSeconds(c.trackId)} | ` +
        `${strat[0] ? `${strat[0][0]} ${pct(strat[0][1])}` : 'n/a'} | ${tires[0] ? `${tireName(String(tires[0][0]))} ${pct(tires[0][1])} of ${tires[0][2]}` : 'n/a'} | ` +
        `${pct(s.lap1LeaderWins)} | ${f(s.leadChanges, 2)} | ${pct(s.shortcutLaps)} | ${f(s.shortcutPayoff, 2)} | ${f(s.weapons)} | ${f(s.damage)} | ${f(s.wrecks, 2)} | ${f(s.hot)} |`,
    );
  }
  out();
  out(
    "Target is the Section 9.3 length class for the default car driven by the centerline driver (about 105 s short, 130 s long). AI cars are built for the course and drive a racing line, so they are faster than that car. Shortcut payoff compares each car's own laps 2 and 3 through a shortcut with its laps without one (blank where no car did both).",
  );
  out();

  out('## Which strategy wins where (Racer against Racer, win rate)');
  out();
  out(`| Course | ${AI_STRATEGIES.join(' | ')} |`);
  out(`| :-- |${AI_STRATEGIES.map(() => ' --: |').join('')}`);
  for (const c of COURSES) {
    const ms = strategy.filter((m) => courseKey(m) === `${c.trackId}/${c.presetId}`);
    const t = tally(ms, (car) => car.strategy);
    out(
      `| ${courseName(c.trackId, c.presetId)} | ${AI_STRATEGIES.map((s) => {
        const row = t.get(s);
        return row ? pct(row.wins / Math.max(1, row.races)) : 'n/a';
      }).join(' | ')} |`,
    );
  }
  const overall = tally(strategy, (car) => car.strategy);
  out(
    `| All courses | ${AI_STRATEGIES.map((s) => {
      const row = overall.get(s);
      return row ? pct(row.wins / Math.max(1, row.races)) : 'n/a';
    }).join(' | ')} |`,
  );
  out();

  out('## Which tires win where (every AI-built car, win rate and races)');
  out();
  const tireIds = [...new Set(ai.flatMap((m) => m.cars.map((c) => c.tireKitId)))].filter(
    (t) => t !== '?',
  );
  out(`| Course | ${tireIds.map(tireName).join(' | ')} |`);
  out(`| :-- |${tireIds.map(() => ' --: |').join('')}`);
  for (const c of COURSES) {
    const ms = played.filter(
      (m) =>
        courseKey(m) === `${c.trackId}/${c.presetId}` &&
        !m.cars[0].sparring &&
        m.spec.phase !== 'sparring',
    );
    const t = tally(ms, (car) => car.tireKitId);
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
  out("Mirror matchups (both cars on the same kit) are left out of a kit's count.");
  out();

  out('## Surface choice: the same car on different wheel kits');
  out();
  out(
    "The balanced strategy's Arrow (V8, Trail Engine on the desert) against itself, Racer against Racer, from both grid slots; the only difference between the two cars is the wheel kit. Win rate of the kit the course's surface profile ranks first, and its mean finishing margin (seconds, positive when it is ahead).",
  );
  out();
  out('| Course | Profile kit | Against | Races | Profile kit wins | Margin s |');
  out('| :-- | :-- | :-- | --: | --: | --: |');
  const duels = played.filter((m) => m.spec.phase === 'tires');
  for (const c of COURSES) {
    const here = duels.filter((m) => courseKey(m) === `${c.trackId}/${c.presetId}`);
    const pairs = [...new Set(here.map((m) => m.spec.pair))];
    for (const pair of pairs) {
      const ms = here.filter((m) => m.spec.pair === pair);
      const [best, other] = pair.split('-') as [string, string];
      let wins = 0;
      const margins: number[] = [];
      for (const m of ms) {
        const i = m.cars.findIndex((car) => car.tireKitId === best);
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
  const allDuels = duels.length;
  const bestWins = duels.filter((m) => {
    const best = m.spec.pair.split('-')[0];
    return m.winner === m.cars.findIndex((car) => car.tireKitId === best);
  }).length;
  out();
  out(`Over all ${allDuels} duels the profile's kit won ${pct(bestWins / Math.max(1, allDuels))}.`);
  out();

  out('## Shortcuts: what they are worth, driven');
  out();
  out(
    "One car alone, the AI at Racer, three laps: every shortcut forced off, every one forced on, and left to its own plan. The estimate is the plan's own (seconds a lap, positive when the shortcut is quicker for that car).",
  );
  out();
  out('| Course | Car | Never s | Always s | Plan s | Plan took | Estimate s/lap |');
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

  out('## Difficulty');
  out();
  const diffT = (a: string, b: string) => {
    const ms = difficulty.filter((m) => m.spec.pair === `${a}-${b}`);
    let aw = 0;
    for (const m of ms) {
      const ai_ = m.cars.findIndex((c) => c.difficulty === a);
      if (m.winner === ai_) aw++;
      else if (m.winner === -1) aw += 0.5;
    }
    return { races: ms.length, rate: aw / Math.max(1, ms.length) };
  };
  for (const [a, b] of [
    ['ace', 'rookie'],
    ['ace', 'racer'],
    ['racer', 'rookie'],
  ] as const) {
    const r = diffT(a, b);
    out(`- ${a} against ${b}: ${a} wins ${pct(r.rate)} of ${r.races}.`);
  }
  const byDiff = (d: string) => difficulty.flatMap((m) => m.cars.filter((c) => c.difficulty === d));
  out();
  out(
    '| Difficulty | Mean lap s (laps 2 and 3) | Off its best line, px | Wall hits a race | Weapons fired a race | Damage dealt | Shortcut laps |',
  );
  out('| :-- | --: | --: | --: | --: | --: | --: |');
  for (const d of ['rookie', 'racer', 'ace']) {
    const cars = byDiff(d);
    const laps = cars.flatMap((c) => c.lapTimes.slice(1));
    const all_ = cars.flatMap((c) => c.lapShortcuts);
    out(
      `| ${d} | ${f(mean(laps), 2)} | ${f(mean(cars.map((c) => c.lineError).filter(Number.isFinite)))} | ${f(mean(cars.map((c) => c.wallHits)), 2)} | ${f(mean(cars.map((c) => c.weaponUses)))} | ${f(mean(cars.map((c) => c.damageDealt)))} | ${pct(all_.filter((x) => x > 0).length / Math.max(1, all_.length))} |`,
    );
  }
  out();
  out(
    'Lap times are of the balanced strategy on every course together, so they compare difficulties, not courses.',
  );
  out();

  out('## Styles at the same difficulty (strategy matchups, Racer)');
  out();
  const st = tally(strategy, (car) => car.style);
  out(
    `- Win rate: aggressive ${pct((st.get('aggressive')?.wins ?? 0) / Math.max(1, st.get('aggressive')?.races ?? 1))}, tactical ${pct((st.get('tactical')?.wins ?? 0) / Math.max(1, st.get('tactical')?.races ?? 1))}.`,
  );
  const byStyle = (s: string) => strategy.flatMap((m) => m.cars.filter((c) => c.style === s));
  for (const s of ['aggressive', 'tactical']) {
    const cars = byStyle(s);
    const sc = cars.flatMap((c) => c.lapShortcuts);
    out(
      `- ${s}: weapons fired a race ${f(mean(cars.map((c) => c.weaponUses)))}, damage dealt ${f(mean(cars.map((c) => c.damageDealt)))}, ` +
        `wall hits ${f(mean(cars.map((c) => c.wallHits)), 2)}, off its best line ${f(mean(cars.map((c) => c.lineError).filter(Number.isFinite)))} px, ` +
        `shortcut laps ${pct(sc.filter((x) => x > 0).length / Math.max(1, sc.length))}.`,
    );
  }
  out();

  const compare = (title: string, note: string, before: Played[], after: Played[]) => {
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
      `| Finished | ${pct(b.finished / Math.max(1, b.races))} | ${pct(a.finished / Math.max(1, a.races))} |`,
    );
    out(`| Mean race s | ${f(b.meanRace)} | ${f(a.meanRace)} |`);
    out(`| Lead changes a race | ${f(b.leadChanges, 2)} | ${f(a.leadChanges, 2)} |`);
    out(
      `| Races with a lead change | ${pct(before.filter((m) => m.leadChanges > 0).length / Math.max(1, before.length))} | ${pct(after.filter((m) => m.leadChanges > 0).length / Math.max(1, after.length))} |`,
    );
    out(`| Lap 1 leader wins | ${pct(b.lap1LeaderWins)} | ${pct(a.lap1LeaderWins)} |`);
    out(`| Seconds within 220 px a race | ${f(b.close)} | ${f(a.close)} |`);
    out(`| Weapon activations a race | ${f(b.weapons)} | ${f(a.weapons)} |`);
    out(`| Damage dealt a race | ${f(b.damage)} | ${f(a.damage)} |`);
    out(`| Wrecks a race | ${f(b.wrecks, 2)} | ${f(a.wrecks, 2)} |`);
    out(`| Shortcut laps | ${pct(b.shortcutLaps)} | ${pct(a.shortcutLaps)} |`);
    out(`| Seconds hot (at or over the performance threshold) a car | ${f(b.hot)} | ${f(a.hot)} |`);
    out(`| Seconds in thermal protection a car | ${f(b.protection)} | ${f(a.protection)} |`);
    out();
  };
  compare(
    '## Before and after: the rival as a player meets it (same seeds)',
    'Before: what the room raced until now, a shipped build picked by seed, driven by the sparring brain (both cars). After: what it races now, a build for the course from a strategy picked by seed, driven by the AI at Racer (both cars).',
    sys,
    sysAi,
  );
  compare(
    '## Before and after: the brain alone (same shipped builds, same seeds)',
    'The same pairs of shipped builds from both grid slots, once with the sparring brain in both cars and once with the AI. This isolates the driver from the build.',
    spar,
    sparAi,
  );

  out('## Weapons in the AI races (damage dealt per activation, and per 100 credits)');
  out();
  const weaponRows = new Map<string, { uses: number; damage: number; cars: number }>();
  for (const m of ai)
    for (const car of m.cars) {
      const key = `${car.strategy}`;
      const row = weaponRows.get(key) ?? { uses: 0, damage: 0, cars: 0 };
      row.uses += car.weaponUses;
      row.damage += car.damageDealt;
      row.cars++;
      weaponRows.set(key, row);
    }
  out('| Strategy | Cars | Activations a race | Damage dealt a race | Damage per activation |');
  out('| :-- | --: | --: | --: | --: |');
  for (const [k, v] of [...weaponRows.entries()].sort()) {
    out(
      `| ${k} | ${v.cars} | ${f(v.uses / v.cars)} | ${f(v.damage / v.cars)} | ${f(v.damage / Math.max(1, v.uses))} |`,
    );
  }
  out();
  void TRACKS;
  return lines.join('\n');
}
