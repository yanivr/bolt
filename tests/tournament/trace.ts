import { CATALOG, conditionsFor, environmentFor } from '@bolt/content';
import type { BuildConditions, RaceEnvironment } from '@bolt/shared';
import { AiBrain, SIM_DT, createRace, stepRaceWithBrains } from '@bolt/shared';
import type { CarSpec } from './harness.js';
import { entryFor, trackOf } from './harness.js';

/**
 * Review tool: one car alone on a course, driven by the AI, with a line every `every` seconds
 * (place, speed, surface, the brain's state) and every wall strike, recovery and long stop.
 *
 *   npx tsx tests/tournament/trace.ts <track> <preset> <templateId|strategy> [difficulty] [every]
 */
const [trackId, presetId, who, difficulty = 'racer', everyArg = '5'] = process.argv.slice(2);
const every = Number(everyArg);
const car: CarSpec = who!.includes('_')
  ? { templateId: who!, difficulty: difficulty as CarSpec['difficulty'], style: 'tactical' }
  : {
      strategy: who as CarSpec['strategy'],
      difficulty: difficulty as CarSpec['difficulty'],
      style: 'tactical',
    };
const env = environmentFor(presetId!) as RaceEnvironment;
const conditions = conditionsFor(trackId!, presetId!) as BuildConditions;
const entry = entryFor(car, trackId!, presetId!, 3, conditions);
const race = createRace(trackOf(trackId!), env, [entry], {
  seed: 3,
  conditions,
  catalog: CATALOG,
  tow: false,
});
const brain = new AiBrain({ seed: 3, difficulty: car.difficulty, style: car.style });
let still = 0;
let lastRecoveries = 0;
for (let i = 0; i < 30 * 200 && race.phase !== 'FINISHED'; i++) {
  stepRaceWithBrains(race, [], [brain]);
  const c = race.cars[0]!;
  const m = c.session.motion;
  const speed = Math.hypot(m.velocityX, m.velocityY);
  const t = race.raceTicks * SIM_DT;
  const pilot = brain.parts?.pilot;
  for (const e of race.events)
    if (e.type === 'wall')
      console.log(
        `${t.toFixed(1)} s wall at ${e.speed.toFixed(0)} px/s (${m.x.toFixed(0)}, ${m.y.toFixed(0)})`,
      );
  if (pilot && pilot.recoveries !== lastRecoveries) {
    lastRecoveries = pilot.recoveries;
    console.log(
      `${t.toFixed(1)} s recovery #${lastRecoveries} at (${m.x.toFixed(0)}, ${m.y.toFixed(0)})`,
    );
  }
  if (race.raceTicks > 0 && speed < 8 && !brain.holding) still += SIM_DT;
  else {
    if (still > 2) console.log(`${t.toFixed(1)} s was still for ${still.toFixed(1)} s`);
    still = 0;
  }
  if (race.raceTicks > 0 && race.raceTicks % Math.round(every / SIM_DT) === 0)
    console.log(
      `${t.toFixed(0)} s lap ${c.session.progress.lap} cp ${c.session.progress.checkpointIndex} (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) ${speed.toFixed(0)} px/s ${c.session.telemetry.surface} heat ${m.coreHeat.toFixed(0)} allowed ${pilot?.allowed.toFixed(0)} s=${pilot?.s.toFixed(0)} lat ${pilot?.lateral.toFixed(1)} mask ${pilot?.mask} lost ${pilot?.lost}`,
    );
}
console.log('result', JSON.stringify(race.result?.cars[0]));
