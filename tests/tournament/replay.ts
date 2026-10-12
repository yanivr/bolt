import { runMatch } from './harness.js';
import { plannedMatches } from './plan.js';

/**
 * Review tool: replays planned matches by seed and prints their problems, race time and
 * recoveries, for checking a fix against the races a tournament flagged.
 *
 *   npx tsx tests/tournament/replay.ts [quick|full] <seed> [seed ...]
 */
const [mode = 'full', ...seeds] = process.argv.slice(2);
const all = plannedMatches(mode === 'quick', 7001);
for (const seed of seeds.map(Number))
  for (const spec of all.filter((m) => m.seed === seed)) {
    const r = runMatch(spec);
    console.log(
      `${seed} ${spec.trackId}/${spec.presetId} ${spec.phase} ${spec.pair}${spec.cars[0].sparring ? ' (sparring)' : ''}: ${r.reason} ${r.raceSeconds.toFixed(1)} s, recoveries ${r.cars.map((c) => c.recoveries).join('/')}, walls ${r.cars.map((c) => c.wallHits).join('/')}${r.problems.length ? `; PROBLEM ${r.problems.join('; ')}` : ''}`,
    );
  }
