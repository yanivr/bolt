import { RIVAL_TEMPLATES, WEAPON_LIST } from '@bolt/content';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_WEAPONS,
  DAMAGE_RATIO_HIGH,
  DAMAGE_RATIO_LOW,
  WIN_RATE_HIGH,
  WIN_RATE_LOW,
  formatBalance,
  formatBench,
  runBalance,
  runWeaponBench,
} from './harness.js';

/**
 * The balance harness as a test (Sections 13 and 19.6). One seed keeps it quick; the reports
 * in docs/evidence/balance/ use more (`npx tsx tests/balance/report.ts`). The assertions are
 * the targets the spec sets and that the harness does its job; which builds and weapons are
 * out of line today is a finding, recorded in docs/BALANCE_CHANGELOG.md, not a pass or fail.
 */

const SEEDS = [1001];

describe('every starter and example build against every other on Neon Cut', () => {
  const report = runBalance(SEEDS);

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
