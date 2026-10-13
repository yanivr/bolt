import type { RaceResult } from '@bolt/shared';

/**
 * The match record hook (Section 15.8, `matches`). The match room calls `recordMatch` once for
 * every race that is decided (a finish, the time limit, a knockout or a forfeit), after the
 * result has gone to both players and outside the 30 Hz loop's critical path. A cancelled
 * build phase is not a match and is not recorded.
 *
 * Storage belongs to the persistence layer, which installs a recorder with `setMatchRecorder`
 * when it starts. Until then nothing is stored. The room never waits for the recorder and a
 * failing recorder never affects a race: errors are passed to `onError` and dropped.
 *
 * Nothing personal is in a summary: guest ids are the opaque server-side ids of anonymous
 * sessions, nicknames are indices into the preset list, and no invite code is included.
 */

export type MatchSummaryPlayer = {
  /** Opaque anonymous guest id. */
  guestId: string;
  /** Seat in the room: 0 for whoever opened it. */
  seat: number;
  /** Car index on the grid for this race. */
  car: number;
  /** Mechanical hash of the build this player drove (their rival's after a swap). */
  buildHash: string;
  /** Index into `NICKNAMES`. */
  nickname: number;
};

export type MatchSummary = {
  /** Unique per race: `<roomId>:<round>`. */
  matchId: string;
  roomId: string;
  round: number;
  trackId: string;
  weatherPresetId: string;
  /** The race seed: with the builds and the logged inputs, enough to replay it. */
  seed: number;
  catalogVersion: string;
  protocolVersion: number;
  swapped: boolean;
  players: MatchSummaryPlayer[];
  result: RaceResult;
  /** Set for a forfeit: the seat that forfeited and why. */
  disconnect: { seat: number; cause: 'left' | 'disconnected' } | null;
  startedAt: string;
  endedAt: string;
};

export type MatchRecorder = (summary: MatchSummary) => void | Promise<void>;

let recorder: MatchRecorder = () => undefined;

/** Installed by the persistence layer at startup. Passing null restores the no-op. */
export function setMatchRecorder(next: MatchRecorder | null): void {
  recorder = next ?? (() => undefined);
}

export function recordMatch(summary: MatchSummary, onError?: (error: unknown) => void): void {
  try {
    const pending = recorder(summary);
    if (pending && typeof (pending as Promise<void>).catch === 'function')
      (pending as Promise<void>).catch((error: unknown) => onError?.(error));
  } catch (error) {
    onError?.(error);
  }
}
