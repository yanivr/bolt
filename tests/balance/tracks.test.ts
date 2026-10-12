import { RIVAL_TEMPLATES, TRACKS, conditionsFor, environmentFor, raceEntry } from '@bolt/content';
import type { BuildConditions, RaceEnvironment, SurfaceId } from '@bolt/shared';
import {
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  stepStraight,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { courseId, runBotMatch } from './harness.js';

/**
 * The balance harness on all eight tracks, as a smoke test (Milestone D phase 0). The full
 * report is `npx tsx tests/balance/tracksReport.ts` (docs/evidence/balance/tracks-0.7.0.md);
 * here four quick builds race each other on both weathers of every track and must finish in a
 * sane time. The second block holds the floors on loose ground: no shipped build is held to a
 * crawl on sand or mud (docs/BALANCE_CHANGELOG.md 0.7.0 and 0.7.1).
 */

const QUICK = [
  'starter_sprinter',
  'example_straight_line_rocket',
  'example_tiny_trouble',
  'starter_tinker',
];
const template = (id: string) => RIVAL_TEMPLATES.find((t) => t.id === id)!;

const courses = Object.values(TRACKS).flatMap((def) =>
  def.weatherPresetIds.map((presetId) => [def.id, presetId] as const),
);

describe('the harness on every course of the eight tracks', () => {
  it.each(courses)('%s / %s: quick builds race to a finish in a sane time', (trackId, presetId) => {
    const pairs: Array<[string, string]> = [
      [QUICK[0]!, QUICK[1]!],
      [QUICK[2]!, QUICK[3]!],
    ];
    for (const [a, b] of pairs) {
      const outcome = runBotMatch(template(a), template(b), 1001, courseId(trackId, presetId));
      expect(outcome.reason).toBe('finish');
      expect(outcome.raceSeconds).toBeGreaterThan(80);
      expect(outcome.raceSeconds).toBeLessThan(170);
    }
  });
});

/** Forward speed after `seconds` flat out from rest on one surface, in a course's weather. */
function speedAfter(
  templateId: string,
  trackId: string,
  presetId: string,
  surface: SurfaceId,
  seconds: number,
): number {
  const conditions = conditionsFor(trackId, presetId) as BuildConditions;
  const env = environmentFor(presetId) as RaceEnvironment;
  const params = raceEntry(template(templateId).blueprint, conditions)!.params;
  const state = createMotionState(0, 0, 0, params);
  const power = createPowertrainOutput();
  const telemetry = createTelemetry();
  let v = 0;
  for (let i = 0; i < Math.round(seconds * 30); i++)
    v = stepStraight(state, v, params, env, surface, 1 / 30, power, telemetry);
  return v;
}

describe('nobody stalls on sand (the crawl floor and the deep-ground floor, docs/BALANCE_CHANGELOG.md)', () => {
  it('gets every shipped build up to a trudge on Dust Devil sand, the weakest slowest', () => {
    // Before the crawl floor Iron Mule did not move at all on sand, and under it alone it
    // settled at 48 px/s; Packhorse and Longlegs carry the Trail Engine (templates.ts).
    const tenSeconds = RIVAL_TEMPLATES.map(
      (t) => [t.id, speedAfter(t.id, 'desert_01', 'desert_clear', 'sand', 10)] as const,
    );
    for (const [id, v] of tenSeconds) expect(v, id).toBeGreaterThan(80);
    const slowest = [...tenSeconds].sort((a, b) => a[1] - b[1])[0]![0];
    expect(slowest).toBe('example_iron_mule');
    // Thirty seconds in, nobody is below a trudging pace, in either desert weather.
    for (const t of RIVAL_TEMPLATES) {
      expect(speedAfter(t.id, 'desert_01', 'desert_clear', 'sand', 30), t.id).toBeGreaterThan(120);
      expect(speedAfter(t.id, 'desert_02', 'desert_dry_heat', 'sand', 40), t.id).toBeGreaterThan(
        120,
      );
    }
  });

  it('gets every shipped build through deep mud at better than a crawl', () => {
    for (const t of RIVAL_TEMPLATES)
      expect(speedAfter(t.id, 'forest_01', 'forest_rain', 'mud', 20), t.id).toBeGreaterThan(75);
  });
});
