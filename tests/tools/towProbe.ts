import { RIVAL_TEMPLATES } from '@bolt/content';
import { SIM_DT, towShareOf, stepRaceWithBrains, towGapSeconds } from '@bolt/shared';
import { createBotMatch } from '../balance/harness.js';
import { unarmed } from '../balance/tow.js';

// Scratch probe: how two cars separate, and what the tow is doing around each change of lead.
// Not part of any gate.   npx tsx tests/tools/towProbe.ts <a> <b> [on|off] [armed|unarmed] [every]
const [a = 'starter_rookie', b = 'starter_sprinter', mode = 'on', arms = 'unarmed', every = '150'] =
  process.argv.slice(2);
const ta = RIVAL_TEMPLATES.find((t) => t.id === a)!;
const tb = RIVAL_TEMPLATES.find((t) => t.id === b)!;
const { race, brains } =
  arms === 'armed'
    ? createBotMatch(ta, tb, 1001, undefined, mode !== 'off')
    : createBotMatch(unarmed(ta), unarmed(tb), 1001, undefined, mode !== 'off');
const line = () =>
  (race.raceTicks * SIM_DT).toFixed(1).padStart(6) +
  ' ' +
  race.cars
    .map(
      (c) =>
        `p=${c.session.progress.courseProgress.toFixed(0).padStart(6)} v=${c.session.telemetry.speed.toFixed(0).padStart(4)} avg=${c.tow.averageSpeed.toFixed(0).padStart(4)} gap=${towGapSeconds(race, c).toFixed(2)} cu=${towShareOf(c).toFixed(2)}`,
    )
    .join(' | ');
while (race.phase !== 'FINISHED') {
  stepRaceWithBrains(race, [], brains);
  for (const e of race.events)
    if (e.type === 'position' || e.type === 'catchup') console.log(line(), JSON.stringify(e));
  if (race.raceTicks % Number(every) === 0 && race.phase === 'RACING') console.log(line());
}
console.log(
  race.result?.winner,
  race.result?.cars.map((c) => c.finishTimeMs),
);
