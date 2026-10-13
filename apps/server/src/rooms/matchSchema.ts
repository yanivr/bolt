import type { SchemaType } from '@colyseus/schema';
import { schema } from '@colyseus/schema';
import { DriveState } from './schema.js';

/**
 * Synchronized state of a match room (Race a Friend). The root and the seats are shared: both
 * players see the phase, its deadline, the code, the course and what each seat may know about
 * the other (present, connected, ready, the preset nickname and emblem, the latency quality).
 *
 * `views` holds one `DriveState` per seat and is filtered: each connection's `StateView`
 * contains only its own seat's entry, so a player never receives the other player's heat,
 * energy, ammunition, cooldowns, input acknowledgements or unrevealed traps (Section 19.6). The
 * other car reaches each player only as the `rival` inside their own view, written with the
 * same public rules as the AI rival's.
 */

export const SeatState = schema(
  {
    present: { type: 'boolean', default: false },
    connected: { type: 'boolean', default: false },
    host: { type: 'boolean', default: false },
    nickname: { type: 'uint8', default: 0 },
    emblem: { type: 'uint8', default: 0 },
    ready: { type: 'boolean', default: false },
    loaded: { type: 'boolean', default: false },
    vote: { type: 'string', default: '' },
    car: { type: 'int8', default: -1 },
    latencyMs: { type: 'uint16', default: 0 },
    graceEndsAt: { type: 'float64', default: 0 },
  },
  'SeatState',
);
export type SeatState = SchemaType<typeof SeatState>;

export const MatchState = schema(
  {
    phase: { type: 'string', default: 'CREATED' },
    /** Epoch ms (server clock) when the phase ends by itself, or 0. */
    phaseEndsAt: { type: 'float64', default: 0 },
    code: { type: 'string', default: '' },
    trackId: { type: 'string', default: '' },
    weatherPresetId: { type: 'string', default: '' },
    randomTrack: { type: 'boolean', default: false },
    /** The race the views describe (`DriveState.raceId`), 0 before the first. */
    raceId: { type: 'uint16', default: 0 },
    round: { type: 'uint16', default: 0 },
    swapped: { type: 'boolean', default: false },
    /** Why the room came back to the lobby, for the notice line (`MATCH_NOTICES`). */
    notice: { type: 'string', default: '' },
    seats: { map: SeatState },
    views: { map: DriveState, view: true },
  },
  'MatchState',
);
export type MatchState = SchemaType<typeof MatchState>;

/** Per-connection filters, for the tests that measure what each player is sent. */
export { StateView } from '@colyseus/schema';
