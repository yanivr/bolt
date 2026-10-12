import { TOW } from '@bolt/shared';
import type { CarSpec, MatchSpec } from './harness.js';
import { runMatch, runSolo } from './harness.js';

/**
 * Balance probes only (docs/BALANCE_CHANGELOG.md, the balance follow-up): `BOLT_TOW_BONUS=0.12`
 * runs the whole tournament with that tow bonus instead of the shipped `TOW.maxBonus`. Never set
 * for the evidence run.
 */
const towBonus = process.env.BOLT_TOW_BONUS;
if (towBonus !== undefined) TOW.maxBonus = Number(towBonus);

/**
 * A tournament worker process (forked by `run.ts` with the same tsx loader): runs one job at a
 * time and sends the record back. Each race is self-contained and seeded, so which worker runs
 * it changes nothing. Child processes rather than worker threads, because tsx maps `.js`
 * imports to TypeScript sources only in a process it starts.
 */

export type Job =
  | { id: number; kind: 'match'; spec: MatchSpec }
  | {
      id: number;
      kind: 'solo';
      trackId: string;
      presetId: string;
      car: CarSpec;
      shortcuts: 'plan' | 'always' | 'never';
    };

process.on('message', (job: Job) => {
  const started = performance.now();
  try {
    const record =
      job.kind === 'match'
        ? runMatch(job.spec)
        : runSolo(job.trackId, job.presetId, job.car, job.shortcuts);
    process.send!({ id: job.id, record, ms: performance.now() - started });
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.send!({ id: job.id, error: message, ms: performance.now() - started });
  }
});
