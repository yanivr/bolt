import { SIM_DT, AiBrain, stepRaceWithBrains } from '@bolt/shared';
import { createMatch } from './harness.js';
import { plannedMatches } from './plan.js';

/**
 * Review tool: replays one planned tournament match with a line per car every `every` seconds
 * and every wall strike and recovery.
 *
 *   npx tsx tests/tournament/traceMatch.ts <track/preset|seed=n> <phase|any|ai> [nth] [every] [quick|full] [baseSeed]
 */
const [course, phase, nth = '0', everyArg = '2', mode = 'quick', base = '9001'] =
  process.argv.slice(2);
// `seed=<n>` as the course picks a match by seed (the first, or the AI one with phase `ai`).
const all = plannedMatches(mode === 'quick', Number(base));
const bySeed = course!.startsWith('seed=') ? Number(course!.slice(5)) : null;
const list = all.filter((m) =>
  bySeed !== null
    ? m.seed === bySeed && (phase !== 'ai' || !m.cars[0].sparring)
    : `${m.trackId}/${m.presetId}` === course && m.phase === phase,
);
const spec = list[Number(nth)]!;
console.log(JSON.stringify(spec));
const { race, brains } = createMatch(spec);
const every = Math.round(Number(everyArg) / SIM_DT);
const recoveries = [0, 0];
while (race.phase !== 'FINISHED' && race.tick < 30 * 200) {
  stepRaceWithBrains(race, [], brains);
  const t = (race.raceTicks * SIM_DT).toFixed(1);
  for (const e of race.events)
    if (e.type === 'wall') {
      const m = race.cars[e.car]!.session.motion;
      console.log(
        `${t} car ${e.car} wall ${e.speed.toFixed(0)} at (${m.x.toFixed(0)}, ${m.y.toFixed(0)})`,
      );
    }
  race.cars.forEach((c, i) => {
    const b = brains[i];
    const p = b instanceof AiBrain ? b.parts?.pilot : undefined;
    if (p && p.recoveries !== recoveries[i]) {
      recoveries[i] = p.recoveries;
      const m = c.session.motion;
      console.log(
        `${t} car ${i} recovery #${p.recoveries} at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) s=${p.s.toFixed(0)} mask ${p.mask}`,
      );
    }
    if (race.raceTicks > 0 && race.raceTicks % every === 0) {
      const m = c.session.motion;
      console.log(
        `${t} car ${i} lap ${c.session.progress.lap} cp ${c.session.progress.checkpointIndex} prog ${c.session.progress.courseProgress.toFixed(0)} (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) v ${Math.hypot(m.velocityX, m.velocityY).toFixed(0)} ${c.session.telemetry.surface} s=${p?.s.toFixed(0)} lat ${p?.lateral.toFixed(0)} mask ${p?.mask} hold ${p?.holding} ko ${c.ko} chassis ${c.chassis.toFixed(0)} lane ${p ? (p.lineOffset(p.s) + p.bias).toFixed(0) : ''} allowed ${p?.allowed.toFixed(0)} bias ${p?.bias.toFixed(0)} steer ${race.controls[i]!.steer.toFixed(2)} brake ${race.controls[i]!.brake.toFixed(2)} grip ${c.session.telemetry.grip.toFixed(2)} fx ${c.session.effects.grip.toFixed(2)}`,
      );
    }
  });
}
console.log('result', JSON.stringify(race.result));
