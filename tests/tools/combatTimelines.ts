import { ACCESSORIES, WEAPON_LIST } from '@bolt/content';
import type { RaceEvent } from '@bolt/shared';
import { SIM_DT } from '@bolt/shared';
import { runScenarioById } from '../scenarios/runner.js';

/**
 * Prints, for every weapon, the events one activation produces and when, measured from the
 * weapon scenario of the same id. The table in docs/COMBAT_API.md is this output.
 *
 *   npx tsx tests/tools/combatTimelines.ts
 */

const SKIP = new Set(['checkpoint', 'lap', 'position', 'wall', 'finish', 'result', 'refused']);

function label(event: RaceEvent): string {
  switch (event.type) {
    case 'status':
      return `status ${event.family} ${event.state}`;
    case 'hazard':
      return `hazard ${event.kind} ${event.state}`;
    case 'tether':
      return `tether ${event.state}`;
    case 'impact':
      return `impact ${event.on}`;
    case 'lock':
      return event.locked ? 'lock' : 'lock lost';
    case 'warning':
      return `warning ${event.kind}`;
    case 'component':
      return `component ${event.condition}`;
    case 'hit':
      return `hit ${event.cls}`;
    default:
      return event.type;
  }
}

console.log(
  '| Weapon | Events of one activation, with ticks after the first (30 ticks a second) |',
);
console.log('| :-- | :-- |');
for (const weapon of WEAPON_LIST) {
  const run = runScenarioById(weapon.id);
  const events = run.events.filter((event) => !SKIP.has(event.type));
  const first = events[0];
  if (!first) continue;
  // One activation: up to the weapon's next first shot, or four seconds, whichever is sooner.
  const starts = events.filter(
    (e) =>
      (e.type === 'shot' && e.n === 0 && e.weapon === weapon.id) ||
      (e.type === 'beam' && e.weapon === weapon.id),
  );
  const next = starts.find((event) => event.tick > starts[0]!.tick);
  const end = Math.min(next?.tick ?? Infinity, first.tick + 150);
  const groups: Array<{ label: string; ticks: number[] }> = [];
  for (const event of events) {
    if (event.tick >= end) break;
    const name = label(event);
    const last = groups[groups.length - 1];
    if (last && last.label === name) last.ticks.push(event.tick - first.tick);
    else groups.push({ label: name, ticks: [event.tick - first.tick] });
  }
  const ms = (ticks: number) => Math.round(ticks * SIM_DT * 1000);
  const text = groups
    .map((group) => {
      const from = group.ticks[0]!;
      const to = group.ticks[group.ticks.length - 1]!;
      const count = group.ticks.length > 1 ? ` x${group.ticks.length}` : '';
      const when =
        from === to
          ? `+${from} (${ms(from)} ms)`
          : `+${from} to +${to} (${ms(from)} to ${ms(to)} ms)`;
      return `\`${group.label}\`${count} ${when}`;
    })
    .join(', ');
  console.log(`| ${ACCESSORIES[weapon.id]!.displayName} \`${weapon.id}\` | ${text} |`);
}
