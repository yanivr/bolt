import { mkdirSync, writeFileSync } from 'node:fs';
import type { CarSpec } from './harness.js';
import { runMatch, runSolo } from './harness.js';
import { COURSES, plannedMatches } from './plan.js';
import type { Played, ShortcutRow } from './report.js';
import { buildReport } from './report.js';

/**
 * The bot tournament (Section 10.2 and the Milestone D gate): server-only AI races on every
 * course, every strategy pair, the difficulty pairs and the before/after against the sparring
 * brain, with seeds. Writes the report to docs/evidence/tournament and the raw records next to
 * it, and exits non-zero if any race crashed, timed out or left a car stuck.
 *
 *   npx tsx tests/tournament/run.ts [--quick] [--out <file.md>] [--seed <n>]
 */

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const outIndex = args.indexOf('--out');
const seedIndex = args.indexOf('--seed');
const baseSeed = seedIndex >= 0 ? Number(args[seedIndex + 1]) : 7001;
const outFile =
  outIndex >= 0
    ? args[outIndex + 1]!
    : `docs/evidence/tournament/tournament${quick ? '-quick' : ''}.md`;

const phaseIndex = args.indexOf('--phase');
const onlyPhase = phaseIndex >= 0 ? args[phaseIndex + 1] : undefined;
const matches = plannedMatches(quick, baseSeed).filter((m) => !onlyPhase || m.phase === onlyPhase);
const started = Date.now();
const played: Played[] = [];
let lastLog = 0;
for (const [i, spec] of matches.entries()) {
  const record = runMatch(spec);
  played.push({ ...record, spec });
  if (record.problems.length > 0)
    console.error(
      `problem: ${spec.trackId}/${spec.presetId} seed ${spec.seed} ${spec.phase} ${spec.pair}: ${record.problems.join('; ')}`,
    );
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    console.error(
      `${i + 1} / ${matches.length} races, ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  }
}
// Shortcut payoff: one car alone with its shortcuts forced on, off and left to plan.
const shortcuts: ShortcutRow[] = [];
if (!onlyPhase || onlyPhase === 'shortcuts')
  for (const course of COURSES) {
    const cars: Array<[string, CarSpec]> = [
      ['AI balanced build', { strategy: 'balanced', difficulty: 'racer', style: 'tactical' }],
      [
        'Rookie (shipped)',
        { templateId: 'starter_rookie', difficulty: 'racer', style: 'tactical' },
      ],
    ];
    for (const [label, car] of quick ? cars.slice(0, 1) : cars) {
      const never = runSolo(course.trackId, course.presetId, car, 'never');
      const always = runSolo(course.trackId, course.presetId, car, 'always');
      const plan = runSolo(course.trackId, course.presetId, car, 'plan');
      shortcuts.push({
        ...course,
        car: label,
        never: never.seconds,
        always: always.seconds,
        plan: plan.seconds,
        planMask: plan.mask,
        gains: plan.gains,
      });
    }
  }
const seconds = (Date.now() - started) / 1000;
const command = `npx tsx tests/tournament/run.ts${quick ? ' --quick' : ''}${seedIndex >= 0 ? ` --seed ${baseSeed}` : ''}`;
const desync = (process.env.TOURNAMENT_DESYNC ?? '').split('|').filter(Boolean);
const report = buildReport(played, { command, seconds, desync, quick, shortcuts });
mkdirSync(outFile.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(outFile, `${report}\n`);
writeFileSync(outFile.replace(/\.md$/, '.json'), JSON.stringify(played));
const bad = played.filter((m) => m.problems.length > 0).length;
console.error(
  `${played.length} races in ${seconds.toFixed(0)} s, ${bad} with a problem -> ${outFile}`,
);
process.exit(bad > 0 ? 1 : 0);
