import { TRACKS } from '@bolt/content';
import { courseList } from '../../apps/web/src/game/weather/plan.js';
import { weatherRig } from '../helpers/weather.js';

/**
 * What the weather stage costs a frame in Node (no drawing), per course, and in the stress
 * case (heaviest rain, both cars spraying flat out), at both tiers.
 *
 *   npx tsx tests/tools/weatherBench.ts [frames]
 */
const frames = Number(process.argv[2] ?? 1800);
function bench(
  track: string,
  preset: string,
  opts: { low?: boolean; stress?: boolean } = {},
): string {
  const rig = weatherRig(track, preset, opts);
  for (let f = 0; f < 240; f++) rig.step();
  const times: number[] = [];
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    const t = performance.now();
    rig.step();
    times.push(performance.now() - t);
    peak = Math.max(peak, rig.weather.list.total());
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return `mean ${mean.toFixed(3)} ms, p95 ${times[Math.floor(times.length * 0.95)]!.toFixed(3)} ms, peak sprites ${peak}`;
}
for (const [def, preset] of courseList(Object.values(TRACKS)))
  console.log(`${def.id}/${preset}: ${bench(def.id, preset)}`);
for (const low of [false, true])
  console.log(
    `stress forest_02/forest_heavy_rain ${low ? 'low' : 'high'}: ${bench('forest_02', 'forest_heavy_rain', { stress: true, low })}`,
  );
