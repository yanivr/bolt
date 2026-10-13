import type { Room } from 'colyseus.js';
import type { InputSample } from '@bolt/shared';
import { ClientMessage, MAX_INPUTS_PER_PACKET, SIM_DT } from '@bolt/shared';
import type { DriveState } from '../../apps/server/src/rooms/schema.js';
import { sleep } from './server.js';

/**
 * Feeds pre-recorded samples to a room that runs on its own 30 Hz clock (Milestone E): on the
 * wall clock, `ahead` samples before the room needs them, the way a real client keeps time. The
 * room consumes one number per tick whatever happens, so a comparison with an offline mirror
 * holds exactly when no tick ran on a stand-in: `strict` returns false the moment the room
 * reports a missing sample or a change of its input delay, and the caller plays it again.
 *
 * Rooms used this way are started with a shrink slack above `ahead` (`LOCKSTEP_INPUT_POLICY`),
 * so a feeder that is deliberately early is not mistaken for a network that got faster. That
 * is the only difference from the shipped policy.
 */
export const LOCKSTEP_AHEAD = 8;
export const LOCKSTEP_INPUT_POLICY = { shrinkSlack: 64 };

export async function feedLockstep(
  room: Room<DriveState>,
  samples: readonly InputSample[],
  options: { ahead?: number; strict?: boolean; race?: number } = {},
): Promise<boolean> {
  const ahead = options.ahead ?? LOCKSTEP_AHEAD;
  const strict = options.strict ?? true;
  const last = samples[samples.length - 1]!.sequence;
  // A few neutral samples after the last one, so the ticks right after it (which the room
  // runs before this returns) are not misses. Nothing compared is decided by them.
  const padded = [...samples];
  for (let i = 1; i <= ahead; i++)
    padded.push({ sequence: last + i, clientTick: last + i, steer: 0, brake: 0.5, coast: false });
  const net = room.state.net;
  const start = {
    missing: net.missing,
    grown: net.grown,
    shrunk: net.shrunk,
    reanchors: net.reanchors,
  };
  const broke = () =>
    room.state.net.missing !== start.missing ||
    room.state.net.grown !== start.grown ||
    room.state.net.shrunk !== start.shrunk ||
    room.state.net.reanchors !== start.reanchors;
  let sent = 0;
  const startedAt = Date.now();
  const deadline = startedAt + samples.length * 34 + 8000;
  for (;;) {
    if (strict && broke()) return false;
    if (room.state.ackSequence >= last) return !strict || !broke();
    const due = Math.floor((Date.now() - startedAt) / (SIM_DT * 1000)) + ahead;
    while (sent < Math.min(padded.length, due)) {
      const batch = padded.slice(sent, Math.min(padded.length, due, sent + MAX_INPUTS_PER_PACKET));
      room.send(
        ClientMessage.PLAYER_INPUT,
        options.race ? { race: options.race, inputs: batch } : { inputs: batch },
      );
      sent += batch.length;
    }
    if (Date.now() > deadline) throw new Error('the room stopped consuming input');
    await sleep(4);
  }
}
