import { createHmac } from 'node:crypto';
import type { RaceEvent } from '@bolt/shared';
import type { MatchSummary } from '../rooms/matchLog.js';
import type { Logger } from '../telemetry/log.js';
import { errorFields } from '../telemetry/log.js';
import type { MatchEventRow, MatchRepository, MatchRow } from './types.js';

/**
 * The storage behind `recordMatch` (Section 15.8): one `matches` row per finished match and a
 * compact sample of its notable events. No personal data: a player is a pseudonym that is only
 * valid inside its match (an HMAC of the match id and the guest id under a server key), so the
 * table cannot link two matches of one player and a database dump alone cannot link a match to
 * a guest session. Raw inputs never arrive here.
 */

/** Most events kept per match. */
export const MAX_SAMPLED_EVENTS = 240;

/**
 * Notable events and how much each kind matters when the sample is full. Shots, impulses,
 * statuses ending, locks and refusals are routine and left out.
 */
const PRIORITY: Partial<Record<RaceEvent['type'], number>> = {
  result: 100,
  ko: 90,
  component: 70,
  utility: 60,
  hit: 50,
  explosion: 40,
  hazard: 30,
  shield: 25,
  tether: 20,
  misfire: 15,
};

/** Hits smaller than this many points are noise in a dispute and are not sampled. */
const MIN_HIT_POINTS = 4;

const MAX_STRING = 48;

function compactData(event: RaceEvent): Record<string, number | string | boolean> {
  const data: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'id' || key === 'tick' || key === 'type' || key === 'car') continue;
    if (typeof value === 'number' && Number.isFinite(value))
      data[key] = Math.round(value * 100) / 100;
    else if (typeof value === 'string') data[key] = value.slice(0, MAX_STRING);
    else if (typeof value === 'boolean') data[key] = value;
  }
  return data;
}

function notable(event: RaceEvent): boolean {
  if (PRIORITY[event.type] === undefined) return false;
  if (event.type === 'hit') {
    const points = event.damage + event.chassis + event.shield + event.armor + event.absorbed;
    return points >= MIN_HIT_POINTS;
  }
  if (event.type === 'status') return false;
  if (event.type === 'hazard') return event.state === 'triggered';
  if (event.type === 'utility') return event.state === 'done';
  if (event.type === 'component') return event.condition !== 'healthy' || event.repaired;
  return true;
}

/**
 * Picks at most `max` notable events: by priority, then by size for hits, then by time; the
 * kept events are returned in time order. Pure, so it is tested on its own.
 */
export function sampleNotableEvents(
  events: readonly RaceEvent[],
  max = MAX_SAMPLED_EVENTS,
): MatchEventRow[] {
  const kept = events.filter(notable);
  const weight = (e: RaceEvent): number =>
    (PRIORITY[e.type] ?? 0) * 1000 + (e.type === 'hit' ? Math.min(999, e.damage + e.chassis) : 0);
  const chosen =
    kept.length <= max
      ? kept
      : [...kept]
          .sort((a, b) => weight(b) - weight(a) || a.tick - b.tick || a.id - b.id)
          .slice(0, max);
  return [...chosen]
    .sort((a, b) => a.tick - b.tick || a.id - b.id)
    .map((event, seq) => ({
      seq,
      tick: event.tick,
      type: event.type,
      car: 'car' in event && typeof event.car === 'number' ? event.car : null,
      data: compactData(event),
    }));
}

/** A player's pseudonym inside one match. */
export function playerRef(
  key: string,
  matchId: string,
  guestId: string | null,
  slot: number,
): string {
  if (guestId === null) return `ai${slot}`;
  return createHmac('sha256', key)
    .update(`match-player\u0000${matchId}\u0000${guestId}`)
    .digest('hex')
    .slice(0, 32);
}

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SHORT = (value: string, n = 48) => String(value).slice(0, n);

/**
 * What the room hands over (`rooms/matchLog.ts`, owned by the room code), plus an optional
 * list of the race's authoritative events, which this sink samples when a room passes it.
 */
export type RecordedMatch = MatchSummary & { events?: readonly RaceEvent[] };

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function matchRowOf(key: string, summary: RecordedMatch): MatchRow {
  if (!ID_PATTERN.test(summary.matchId))
    throw new Error('A match id must be 1 to 64 safe characters.');
  const players = [...summary.players].sort((a, b) => a.seat - b.seat);
  const result = summary.result;
  return {
    id: summary.matchId,
    // Every match the room hook reports is between two people; the AI room records nothing.
    mode: 'friend',
    trackId: SHORT(summary.trackId),
    weatherPresetId: SHORT(summary.weatherPresetId),
    seed: Math.trunc(summary.seed),
    catalogVersion: SHORT(summary.catalogVersion, 24),
    playerRefs: players.map((p) => playerRef(key, summary.matchId, p.guestId, p.seat)),
    playerKinds: players.map(() => 'human'),
    blueprintHashes: players.map((p) => SHORT(p.buildHash, 64)),
    result: {
      // `winner` is a car index (-1 for a draw); `seats[i]` is the car seat i drove.
      winner: result.winner,
      reason: SHORT(result.reason, 24),
      raceTimeMs: finiteOrNull(result.raceTimeMs),
      seats: players.map((p) => p.car),
      cars: result.cars.map((car) => ({
        finished: car.finished,
        finishTimeMs: finiteOrNull(car.finishTimeMs),
        bestLapMs: finiteOrNull(car.bestLapMs),
        ko: car.ko,
        chassis: finiteOrNull(car.chassis),
        damageDealt: finiteOrNull(car.damageDealt),
        damageTaken: finiteOrNull(car.damageTaken),
        shotsFired: finiteOrNull(car.shotsFired),
        hitsLanded: finiteOrNull(car.hitsLanded),
      })),
    },
    startedAt: new Date(summary.startedAt),
    endedAt: new Date(summary.endedAt),
    disconnectReason: summary.disconnect
      ? `seat${summary.disconnect.seat}:${SHORT(summary.disconnect.cause, 24)}`
      : null,
    metrics: {
      round: summary.round,
      protocolVersion: summary.protocolVersion,
      swapped: summary.swapped ? 1 : 0,
      ...(finiteOrNull(result.raceTimeMs) !== null ? { raceTimeMs: result.raceTimeMs } : {}),
    },
  };
}

export type MatchRecorderOptions = {
  repo: MatchRepository;
  /** Server secret for the per-match pseudonyms (the guest token key is used). */
  pseudonymKey: string;
  logger: Logger;
  now?: () => Date;
};

export type MatchStore = {
  /** The function to pass to `setMatchRecorder`. Never rejects. */
  record: (summary: RecordedMatch) => Promise<void>;
  /** Resolves once every record handed over so far is stored or has failed. */
  flush(): Promise<void>;
};

export function createMatchRecorder(options: MatchRecorderOptions): MatchStore {
  const now = options.now ?? (() => new Date());
  const pending = new Set<Promise<void>>();
  const store = async (summary: RecordedMatch): Promise<void> => {
    try {
      const row = matchRowOf(options.pseudonymKey, summary);
      if (Number.isNaN(row.startedAt.getTime()) || Number.isNaN(row.endedAt.getTime()))
        throw new Error('A match needs valid start and end times.');
      const events = sampleNotableEvents(summary.events ?? []);
      const stored = await options.repo.insert(row, events, now());
      options.logger.info('match_recorded', {
        matchId: row.id,
        events: events.length,
        duplicate: !stored,
      });
    } catch (error) {
      options.logger.error('match_record_failed', {
        matchId: SHORT(String(summary.matchId), 64),
        ...errorFields(error),
      });
    }
  };
  return {
    record(summary) {
      const task = store(summary);
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return task;
    },
    async flush() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
