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
 * sane time. The second block holds a finding, not a target: which shipped builds cannot get
 * going on sand (docs/BALANCE_CHANGELOG.md 0.7.0). When the owner retunes sand, it changes.
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

describe('finding: heavy builds on street or armored tires stall on sand', () => {
  it('lists the shipped builds that cannot reach 60 px/s on Dust Devil sand in ten seconds', () => {
    const stalled = RIVAL_TEMPLATES.filter(
      (t) => speedAfter(t.id, 'desert_01', 'desert_clear', 'sand', 10) < 60,
    ).map((t) => t.id);
    // Rolling resistance on sand is a fixed 42 px/s^2 for every car; these three have less
    // drive than that to spare at low speed. On asphalt each of them passes 120 px/s in 5 s.
    expect(stalled).toEqual(['starter_packhorse', 'starter_longlegs', 'example_iron_mule']);
    for (const id of stalled)
      expect(speedAfter(id, 'desert_01', 'desert_clear', 'asphalt', 5)).toBeGreaterThan(120);
  });
});
