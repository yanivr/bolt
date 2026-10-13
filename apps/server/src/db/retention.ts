import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';
import type { Persistence, RetentionReport } from './types.js';

/**
 * The Section 15.8 retention policy, applied at startup and then on an interval:
 *
 * - match events (the sampled notable events) expire 30 days after they were stored;
 * - match summaries expire after 90 days (they hold per-match pseudonyms, never guest ids);
 * - blueprints a guest deleted are kept 30 days for disputes and then removed for good;
 * - guest sessions are removed once expired (also swept every minute by the session layer).
 *
 * Raw input streams are never stored, so there is nothing to expire for them. Live shared
 * blueprints have no expiry: a code is meant to keep working.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionPolicy = {
  matchEventDays: number;
  matchDays: number;
  deletedBlueprintDays: number;
};

export const RETENTION: RetentionPolicy = {
  matchEventDays: 30,
  matchDays: 90,
  deletedBlueprintDays: 30,
};

export async function runRetention(
  persistence: Persistence,
  at: Date,
  policy: RetentionPolicy = RETENTION,
): Promise<RetentionReport> {
  const before = (days: number) => new Date(at.getTime() - days * DAY_MS);
  const matchEvents = await persistence.matches.purgeEvents(before(policy.matchEventDays));
  const matches = await persistence.matches.purgeMatches(before(policy.matchDays));
  const deletedBlueprints = await persistence.blueprints.purgeDeleted(
    before(policy.deletedBlueprintDays),
  );
  const guestSessions = await persistence.guests.expire(at);
  return { matchEvents, matches, deletedBlueprints, guestSessions };
}

export type RetentionJob = { stop(): void; runNow(): Promise<RetentionReport | null> };

/** Runs the policy now and every `intervalMs` (hourly by default). The timer never holds the process open. */
export function startRetentionJob(
  persistence: Persistence,
  logger: Logger,
  intervalMs = 60 * 60 * 1000,
  now: () => Date = () => new Date(),
): RetentionJob {
  let running: Promise<RetentionReport | null> | null = null;
  const runNow = (): Promise<RetentionReport | null> => {
    running ??= runRetention(persistence, now())
      .then((report) => {
        logger.info('retention_run', report);
        return report;
      })
      .catch((error: unknown) => {
        logger.error('retention_failed', errorFields(error));
        return null;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  void runNow();
  const timer = setInterval(() => void runNow(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), runNow };
}
