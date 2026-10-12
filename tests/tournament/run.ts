import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RIVAL_TEMPLATES } from '@bolt/content';
import type { CarSpec, MatchRecord } from './harness.js';
import type { PlannedMatch } from './plan.js';
import { COURSES, plannedMatches } from './plan.js';
import type { ConstructionRow, Played, ShortcutRow } from './report.js';
import { CONSTRUCTION_FRAMES, CONSTRUCTION_KITS, buildReport, canonical } from './report.js';
import type { Job } from './worker.js';

/**
 * The bot tournament (Section 10.2 and the Milestone D gate): server-only AI races on every
 * course (the room's own race setup and `stepRaceWithBrains`, headless), every strategy pair,
 * every shipped build against every difficulty, the difficulty pairs, the tire duels and the
 * before/after against the sparring brain, with seeds; then solo runs for the shortcut payoff
 * and the construction matrix. Runs on worker processes (one per core by default), with a
 * wall-clock watchdog per race, re-runs a sample of races to check they are identical, writes
 * the report to docs/evidence/tournament and the raw records next to it as JSON, and exits
 * non-zero if any race crashed, hung, left a car stuck, went non-finite or did not repeat. A
 * race that runs to the 180 s limit is decided on progress, as the rules say, and is flagged.
 *
 *   npx tsx tests/tournament/run.ts [--quick] [--out <file.md>] [--json <file.json>]
 *                                   [--seed <n>] [--workers <n>] [--phase <phase>]
 */

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const baseSeed = arg('--seed') !== undefined ? Number(arg('--seed')) : 7001;
const outFile = arg('--out') ?? `docs/evidence/tournament/tournament${quick ? '-quick' : ''}.md`;
const jsonFile = arg('--json') ?? outFile.replace(/\.md$/, '.json');
const workers = Math.max(1, Number(arg('--workers') ?? availableParallelism()));
const onlyPhase = arg('--phase');
/** A race that takes longer than this on the wall clock is a hang. */
const WATCHDOG_MS = 120_000;
/** One race in this many is run a second time and must be identical. */
const REPEAT_EVERY = quick ? 10 : 25;

type Result = { record: unknown; ms: number } | { error: string; ms: number };

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));

/** Runs jobs on a pool of worker processes, in any order, with a watchdog on each. */
async function runPool(jobs: Job[], label: string): Promise<Result[]> {
  const results: Result[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  let lastLog = 0;
  const lane = (): Promise<void> =>
    new Promise((resolve) => {
      let child: ChildProcess;
      let current = -1;
      let timer: NodeJS.Timeout | null = null;
      const finish = (r: Result) => {
        if (timer) clearTimeout(timer);
        timer = null;
        results[current] = r;
        done++;
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now();
          console.error(
            `${label}: ${done} / ${jobs.length}, ${((Date.now() - started) / 1000).toFixed(0)} s`,
          );
        }
      };
      const start = () => {
        const c = fork(WORKER, [], {
          execArgv: process.execArgv,
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        c.on('message', (msg: { id: number; record?: unknown; error?: string; ms: number }) => {
          if (c !== child) return;
          finish(
            msg.error !== undefined
              ? { error: msg.error, ms: msg.ms }
              : { record: msg.record, ms: msg.ms },
          );
          feed();
        });
        c.on('exit', (code) => {
          if (c !== child || current < 0 || results[current] !== undefined) return;
          // Died in the middle of a job: record it, replace the worker and carry on.
          finish({ error: `worker exited with code ${code}`, ms: 0 });
          start();
          feed();
        });
        child = c;
      };
      const feed = () => {
        if (next >= jobs.length) {
          child.disconnect();
          resolve();
          return;
        }
        current = next++;
        const job = jobs[current]!;
        const t0 = Date.now();
        timer = setTimeout(() => {
          // A hang: record it, replace the worker and carry on.
          const stale = child;
          finish({ error: `hung: no result in ${WATCHDOG_MS / 1000} s`, ms: Date.now() - t0 });
          start();
          stale.kill('SIGKILL');
          feed();
        }, WATCHDOG_MS);
        child.send(job);
      };
      start();
      feed();
    });
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, lane));
  return results;
}

const started = Date.now();
const matches: PlannedMatch[] = plannedMatches(quick, baseSeed).filter(
  (m) => !onlyPhase || m.phase === onlyPhase,
);
console.error(`${matches.length} races on ${workers} worker processes`);
const matchResults = await runPool(
  matches.map((spec, id) => ({ id, kind: 'match', spec })),
  'races',
);
const played: Played[] = matches.map((spec, i) => {
  const r = matchResults[i]!;
  if ('error' in r)
    return {
      spec,
      winner: -1,
      reason: 'error',
      error: r.error,
      raceSeconds: 0,
      cars: [blankCar(spec, 0), blankCar(spec, 1)],
      leadChanges: 0,
      lap1Leader: -1,
      closeSeconds: 0,
      problems: [r.error],
      timedOut: false,
      ticks: 0,
      wallMs: r.ms,
    } as unknown as Played;
  return { ...(r.record as MatchRecord), spec, wallMs: r.ms } as Played;
});
for (const m of played)
  if (m.problems.length > 0)
    console.error(
      `problem: ${m.spec.trackId}/${m.spec.presetId} seed ${m.spec.seed} ${m.spec.phase} ${m.spec.pair}: ${m.problems.join('; ')}`,
    );
const raceSeconds = (Date.now() - started) / 1000;

// --- Determinism: a sample of races again, which must be the same races ------------------------
const sampleAt = matches.map((_, i) => i).filter((i) => i % REPEAT_EVERY === 0);
const sample = sampleAt.map((i) => matches[i]!);
const again = await runPool(
  sample.map((spec, id) => ({ id, kind: 'match', spec })),
  'repeats',
);
const desync: string[] = [];
sample.forEach((spec, k) => {
  const first = played[sampleAt[k]!]!;
  const second = again[k]!;
  if ('error' in second)
    desync.push(`${spec.trackId}/${spec.presetId} #${spec.index}: ${second.error}`);
  else if (canonical(first) !== canonical({ ...(second.record as MatchRecord), spec }))
    desync.push(
      `${spec.trackId}/${spec.presetId} #${spec.index} ${spec.phase} ${spec.pair}: differs on a second run`,
    );
});

// --- Solo runs: shortcut payoff and the construction matrix -------------------------------------
const soloJobs: Array<{
  job: Job;
  tag: string;
  course: (typeof COURSES)[number];
  car: string;
  mode: string;
}> = [];
const addSolo = (
  tag: string,
  course: (typeof COURSES)[number],
  car: string,
  spec: CarSpec,
  mode: 'plan' | 'always' | 'never',
) =>
  soloJobs.push({
    job: { id: soloJobs.length, kind: 'solo', ...course, car: spec, shortcuts: mode },
    tag,
    course,
    car,
    mode,
  });
if (!onlyPhase)
  for (const course of COURSES) {
    const cars: Array<[string, CarSpec]> = [
      ['AI balanced build', { strategy: 'balanced', difficulty: 'racer', style: 'tactical' }],
      [
        'Rookie (shipped)',
        { templateId: 'starter_rookie', difficulty: 'racer', style: 'tactical' },
      ],
    ];
    for (const [label, car] of quick ? cars.slice(0, 1) : cars)
      for (const mode of ['never', 'always', 'plan'] as const)
        addSolo('shortcut', course, label, car, mode);
    for (const t of RIVAL_TEMPLATES)
      addSolo(
        'template',
        course,
        t.id,
        { templateId: t.id, difficulty: 'racer', style: 'tactical' },
        'plan',
      );
    for (const frame of CONSTRUCTION_FRAMES)
      for (const kit of CONSTRUCTION_KITS)
        addSolo(
          'construction',
          course,
          `${frame.frame}|${kit}`,
          {
            build: { frame: frame.frame, engineId: frame.engineId, tireKitId: kit },
            difficulty: 'racer',
            style: 'tactical',
          },
          'plan',
        );
  }
const soloResults = await runPool(
  soloJobs.map((s) => s.job),
  'solo runs',
);
type Solo = { seconds: number | null; walls: number; mask: number; gains: number[] };
const soloOf = (i: number): Solo | null => {
  const r = soloResults[i]!;
  return 'error' in r ? null : (r.record as Solo);
};
const shortcuts: ShortcutRow[] = [];
const construction: ConstructionRow[] = [];
const templateSolo: ConstructionRow[] = [];
for (const course of COURSES) {
  const here = soloJobs.map((s, i) => ({ ...s, i })).filter((s) => s.course === course);
  for (const label of [...new Set(here.filter((s) => s.tag === 'shortcut').map((s) => s.car))]) {
    const get = (mode: string) =>
      soloOf(here.find((s) => s.tag === 'shortcut' && s.car === label && s.mode === mode)!.i);
    const plan = get('plan');
    shortcuts.push({
      ...course,
      car: label,
      never: get('never')?.seconds ?? null,
      always: get('always')?.seconds ?? null,
      plan: plan?.seconds ?? null,
      planMask: plan?.mask ?? 0,
      gains: plan?.gains ?? [],
    });
  }
  for (const s of here.filter((x) => x.tag === 'construction' || x.tag === 'template')) {
    const r = soloResults[s.i]!;
    const row: ConstructionRow = {
      ...course,
      car: s.car,
      seconds: 'error' in r ? null : (r.record as Solo).seconds,
      illegal: 'error' in r ? r.error.split('\n')[0]! : null,
    };
    (s.tag === 'construction' ? construction : templateSolo).push(row);
  }
}

const seconds = (Date.now() - started) / 1000;
const command = `npx tsx tests/tournament/run.ts${quick ? ' --quick' : ''}${arg('--seed') !== undefined ? ` --seed ${baseSeed}` : ''}`;
const report = buildReport(played, {
  command,
  seconds,
  raceSeconds,
  workers,
  desync,
  repeats: sample.length,
  quick,
  shortcuts,
  construction,
  templateSolo,
});
mkdirSync(outFile.replace(/\/[^/]*$/, ''), { recursive: true });
writeFileSync(outFile, `${report}\n`);
writeFileSync(
  jsonFile,
  JSON.stringify(
    {
      command,
      seconds,
      raceSeconds,
      workers,
      desync,
      repeats: sample.length,
      quick,
      races: played,
      shortcuts,
      construction,
      templateSolo,
    },
    (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v),
  ),
);
const bad = played.filter((m) => m.problems.length > 0).length;
console.error(
  `${played.length} races (+${sample.length} repeats, ${soloJobs.length} solo runs) in ${seconds.toFixed(0)} s on ${workers} workers, ${bad} with a problem, ${desync.length} not repeatable -> ${outFile}`,
);
process.exit(bad > 0 || desync.length > 0 ? 1 : 0);

function blankCar(spec: PlannedMatch, i: number) {
  return {
    id: '?',
    strategy: spec.cars[i]!.strategy ?? 'template',
    frame: '?',
    tireKitId: '?',
    engineId: '?',
    difficulty: spec.cars[i]!.difficulty,
    style: spec.cars[i]!.style ?? 'tactical',
    sparring: spec.cars[i]!.sparring === true,
    finished: false,
    finishSeconds: null,
    damageDealt: 0,
    damageTaken: 0,
    weaponUses: 0,
    weapons: [],
    wrecked: false,
    ko: false,
    hotSeconds: 0,
    protectionSeconds: 0,
    lapTimes: [],
    lapShortcuts: [],
    longestStill: 0,
    longestNoProgress: 0,
    recoveries: 0,
    wallHits: 0,
    brainMeanMs: 0,
    brainWorstMs: 0,
    lineError: Number.NaN,
    towSeconds: 0,
    towMean: 0,
    inRangeSeconds: 0,
    dnf: 'crash',
    meanSpeed: 0,
  };
}
