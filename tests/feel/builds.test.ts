import { EXAMPLE_TEMPLATES, TEMPLATES } from '@bolt/content';
import { RACE_LIMIT_SECONDS } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import type { BuildRun } from './builds.js';
import { NEON_DRY, NEON_RAIN, runBuild } from './builds.js';

/**
 * Milestone B gate: "build unusual cars, and verify meaningful speed/stability differences".
 * Every shipped blueprint is driven round Neon Cut by the centerline driver, dry and in the
 * rain, on the authoritative session. The assertions are the directions Section 11.9 gives
 * for each example build. The measured table is in docs/BALANCE_CHANGELOG.md and can be
 * regenerated with `npx tsx tests/feel/buildsReport.ts`.
 */

const dry = new Map<string, BuildRun>();
const rain = new Map<string, BuildRun>();
for (const template of TEMPLATES) {
  dry.set(template.name, runBuild(template.blueprint, NEON_DRY));
  rain.set(template.name, runBuild(template.blueprint, NEON_RAIN));
}
const examples = EXAMPLE_TEMPLATES.map((t) => t.name);
const others = (name: string) => examples.filter((n) => n !== name);
const rainLoss = (name: string) => rain.get(name)!.raceSeconds - dry.get(name)!.raceSeconds;

describe('every shipped blueprint races', () => {
  it.each(TEMPLATES.map((t) => t.name))(
    '%s finishes Neon Cut, dry and wet, without touching a wall',
    (name) => {
      for (const run of [dry.get(name)!, rain.get(name)!]) {
        expect(run.finished).toBe(true);
        expect(run.raceSeconds).toBeLessThan(RACE_LIMIT_SECONDS - 20);
        expect(run.raceSeconds).toBeGreaterThan(90);
        expect(run.wallStrikes).toBe(0);
        expect(run.peakSlipDeg).toBeLessThan(20);
        expect(run.topMph).toBeGreaterThan(60);
        expect(run.cost).toBeLessThanOrEqual(1000);
      }
      // Rain is slower for every car.
      expect(rainLoss(name)).toBeGreaterThan(0);
    },
  );

  it('keeps the baseline Beetle inside the Section 9.3 race window and the Section 6.5 targets', () => {
    const baseline = dry.get('Baseline Beetle')!;
    expect(baseline.raceSeconds).toBeGreaterThan(105);
    expect(baseline.raceSeconds).toBeLessThan(140);
    expect(baseline.topMph).toBeGreaterThan(70);
    expect(baseline.topMph).toBeLessThan(95);
    expect(baseline.zeroToSixty!).toBeGreaterThan(3.5);
    expect(baseline.zeroToSixty!).toBeLessThan(4.5);
    expect(baseline.peakHeat).toBeLessThan(70);
    expect(baseline.lowPowerSeconds).toBe(0);
    // The Rookie starter carries 63 kg more and is a little slower for it, as it should be.
    expect(dry.get('Rookie')!.raceSeconds).toBeGreaterThan(baseline.raceSeconds);
    expect(dry.get('Rookie')!.raceSeconds).toBeLessThan(baseline.raceSeconds + 5);
  });
});

describe('the six example builds differ the way Section 11.9 says', () => {
  it('spreads them meaningfully in pace, top speed, launch and stability', () => {
    const times = examples.map((n) => dry.get(n)!.raceSeconds);
    const tops = examples.map((n) => dry.get(n)!.topMph);
    const launches = examples.map((n) => dry.get(n)!.zeroToSixty!);
    const stabilities = examples.map((n) => dry.get(n)!.stability);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(20);
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(15);
    expect(Math.max(...launches) / Math.min(...launches)).toBeGreaterThan(2.5);
    expect(Math.max(...stabilities) - Math.min(...stabilities)).toBeGreaterThan(40);
    // No two examples are the same car in different paint.
    for (const a of examples)
      for (const b of examples)
        if (a < b) {
          const pace = Math.abs(dry.get(a)!.raceSeconds - dry.get(b)!.raceSeconds);
          const launch = Math.abs(dry.get(a)!.zeroToSixty! - dry.get(b)!.zeroToSixty!);
          const stability = Math.abs(dry.get(a)!.stability - dry.get(b)!.stability);
          expect(pace > 1 || launch > 1 || stability > 10, `${a} and ${b}`).toBe(true);
        }
  });

  it('Straight-Line Rocket: fast on dry asphalt, weak in rain', () => {
    const name = 'Straight-Line Rocket';
    for (const other of others(name)) {
      expect(dry.get(name)!.raceSeconds, other).toBeLessThan(dry.get(other)!.raceSeconds);
      expect(dry.get(name)!.topMph, other).toBeGreaterThan(dry.get(other)!.topMph);
      // Slicks: it gives up more time to the rain than any other example.
      expect(rainLoss(name), other).toBeGreaterThan(rainLoss(other) + 2);
    }
    expect(rainLoss(name)).toBeGreaterThan(10);
    // In the rain it is no longer the quickest car.
    expect(rain.get(name)!.raceSeconds).toBeGreaterThan(
      Math.min(...others(name).map((n) => rain.get(n)!.raceSeconds)),
    );
    expect(dry.get(name)!.topMph).toBeGreaterThan(dry.get('Baseline Beetle')!.topMph + 12);
  });

  it('Iron Mule: high survival, low acceleration', () => {
    const name = 'Iron Mule';
    for (const other of others(name)) {
      expect(dry.get(name)!.zeroToSixty!, other).toBeGreaterThan(dry.get(other)!.zeroToSixty! + 2);
      expect(dry.get(name)!.massKg, other).toBeGreaterThan(dry.get(other)!.massKg);
      expect(dry.get(name)!.raceSeconds, other).toBeGreaterThan(dry.get(other)!.raceSeconds);
    }
    expect(dry.get(name)!.zeroToSixty!).toBeGreaterThan(
      2 * dry.get('Baseline Beetle')!.zeroToSixty!,
    );
  });

  it('Dust Spider: the most stable, and the calmest through the corners', () => {
    const name = 'Dust Spider';
    for (const other of others(name))
      expect(dry.get(name)!.stability, other).toBeGreaterThan(dry.get(other)!.stability + 20);
    expect(dry.get(name)!.stability).toBe(100);
    expect(dry.get(name)!.peakSlipDeg).toBeLessThanOrEqual(
      Math.min(...others(name).map((n) => dry.get(n)!.peakSlipDeg)) + 0.2,
    );
    expect(rain.get(name)!.peakSlipDeg).toBeLessThan(rain.get('Tiny Trouble')!.peakSlipDeg - 3);
  });

  it('Rain Runner: at home in the wet, and short of power', () => {
    const name = 'Rain Runner';
    // Rain Runners: the rain costs it less than it costs any other example.
    for (const other of others(name))
      expect(rainLoss(name), other).toBeLessThan(rainLoss(other) - 2);
    expect(rainLoss(name)).toBeLessThan(2);
    // Sport Electric: the hardest launch of the four-wheeled examples.
    for (const other of others(name).filter((n) => n !== 'Tiny Trouble'))
      expect(dry.get(name)!.zeroToSixty!, other).toBeLessThanOrEqual(dry.get(other)!.zeroToSixty!);
    // The electrical tradeoff: it runs its battery flat and spends most of the race short.
    expect(dry.get(name)!.minBattery).toBe(0);
    expect(dry.get(name)!.lowPowerSeconds).toBeGreaterThan(40);
    for (const other of others(name)) expect(dry.get(other)!.lowPowerSeconds, other).toBe(0);
  });

  it('Back-Alley Trap: a sound all-rounder whose strength is behind it', () => {
    const name = 'Back-Alley Trap';
    const times = examples.map((n) => dry.get(n)!.raceSeconds).sort((a, b) => a - b);
    // Neither the quickest nor the slowest of the six, and quicker than the stock car.
    expect(dry.get(name)!.raceSeconds).toBeGreaterThan(times[0]!);
    expect(dry.get(name)!.raceSeconds).toBeLessThan(times[5]!);
    expect(dry.get(name)!.raceSeconds).toBeLessThan(dry.get('Baseline Beetle')!.raceSeconds);
    // The Hybrid never runs hot or short of power.
    expect(dry.get(name)!.peakHeat).toBeLessThan(70);
    expect(dry.get(name)!.lowPowerSeconds).toBe(0);
  });

  it('Tiny Trouble: outrageous acceleration and fragile turning', () => {
    const name = 'Tiny Trouble';
    for (const other of others(name)) {
      expect(dry.get(name)!.zeroToSixty!, other).toBeLessThan(dry.get(other)!.zeroToSixty!);
      expect(dry.get(name)!.launch200!, other).toBeLessThanOrEqual(dry.get(other)!.launch200!);
      expect(dry.get(name)!.stability, other).toBeLessThan(dry.get(other)!.stability - 10);
      expect(dry.get(name)!.massKg, other).toBeLessThan(dry.get(other)!.massKg);
      // It slides further than any other example, wet or dry.
      expect(dry.get(name)!.peakSlipDeg, other).toBeGreaterThan(dry.get(other)!.peakSlipDeg + 1);
      expect(rain.get(name)!.peakSlipDeg, other).toBeGreaterThan(rain.get(other)!.peakSlipDeg + 1);
    }
    expect(dry.get(name)!.zeroToSixty!).toBeLessThan(3);
    // Fragile, not undrivable.
    expect(dry.get(name)!.peakSlipDeg).toBeLessThan(18);
    // The cheapest example is one of the two quickest in the dry.
    expect(dry.get(name)!.cost).toBe(Math.min(...examples.map((n) => dry.get(n)!.cost)));
    expect(dry.get(name)!.raceSeconds).toBeLessThan(dry.get('Rain Runner')!.raceSeconds);
  });
});
