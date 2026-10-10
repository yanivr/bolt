import { CITY_01, DEFAULT_LOADOUT, environmentFor, resolveLoadout } from '@bolt/content';
import type { CarSnapshot, ControlInput, DriveSession, InputSample } from '@bolt/shared';
import {
  buildTrack,
  countdownSeconds,
  createDriveSession,
  createDriverScratch,
  driveCenterline,
  raceTimeMs,
  stepDriveSession,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { OfflineLink } from '../../apps/web/src/network/offlineLink.js';
import { Predictor } from '../../apps/web/src/network/prediction.js';

const track = buildTrack(CITY_01);
const env = environmentFor('city_clear_night')!;
const resolved = resolveLoadout(DEFAULT_LOADOUT);
if (!resolved.ok) throw new Error('default loadout must resolve');
const params = resolved.params;

function snapshot(s: DriveSession, ack: number): CarSnapshot {
  return {
    tick: s.tick,
    ackSequence: ack,
    raceTimeMs: raceTimeMs(s),
    phase: s.phase,
    countdown: countdownSeconds(s),
    countdownTicks: s.phase === 'COUNTDOWN' ? Math.max(0, s.countdownTicks) : 0,
    motion: { ...s.motion },
    progress: { ...s.progress },
    bestLapMs: s.bestLapMs,
    lastLapMs: s.lastLapMs,
  };
}

/** Server stand-in: consumes one queued sample per tick, like the drive room. */
function harness(delayTicks: number, drop: (tick: number) => boolean = () => false) {
  const server = createDriveSession(track, env, params);
  const predictor = new Predictor(createDriveSession(track, env, params));
  const scratch = createDriverScratch();
  const wire: Array<{ at: number; sample: InputSample }> = [];
  const back: Array<{ at: number; snap: CarSnapshot }> = [];
  const queue: InputSample[] = [];
  let ack = -1;
  let last: ControlInput = { steer: 0, brake: 0, coast: true };
  const run = (ticks: number, from = 0) => {
    for (let tick = from; tick < from + ticks; tick++) {
      const control = driveCenterline(track, predictor.session.motion, params, env, scratch);
      const { sample } = predictor.step(control);
      if (!drop(tick)) wire.push({ at: tick + delayTicks, sample });
      while (wire.length > 0 && wire[0]!.at <= tick) queue.push(wire.shift()!.sample);
      const next = queue.shift();
      if (next) {
        ack = next.sequence;
        last = next;
      }
      stepDriveSession(server, last);
      if (tick % 2 === 0) back.push({ at: tick + delayTicks, snap: snapshot(server, ack) });
      while (back.length > 0 && back[0]!.at <= tick) predictor.reconcile(back.shift()!.snap);
    }
  };
  return { server, predictor, run };
}

describe('client prediction and reconciliation (Section 15.4)', () => {
  it('stays exactly on the authoritative car with zero latency', () => {
    const { server, predictor, run } = harness(0);
    run(30 * 20);
    expect(predictor.session.motion.x).toBeCloseTo(server.motion.x, 6);
    expect(predictor.session.motion.y).toBeCloseTo(server.motion.y, 6);
    expect(predictor.maxCorrection).toBeLessThan(1e-6);
  });

  it('replays unacknowledged input so 100 ms each way needs no visible correction', () => {
    const { predictor, run } = harness(3);
    run(30 * 25);
    expect(predictor.pendingCount).toBeGreaterThan(3);
    expect(predictor.pendingCount).toBeLessThan(12);
    // After the input queue fills at GO, prediction and authority agree to rounding error.
    expect(predictor.maxCorrection).toBeLessThan(0.5);
  });

  it('recovers from lost packets without a teleport and converges again', () => {
    const { server, predictor, run } = harness(
      3,
      (tick) => tick > 200 && tick < 900 && tick % 20 === 0,
    );
    run(30 * 30);
    expect(predictor.corrections).toBeGreaterThan(0);
    expect(predictor.maxCorrection).toBeLessThan(40);
    // Run on a clean link: the visual error decays and both cars keep lapping.
    run(30 * 5, 30 * 30);
    for (let i = 0; i < 60; i++) predictor.decayError(1 / 60);
    expect(Math.hypot(predictor.errorX, predictor.errorY)).toBeLessThan(0.5);
    expect(server.progress.lap).toBeGreaterThanOrEqual(1);
  });

  it('leads the server by the one-way delay, so its inputs land on the intended tick', () => {
    const { server, predictor, run } = harness(4);
    run(30 * 4);
    expect(server.phase).toBe('RACING');
    expect(predictor.session.phase).toBe('RACING');
    const lead = predictor.session.raceTicks - server.raceTicks;
    expect(lead).toBeGreaterThanOrEqual(3);
    expect(lead).toBeLessThanOrEqual(5);
  });
});

describe('offline link', () => {
  it('reports the same snapshots and events as an authority and ignores replayed samples', () => {
    const authority = createDriveSession(track, env, params);
    const link = new OfflineLink(authority);
    const snaps: CarSnapshot[] = [];
    link.onSnapshot = (s) => snaps.push(s);
    const sample: InputSample = { sequence: 1, clientTick: 1, steer: 0, brake: 0, coast: false };
    link.sendInputs([sample]);
    link.sendInputs([sample]);
    expect(authority.tick).toBe(1);
    expect(snaps.at(-1)!.ackSequence).toBe(1);
    link.resetCar();
    expect(snaps.at(-1)!.phase).toBe('COUNTDOWN');
  });
});
