import { getTemplate } from '@bolt/content';
import type { ControlInput, VehicleBlueprint } from '@bolt/shared';
import {
  MatchClientMessage,
  MatchServerMessage,
  PROTOCOL_VERSION,
  PUBLIC_RIVAL_CAR_NAME,
  createDriverScratch,
  driveCenterline,
} from '@bolt/shared';
import { Client } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_CODE_ABUSE } from '../../apps/server/src/rooms/MatchRoom.js';
import { car, check, errorCodes } from '../helpers/blueprints.js';
import type { TestServer } from '../helpers/server.js';
import { startTestServer } from '../helpers/server.js';
import type { DrivePolicy } from './headless.js';
import { HeadlessPlayer, sleep, waitUntil } from './headless.js';
import { NetSim, PERFECT } from './netsim.js';

/**
 * Race a Friend against a hostile client (Section 19.6): everything a player can send is
 * parsed and limited, nothing a player sends can set state, and nothing about the other player
 * reaches a client beyond what the rules make public. Real sockets, a real room; the proxy
 * here is a perfect link, so every failure is the server's answer and not the network's.
 */

const tinker = getTemplate('starter_tinker')!.blueprint;
const sprinter = getTemplate('starter_sprinter')!.blueprint;
const PROFILE = { nickname: 2, emblem: 1 };
const TIMING = { trackRevealMs: 2_000, buildMs: 4_000, loadMs: 6_000 };

let ctx: TestServer;
const sims: NetSim[] = [];
const players: HeadlessPlayer[] = [];

beforeAll(async () => {
  ctx = await startTestServer({
    match: { timing: TIMING, laps: 1 },
    rateLimits: {
      api: { windowMs: 60_000, max: 10_000 },
      guest: { windowMs: 60_000, max: 10_000 },
      join: { windowMs: 60_000, max: 10_000 },
      match: { windowMs: 60_000, max: 50 },
      // Production limits for code guesses: the brute-force test below relies on them.
      code: { windowMs: 60_000, max: 20 },
    },
  });
});

afterAll(async () => {
  for (const p of players) p.stopDriving();
  for (const s of sims) await s.close();
  await ctx.stop();
}, 30_000);

async function player(name: string): Promise<HeadlessPlayer> {
  const sim = new NetSim(ctx.port, { ...PERFECT, seed: sims.length + 1 });
  await sim.listen();
  sims.push(sim);
  const p = new HeadlessPlayer(name, sim, undefined, 1);
  players.push(p);
  return p;
}

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${ctx.url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null,
  };
}

async function lobby(): Promise<[HeadlessPlayer, HeadlessPlayer]> {
  const a = await player('host');
  const b = await player('guest');
  const code = await a.create(tinker, PROFILE);
  expect((await b.join(code, sprinter, { nickname: 5, emblem: 3 })).status).toBe(200);
  await waitUntil(() => a.seatView(1)?.present === true, 5_000, 'guest seen');
  return [a, b];
}

/** Brakes on the grid (and so backs away from it): far from anything the host drops. */
const parked: DrivePolicy = () => ({
  steer: 0,
  brake: 1,
  coast: false,
  fire: 0,
  use: 0,
  target: 0,
});

/** Drives the line and drops a mine once it is well away from the grid. */
function minelayer(): DrivePolicy {
  const scratch = createDriverScratch();
  return (session, _race, info): ControlInput => {
    const c = driveCenterline(session.track, session.motion, session.params, session.env, scratch);
    const fire = session.phase === 'RACING' && info.tick > 150 && info.tick % 60 < 3 ? 1 : 0;
    return { steer: c.steer, brake: c.brake, coast: c.coast, fire, use: 0, target: 0 };
  };
}

describe('Race a Friend security', () => {
  it('refuses the wrong protocol version, a forged guest token and room calls that skip the code', async () => {
    const a = await player('versions');
    const guest = await a.guestSession();
    const old = await post(
      '/api/v1/match',
      { protocolVersion: PROTOCOL_VERSION - 1, profile: PROFILE, blueprint: tinker },
      guest.token,
    );
    expect(old.status).toBe(409);
    expect(old.body?.error?.code).toBe('VERSION_MISMATCH');
    const oldJoin = await post(
      '/api/v1/match/join',
      {
        protocolVersion: PROTOCOL_VERSION - 1,
        code: 'K7MQ2X',
        profile: PROFILE,
        blueprint: tinker,
      },
      guest.token,
    );
    expect(oldJoin.body?.error?.code).toBe('VERSION_MISMATCH');

    // A token with its signature changed by one character.
    const last = guest.token.slice(-1);
    const forged = guest.token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    const fake = await post(
      '/api/v1/match',
      { protocolVersion: PROTOCOL_VERSION, profile: PROFILE, blueprint: tinker },
      forged,
    );
    expect(fake.status).toBe(401);
    expect(
      (
        await post('/api/v1/match', {
          protocolVersion: PROTOCOL_VERSION,
          profile: PROFILE,
          blueprint: tinker,
        })
      ).status,
    ).toBe(401);

    // Free text where a preset belongs, and extra fields, are refused.
    const named = await post(
      '/api/v1/match',
      {
        protocolVersion: PROTOCOL_VERSION,
        profile: { nickname: 'Sam', emblem: 0 },
        blueprint: tinker,
      },
      guest.token,
    );
    expect(named.status).toBe(400);
    const extra = await post(
      '/api/v1/match',
      { protocolVersion: PROTOCOL_VERSION, profile: PROFILE, blueprint: tinker, email: 'a@b.c' },
      guest.token,
    );
    expect(extra.status).toBe(400);

    // The matchmaker cannot open or join a match room directly: only the code route can.
    const client = new Client(ctx.wsUrl);
    await expect(client.create('match', {})).rejects.toBeTruthy();
    await expect(client.joinOrCreate('match', {})).rejects.toBeTruthy();
    const byId = await fetch(`${ctx.url}/matchmake/joinById/abcdef`, {
      method: 'POST',
      body: '{}',
    });
    expect(byId.status).toBe(404);
  });

  it("a seat cannot be taken with someone else's reconnection token or guest identity", async () => {
    const [a, b] = await lobby();
    const roomId = a.room.roomId;
    const intruder = new Client(ctx.wsUrl);
    // A made-up token for the room, and the host's real one while the host is connected.
    await expect(intruder.reconnect(`${roomId}:not-a-real-token`)).rejects.toBeTruthy();
    await expect(intruder.reconnect(a.room.reconnectionToken)).rejects.toBeTruthy();
    expect(a.left).toBeUndefined();
    expect(a.seatView(0)?.connected).toBe(true);
    // The same guest a second time: refused, it is already seated.
    const again = await post(
      '/api/v1/match/join',
      { protocolVersion: PROTOCOL_VERSION, code: a.code, profile: PROFILE, blueprint: tinker },
      b.guest.token,
    );
    expect(again.status).toBe(409);
    expect(again.body?.error?.code).toBe('LOBBY_FULL');
    // A third player: the lobby holds two, with no spectators.
    const third = await player('third');
    const full = await third.join(a.code, tinker, PROFILE);
    expect(full.status).toBe(409);
    await a.leave();
    await b.leave();
  });

  it(
    'a race leaks nothing about the other player and accepts nothing but controls',
    { timeout: 90_000 },
    async () => {
      const mineCar: VehicleBlueprint = car('chassis_beetle', [
        {
          partId: 'weapon_mine',
          mountId: 'rear_center',
          rotationQuarterTurns: 2,
          assignedActionSlot: 0,
        },
      ]);
      expect(errorCodes(check(mineCar))).toEqual([]);
      const a = await player('minelayer');
      const b = await player('watcher');
      const code = await a.create(mineCar, PROFILE);
      await b.join(code, sprinter, { nickname: 7, emblem: 2 });
      await waitUntil(() => a.seatView(1)?.present === true, 5_000, 'guest seen');

      // Every state the guest is ever sent, checked as it arrives.
      let foreignViews = 0;
      let foreignHazards = 0;
      const rivalNames = new Set<string>();
      const seatKeys = new Set<string>();
      b.room.onStateChange((state) => {
        state.views.forEach((_v, key) => {
          if (key !== String(b.seat)) foreignViews += 1;
        });
        const mine = b.view();
        mine?.hazards?.forEach((h) => {
          if (h.owner !== mine.you) foreignHazards += 1;
        });
        if (mine?.rivalBlueprint)
          rivalNames.add((JSON.parse(mine.rivalBlueprint) as { name: string }).name);
        const host = state.seats.get('0') as unknown as Record<string, unknown> | undefined;
        if (host)
          for (const k of Object.keys(host.toJSON ? (host.toJSON as () => object)() : host))
            seatKeys.add(k);
      });

      // The guest tries to run the lobby: ignored, the host's pick stands.
      b.selectTrack('desert_01', 'desert_noon');
      b.lockTrack();
      await sleep(400);
      expect(a.state.phase).toBe('WAITING_FOR_OPPONENT');
      expect(a.state.trackId).toBe('city_01');
      a.selectTrack('city_01', 'city_clear_night');
      a.lockTrack();
      await a.waitPhase('TRACK_REVEAL');
      a.roomReady();
      b.roomReady();
      await a.waitPhase('BUILDING');
      a.ready(mineCar);
      b.ready(sprinter);
      await a.waitPhase('VS_REVEAL', 10_000);
      await waitUntil(
        () =>
          !!a.locked && a.locked.raceId === a.state.raceId && b.locked?.raceId === a.state.raceId,
        5_000,
        'locks',
      );
      a.startDriving(minelayer());
      b.startDriving(parked);
      a.roomReady();
      b.roomReady();
      await a.waitPhase('RACING', 10_000);

      // Forged state and controls out of range: each is refused and counted, none moves anything.
      const sample = { sequence: 1, clientTick: 1, steer: 0, brake: 0, coast: false };
      b.send(MatchClientMessage.PLAYER_INPUT, {
        race: b.state.raceId,
        inputs: [{ ...sample, x: 0, y: 0 }],
      });
      b.send(MatchClientMessage.PLAYER_INPUT, {
        race: b.state.raceId,
        inputs: [{ ...sample, steer: 40 }],
      });
      b.send(MatchClientMessage.PLAYER_INPUT, {
        race: b.state.raceId,
        inputs: [sample],
        chassis: 999,
      });
      b.send('SET_STATE', { finished: true, chassis: 999 });
      const lateBuild = b.ready(mineCar);
      await waitUntil(() => !!b.buildResult(lateBuild), 3_000, 'late build answer');
      expect(b.buildResult(lateBuild)!.ok).toBe(false);

      // The minelayer laps away and lays mines far from the parked guest.
      await waitUntil(
        () => a.events.some((e) => e.type === 'hazard' && e.state === 'placed'),
        30_000,
        'a mine laid',
      );
      await sleep(3_000);
      let ownHazards = 0;
      a.view()!.hazards?.forEach(() => (ownHazards += 1));
      expect(ownHazards).toBeGreaterThan(0);
      // The guest was never sent the host's view, its hidden mines, their quiet events or its
      // car's name; the seat record carries preset indices and flags only.
      expect(foreignViews).toBe(0);
      expect(foreignHazards).toBe(0);
      expect(
        b.events.filter(
          (e) =>
            e.type === 'hazard' &&
            e.by !== b.seatView(1)!.car &&
            ['placed', 'armed'].includes(e.state),
        ),
      ).toEqual([]);
      expect([...rivalNames]).toEqual([PUBLIC_RIVAL_CAR_NAME]);
      for (const key of seatKeys)
        expect([
          'present',
          'connected',
          'host',
          'nickname',
          'emblem',
          'ready',
          'loaded',
          'vote',
          'car',
          'latencyMs',
          'graceEndsAt',
        ]).toContain(key);
      // The forged fields set nothing: the guest's car is unhurt and has not finished.
      const now = b.view()!;
      expect(now.finishedAtMs).toBeLessThan(0);
      expect(now.combat!.chassis).toBe(now.combat!.chassisMax);
      expect(b.state.phase).toBe('RACING');
      expect(b.left).toBeUndefined();

      // Garbage keeps coming: past the strike limit, the connection is closed.
      for (let i = 0; i < 20; i++) b.send(MatchClientMessage.PLAYER_INPUT, { inputs: 'nope' });
      await waitUntil(() => b.left !== undefined, 5_000, 'abuser closed');
      expect(b.left).toBe(CLOSE_CODE_ABUSE);
      expect(b.errors.some((e) => e.code === 'BAD_REQUEST')).toBe(true);
      b.stopDriving();
      // The other player's race carries on: the guest's car is on autopilot for the race grace.
      const tick = a.view()!.tick;
      await sleep(500);
      expect(a.view()!.tick).toBeGreaterThan(tick + 10);
      a.stopDriving();
      await a.leave();
    },
  );

  it('floods and oversized messages close the connection', { timeout: 30_000 }, async () => {
    const [a, b] = await lobby();
    for (let i = 0; i < 400; i++) a.send(MatchClientMessage.PING, { t: i });
    await waitUntil(() => a.left !== undefined, 5_000, 'flooder closed');
    expect(a.left).toBe(CLOSE_CODE_ABUSE);
    expect(a.errors.some((e) => e.code === 'RATE_LIMITED')).toBe(true);
    // A message over the 8 KB socket limit is refused by the socket itself: the server closes
    // with 1009 (message too big), which the client sees as that or as an abnormal close
    // (1006) when the socket is torn down before the close frame is read. Never answered.
    let pongs = 0;
    b.room.onMessage(MatchServerMessage.PONG, () => (pongs += 1));
    b.send(MatchClientMessage.PING, { t: 1, pad: 'x'.repeat(9_000) });
    await waitUntil(() => b.left !== undefined, 5_000, 'oversized closed');
    expect([1006, 1009]).toContain(b.left);
    expect(pongs).toBe(0);
  });

  it('code guesses are limited per address and per guest', { timeout: 30_000 }, async () => {
    const p = await player('guesser');
    const guest = await p.guestSession();
    const answers: number[] = [];
    for (let i = 0; i < 25; i++) {
      const code = `ZZZ${String(222 + i)
        .slice(-3)
        .replace(/[01]/g, '9')}`;
      const res = await post(
        '/api/v1/match/join',
        { protocolVersion: PROTOCOL_VERSION, code, profile: PROFILE, blueprint: tinker },
        guest.token,
      );
      answers.push(res.status);
      if (res.status === 429) {
        expect(res.body?.error?.code).toBe('RATE_LIMITED');
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      }
    }
    expect(answers).not.toContain(200);
    const firstLimited = answers.indexOf(429);
    expect(firstLimited).toBeGreaterThanOrEqual(0);
    expect(firstLimited).toBeLessThanOrEqual(20);
    expect(answers.slice(firstLimited).every((s) => s === 429)).toBe(true);
    // Up to the limit, a wrong code is the approved expired-invite answer.
    expect(answers.slice(0, firstLimited).every((s) => s === 404)).toBe(true);
  });
});
