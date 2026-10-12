import { describe, expect, it } from 'vitest';
import { runMatch } from './harness.js';
import type { PlannedMatch } from './plan.js';
import { COURSES, plannedMatches } from './plan.js';

/**
 * A small deterministic subset of the bot tournament (`npx tsx tests/tournament/run.ts`), in
 * CI time: one strategy matchup, one difficulty matchup and one roster race (a shipped build
 * against the AI exactly as the room sets it up, `createAiRace`) on four courses that cover
 * the four kinds of ground (city, sand, mud, snow). Every race must finish with nobody stuck,
 * and a race run twice must be the same race.
 */

const SAMPLE = [
  'city_02/city_rain_day',
  'desert_02/desert_dry_heat',
  'forest_01/forest_clear',
  'snow_01/snow_snowfall',
];

function subset(): PlannedMatch[] {
  const all = plannedMatches(true, 9001);
  const out: PlannedMatch[] = [];
  for (const key of SAMPLE) {
    const here = all.filter((m) => `${m.trackId}/${m.presetId}` === key);
    for (const phase of ['strategy', 'difficulty', 'roster'] as const) {
      const m = here.find((x) => x.phase === phase);
      if (m) out.push(m);
    }
  }
  return out;
}

describe('the bot tournament, a CI subset', () => {
  const matches = subset();
  const records = matches.map((spec) => ({ spec, record: runMatch(spec) }));

  it('covers the courses it says it does', () => {
    expect(COURSES).toHaveLength(16);
    expect(matches.length).toBe(SAMPLE.length * 3);
    expect(matches.filter((m) => m.room).length).toBe(SAMPLE.length);
  });

  it.each(
    records.map(
      (r) => [`${r.spec.trackId}/${r.spec.presetId} ${r.spec.phase} ${r.spec.pair}`, r] as const,
    ),
  )('%s: finishes, nobody stuck, no crash', (_name, { record }) => {
    expect(record.problems).toEqual([]);
    expect(record.reason).toBe('finish');
    expect(record.cars.some((c) => c.finished)).toBe(true);
    expect(record.raceSeconds).toBeGreaterThan(60);
    expect(record.raceSeconds).toBeLessThan(180);
  });

  it('is deterministic: the same match twice is the same race', () => {
    const { spec, record } = records[1]!;
    const again = runMatch(spec);
    const strip = (r: typeof record) => ({
      ...r,
      cars: r.cars.map((c) => ({ ...c, brainMeanMs: 0, brainWorstMs: 0 })),
    });
    expect(strip(again)).toEqual(strip(record));
  });

  it('keeps the AI cheap: well under a tenth of a tick per car on average', () => {
    const means = records.flatMap((r) => r.record.cars.map((c) => c.brainMeanMs));
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    expect(mean).toBeLessThan(3.3);
  });
});
