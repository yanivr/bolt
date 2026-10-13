import { getTemplate } from '@bolt/content';
import type { RaceEvent, VehicleBlueprint } from '@bolt/shared';
import { STRINGS } from '@bolt/content';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../apps/server/src/telemetry/log.js';
import type { TestServer } from '../helpers/server.js';
import { startTestServer } from '../helpers/server.js';
import type { HeadlessPlayer as Player, TrackPoint } from './headless.js';
import { HeadlessPlayer, percentile, sleep, waitUntil } from './headless.js';
import type { LinkProfile } from './netsim.js';
import { NetSim } from './netsim.js';

/**
 * Race a Friend end to end over real WebSockets (Milestone E): two headless colyseus.js
 * players, each behind its own simulated mobile network, open and join a lobby, build, race,
 * damage each other, repair, finish, see identical results and rematch, through the same
 * HTTP routes, seat reservations, room messages and state views as the browser.
 *
 * The networks are asymmetric: a fast phone (40 ms each way, so an 80 ms round trip, 30 ms
 * jitter) and a slow one (100 ms each way, 200 ms round trip, 30 ms jitter, and 2% of TCP
 * chunks stalled for a retransmission timeout). Both lose 2% of their input packets and
 * reorder another 2% at the application level, which TCP alone cannot do.
 *
 * Desynchronization is checked where it would show: the two players' views of the same car at
 * the same room tick must be identical, every hit both saw must be the same hit, and the two
 * results must be equal to the last field. Prediction quality is the count and size of the
 * corrections each client's predictor had to make to its own car.
 *
 * Races are one lap (`MatchRoomTuning.laps`) and the lobby clocks are short so the file runs in
 * a few minutes of real time; nothing else about the room differs from production.
 */

const FAST: LinkProfile = { latencyMs: 40, jitterMs: 30, lossRate: 0, seed: 11 };
const SLOW: LinkProfile = {
  latencyMs: 100,
  jitterMs: 30,
  lossRate: Number(process.env.BOLT_NET_SLOW_LOSS ?? 0.02),
  seed: 12,
};
const APP_LOSS = { dropInputRate: 0.02, reorderInputRate: 0.02 };
const LAPS = 1;

const TIMING = {
  trackRevealMs: 3_000,
  buildMs: 6_000,
  loadMs: 8_000,
  lobbyGraceMs: 6_000,
  buildGraceMs: 4_000,
  raceGraceMs: 5_000,
  resultsGraceMs: 6_000,
};

const tinker = getTemplate('starter_tinker')!.blueprint;
const packhorse = getTemplate('starter_packhorse')!.blueprint;
const sprinter = getTemplate('starter_sprinter')!.blueprint;

let ctx: TestServer;
const sims: NetSim[] = [];
const players: Player[] = [];

beforeAll(async () => {
  ctx = await startTestServer({
    logger: createLogger({ level: 'error' }),
    match: {
      timing: TIMING,
      laps: LAPS,
      inputPolicy: process.env.BOLT_NET_POLICY
        ? (JSON.parse(process.env.BOLT_NET_POLICY) as object)
        : {},
    },
  });
});

afterAll(async () => {
  for (const p of players) p.stopDriving();
  for (const s of sims) await s.close();
  await ctx.stop();
}, 30_000);

async function link(profile: LinkProfile): Promise<NetSim> {
  const sim = new NetSim(ctx.port, profile);
  await sim.listen();
  sims.push(sim);
  return sim;
}

async function pair(seed: number): Promise<[Player, Player, NetSim, NetSim]> {
  const fast = await link({ ...FAST, seed: FAST.seed + seed });
  const slow = await link({ ...SLOW, seed: SLOW.seed + seed });
  const a = new HeadlessPlayer('fast', fast, { ...APP_LOSS, seed: 100 + seed }, LAPS);
  const b = new HeadlessPlayer('slow', slow, { ...APP_LOSS, seed: 200 + seed }, LAPS);
  players.push(a, b);
  return [a, b, fast, slow];
}

/** Lobby to building: both seated, the host picks Neon Cut at night and starts the build. */
async function toBuilding(
  a: Player,
  b: Player,
  guestBuild: VehicleBlueprint = sprinter,
): Promise<void> {
  const code = await a.create(tinker, { nickname: 1, emblem: 2 });
  const joined = await b.join(code, guestBuild, { nickname: 3, emblem: 4 });
  expect(joined.status).toBe(200);
  await waitUntil(() => a.seatView(1)?.present === true, 5_000, 'guest seen by host');
  a.selectTrack('city_01', 'city_clear_night');
  a.lockTrack();
  await a.waitPhase('TRACK_REVEAL');
  await b.waitPhase('TRACK_REVEAL');
  a.roomReady();
  b.roomReady();
  await a.waitPhase('BUILDING');
  await b.waitPhase('BUILDING');
}

/** Both players hold the build the room locked for the race it just created. */
async function bothLocked(a: Player, b: Player): Promise<void> {
  const id = a.state.raceId;
  await waitUntil(
    () => a.locked?.raceId === id && b.locked?.raceId === id && b.state.raceId === id,
    8_000,
    'locked builds',
  );
}

/** From a locked build to the green light: both drive and both say the race has loaded. */
async function toRacing(a: Player, b: Player): Promise<void> {
  await a.waitPhase('VS_REVEAL', 15_000);
  await bothLocked(a, b);
  a.startDriving();
  b.startDriving();
  a.roomReady();
  b.roomReady();
  await a.waitPhase('RACING', 15_000);
}

/** The largest difference between two players' records of one car at the same room ticks. */
function compareTracks(mine: Map<number, TrackPoint>, theirs: Map<number, TrackPoint>) {
  let common = 0;
  let worstPos = 0;
  let worstChassis = 0;
  for (const [tick, p] of mine) {
    const q = theirs.get(tick);
    if (!q) continue;
    common += 1;
    worstPos = Math.max(worstPos, Math.hypot(p.x - q.x, p.y - q.y));
    worstChassis = Math.max(worstChassis, Math.abs(p.chassis - q.chassis));
  }
  return { common, worstPos, worstChassis };
}

function hitsById(events: RaceEvent[]): Map<number, RaceEvent> {
  const out = new Map<number, RaceEvent>();
  for (const e of events) if (e.type === 'hit') out.set(e.id, e);
  return out;
}

function report(label: string, data: unknown): void {
  // One line per measurement, picked up for docs/MULTIPLAYER.md.
  console.info(`NETREPORT ${label} ${JSON.stringify(data)}`);
}

describe('Race a Friend over a simulated mobile network', () => {
  it(
    'invites, builds, races, damages, repairs, finishes and rematches without desync',
    { timeout: 240_000 },
    async () => {
      const [a, b, fast, slow] = await pair(0);
      await toBuilding(a, b);

      // --- Build phase: the server owns the deadline, refuses an illegal build with the
      // approved copy, and at the deadline locks the guest's last legal submission although the
      // guest never pressed Ready.
      const endsIn = a.state.phaseEndsAt - Date.now();
      expect(endsIn).toBeGreaterThan(3_000);
      expect(endsIn).toBeLessThanOrEqual(TIMING.buildMs + 200);
      const illegal = structuredClone(packhorse);
      illegal.parts[0]!.partId = 'weapon_does_not_exist';
      const bad = b.submit(illegal);
      const good = b.submit(packhorse);
      await waitUntil(() => !!b.buildResult(bad) && !!b.buildResult(good), 5_000, 'build answers');
      const refused = b.buildResult(bad)!;
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.code).toBe('UNKNOWN_PART');
        expect(refused.message).not.toMatch(/—|--/);
      }
      expect(b.buildResult(good)!.ok).toBe(true);
      // Neither copy of the refused build reached the rival: only the readiness flags did.
      const readyA = a.ready(tinker);
      await waitUntil(() => b.seatView(0)?.ready === true, 3_000, 'host ready seen by guest');
      expect(a.buildResult(readyA)!.ok).toBe(true);
      expect(a.seatView(1)?.ready).toBe(false);
      await a.waitPhase('VS_REVEAL', TIMING.buildMs + 3_000);
      const lockedAt = Date.now();
      expect(lockedAt).toBeGreaterThanOrEqual(a.state.phaseEndsAt - TIMING.loadMs - 500);
      await waitUntil(() => !!b.locked && !!a.locked, 5_000, 'locks');
      expect(b.locked!.blueprint.name).toBe(packhorse.name);
      expect(b.locked!.buildHash).toBe((b.buildResult(good) as { buildHash: string }).buildHash);

      // --- Race one, with a 1.5 s outage on the slow phone part way through.
      await toRacing(a, b);
      const raceOne = a.state.raceId;
      const carOfA = a.seatView(a.seat)!.car;
      const carOfB = b.seatView(b.seat)!.car;
      expect(carOfA).not.toBe(carOfB);
      fast.resetCounters();
      slow.resetCounters();
      const racingFrom = Date.now();
      await sleep(8_000);
      const before = { tick: a.stats.lastTick, at: Date.now() };
      a.stats.worstTickGapMs = 0;
      slow.blackout(1_500);
      await sleep(2_500);
      const during = {
        worstGapMs: a.stats.worstTickGapMs,
        ticks: a.stats.lastTick - before.tick,
        ms: a.stats.lastTickAt - before.at,
      };
      // The fast phone's room clock did not wait for the slow one.
      expect(during.worstGapMs).toBeLessThan(250);
      expect((during.ticks / during.ms) * 1000).toBeGreaterThan(27);
      report('outage', during);

      await waitUntil(
        () =>
          a.results.some((r) => r.raceId === raceOne) &&
          b.results.some((r) => r.raceId === raceOne),
        150_000,
        'race one results',
      );
      const racingSeconds = (Date.now() - racingFrom) / 1000;
      const resultA = a.results.find((r) => r.raceId === raceOne)!.result;
      const resultB = b.results.find((r) => r.raceId === raceOne)!.result;
      // One authoritative result, the same for both, to the last field.
      expect(resultB).toEqual(resultA);
      expect(resultA.reason).not.toBe('forfeit');
      expect(resultA.cars).toHaveLength(2);

      // The same car, as each player saw it at the same room tick, is the same car.
      const ownVsRival = compareTracks(a.ownTrack, b.rivalTrack);
      const rivalVsOwn = compareTracks(b.ownTrack, a.rivalTrack);
      expect(ownVsRival.common).toBeGreaterThan(300);
      expect(rivalVsOwn.common).toBeGreaterThan(300);
      expect(ownVsRival.worstPos).toBeLessThan(0.01);
      expect(rivalVsOwn.worstPos).toBeLessThan(0.01);
      expect(ownVsRival.worstChassis).toBe(0);
      expect(rivalVsOwn.worstChassis).toBe(0);

      // Damage both ways, and every hit both players saw is the same hit.
      const hitsA = hitsById(a.events);
      const hitsB = hitsById(b.events);
      expect([...hitsA.keys()].sort()).toEqual([...hitsB.keys()].sort());
      for (const [id, hit] of hitsA) expect(hitsB.get(id)).toEqual(hit);
      const hitsOn = (car: number) =>
        [...hitsA.values()].filter((h) => h.type === 'hit' && h.car === car).length;
      expect(hitsOn(carOfA)).toBeGreaterThan(0);
      expect(hitsOn(carOfB)).toBeGreaterThan(0);
      const repairs = a.events.filter(
        (e) => e.type === 'utility' && e.utility.includes('repair') && e.state === 'done',
      );
      expect(repairs.length).toBeGreaterThan(0);

      // Prediction: corrections to each player's own car stay few and small. Thresholds and why
      // are in docs/MULTIPLAYER.md (Measured).
      const minutes = racingSeconds / 60;
      const summary = (p: Player, sim: NetSim) => {
        const { correctionSizes, ...rest } = p.stats;
        return {
          ...rest,
          perMinute: p.stats.corrections / minutes,
          p50: percentile(correctionSizes, 0.5),
          p95: percentile(correctionSizes, 0.95),
          upStalls: sim.up.stalls,
          downStalls: sim.down.stalls,
          net: p.view()?.net,
        };
      };
      report('race', {
        seconds: Math.round(racingSeconds),
        fast: summary(a, fast),
        slow: summary(b, slow),
        hits: { onFast: hitsOn(carOfA), onSlow: hitsOn(carOfB) },
        repairs: repairs.length,
        desync: { ownVsRival, rivalVsOwn },
      });
      // Both players' state arrived in order: no update ever went back in time or named a tick
      // already seen with different contents.
      for (const p of [a, b]) {
        expect(p.stats.tickBackwards).toBe(0);
        expect(p.stats.relabels).toBe(0);
        expect(p.stats.sameTickMoves).toBe(0);
      }
      // The fast phone loses 2% of its input packets and has 2% reordered. A lost tick runs on the
      // repeated control, which is nearly always the control sent; each change of the room's input
      // delay moves the car one tick against the prediction (about 9.5 px at speed), once.
      expect(a.stats.corrections / minutes).toBeLessThan(30);
      expect(a.stats.worstCorrectionPx).toBeLessThan(15);
      // The slow phone also has TCP stalls of 400 ms, longer than any input delay worth having,
      // and a 1.5 s outage that outlasts the 0.5 s after which the autopilot takes the car. Each
      // stall is at most a few corrections; they stay small.
      expect(b.stats.corrections).toBeLessThanOrEqual(
        3 * slow.up.stalls + 2 * b.stats.packetsDropped + 10,
      );
      expect(percentile(b.stats.correctionSizes, 0.5)).toBeLessThan(10);
      expect(b.stats.worstCorrectionPx).toBeLessThan(45);
      expect(a.stats.tickRate).toBeGreaterThan(28);
      expect(b.stats.tickRate).toBeGreaterThan(28);

      // Bandwidth per client over the racing part.
      const bandwidth = {
        fastDown: fast.down.bytes / racingSeconds,
        fastUp: fast.up.bytes / racingSeconds,
        slowDown: slow.down.bytes / racingSeconds,
        slowUp: slow.up.bytes / racingSeconds,
      };
      report('bandwidth', bandwidth);
      for (const down of [bandwidth.fastDown, bandwidth.slowDown]) expect(down).toBeLessThan(8_000);
      for (const up of [bandwidth.fastUp, bandwidth.slowUp]) expect(up).toBeLessThan(4_000);

      // --- Rematch: both ask to swap cars; nothing starts until both have.
      await a.waitPhase('RESULTS', 10_000);
      a.vote('swap');
      await sleep(800);
      expect(a.state.phase).toBe('REMATCH_VOTE');
      expect(b.seatView(0)?.vote).toBe('swap');
      b.vote('swap');
      await a.waitPhase('VS_REVEAL', 5_000);
      await bothLocked(a, b);
      expect(a.state.swapped).toBe(true);
      expect(a.locked!.buildHash).toBe((b.buildResult(good) as { buildHash: string }).buildHash);
      expect(b.locked!.blueprint.name).toBe(tinker.name);
      await toRacing(a, b);
      const raceTwo = a.state.raceId;
      expect(raceTwo).toBe(raceOne + 1);
      const swappedCarOfA = a.seatView(a.seat)!.car;
      const swappedCarOfB = b.seatView(b.seat)!.car;
      expect(swappedCarOfA).not.toBe(carOfA);
      const eventsBefore = [a.events.length, b.events.length];
      await sleep(4_000);
      // The second race's events reach both: ids carry on from the first race, so a client that
      // drops repeats by id does not drop them.
      expect(a.events.length).toBeGreaterThan(eventsBefore[0]!);
      expect(b.events.length).toBeGreaterThan(eventsBefore[1]!);
      // The guest leaves on purpose: a forfeit, not a finish, and the host wins it.
      await b.leave();
      await waitUntil(() => a.results.some((r) => r.raceId === raceTwo), 10_000, 'forfeit result');
      const forfeit = a.results.find((r) => r.raceId === raceTwo)!.result;
      expect(forfeit.reason).toBe('forfeit');
      expect(forfeit.forfeit).toEqual({ car: swappedCarOfB, cause: 'left' });
      expect(forfeit.winner).toBe(swappedCarOfA);
      await a.waitPhase('RESULTS', 10_000);
      expect(a.seatView(1)?.present).toBe(false);
      await a.leave();
    },
  );

  it(
    'a phone that drops during the build gets its seat back with its build',
    { timeout: 60_000 },
    async () => {
      const [a, b, , slow] = await pair(1);
      await toBuilding(a, b);
      const id = b.submit(packhorse);
      await waitUntil(() => !!b.buildResult(id), 3_000, 'build saved');
      slow.cut();
      await waitUntil(() => a.seatView(1)?.connected === false, 3_000, 'drop seen by host');
      expect(a.state.phase).toBe('BUILDING');
      await sleep(500);
      await b.reconnect();
      await waitUntil(() => a.seatView(1)?.connected === true, 3_000, 'guest back');
      expect(b.seat).toBe(1);
      expect(b.state.phase).toBe('BUILDING');
      a.ready(tinker);
      b.ready(packhorse);
      await a.waitPhase('VS_REVEAL', 5_000);
      await waitUntil(() => !!b.locked, 3_000, 'guest lock');
      expect(b.locked!.blueprint.name).toBe(packhorse.name);
      await a.leave();
      await b.leave();
    },
  );

  it(
    'a phone gone for the whole build grace cancels the build with no winner',
    { timeout: 60_000 },
    async () => {
      const [a, b, , slow] = await pair(2);
      await toBuilding(a, b);
      b.stopDriving();
      // The proxy stays down for this player: every reconnection attempt would fail too.
      await slow.close();
      await waitUntil(() => a.seatView(1)?.connected === false, 3_000, 'drop seen');
      await waitUntil(
        () => a.state.phase === 'WAITING_FOR_OPPONENT',
        TIMING.buildGraceMs + 4_000,
        'back to the lobby',
      );
      expect(a.state.notice).toBe('build_cancelled');
      expect(a.results).toHaveLength(0);
      expect(a.seatView(1)?.present).toBe(false);
      expect(STRINGS.match.notices.build_cancelled.length).toBeGreaterThan(0);
      await a.leave();
    },
  );

  it(
    'a phone that drops mid-race is driven by the autopilot and takes its car back unchanged',
    { timeout: 200_000 },
    async () => {
      const [a, b, , slow] = await pair(3);
      await toBuilding(a, b, packhorse);
      a.ready(tinker);
      b.ready(packhorse);
      await toRacing(a, b);
      const raceId = a.state.raceId;
      await sleep(5_000);
      const carOfB = b.seatView(1)!.car;
      slow.cut();
      await waitUntil(() => a.seatView(1)?.connected === false, 3_000, 'drop seen');
      const droppedAt = a.stats.lastTick;
      const atDrop = a.rivalTrack.get(droppedAt)!;
      await sleep(2_500);
      // The autopilot kept the dropped car going: it moved on while nobody drove it.
      const lastSeen = a.rivalTrack.get(a.stats.lastTick)!;
      expect(Math.hypot(lastSeen.x - atDrop.x, lastSeen.y - atDrop.y)).toBeGreaterThan(100);
      await b.reconnect();
      await waitUntil(() => a.seatView(1)?.connected === true, 3_000, 'guest back');
      // Its first view after coming back is the same car the host was watching: same place,
      // same damage, nothing reset.
      await waitUntil(
        () => b.ownTrack.size > 0 && [...b.ownTrack.keys()].some((t) => t > a.stats.lastTick - 5),
        5_000,
        'own view again',
      );
      const tick = Math.max(...[...b.ownTrack.keys()].filter((t) => a.rivalTrack.has(t)));
      const mine = b.ownTrack.get(tick)!;
      const seen = a.rivalTrack.get(tick)!;
      expect(Math.hypot(mine.x - seen.x, mine.y - seen.y)).toBeLessThan(0.01);
      expect(mine.chassis).toBe(seen.chassis);
      await waitUntil(
        () =>
          a.results.some((r) => r.raceId === raceId) && b.results.some((r) => r.raceId === raceId),
        150_000,
        'results',
      );
      const ra = a.results.find((r) => r.raceId === raceId)!.result;
      expect(b.results.find((r) => r.raceId === raceId)!.result).toEqual(ra);
      expect(ra.reason).not.toBe('forfeit');
      expect(ra.cars[carOfB]!.finished || ra.cars[carOfB]!.courseProgress > 0).toBe(true);
      report('reconnect', { slow: b.stats });
      await a.leave();
      await b.leave();
    },
  );

  it(
    'a phone that never comes back forfeits the race as disconnected',
    { timeout: 90_000 },
    async () => {
      const [a, b, , slow] = await pair(4);
      await toBuilding(a, b, packhorse);
      a.ready(tinker);
      b.ready(packhorse);
      await toRacing(a, b);
      const raceId = a.state.raceId;
      await sleep(3_000);
      const carOfA = a.seatView(0)!.car;
      b.stopDriving();
      await slow.close();
      const goneAt = Date.now();
      await waitUntil(
        () => a.results.some((r) => r.raceId === raceId),
        TIMING.raceGraceMs + 5_000,
        'forfeit',
      );
      const waited = Date.now() - goneAt;
      expect(waited).toBeGreaterThan(TIMING.raceGraceMs - 500);
      const result = a.results.find((r) => r.raceId === raceId)!.result;
      expect(result.reason).toBe('forfeit');
      expect(result.forfeit?.cause).toBe('disconnected');
      expect(result.winner).toBe(carOfA);
      await a.waitPhase('RESULTS', 10_000);
      await waitUntil(() => a.seatView(1)?.present === false, 5_000, 'seat freed');
      await a.leave();
    },
  );
});
