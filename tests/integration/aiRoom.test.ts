import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conditionsFor,
  createAiRace,
  environmentFor,
  getTemplate,
  getTrack,
  raceEntry,
} from '@bolt/content';
import type {
  AiDifficulty,
  BuildConditions,
  ControlInput,
  DriveJoinOptions,
  GuestSessionResponse,
  InputSample,
  RaceEnvironment,
  RaceEvent,
  VehicleBlueprint,
} from '@bolt/shared';
import {
  AiBrain,
  ClientMessage,
  MAX_INPUTS_PER_PACKET,
  PROTOCOL_VERSION,
  ROOM_DRIVE,
  ServerMessage,
  buildTrack,
  eventVisibleTo,
  stepRaceWithBrains,
} from '@bolt/shared';
import type { DriveState } from '../../apps/server/src/rooms/schema.js';
import type { TestServer } from '../helpers/server.js';
import { sleep, startTestServer, waitFor } from '../helpers/server.js';

/**
 * The AI rival through a real room (Milestone D): the room builds its rival with
 * `createAiRace` and steps it with `stepRaceWithBrains`; the offline link does the same in
 * the page. Here a mirror of the race is run in this process with an AI autopilot in the
 * player's seat, recording the samples it sends; the same samples are fed to a real room over
 * the wire, and every event the room sends must equal the mirror's, id for id. That is the
 * claim that the server's AI and the offline AI are one race, and that the AI's build and
 * difficulty reach the room from the join.
 */

const AHEAD = 6;
let ctx: TestServer;
let client: Client;
let guest: GuestSessionResponse;

beforeAll(async () => {
  ctx = await startTestServer({ drive: { reconnectSeconds: 10 } });
  client = new Client(ctx.wsUrl);
  guest = (await (
    await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' })
  ).json()) as GuestSessionResponse;
});

afterAll(async () => {
  await ctx.stop();
});

type DriveRoomClient = Room<DriveState>;

type Course = { trackId: string; presetId: string };

function mirror(
  course: Course,
  blueprint: VehicleBlueprint,
  seed: number,
  difficulty: AiDifficulty,
  ticks: number,
) {
  const track = buildTrack(getTrack(course.trackId)!);
  const env = environmentFor(course.presetId) as RaceEnvironment;
  const conditions = conditionsFor(course.trackId, course.presetId) as BuildConditions;
  const player = raceEntry(blueprint, conditions)!;
  const ai = createAiRace(track, course.presetId, env, conditions, player, seed, { difficulty })!;
  // The player's seat is driven by an AI autopilot; its samples are what a client would send.
  const autopilot = new AiBrain({ seed: seed + 99, difficulty: 'racer', style: 'tactical' });
  const samples: InputSample[] = [];
  const events: RaceEvent[] = [];
  const human: Array<ControlInput | undefined> = [];
  for (let i = 0; i < ticks; i++) {
    const own: ControlInput = { ...autopilot.control(ai.race, 0) };
    samples.push({
      sequence: i,
      clientTick: i,
      steer: own.steer,
      brake: own.brake,
      coast: own.coast,
      fire: own.fire ?? 0,
      use: own.use ?? 0,
      target: own.target ?? 0,
    });
    human[0] = own;
    stepRaceWithBrains(ai.race, human, ai.brains);
    for (const event of ai.race.events) if (eventVisibleTo(event, 0)) events.push({ ...event });
  }
  return { samples, events, rival: ai.rival.blueprint, ai };
}

async function join(options: Partial<DriveJoinOptions>): Promise<DriveRoomClient> {
  const room = await client.joinOrCreate<DriveState>(ROOM_DRIVE, {
    protocolVersion: PROTOCOL_VERSION,
    guestToken: guest.token,
    ...options,
  });
  await waitFor(() => typeof room.state?.tick === 'number', 3000, 'the first state snapshot');
  return room;
}

/** Sends samples at the pace the room consumes them; false if the lockstep broke. */
async function feed(room: DriveRoomClient, samples: readonly InputSample[]): Promise<boolean> {
  const first = samples[0]!.sequence;
  const last = samples[samples.length - 1]!.sequence;
  const tickAtFirst = room.state.tick - (room.state.ackSequence - first + 1);
  let sent = 0;
  const deadline = Date.now() + samples.length * 34 + 8000;
  for (;;) {
    const ack = room.state.ackSequence;
    if (ack >= first && room.state.tick - tickAtFirst > ack - first + 1) return false;
    if (ack >= last) return true;
    const limit = Math.min(samples.length, ack - first + 1 + AHEAD);
    if (sent < limit) {
      const batch = samples.slice(sent, Math.min(limit, sent + MAX_INPUTS_PER_PACKET));
      room.send(ClientMessage.PLAYER_INPUT, { inputs: batch });
      sent += batch.length;
    }
    if (Date.now() > deadline) throw new Error('the room stopped consuming input');
    await sleep(8);
  }
}

describe('the AI rival through a real room', () => {
  it('is the same race as the offline mirror, event for event, with the build and difficulty from the join', async () => {
    const course = { trackId: 'desert_01', presetId: 'desert_clear' };
    const blueprint = getTemplate('starter_sprinter')!.blueprint;
    const seed = 4242;
    // About 25 seconds of racing after the countdown: long enough for passes and fire.
    const expected = mirror(course, blueprint, seed, 'ace', 30 * 28);
    let received: RaceEvent[] = [];
    let rivalJson = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      received = [];
      const room = await join({
        trackId: course.trackId,
        weatherPresetId: course.presetId,
        blueprint,
        seed,
        difficulty: 'ace',
      });
      room.onMessage(ServerMessage.RACE_EVENT, (event: RaceEvent) => received.push(event));
      for (const type of [
        ServerMessage.MATCH_PHASE,
        ServerMessage.COUNTDOWN,
        ServerMessage.RESULTS,
        ServerMessage.ERROR,
      ])
        room.onMessage(type, () => undefined);
      const inStep = await feed(room, expected.samples);
      await sleep(150);
      rivalJson = room.state.rivalBlueprint;
      await room.leave();
      if (inStep) break;
    }
    const upTo = expected.samples.length;
    expect(received.filter((e) => e.tick <= upTo)).toEqual(expected.events);
    // The rival the room shows the client is the AI's own build for this course.
    expect(JSON.parse(rivalJson)).toEqual(expected.ai.race.cars[1]!.build.blueprint);
    expect(expected.rival.tireKitId).toBe('tires_sand');
    // There was racing in it.
    expect(expected.events.some((e) => e.type === 'checkpoint')).toBe(true);
  }, 120_000);

  it('refuses a difficulty that does not exist', async () => {
    await expect(
      join({
        trackId: 'city_01',
        weatherPresetId: 'city_clear_night',
        blueprint: getTemplate('baseline')!.blueprint,
        difficulty: 'impossible' as AiDifficulty,
      }),
    ).rejects.toThrow();
  });
});
