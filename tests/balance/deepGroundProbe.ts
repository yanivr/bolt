import { RIVAL_TEMPLATES, conditionsFor, environmentFor, raceEntry } from '@bolt/content';
import type { BuildConditions, RaceEnvironment, SurfaceId } from '@bolt/shared';
import {
  DEEP_GROUND_FLOOR,
  createMotionState,
  createPowertrainOutput,
  createTelemetry,
  stepStraight,
} from '@bolt/shared';
import { runSolo } from '../tournament/harness.js';

/**
 * Probe for the deep-ground floor (docs/BALANCE_CHANGELOG.md 0.7.1): set the sand and mud bands
 * and see the slowest shipped builds' straight-line speed and solo times on the loose courses.
 *
 *   npx tsx tests/balance/deepGroundProbe.ts <sandFull> <sandFade> <mudFull> <mudFade> [off]
 */
const [sf, sd, mf, md] = process.argv.slice(2, 6).map(Number);
if (process.argv.includes('off')) {
  delete DEEP_GROUND_FLOOR.sand;
  delete DEEP_GROUND_FLOOR.mud;
} else {
  if (sf !== undefined && sd !== undefined) DEEP_GROUND_FLOOR.sand = { fullBelow: sf, fadeTo: sd };
  if (mf !== undefined && md !== undefined) DEEP_GROUND_FLOOR.mud = { fullBelow: mf, fadeTo: md };
}
console.log('bands', JSON.stringify(DEEP_GROUND_FLOOR));
const ids = [
  'example_iron_mule',
  'starter_rookie',
  'example_rain_runner',
  'example_back_alley_trap',
];
const courses: Array<[string, string, SurfaceId]> = [
  ['desert_01', 'desert_clear', 'sand'],
  ['desert_02', 'desert_dry_heat', 'sand'],
  ['forest_01', 'forest_rain', 'mud'],
  ['forest_02', 'forest_heavy_rain', 'mud'],
];
for (const id of ids) {
  const t = RIVAL_TEMPLATES.find((x) => x.id === id)!;
  const cells: string[] = [];
  for (const [trackId, presetId, surface] of courses) {
    const conditions = conditionsFor(trackId, presetId) as BuildConditions;
    const env = environmentFor(presetId) as RaceEnvironment;
    const params = raceEntry(t.blueprint, conditions)!.params;
    const state = createMotionState(0, 0, 0, params);
    const power = createPowertrainOutput();
    const tel = createTelemetry();
    let v = 0;
    for (let i = 0; i < 60 * 30; i++)
      v = stepStraight(state, v, params, env, surface, 1 / 30, power, tel);
    const times = (['rookie', 'racer'] as const).map((difficulty) => {
      const s = runSolo(
        trackId,
        presetId,
        { templateId: id, difficulty, style: 'tactical' },
        'plan',
      );
      return s.seconds === null ? 'DNF' : s.seconds.toFixed(1);
    });
    cells.push(
      `${trackId}/${presetId}: ${surface} ${v.toFixed(0)} px/s, rookie ${times[0]} racer ${times[1]}`,
    );
  }
  console.log(`${t.name}\n  ${cells.join('\n  ')}`);
}
