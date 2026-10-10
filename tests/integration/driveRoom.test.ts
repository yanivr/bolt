import { Client } from 'colyseus.js';
import type { Room } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT, getTrack } from '@bolt/content';
import type {
  ApiError,
  DriveJoinOptions,
  GuestSessionResponse,
  HealthResponse,
  InputSample,
  RaceEvent,
} from '@bolt/shared';
import {
  COUNTDOWN_SECONDS,
  ClientMessage,
  MAX_INPUTS_PER_PACKET,
  MAX_QUEUED_INPUTS,
  PROTOCOL_VERSION,
  ROOM_DRIVE,
  ServerMessage,
  buildTrack,
} from '@bolt/shared';
import type { MatchPhaseMessage } from '../../apps/server/src/rooms/DriveRoom.js';
import { CLOSE_CODE_ABUSE } from '../../apps/server/src/rooms/DriveRoom.js';
import { JOIN_ERROR_CODES } from '../../apps/server/src/rooms/driveJoin.js';
import type { DriveState } from '../../apps/server/src/rooms/schema.js';
import {
  createGuestTokenSigner,
  generateGuestId,
} from '../../apps/server/src/security/guestTokens.js';
import type { TestServer } from '../helpers/server.js';
import { TEST_ORIGIN, TEST_SECRET, sleep, startTestServer, waitFor } from '../helpers/server.js';

const MAX_MALFORMED = 12;
const TRACK_ID = 'city_01';
const WEATHER_ID = 'city_clear_night';

let ctx: TestServer;
let client: Client;
let guest: GuestSessionResponse;
const spawn = buildTrack(getTrack(TRACK_ID)!).spawns[0]!;

beforeAll(async () => {
  ctx = await startTestServer({
    drive: { maxMalformedMessages: MAX_MALFORMED, reconnectSeconds: 5 },
  });
  client = new Client(ctx.wsUrl);
  guest = (await (
    await fetch(`${ctx.url}/api/v1/guest`, { method: 'POST' })
  ).json()) as GuestSessionResponse;
});

afterAll(async () => {
  await ctx.stop();
});

function joinOptions(overrides: Record<string, unknown> = {}): DriveJoinOptions {
  return {
    protocolVersion: PROTOCOL_VERSION,
    guestToken: guest.token,
    trackId: TRACK_ID,
    weatherPresetId: WEATHER_ID,
    loadout: { ...DEFAULT_LOADOUT },
    ...overrides,
  } as DriveJoinOptions;
}

type DriveRoomClient = Room<DriveState>;

async function join(overrides: Record<string, unknown> = {}): Promise<DriveRoomClient> {
  const room = await client.joinOrCreate<DriveState>(ROOM_DRIVE, joinOptions(overrides));
  await waitForState(room);
  return room;
}

async function waitForState(room: DriveRoomClient): Promise<void> {
  await waitFor(
    () => typeof room.state?.tick === 'number' && typeof room.state.phase === 'string',
    3000,
    'the first state snapshot',
  );
}

async function expectJoinRefused(overrides: Record<string, unknown>, code: number): Promise<void> {
  let failure: { code?: number; message?: string } | undefined;
  try {
    const room = await client.joinOrCreate(ROOM_DRIVE, joinOptions(overrides));
    await room.leave();
  } catch (error) {
    failure = error as { code?: number; message?: string };
  }
  expect(
    failure,
    `join with ${JSON.stringify(overrides).slice(0, 80)} should be refused`,
  ).toBeDefined();
  expect(failure!.code).toBe(code);
  expect(failure!.message).toMatch(/^[A-Z].*\.$/);
  expect(failure!.message).not.toMatch(/—|--|Error:|node_modules/);
}

async function roomCount(): Promise<number> {
  return ((await (await fetch(`${ctx.url}/api/v1/health`)).json()) as HealthResponse).rooms;
}

function sample(sequence: number, steer = 0, brake = 0): InputSample {
  return { sequence, clientTick: sequence, steer, brake, coast: false };
}

describe('joining the drive room', () => {
  it('refuses a missing, forged or expired guest token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = createGuestTokenSigner('some-other-secret-0123456789abcdef').sign(
      generateGuestId(),
      now + 3600,
    );
    const expired = createGuestTokenSigner(TEST_SECRET).sign(generateGuestId(), now - 5);
    await expectJoinRefused({ guestToken: forged }, JOIN_ERROR_CODES.UNAUTHORIZED);
    await expectJoinRefused({ guestToken: expired }, JOIN_ERROR_CODES.UNAUTHORIZED);
    await expectJoinRefused(
      { guestToken: guest.token.slice(0, -3) + 'AAA' },
      JOIN_ERROR_CODES.UNAUTHORIZED,
    );
    await expectJoinRefused({ guestToken: 'x'.repeat(40) }, JOIN_ERROR_CODES.UNAUTHORIZED);
    await expectJoinRefused({ guestToken: undefined }, JOIN_ERROR_CODES.BAD_REQUEST);
  });

  it('refuses a client built for another protocol version', async () => {
    await expectJoinRefused(
      { protocolVersion: PROTOCOL_VERSION + 1 },
      JOIN_ERROR_CODES.VERSION_MISMATCH,
    );
    await expectJoinRefused(
      { protocolVersion: String(PROTOCOL_VERSION) },
      JOIN_ERROR_CODES.VERSION_MISMATCH,
    );
    await expectJoinRefused({ protocolVersion: undefined }, JOIN_ERROR_CODES.VERSION_MISMATCH);
  });

  it('refuses an unknown track or a weather preset the track does not offer', async () => {
    await expectJoinRefused({ trackId: 'moon_99' }, JOIN_ERROR_CODES.UNKNOWN_TRACK);
    await expectJoinRefused({ trackId: 'constructor' }, JOIN_ERROR_CODES.UNKNOWN_TRACK);
    await expectJoinRefused({ trackId: '../etc/passwd' }, JOIN_ERROR_CODES.BAD_REQUEST);
    await expectJoinRefused({ weatherPresetId: 'desert_dry_heat' }, JOIN_ERROR_CODES.BAD_REQUEST);
  });

  it('refuses unknown part ids in any slot', async () => {
    for (const slot of ['chassisId', 'engineId', 'tireKitId', 'paintId'] as const) {
      await expectJoinRefused(
        { loadout: { ...DEFAULT_LOADOUT, [slot]: 'part_from_nowhere' } },
        JOIN_ERROR_CODES.UNKNOWN_PART,
      );
    }
    // Names that exist on every JavaScript object are still not parts.
    for (const inherited of ['__proto__', 'constructor', 'to_string', 'has_own_property']) {
      await expectJoinRefused(
        { loadout: { ...DEFAULT_LOADOUT, engineId: inherited } },
        JOIN_ERROR_CODES.UNKNOWN_PART,
      );
    }
    await expectJoinRefused(
      { loadout: { ...DEFAULT_LOADOUT, engineId: 'Engine Four' } },
      JOIN_ERROR_CODES.BAD_REQUEST,
    );
  });

  it('refuses client-supplied totals, coefficients and other extra fields', async () => {
    await expectJoinRefused({ totalCost: 0 }, JOIN_ERROR_CODES.BAD_REQUEST);
    await expectJoinRefused({ params: { driveForce: 1e9 } }, JOIN_ERROR_CODES.BAD_REQUEST);
    await expectJoinRefused(
      { loadout: { ...DEFAULT_LOADOUT, massKg: 1 } },
      JOIN_ERROR_CODES.BAD_REQUEST,
    );
  });

  it('creates no room for any refused join', async () => {
    expect(await roomCount()).toBe(0);
  });

  it('refuses a socket opened from an unlisted origin', async () => {
    const attempt = (origin: string) =>
      new Promise<'open' | 'refused'>((resolve) => {
        // Node's WebSocket accepts request headers as an undici extension.
        const socket = new WebSocket(`${ctx.wsUrl}/any/room?sessionId=x`, {
          headers: { Origin: origin },
        } as unknown as string[]);
        socket.onopen = () => {
          socket.close();
          resolve('open');
        };
        socket.onerror = () => resolve('refused');
      });
    expect(await attempt('http://evil.example')).toBe('refused');
    expect(await attempt(TEST_ORIGIN)).toBe('open');
  });
});

describe('driving', () => {
  let room: DriveRoomClient;
  let sequence = 0;
  const phases: MatchPhaseMessage[] = [];
  const events: RaceEvent[] = [];
  const errors: ApiError['error'][] = [];
  let left: number | undefined;

  function listen(target: DriveRoomClient): void {
    target.onMessage(ServerMessage.MATCH_PHASE, (message: MatchPhaseMessage) =>
      phases.push(message),
    );
    target.onMessage(ServerMessage.RACE_EVENT, (message: RaceEvent) => events.push(message));
    target.onMessage(ServerMessage.ERROR, (message: ApiError['error']) => errors.push(message));
    target.onLeave((code) => (left = code));
  }

  /** Sends one fresh full-throttle sample per call, the way the client does every tick. */
  function drive(steer = 0): void {
    room.send(ClientMessage.PLAYER_INPUT, { inputs: [sample(sequence, steer)] });
    sequence += 1;
  }

  async function driveFor(ms: number, steer = 0): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      drive(steer);
      await sleep(33);
    }
  }

  /** Waits until the server has consumed everything sent so far. */
  async function settle(): Promise<void> {
    await waitFor(
      () => room.state.ackSequence === sequence - 1,
      3000,
      `ackSequence to reach ${sequence - 1}`,
    );
  }

  function distanceFromSpawn(): number {
    return Math.hypot(room.state.x - spawn.x, room.state.y - spawn.y);
  }

  afterAll(async () => {
    if (left === undefined) await room?.leave();
  });

  it('joins with a valid guest token and the default loadout, held on the grid', async () => {
    room = await join();
    listen(room);
    const state = room.state;
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.countdown).toBeGreaterThanOrEqual(COUNTDOWN_SECONDS - 1);
    expect(state.countdown).toBeLessThanOrEqual(COUNTDOWN_SECONDS);
    expect(state.ackSequence).toBe(-1);
    expect(state.raceTimeMs).toBe(0);
    expect(state.finishedAtMs).toBe(-1);
    expect(state.lap).toBe(0);
    expect(state.x).toBe(spawn.x);
    expect(state.y).toBe(spawn.y);
    expect(state.headingRad).toBe(spawn.headingRad);
    expect(await roomCount()).toBe(1);
  });

  it('carries every CarSnapshot field in the synchronized state', () => {
    const state = room.state as unknown as Record<string, unknown>;
    const numeric = [
      'tick',
      'countdown',
      'raceTimeMs',
      'ackSequence',
      'bestLapMs',
      'lastLapMs',
      'x',
      'y',
      'headingRad',
      'velocityX',
      'velocityY',
      'yawRate',
      'steeringInput',
      'brakeInput',
      'throttleFraction',
      'reverseHold',
      'wallGrace',
      'checkpointIndex',
      'lap',
      'courseProgress',
      'lastCheckpointMs',
      'wrongWaySeconds',
      'finishedAtMs',
    ];
    for (const field of numeric) expect(typeof state[field], field).toBe('number');
    expect(typeof state.phase).toBe('string');
    expect(typeof state.reversing).toBe('boolean');
  });

  it('does not let the car move before the countdown ends, whatever the client sends', async () => {
    await driveFor(400);
    await settle();
    expect(room.state.phase).toBe('COUNTDOWN');
    expect(distanceFromSpawn()).toBe(0);
    expect(room.state.velocityX).toBe(0);
    expect(room.state.velocityY).toBe(0);
    expect(room.state.raceTimeMs).toBe(0);
  });

  it('starts racing after the countdown and announces the phase change', async () => {
    await waitFor(
      () => room.state.phase === 'RACING',
      (COUNTDOWN_SECONDS + 2) * 1000,
      'the RACING phase',
    );
    expect(room.state.countdown).toBe(0);
    await waitFor(
      () => phases.some((message) => message.phase === 'RACING'),
      2000,
      'the RACING announcement',
    );
    expect(phases.map((message) => message.phase)).toEqual(['RACING']);
    const announced = phases[0]!;
    // Thirty ticks per second for the whole countdown, measured from the join.
    expect(announced.tick).toBe(COUNTDOWN_SECONDS * 30);
  });

  it('moves the car under full-throttle straight input and acknowledges each sample', async () => {
    const tickBefore = room.state.tick;
    const ackBefore = room.state.ackSequence;
    const startedAt = performance.now();
    await driveFor(1500);
    const elapsedTicks = ((performance.now() - startedAt) / 1000) * 30;
    // The simulation tracks wall-clock time at 30 Hz. The tolerance covers snapshot
    // granularity (two ticks per patch) and timer jitter on a busy machine.
    expect(Math.abs(room.state.tick - tickBefore - elapsedTicks)).toBeLessThan(8);
    await settle();

    const state = room.state;
    expect(state.ackSequence).toBeGreaterThan(ackBefore + 20);
    expect(state.tick).toBeGreaterThan(tickBefore + 30);
    expect(state.raceTimeMs).toBeGreaterThan(1000);
    expect(distanceFromSpawn()).toBeGreaterThan(40);
    expect(Math.hypot(state.velocityX, state.velocityY)).toBeGreaterThan(40);
    expect(state.throttleFraction).toBeGreaterThan(0.5);
    // The grid sits just behind the start line, so the first event is crossing it.
    await waitFor(() => events.length > 0, 3000, 'a race event');
    expect(events[0]).toMatchObject({ id: 1, type: 'checkpoint', index: 0 });
    expect(state.lap).toBe(1);
  });

  it('ignores duplicate and old sequence numbers', async () => {
    await settle();
    const ack = room.state.ackSequence;
    const x = room.state.steeringInput;
    // Replays of consumed samples, carrying a hard-left steer that must never be applied.
    room.send(ClientMessage.PLAYER_INPUT, { inputs: [sample(ack, -1), sample(ack, -1)] });
    room.send(ClientMessage.PLAYER_INPUT, {
      inputs: [sample(0, -1), sample(ack - 1, -1), sample(ack, -1)],
    });
    await sleep(300);
    expect(room.state.ackSequence).toBe(ack);
    expect(room.state.steeringInput).toBeGreaterThanOrEqual(Math.min(x, 0) - 1e-9);

    // A packet that repeats old samples and adds one new one advances by exactly one.
    room.send(ClientMessage.PLAYER_INPUT, {
      inputs: [sample(ack - 1, -1), sample(ack, -1), sample(ack + 1)],
    });
    sequence = ack + 2;
    await settle();
    expect(room.state.ackSequence).toBe(ack + 1);
    expect(room.state.steeringInput).toBeGreaterThanOrEqual(-1e-9);
  });

  it('keeps only the newest queued samples when the client outruns the simulation', async () => {
    await settle();
    const first = sequence;
    const burst = MAX_QUEUED_INPUTS * 3;
    for (let sent = 0; sent < burst; sent += MAX_INPUTS_PER_PACKET) {
      const inputs = Array.from({ length: MAX_INPUTS_PER_PACKET }, (_, i) =>
        sample(first + sent + i),
      );
      room.send(ClientMessage.PLAYER_INPUT, { inputs });
    }
    sequence = first + burst;
    const tickBefore = room.state.tick;
    await settle();
    // Draining at one sample per tick can take at most a queue's worth of ticks (plus
    // snapshot granularity), far fewer than the number of samples sent.
    expect(room.state.tick - tickBefore).toBeLessThan(burst);
  });

  it('rejects malformed input without crashing the room or moving ackSequence', async () => {
    await settle();
    const ack = room.state.ackSequence;
    const next = sequence;
    const good = sample(next, -1);
    const malformed: unknown[] = [
      { inputs: [{ ...good, steer: Number.NaN }] },
      { inputs: [{ ...good, brake: Number.POSITIVE_INFINITY }] },
      { inputs: [{ ...good, steer: 5 }] },
      { inputs: [{ ...good, brake: -0.5 }] },
      { inputs: [{ ...good, extra: true }] },
      { inputs: [good], x: 1e9, y: 1e9 },
      { inputs: Array.from({ length: MAX_INPUTS_PER_PACKET + 1 }, (_, i) => sample(next + i, -1)) },
      { inputs: [{ ...good, sequence: '7' }] },
      { inputs: [{ ...good, sequence: 1.5 }] },
      { inputs: [{ ...good, sequence: -1 }] },
    ];
    expect(malformed.length).toBeLessThanOrEqual(MAX_MALFORMED);
    for (const payload of malformed) room.send(ClientMessage.PLAYER_INPUT, payload);
    await sleep(400);

    expect(left).toBeUndefined();
    expect(errors).toEqual([]);
    expect(room.state.ackSequence).toBe(ack);
    expect(room.state.phase).toBe('RACING');

    const tick = room.state.tick;
    drive();
    await settle();
    expect(room.state.ackSequence).toBe(next);
    expect(room.state.tick).toBeGreaterThan(tick);
  });

  it('coasts on neutral input once the client goes quiet', async () => {
    await driveFor(300, 1);
    await settle();
    expect(room.state.steeringInput).toBeGreaterThan(0.2);
    const ack = room.state.ackSequence;
    // Half a second of held input, then neutral: the wheels come back to center.
    await waitFor(
      () => Math.abs(room.state.steeringInput) < 0.02,
      3000,
      'the steering to return to center',
    );
    expect(room.state.ackSequence).toBe(ack);
    expect(room.state.phase).toBe('RACING');
  });

  it('resumes the same car after a dropped connection', async () => {
    await driveFor(300);
    await settle();
    const before = {
      ...(room.state.toJSON() as unknown as Record<string, number | string | boolean>),
    };
    const sessionId = room.sessionId;
    const token = room.reconnectionToken;
    const eventsBefore = events.length;

    // Closing the socket without the leave handshake is what a network drop looks like.
    left = undefined;
    await room.leave(false);
    expect(left).toBeDefined();
    left = undefined;
    await sleep(500);
    expect(await roomCount()).toBe(1);

    room = await client.reconnect<DriveState>(token);
    listen(room);
    await waitForState(room);
    const state = room.state;

    expect(room.sessionId).toBe(sessionId);
    expect(state.phase).toBe('RACING');
    expect(state.ackSequence).toBe(before.ackSequence);
    expect(state.lap).toBe(before.lap);
    expect(state.checkpointIndex).toBeGreaterThanOrEqual(before.checkpointIndex as number);
    expect(state.bestLapMs).toBe(before.bestLapMs);
    // The simulation kept running on neutral input: time moved on and nothing was reset.
    expect(state.tick).toBeGreaterThan((before.tick as number) + 10);
    expect(state.raceTimeMs).toBeGreaterThan(before.raceTimeMs as number);
    // Far past the grid, where progress is never positive.
    expect(state.courseProgress).toBeGreaterThan(100);
    expect(distanceFromSpawn()).toBeGreaterThan(40);

    // Old sequences stay dead across the reconnect and fresh ones are accepted again.
    room.send(ClientMessage.PLAYER_INPUT, {
      inputs: [sample(0, -1), sample(before.ackSequence as number, -1)],
    });
    await sleep(200);
    expect(room.state.ackSequence).toBe(before.ackSequence);
    drive();
    await settle();
    expect(room.state.ackSequence).toBe((before.ackSequence as number) + 1);

    // Event ids keep increasing for the room; none are reused after the reconnect.
    const ids = events.map((event) => event.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.length).toBeGreaterThanOrEqual(eventsBefore);
  });

  it('puts the car back on the grid on RESET_CAR, at most once per second', async () => {
    await settle();
    const ack = room.state.ackSequence;
    const phasesBefore = phases.length;
    room.send(ClientMessage.RESET_CAR);
    await waitFor(() => room.state.phase === 'COUNTDOWN', 2000, 'the countdown after a reset');
    expect(distanceFromSpawn()).toBe(0);
    expect(room.state.lap).toBe(0);
    expect(room.state.raceTimeMs).toBe(0);
    expect(room.state.ackSequence).toBe(ack);
    await waitFor(() => phases.length > phasesBefore, 2000, 'the COUNTDOWN announcement');
    expect(phases[phases.length - 1]!.phase).toBe('COUNTDOWN');

    // A second reset right away is dropped, so the countdown is not restarted.
    await sleep(400);
    const countdownTick = phases[phases.length - 1]!.tick;
    room.send(ClientMessage.RESET_CAR);
    await waitFor(
      () => room.state.phase === 'RACING',
      (COUNTDOWN_SECONDS + 2) * 1000,
      'racing after the reset',
    );
    const racing = phases[phases.length - 1]!;
    expect(racing.phase).toBe('RACING');
    expect(racing.tick - countdownTick).toBe(COUNTDOWN_SECONDS * 30);

    // Samples from before the reset cannot be replayed into the new run.
    room.send(ClientMessage.PLAYER_INPUT, { inputs: [sample(ack, -1)] });
    await sleep(200);
    expect(room.state.ackSequence).toBe(ack);
  });

  it('disposes the room when the player leaves on purpose', async () => {
    await room.leave();
    expect(left).toBe(4000);
    await waitFor(() => left !== undefined, 1000, 'the leave to complete');
    const deadline = Date.now() + 3000;
    while ((await roomCount()) !== 0 && Date.now() < deadline) await sleep(50);
    expect(await roomCount()).toBe(0);
  });
});

describe('abuse', () => {
  async function joinAndWatch(): Promise<{
    room: DriveRoomClient;
    errors: ApiError['error'][];
    closed: () => number | undefined;
  }> {
    const room = await join();
    const errors: ApiError['error'][] = [];
    let code: number | undefined;
    room.onMessage(ServerMessage.ERROR, (message: ApiError['error']) => errors.push(message));
    room.onMessage('*', () => undefined);
    room.onLeave((closeCode) => (code = closeCode));
    return { room, errors, closed: () => code };
  }

  it('disconnects a client that keeps sending malformed messages', async () => {
    const { room, errors, closed } = await joinAndWatch();
    for (let i = 0; i < MAX_MALFORMED + 1; i += 1) {
      if (i % 3 === 0) room.send(ClientMessage.PLAYER_INPUT, { inputs: 'nope' });
      else if (i % 3 === 1) room.send('NOT_A_REAL_MESSAGE', { anything: true });
      else room.send(ClientMessage.RESET_CAR, { teleportTo: { x: 0, y: 0 } });
    }
    await waitFor(() => closed() !== undefined, 3000, 'the abusive client to be disconnected');
    expect(closed()).toBe(CLOSE_CODE_ABUSE);
    expect(errors).toEqual([
      { code: 'BAD_REQUEST', message: expect.stringMatching(/^[A-Z].*\.$/) },
    ]);
    // A removed client gets no reconnection window, so its room goes away immediately.
    await expect(client.reconnect(room.reconnectionToken)).rejects.toBeDefined();
  });

  it('disconnects a client that floods the room with messages', async () => {
    const { room, errors, closed } = await joinAndWatch();
    for (let i = 0; i < 400 && closed() === undefined; i += 1) {
      room.send(ClientMessage.PLAYER_INPUT, { inputs: [sample(i)] });
    }
    await waitFor(() => closed() !== undefined, 3000, 'the flooding client to be disconnected');
    expect(closed()).toBe(CLOSE_CODE_ABUSE);
    expect(errors[0]).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('survives a frame that is not a valid message at all', async () => {
    const { room, closed } = await joinAndWatch();
    // Raw bytes on the socket: a ROOM_DATA header followed by truncated msgpack.
    room.connection.send(new Uint8Array([13, 0xa5, 0x41, 0xdc, 0xff]));
    room.connection.send(new Uint8Array([13]));
    room.connection.send(new Uint8Array([255, 255, 255]));
    await sleep(300);
    // Whether or not this connection was dropped, the server and other rooms carry on.
    expect(
      ((await (await fetch(`${ctx.url}/api/v1/health`)).json()) as HealthResponse).status,
    ).toBe('ok');
    if (closed() === undefined) await room.leave();
    const other = await join();
    expect(other.state.phase).toBe('COUNTDOWN');
    await other.leave();
  });

  it('leaves no rooms behind', async () => {
    const deadline = Date.now() + 3000;
    while ((await roomCount()) !== 0 && Date.now() < deadline) await sleep(50);
    expect(await roomCount()).toBe(0);
  });
});
