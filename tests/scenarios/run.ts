import { SCENARIOS, formatEvent, runScenarioById } from './runner.js';

/**
 * Prints the event timeline of a showcase scenario.
 *
 *   npx tsx tests/scenarios/run.ts              lists the scenarios
 *   npx tsx tests/scenarios/run.ts rocket_hit   runs one
 *   npx tsx tests/scenarios/run.ts all          runs every one and reports what is missing
 */

const name = process.argv[2];

if (!name) {
  for (const def of SCENARIOS) console.log(`${def.id.padEnd(20)} ${def.title}`);
  console.log('\nRun one with: npx tsx tests/scenarios/run.ts <id>');
} else if (name === 'all') {
  let failed = 0;
  for (const def of SCENARIOS) {
    const run = runScenarioById(def.id);
    const counts = new Map<string, number>();
    for (const event of run.events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    const summary = [...counts].map(([type, n]) => `${type} ${n}`).join(', ');
    if (run.missing.length > 0) failed++;
    console.log(
      `${run.missing.length === 0 ? 'ok  ' : 'MISS'} ${def.id.padEnd(20)} ${summary}` +
        (run.missing.length > 0 ? `\n     missing: ${JSON.stringify(run.missing)}` : ''),
    );
  }
  process.exitCode = failed > 0 ? 1 : 0;
} else {
  const run = runScenarioById(name);
  const { def } = run;
  console.log(`${def.title} (${def.id})`);
  console.log(def.description);
  console.log(`Shows: ${def.shows}`);
  console.log(`Client: ?debug=1&scenario=${def.id}\n`);
  for (const event of run.events) console.log(formatEvent(event, run.goTick));
  const cars = run.setup.race.cars;
  console.log(
    `\nAfter ${def.durationTicks} ticks: ` +
      cars
        .map(
          (car, i) =>
            `car ${i} chassis ${car.chassis.toFixed(1)}/${car.chassisMax} taken ${car.stats.damageTaken.toFixed(1)}`,
        )
        .join('; '),
  );
  if (run.missing.length > 0) {
    console.log(`MISSING: ${JSON.stringify(run.missing)}`);
    process.exitCode = 1;
  }
}
