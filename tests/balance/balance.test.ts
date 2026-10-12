import { RIVAL_TEMPLATES, WEAPON_LIST } from '@bolt/content';
import { TOW } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { MatchOutcome } from './harness.js';
import {
  CONTROL_WEAPONS,
  DAMAGE_RATIO_HIGH,
  DAMAGE_RATIO_LOW,
  NEON_CLEAR,
  WIN_RATE_HIGH,
  WIN_RATE_LOW,
  formatBalance,
  formatBench,
  runBalance,
  runBotMatch,
  runWeaponBench,
} from './harness.js';
import { unarmed } from './tow.js';
import { UPGRADE_PAIRS, checkUpgradePair, runUpgradeTest } from './upgrade.js';

/**
 * The balance harness as a test (Sections 13 and 19.6). One seed keeps it quick; the reports
 * in docs/evidence/balance/ use more (`npx tsx tests/balance/report.ts`). The assertions are
 * the targets the spec sets and that the harness does its job; which builds and weapons are
 * out of line today is a finding, recorded in docs/BALANCE_CHANGELOG.md, not a pass or fail.
 */

const SEEDS = [1001];

// The race as it ships, with the tow on, and the same races without it for the tow's targets.
const report = runBalance(SEEDS);

describe('every starter and example build against every other on Neon Cut', () => {
  it('plays every pairing from both grid slots to a result', () => {
    const n = RIVAL_TEMPLATES.length;
    expect(n).toBe(11);
    expect(report.matches).toBe(n * (n - 1) * SEEDS.length);
    expect(report.templates.every((line) => line.matches === 2 * (n - 1) * SEEDS.length)).toBe(
      true,
    );
    expect(
      Object.keys(report.reasons).every((reason) => ['finish', 'timeout', 'ko'].includes(reason)),
    ).toBe(true);
    const wins = report.templates.reduce((sum, line) => sum + line.wins + line.draws / 2, 0);
    expect(wins).toBe(report.matches);
  });

  it('keeps races inside the length the spec asks for (Section 3.4)', () => {
    expect(report.meanRaceSeconds).toBeGreaterThan(100);
    expect(report.meanRaceSeconds).toBeLessThan(140);
    expect(report.reasons['timeout'] ?? 0).toBe(0);
  });

  it('keeps knockouts rare: under 3 percent of races (Section 3.4)', () => {
    expect((report.reasons['ko'] ?? 0) / report.matches).toBeLessThan(0.03);
  });

  it('makes combat matter without deciding everything: damage is dealt, wrecks are uncommon', () => {
    const dealt = report.templates.reduce((sum, line) => sum + line.meanDamageDealt, 0);
    expect(dealt).toBeGreaterThan(100);
    const wrecked = report.templates.reduce((sum, line) => sum + line.wrecked, 0);
    expect(wrecked / (report.matches * 2)).toBeLessThan(0.1);
  });

  it('flags exactly the builds outside 30 to 70 percent and the weapons outside half to double the median', () => {
    for (const line of report.templates) {
      const out = line.winRate > WIN_RATE_HIGH || line.winRate < WIN_RATE_LOW;
      expect(
        report.flags.some((flag) => flag.startsWith(`${line.name} wins`)),
        line.name,
      ).toBe(out);
    }
    for (const line of report.weapons) {
      const out =
        !CONTROL_WEAPONS.has(line.id) &&
        (line.ratio > DAMAGE_RATIO_HIGH || line.ratio < DAMAGE_RATIO_LOW);
      expect(
        report.flags.some((flag) => flag.startsWith(`${line.name} deals`)),
        line.name,
      ).toBe(out);
    }
    const text = formatBalance(report);
    expect(text).toMatch(/\| Build \| Cost \|/);
    expect(text).toMatch(/Damage per 100 credits/);
  });
});

describe('the weapon bench: one copy of each weapon against the same car without it', () => {
  const bench = runWeaponBench(SEEDS);

  it('covers all twenty weapons, and the sparring driver gets every one of them to go off', () => {
    expect(bench.lines.map((line) => line.id).sort()).toEqual(WEAPON_LIST.map((w) => w.id).sort());
    for (const line of bench.lines) expect(line.meanUses, line.id).toBeGreaterThan(0);
  });

  it('measures damage for every weapon that is meant to deal it', () => {
    for (const line of bench.lines)
      if (!CONTROL_WEAPONS.has(line.id)) expect(line.meanDamage, line.id).toBeGreaterThan(0);
    expect(bench.medianDamagePer100).toBeGreaterThan(0);
    expect(formatBench(bench)).toMatch(/Wins against unarmed twin/);
  });
});

/**
 * The tow against the four targets of its brief and two guards (docs/evidence/balance/
 * tow-0.6.0-clear.md has the four-seed numbers, tow-study.md every setting tried). One seed,
 * so the bands are loose; each was checked against the same races with the tow off, with its
 * bonus halved and with it doubled (`npx tsx tests/tools/towBands.ts`), and placed so that
 * taking the tow out or doubling it fails here:
 *
 * | one seed                                   | off   | on    | halved | doubled |
 * | lap 1 leader wins                          | 0.96  | 0.93  | 0.94   | 0.90    |
 * | weapon activations a race                  | 4.44  | 5.94  | 5.63   | 6.84    |
 * | seconds a race within 220 px               | 12.6  | 15.0  | 13.5   | 16.9    |
 * | share of the race within 1.5 s             | 0.154 | 0.225 | 0.195  | 0.284   |
 * | share of the race beyond 3 s               | 0.670 | 0.551 | 0.603  | 0.439   |
 * | upgraded twin's wins, six pairs of two     | 2 1 2 1 2 1 | 2 1 2 1 2 1 | the same | 2 0 2 1 2 1 |
 * | unarmed fast against slow: gap at the line | 5.80  | 2.82  | 3.95   | 1.70    |
 * | ... the fast car wins, of 12               | 12    | 12    | 12     | 12      |
 * | ... passes by a car with tow               | 0     | 0     | 0      | 0       |
 */
describe('the tow against its targets', () => {
  const off = runBalance(SEEDS, NEON_CLEAR, RIVAL_TEMPLATES, false);
  const on = report;
  const upgradesOff = runUpgradeTest(SEEDS, false);
  const upgradesOn = runUpgradeTest(SEEDS, true);

  // Six pairings of a faster shipped build with a slower one, weapons taken off, from both
  // grid slots: between 2 and 12 percent apart on pace.
  const PAIRS: Array<[string, string]> = [
    ['example_straight_line_rocket', 'example_tiny_trouble'],
    ['example_tiny_trouble', 'starter_sprinter'],
    ['starter_sprinter', 'starter_tinker'],
    ['starter_tinker', 'example_back_alley_trap'],
    ['example_back_alley_trap', 'starter_rookie'],
    ['example_rain_runner', 'example_dust_spider'],
  ];
  const template = (id: string) => RIVAL_TEMPLATES.find((t) => t.id === id)!;
  type Duel = { fastWon: boolean; match: MatchOutcome };
  const duels = (tow: boolean): Duel[] =>
    PAIRS.flatMap(([fast, slow]) =>
      [0, 1].map((slot) => {
        const cars = [unarmed(template(fast)), unarmed(template(slow))];
        const match =
          slot === 0
            ? runBotMatch(cars[0]!, cars[1]!, SEEDS[0]!, NEON_CLEAR, tow)
            : runBotMatch(cars[1]!, cars[0]!, SEEDS[0]!, NEON_CLEAR, tow);
        return { fastWon: match.winner === slot, match };
      }),
    );
  const unarmedOff = duels(false);
  const unarmedOn = duels(true);
  const meanGap = (list: Duel[]) =>
    list.reduce((sum, d) => sum + (d.match.gapAtFinish ?? 0), 0) / list.length;

  it('1. leading still pays: the car ahead after lap 1 wins a clear majority', () => {
    expect(on.racing.lap1Decided).toBe(on.matches);
    expect(on.racing.lap1LeaderWins).toBeGreaterThanOrEqual(0.6);
    // And it is the tow that is on, in a real share of the racing.
    expect(off.racing.towShare).toBe(0);
    expect(on.racing.towShare).toBeGreaterThan(0.2);
    expect(on.racing.towShare).toBeLessThan(0.5);
  });

  it('2. does not push any build further outside 30 to 70 percent than it was', () => {
    const outside = (r: typeof on) =>
      r.templates.filter((t) => t.winRate > WIN_RATE_HIGH || t.winRate < WIN_RATE_LOW);
    // It cannot bring them in either: it never changes who is faster. Recorded, not hidden.
    expect(outside(on).length).toBeLessThanOrEqual(outside(off).length + 1);
    for (const line of on.templates) {
      const before = off.templates.find((t) => t.id === line.id)!;
      expect(Math.abs(line.winRate - before.winRate), line.name).toBeLessThanOrEqual(0.25);
    }
  });

  it('3. combat happens more: more weapon activations, more time within reach, more of the race close', () => {
    const uses = on.racing.usesPerRace / off.racing.usesPerRace;
    expect(uses).toBeGreaterThan(1.15);
    expect(uses).toBeLessThan(1.45);
    const reach = on.racing.reachSecondsPerRace - off.racing.reachSecondsPerRace;
    expect(reach).toBeGreaterThan(1.5);
    expect(reach).toBeLessThan(4);
    const closer = on.racing.within15 - off.racing.within15;
    expect(closer).toBeGreaterThan(0.05);
    expect(closer).toBeLessThan(0.1);
    const lessApart = off.racing.beyond3 - on.racing.beyond3;
    expect(lessApart).toBeGreaterThan(0.08);
    expect(lessApart).toBeLessThan(0.17);
    expect(on.racing.damagePerRace).toBeGreaterThan(off.racing.damagePerRace);
  });

  it('4. building well still pays: an upgraded twin does no worse against its stock twin than without the tow', () => {
    expect(upgradesOn.map((line) => line.pair.id)).toEqual(UPGRADE_PAIRS.map((pair) => pair.id));
    for (const pair of UPGRADE_PAIRS) expect(checkUpgradePair(pair), pair.id).toEqual([]);
    upgradesOn.forEach((line, i) => {
      const before = upgradesOff[i]!;
      // At most one race in two may go the other way (this is one seed); none did as tuned.
      expect(line.wins, line.pair.id).toBeGreaterThanOrEqual(before.wins - 1);
    });
    // The clear engine upgrades win every race, tow or not.
    for (const id of ['rookie_v6', 'packhorse_v8']) {
      const line = upgradesOn.find((l) => l.pair.id === id)!;
      expect(line.winRate, id).toBe(1);
    }
    // Over all six pairs the upgraded twin wins at least as often as it did without the tow.
    const total = (lines: typeof upgradesOn) => lines.reduce((sum, l) => sum + l.wins, 0);
    expect(total(upgradesOn)).toBeGreaterThanOrEqual(total(upgradesOff));
  });

  it('and a faster car still beats a slower one when nobody shoots, by a smaller margin', () => {
    expect(unarmedOff.every((d) => d.fastWon)).toBe(true);
    expect(unarmedOn.every((d) => d.fastWon)).toBe(true);
    unarmedOn.forEach((d, i) => {
      const before = unarmedOff[i]!.match.gapAtFinish!;
      const after = d.match.gapAtFinish!;
      expect(after).toBeLessThan(before);
      // The slower car is brought to the edge of fighting range and no further.
      expect(after).toBeGreaterThan(TOW.thresholdGap);
    });
    const ratio = meanGap(unarmedOn) / meanGap(unarmedOff);
    // 0.49 as tuned; 1 without the tow, 0.29 with it doubled, 0.68 with it halved.
    expect(ratio).toBeGreaterThan(0.38);
    expect(ratio).toBeLessThan(0.6);
  });

  it('and the tow never passes anyone by itself', () => {
    const passes = (list: Duel[]) => list.reduce((sum, d) => sum + d.match.towPasses, 0);
    expect(passes(unarmedOn)).toBe(0);
    // Identical unarmed cars side by side on the grid: whatever happens, not a pass on tow.
    for (const id of ['starter_rookie', 'starter_sprinter', 'starter_packhorse']) {
      const car = unarmed(template(id));
      const match = runBotMatch(car, car, SEEDS[0]!, NEON_CLEAR, true);
      expect(match.towPasses, id).toBe(0);
    }
    // With weapons a car can be shot, slowed and passed while the car behind still has some
    // tow left: that is a weapon's work, and it is rare.
    expect(on.racing.towPasses).toBeLessThanOrEqual(Math.ceil(on.matches * 0.03));
  });
});
