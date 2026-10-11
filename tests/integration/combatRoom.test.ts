import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASELINE_BLUEPRINT,
  ROOKIE_BLUEPRINT,
  SCENARIOS,
  WEAPON_LIST,
  createScenarioRace,
  getScenario,
  getTrack,
} from '@bolt/content';
import type {
  ControlInput,
  DriveJoinOptions,
  GuestSessionResponse,
  HealthResponse,
  InputSample,
  RaceEvent,
  ScenarioDefinition,
  TrackRuntime,
} from '@bolt/shared';
import {
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
import { CONTROL_WEAPONS } from '../balance/harness.js';
import type { TestServer } from '../helpers/server.js';
import { sleep, startTestServer, waitFor } from '../helpers/server.js';

/**
 * Combat through a real room (Section 19.3). A scenario room runs the same scripted two-car
 * match as the scenario runner, with one difference that is the point of the test: the fire
 * and utility buttons of the player's car cross the wire as ordinary input samples and are
 * judged by the server.
 *
 * The test keeps a mirror: the same scenario stepped in this process with the same samples,
 * which is exactly what the offline link does. The room's event stream must equal the
 * mirror's, id for id and field for field. That one comparison shows that every event arrives
 * once and in order, and that the server path and the offline path are the same race.
 */

const TRACK_ID = 'city_01';
const WEATHER_ID = 'city_clear_night';
/** Samples kept queued ahead of the last acknowledged one. The server holds at most eight. */
const AHEAD = 6;

let ctx: TestServer;
let client: Client;
let guest: GuestSessionResponse;
const track: TrackRuntime = buildTrack(getTrack(TRACK_ID)!);

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

function joinOptions(overrides: Record<string, unknown> = {}): DriveJoinOptions {
  return {
    protocolVersion: PROTOCOL_VERSION,
    guestToken: guest.token,
    trackId: TRACK_ID,
    weatherPresetId: WEATHER_ID,
    blueprint: BASELINE_BLUEPRINT,
    ...overrides,
  } as DriveJoinOptions;
}

async function join(overrides: Record<string, unknown> = {}): Promise<DriveRoomClient> {
  const room = await client.joinOrCreate<DriveState>(ROOM_DRIVE, joinOptions(overrides));
  await waitFor(() => typeof room.state?.tick === 'number', 3000, 'the first state snapshot');
  return room;
}

function collect(room: DriveRoomClient, into: RaceEvent[]): void {
  room.onMessage(ServerMessage.RACE_EVENT, (event: RaceEvent) => into.push(event));
  room.onMessage(ServerMessage.MATCH_PHASE, () => undefined);
  room.onMessage(ServerMessage.COUNTDOWN, () => undefined);
  room.onMessage(ServerMessage.RESULTS, () => undefined);
  room.onMessage(ServerMessage.ERROR, () => undefined);
}

async function roomCount(): Promise<number> {
  return ((await (await fetch(`${ctx.url}/api/v1/health`)).json()) as HealthResponse).rooms;
}

/**
 * Sends samples at the pace the room consumes them. Returns false when the room ran a step no
 * sample stood for (this process stalled for longer than the room waits), in which case the
 * room and the mirror have seen different input and the comparison is void.
 */
async function feed(
  room: DriveRoomClient,
  samples: readonly InputSample[],
  strict = true,
): Promise<boolean> {
  const first = samples[0]!.sequence;
  const last = samples[samples.length - 1]!.sequence;
  const tickAtFirst = room.state.tick - (room.state.ackSequence - first + 1);
  let sent = 0;
  const deadline = Date.now() + samples.length * 34 + 8000;
  for (;;) {
    const ack = room.state.ackSequence;
    // One step for each sample consumed, and no more.
    if (strict && ack >= first && room.state.tick - tickAtFirst > ack - first + 1) return false;
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

type Mirror = {
  samples: InputSample[];
  /** What the room should send its driver, in order. */
  events: RaceEvent[];
  /** State of the mirrored race after the last sample. */
  chassis: [number, number];
};

/** The scenario stepped here, recording the sample each tick was given: the offline path. */
function mirror(def: ScenarioDefinition, limitTicks = Infinity): Mirror {
  const setup = createScenarioRace(def, track);
  if (!setup) throw new Error(`${def.id} does not resolve`);
  const { race, brains } = setup;
  const samples: InputSample[] = [];
  const events: RaceEvent[] = [];
  const human: Array<ControlInput | undefined> = [];
  const rivalOnly = [null, brains[1] ?? null];
  const guard = def.countdownTicks + def.durationTicks + 5;
  for (let i = 0; i < guard && race.raceTicks < def.durationTicks && i < limitTicks; i++) {
    const control = brains[0]!.control(race, 0);
    const own: ControlInput = { ...control };
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
    stepRaceWithBrains(race, human, rivalOnly);
    for (const event of race.events) if (eventVisibleTo(event, 0)) events.push({ ...event });
  }
  return { samples, events, chassis: [race.cars[0]!.chassis, race.cars[1]!.chassis] };
}

type Played = {
  def: ScenarioDefinition;
  expected: Mirror;
  received: RaceEvent[];
  attempts: number;
};

/** Plays a scenario through a room, again if this process stalled and broke the lockstep. */
async function play(id: string): Promise<Played> {
  const def = getScenario(id)!;
  const expected = mirror(def);
  for (let attempt = 1; ; attempt++) {
    const received: RaceEvent[] = [];
    const room = await join({
      scenarioId: id,
      trackId: def.trackId,
      weatherPresetId: def.weatherPresetId,
    });
    collect(room, received);
    const inStep = await feed(room, expected.samples);
    // The last events of the last step are on their way.
    await sleep(120);
    await room.leave();
    const lastTick = expected.samples.length;
    if (inStep || attempt >= 3)
      return {
        def,
        expected,
        received: received.filter((event) => event.tick <= lastTick),
        attempts: attempt,
      };
  }
}

const played = new Map<string, Played>();

describe('every scenario through a real room', () => {
  it('plays all of them, a few rooms at a time', async () => {
    const ids = SCENARIOS.map((def) => def.id);
    const lanes = 9;
    let next = 0;
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (next < ids.length) {
          const id = ids[next++]!;
          played.set(id, await play(id));
        }
      }),
    );
    expect(played.size).toBe(SCENARIOS.length);
  }, 240_000);

  it('delivers every event exactly once and in order, identical to the offline race', () => {
    for (const [id, run] of played) {
      const ids = run.received.map((event) => event.id);
      expect(ids, `${id}: ids in order`).toEqual([...ids].sort((a, b) => a - b));
      expect(new Set(ids).size, `${id}: no event twice`).toBe(ids.length);
      // The same race, bit for bit: every id, tick, position and amount.
      expect(run.received, id).toEqual(run.expected.events);
    }
  });

  it('fires and lands every one of the twenty weapons', () => {
    for (const weapon of WEAPON_LIST) {
      const run = played.get(weapon.id);
      expect(run, `a scenario for ${weapon.id}`).toBeDefined();
      const events = run!.received;
      const mine = (event: RaceEvent) => (event as { weapon?: string }).weapon === weapon.id;
      // It went off: a shot, a beam or an area, as the weapon has it.
      expect(
        events.some(
          (e) => mine(e) && (e.type === 'shot' || e.type === 'beam' || e.type === 'area'),
        ),
        `${weapon.id} fired`,
      ).toBe(true);
      // And it did what it is for to the other car.
      if (!CONTROL_WEAPONS.has(weapon.id))
        expect(
          events.some(
            (e) => e.type === 'hit' && e.car === 1 && mine(e) && e.damage + e.chassis > 0,
          ),
          `${weapon.id} hit`,
        ).toBe(true);
      else
        expect(
          events.some(
            (e) =>
              (e.type === 'status' && e.car === 1 && e.state === 'applied') ||
              (e.type === 'impulse' && e.car === 1) ||
              (e.type === 'tether' && e.state === 'attached'),
          ),
          `${weapon.id} took effect`,
        ).toBe(true);
    }
  });

  it('satisfies what each scenario says it shows', () => {
    for (const [id, run] of played)
      for (const want of run.def.expect) {
        // The other driver's warnings are for its eyes only; the room does not send them here.
        if (want.type === 'warning' && want.car !== 0) continue;
        expect(
          run.received.some(
            (event) =>
              event.type === want.type &&
              (want.weapon === undefined ||
                (event as { weapon?: string }).weapon === want.weapon) &&
              (want.car === undefined || (event as { car?: number }).car === want.car),
          ),
          `${id}: ${JSON.stringify(want)}`,
        ).toBe(true);
      }
  });

  it('kept the lockstep without needing many retries', () => {
    const retried = [...played.values()].filter((run) => run.attempts > 1).length;
    expect(retried).toBeLessThanOrEqual(3);
  });
});

describe('fire commands the server refuses', () => {
  let sequence = 0;
  const events: RaceEvent[] = [];
  let room: DriveRoomClient;

  function samples(count: number, fields: Partial<InputSample> = {}): InputSample[] {
    return Array.from({ length: count }, () => {
      const s = sequence++;
      return { sequence: s, clientTick: s, steer: 0, brake: 0.5, coast: false, ...fields };
    });
  }
  async function send(count: number, fields: Partial<InputSample> = {}): Promise<void> {
    await feed(room, samples(count, fields), false);
    await sleep(100);
  }
  async function start(blueprint: unknown): Promise<void> {
    sequence = 0;
    events.length = 0;
    room = await join({ blueprint, rivalTemplateId: 'baseline', seed: 7 });
    collect(room, events);
    // The countdown runs on samples: keep sending until the race is on.
    while (room.state.phase !== 'RACING') await feed(room, samples(6), false);
    await sleep(100);
    events.length = 0;
  }
  const of = <T extends RaceEvent['type']>(type: T) =>
    events.filter((event) => event.type === type && (event as { car?: number }).car === 0) as Array<
      Extract<RaceEvent, { type: T }>
    >;

  it('refuses a fire button with no weapon bound to it', async () => {
    await start(BASELINE_BLUEPRINT);
    await send(3, { fire: 1 });
    await send(3);
    await send(3, { fire: 2 });
    await send(3);
    expect(of('refused').map((e) => e.reason)).toEqual(['no_weapon', 'no_weapon']);
    expect(of('shot')).toEqual([]);
    expect(room.state.projectiles.size).toBe(0);
    await room.leave();
  });

  it('refuses firing faster than the cooldown, and a button the build has nothing on', async () => {
    await start(ROOKIE_BLUEPRINT);
    await feed(room, [...samples(2, { fire: 1 }), ...samples(14)], false);
    await sleep(60);
    // One burst of five, and the gun is now reloading for 1.4 seconds.
    expect(of('shot')).toHaveLength(5);
    const reloading = room.state.combat.modules[0]!;
    expect(reloading.readyTick).toBeGreaterThan(room.state.tick);
    // Hammering the button during the reload buys nothing.
    await feed(
      room,
      [
        ...samples(2, { fire: 1 }),
        ...samples(2),
        ...samples(2, { fire: 1 }),
        ...samples(2),
        ...samples(2, { fire: 1 }),
        ...samples(2),
      ],
      false,
    );
    await sleep(100);
    expect(of('shot')).toHaveLength(5);
    expect(of('refused').map((e) => e.reason)).toEqual(['cooldown', 'cooldown', 'cooldown']);
    expect(of('refused').every((e) => e.part === 0)).toBe(true);
    // The Rookie has nothing on the secondary button.
    await send(2, { fire: 2 });
    expect(of('refused').at(-1)!.reason).toBe('no_weapon');
    // After the reload the same button works again.
    await send(45);
    await send(2, { fire: 1 });
    await send(20);
    expect(of('shot')).toHaveLength(10);
  });

  it('ignores a sample that tries to carry ammunition, cooldowns or damage of its own', async () => {
    const ack = room.state.ackSequence;
    const shots = of('shot').length;
    const spare = room.state.combat.modules[1]!.charges;
    expect(spare).toBe(1);
    const good = samples(1, { fire: 1 })[0]!;
    sequence -= 1;
    const tampered: unknown[] = [
      { inputs: [{ ...good, ammo: 99 }] },
      { inputs: [{ ...good, charges: [9, 9] }] },
      { inputs: [{ ...good, cooldown: 0 }] },
      { inputs: [{ ...good, readyTick: 0 }] },
      { inputs: [{ ...good, damage: 500 }] },
      { inputs: [{ ...good, fire: 7 }] },
      { inputs: [{ ...good, fire: 1.5 }] },
      { inputs: [{ ...good, fire: -1 }] },
      { inputs: [{ ...good, use: 256 }] },
      { inputs: [{ ...good, target: 64 }] },
      { inputs: [good], modules: [{ charges: 9 }] },
    ];
    for (const payload of tampered) room.send(ClientMessage.PLAYER_INPUT, payload);
    await sleep(400);
    // None of them was accepted as input, so none of them pressed anything.
    expect(room.state.ackSequence).toBe(ack);
    expect(of('shot')).toHaveLength(shots);
    expect(room.state.combat.modules[1]!.charges).toBe(spare);
    expect(room.state.phase).toBe('RACING');
    // The connection is still good and honest input still works.
    await send(4);
    expect(room.state.ackSequence).toBe(ack + 4);
    // A spare wheel with nothing to replace is refused and kept.
    await send(2, { use: 1 });
    await send(2);
    expect(of('refused').at(-1)).toMatchObject({ reason: 'not_needed' });
    expect(room.state.combat.modules[1]!.charges).toBe(1);
    await room.leave();
  });
});

describe('reconnecting in the middle of a fight', () => {
  it('restores the fight as the server has it, and delivers what happened meanwhile once', async () => {
    const def = getScenario('mortar_strike')!;
    const expected = mirror(def);
    const telegraph = expected.events.find((event) => event.type === 'telegraph')!;
    const blast = expected.events.find((event) => event.type === 'explosion')!;
    expect(blast.tick).toBeGreaterThan(telegraph.tick + 30);

    const received: RaceEvent[] = [];
    let room = await join({ scenarioId: def.id });
    collect(room, received);
    // Up to the shell being in the air, with its reticle on the road.
    const upTo = expected.samples.filter((sample) => sample.sequence < telegraph.tick + 4);
    expect(await feed(room, upTo)).toBe(true);
    await waitFor(() => received.some((e) => e.type === 'telegraph'), 2000, 'the reticle');
    expect(received.some((event) => event.type === 'explosion')).toBe(false);
    const before = {
      tick: room.state.tick,
      ack: room.state.ackSequence,
      charges: room.state.combat.modules[0]!.charges,
      rivalChassis: room.state.rival.chassis,
      projectiles: room.state.projectiles.size,
      events: received.length,
    };
    expect(before.charges).toBe(2);
    expect(before.projectiles).toBe(1);
    const sessionId = room.sessionId;
    const token = room.reconnectionToken;

    // A network drop while the shell is in flight. It lands with nobody connected.
    await room.leave(false);
    await sleep(2200);
    expect(await roomCount()).toBeGreaterThanOrEqual(1);

    const again: RaceEvent[] = [];
    room = await client.reconnect<DriveState>(token);
    collect(room, again);
    await waitFor(() => typeof room.state?.tick === 'number', 3000, 'the state after reconnecting');
    await waitFor(() => again.some((e) => e.type === 'explosion'), 2000, 'the held events');
    const state = room.state;
    expect(room.sessionId).toBe(sessionId);
    expect(state.tick).toBeGreaterThan(before.tick + 45);
    expect(state.ackSequence).toBe(before.ack);
    // The fight went on without the client: the shell landed and hurt the other car.
    expect(state.projectiles.size).toBe(0);
    expect(state.rival.chassis).toBeLessThan(before.rivalChassis);
    expect(state.rival.chassisMax).toBeGreaterThan(state.rival.chassis);
    // Ammunition is the server's count, not whatever the client last believed.
    expect(state.combat.modules[0]!.charges).toBe(2);
    expect(state.combat.chassis).toBe(state.combat.chassisMax);
    expect(state.rivalBlueprint.length).toBeGreaterThan(20);

    // What happened while the connection was down arrives once, in order, after what came before.
    const all = [...received, ...again];
    const ids = all.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(again.filter((event) => event.type === 'explosion')).toHaveLength(1);
    expect(again.filter((event) => event.type === 'hit' && event.car === 1)).toHaveLength(1);
    expect(again.some((event) => event.type === 'telegraph')).toBe(false);
    expect(again[0]!.id).toBeGreaterThan(received.at(-1)!.id);

    // And the car answers to fresh input again.
    const more = Array.from({ length: 6 }, (_, i) => ({
      sequence: before.ack + 1 + i,
      clientTick: before.ack + 1 + i,
      steer: 0,
      brake: 0,
      coast: false,
    }));
    await feed(room, more, false);
    expect(room.state.ackSequence).toBe(before.ack + 6);
    await room.leave();
  });

  it('leaves no rooms behind', async () => {
    await waitFor(() => true, 100, 'nothing');
    await sleep(300);
    expect(await roomCount()).toBe(0);
  });
});
