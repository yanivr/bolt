import { CITY_01, DEFAULT_LOADOUT, environmentFor, resolveLoadout } from '@bolt/content';
import type { CarSnapshot, DriveSession, InputSample } from '@bolt/shared';
import {
  SIM_DT,
  buildTrack,
  countdownSeconds,
  createDriveSession,
  createDriverScratch,
  driveCenterline,
  mulberry32,
  raceTimeMs,
} from '@bolt/shared';
import { FramePacer, StepClock } from '../../apps/web/src/game/rendering/frame.js';
import { Predictor } from '../../apps/web/src/network/prediction.js';

/**
 * Netcode bench. A predicting client, a network with latency and jitter, and an authoritative
 * car, all on one simulated clock. It counts how often and how far the server has to correct
 * the client's own car, because every correction is a visible lurch.
 */

export type NetModel = {
  /** One-way latency, milliseconds. */
  latencyMs: number;
  /** Extra one-way delay, uniform from zero to this, milliseconds. Order is preserved. */
  jitterMs: number;
  /** Every so often the client misses frames for this long, milliseconds. Zero disables. */
  hitchMs: number;
  hitchEverySeconds: number;
  seed: number;
};

/** What the bench needs from the authoritative side. */
export type Authority = {
  session: DriveSession;
  receive: (samples: InputSample[]) => void;
  /** Advances one server tick. */
  tick: () => void;
  ackSequence: () => number;
};

export type NetResult = {
  seconds: number;
  /** Corrections larger than one world pixel. */
  corrections: number;
  correctionsPerMinute: number;
  worstPx: number;
  meanPx: number;
  /** Largest speed error the correction smoothing put on screen, world pixels per second. */
  worstVisibleSpeedError: number;
  finalLap: number;
};

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

export function benchSessions(): { client: DriveSession; server: DriveSession } {
  const track = buildTrack(CITY_01);
  const env = environmentFor('city_clear_night')!;
  const resolved = resolveLoadout(DEFAULT_LOADOUT);
  if (!resolved.ok) throw new Error('default loadout must resolve');
  return {
    client: createDriveSession(track, env, resolved.params),
    server: createDriveSession(track, env, resolved.params),
  };
}

/**
 * Runs the client loop exactly as the race scene does: frames paced and counted into fixed
 * steps by the shipped pacer and step clock, samples batched into packets, snapshots
 * reconciled as they arrive. `legacyClock` reproduces the loop this replaced, which threw
 * away any frame time beyond 100 ms.
 */
export function runNet(
  model: NetModel,
  seconds: number,
  makeAuthority: (session: DriveSession) => Authority,
  legacyClock = false,
): NetResult {
  const pacer = new FramePacer();
  const clock = new StepClock();
  const rng = mulberry32(model.seed);
  const { client, server } = benchSessions();
  const authority = makeAuthority(server);
  const predictor = new Predictor(client);
  const driver = createDriverScratch();
  const up: Array<{ at: number; samples: InputSample[] }> = [];
  const down: Array<{ at: number; snap: CarSnapshot }> = [];
  let lastUp = 0;
  let lastDown = 0;
  const delay = () => model.latencyMs + rng() * model.jitterMs;

  const frameMs = 1000 / 60;
  const stepMs = SIM_DT * 1000;
  let now = 0;
  let nextFrame = 0;
  let nextPump = 7.3;
  let nextPatch = 31.1;
  let nextHitch = model.hitchMs > 0 ? model.hitchEverySeconds * 1000 * (0.5 + rng()) : Infinity;
  let lastFrame = 0;
  let accumulator = 0;
  let serverAccumulator = 0;
  let lastPump = nextPump - stepMs / 2;
  let outbox: InputSample[] = [];
  let lastSend = 0;

  let corrections = 0;
  let worst = 0;
  let sum = 0;
  let worstSpeed = 0;
  let seen = 0;

  const end = seconds * 1000;
  while (now < end) {
    now = Math.min(nextFrame, nextPump, nextPatch);

    if (now === nextPump) {
      nextPump += stepMs / 2;
      serverAccumulator = Math.min(serverAccumulator + (now - lastPump), stepMs * 5);
      lastPump = now;
      while (up.length > 0 && up[0]!.at <= now) authority.receive(up.shift()!.samples);
      while (serverAccumulator >= stepMs) {
        serverAccumulator -= stepMs;
        authority.tick();
      }
      continue;
    }

    if (now === nextPatch) {
      nextPatch += 1000 / 15;
      const at = Math.max(lastDown, now + delay());
      lastDown = at;
      down.push({ at, snap: snapshot(authority.session, authority.ackSequence()) });
      continue;
    }

    // Client frame.
    nextFrame += frameMs;
    if (now >= nextHitch) {
      nextFrame += model.hitchMs;
      nextHitch = now + model.hitchEverySeconds * 1000 * (0.5 + rng());
    }
    while (down.length > 0 && down[0]!.at <= now) {
      const before = predictor.corrections;
      const ex = predictor.errorX;
      const ey = predictor.errorY;
      predictor.reconcile(down.shift()!.snap);
      if (predictor.corrections > before) {
        const size = Math.hypot(predictor.errorX - ex, predictor.errorY - ey);
        if (size > 1) {
          corrections++;
          sum += size;
          worst = Math.max(worst, size);
        }
      }
    }
    let dt: number;
    let steps: number;
    if (legacyClock) {
      dt = Math.min(0.1, (now - lastFrame) / 1000);
      accumulator = Math.min(accumulator + dt, SIM_DT * 5);
      steps = Math.floor(accumulator / SIM_DT);
      accumulator -= steps * SIM_DT;
    } else {
      dt = pacer.advance(now);
      steps = clock.advance(dt);
    }
    lastFrame = now;
    for (let i = 0; i < steps; i++) {
      const control = driveCenterline(client.track, client.motion, client.params, client.env, driver);
      outbox.push(predictor.step(control).sample);
      if (outbox.length >= 2 || now - lastSend > 60) {
        const at = Math.max(lastUp, now + delay());
        lastUp = at;
        up.push({ at, samples: outbox });
        outbox = [];
        lastSend = now;
      }
    }
    const ex = predictor.errorX;
    const ey = predictor.errorY;
    predictor.decayError(dt);
    if (dt > 0) {
      const speed = Math.hypot(predictor.errorX - ex, predictor.errorY - ey) / dt;
      worstSpeed = Math.max(worstSpeed, speed);
    }
    seen++;
  }
  void seen;
  return {
    seconds,
    corrections,
    correctionsPerMinute: (corrections / seconds) * 60,
    worstPx: worst,
    meanPx: corrections > 0 ? sum / corrections : 0,
    worstVisibleSpeedError: worstSpeed,
    finalLap: client.progress.lap,
  };
}

export const NETWORKS: Array<{ name: string; model: NetModel }> = [
  { name: 'ideal LAN, steady frames', model: { latencyMs: 4, jitterMs: 0, hitchMs: 0, hitchEverySeconds: 0, seed: 11 } },
  { name: 'home WiFi 15 ms + 0-12 ms jitter', model: { latencyMs: 15, jitterMs: 12, hitchMs: 0, hitchEverySeconds: 0, seed: 12 } },
  { name: 'WiFi + 70 ms frame hitch every ~3 s', model: { latencyMs: 15, jitterMs: 12, hitchMs: 70, hitchEverySeconds: 3, seed: 13 } },
  { name: 'mobile data 60 ms + 0-45 ms jitter', model: { latencyMs: 60, jitterMs: 45, hitchMs: 0, hitchEverySeconds: 0, seed: 14 } },
  { name: 'mobile data + 110 ms hitch every ~4 s', model: { latencyMs: 60, jitterMs: 45, hitchMs: 110, hitchEverySeconds: 4, seed: 15 } },
];

export function formatNet(name: string, r: NetResult): string {
  const f = (v: number, d = 1) => v.toFixed(d).padStart(7);
  return `${name.padEnd(40)} ${String(r.corrections).padStart(5)} ${f(r.correctionsPerMinute)} ${f(r.worstPx)} ${f(r.meanPx)} ${f(r.worstVisibleSpeedError, 0)} ${String(r.finalLap).padStart(4)}`;
}
export const NET_HEADER =
  'network                                  corrections  /min  worst px  mean px  worst speed err px/s  lap';
