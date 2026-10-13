import type { ControlInput, InputSample } from '@bolt/shared';
import { DEFAULT_TICK_INPUT_POLICY, TickInputBuffer, mulberry32 } from '@bolt/shared';
import { describe, expect, it } from 'vitest';

/**
 * The room's input policy (Milestone E, docs/MULTIPLAYER.md "Ticks and input"): one control per
 * room tick, whatever arrives; a missing sample stands in as the last control; late samples are
 * dropped and counted; the delay adapts in whole ticks; a client that fell behind is anchored
 * again.
 */

function sample(
  sequence: number,
  steer = sequence / 1000,
  extra: Partial<InputSample> = {},
): InputSample {
  return { sequence, clientTick: sequence, steer, brake: 0, coast: false, ...extra };
}

function rig(policy: Partial<typeof DEFAULT_TICK_INPUT_POLICY> = {}) {
  const buffer = new TickInputBuffer(policy);
  const applied: Array<ControlInput & { outcome: string; ack: number }> = [];
  const tick = () => {
    const out: ControlInput = { steer: 0, brake: 0, coast: true };
    const outcome = buffer.step(out);
    applied.push({ ...out, outcome, ack: buffer.ackSequence });
    return outcome;
  };
  return { buffer, applied, tick };
}

describe('the room input buffer', () => {
  it('waits for the initial delay, then consumes one sample per tick, in order', () => {
    const { buffer, applied, tick } = rig();
    buffer.accept([sample(10), sample(11)]);
    expect(tick()).toBe('idle');
    expect(buffer.ackSequence).toBe(-1);
    buffer.accept([sample(12), sample(13)]);
    for (let s = 14; s < 40; s++) {
      expect(tick()).toBe('sample');
      buffer.accept([sample(s)]);
    }
    const used = applied.filter((a) => a.outcome === 'sample');
    // Anchored at the oldest sample it held: the first number ever sent.
    expect(used[0]!.ack).toBe(10);
    expect(used.map((a) => a.ack)).toEqual(Array.from({ length: used.length }, (_, i) => 10 + i));
    expect(used.map((a) => a.steer)).toEqual(used.map((a) => a.ack / 1000));
    expect(buffer.stats.missing).toBe(0);
    expect(buffer.delayTicks).toBe(DEFAULT_TICK_INPUT_POLICY.initialDelay);
  });

  it('never waits: a missing sample is the last control again, and its number is spent', () => {
    const { buffer, applied, tick } = rig();
    buffer.accept([sample(0, 0.1), sample(1, 0.2), sample(2, 0.3)]);
    tick();
    tick();
    tick();
    // Nothing for the next tick: the car steers as it last did, and the number is used up.
    expect(tick()).toBe('repeat');
    expect(applied.at(-1)!.steer).toBe(0.3);
    expect(buffer.ackSequence).toBe(3);
    // The sample for that tick arrives late and is dropped; the next one is on time.
    buffer.accept([sample(3, -1), sample(4, 0.5)]);
    expect(buffer.stats.late).toBe(1);
    expect(tick()).toBe('sample');
    expect(applied.at(-1)!.steer).toBe(0.5);
    expect(buffer.ackSequence).toBe(4);
  });

  it('repeats for at most the stale limit, then treats the driver as absent', () => {
    const { buffer, applied, tick } = rig();
    buffer.accept([sample(0, 1), sample(1, 1), sample(2, 1)]);
    for (let i = 0; i < 3; i++) tick();
    for (let i = 0; i < DEFAULT_TICK_INPUT_POLICY.staleTicks; i++) expect(tick()).toBe('repeat');
    expect(buffer.absent).toBe(false);
    expect(tick()).toBe('absent');
    expect(applied.at(-1)).toMatchObject({ steer: 0, brake: 0, coast: true, fire: 0 });
    expect(buffer.absent).toBe(true);
    // Every tick still spent a number: the room's clock and the numbering stay together.
    expect(buffer.ackSequence).toBe(2 + DEFAULT_TICK_INPUT_POLICY.staleTicks + 1);
  });

  it('is neutral at once when the client says it went away, until a fresh sample comes', () => {
    const { buffer, applied, tick } = rig();
    buffer.accept([sample(0, 1), sample(1, 1), sample(2, 1)]);
    tick();
    buffer.markAway();
    expect(buffer.absent).toBe(true);
    tick();
    tick();
    expect(tick()).toBe('absent');
    expect(applied.at(-1)!.steer).toBe(0);
    buffer.accept([sample(4, 0.25), sample(5, 0.25)]);
    expect(buffer.absent).toBe(false);
    expect(tick()).toBe('sample');
    expect(applied.at(-1)!.steer).toBe(0.25);
  });

  it('grows the delay by one tick after repeated isolated misses, without spending a number', () => {
    const { buffer, tick } = rig();
    let next = 0;
    for (; next < 3; next++) buffer.accept([sample(next)]);
    // Drain to a buffer that holds exactly the sample each tick needs.
    while (buffer.queued > 0) tick();
    let grewAt = -1;
    let ackBeforeGrow = -1;
    for (let t = 0; t < 60 && grewAt < 0; t++) {
      if (t % 10 === 9) {
        // Jitter: this tick's sample is a tick late. The tick misses it, and it comes with
        // the next one.
        const ack = buffer.ackSequence;
        tick();
        if (buffer.stats.grown > 0 && grewAt < 0) {
          grewAt = t;
          ackBeforeGrow = ack;
        }
        next++;
      } else {
        const late = t % 10 === 0 && t > 0 ? [sample(next - 1)] : [];
        buffer.accept([...late, sample(next++)]);
        tick();
      }
    }
    // The third isolated miss within the window grew the delay; that tick did not spend a
    // number, so the late sample of that tick is on time after all.
    expect(grewAt).toBe(29);
    expect(buffer.delayTicks).toBe(DEFAULT_TICK_INPUT_POLICY.initialDelay + 1);
    expect(ackBeforeGrow).toBeGreaterThan(0);
    // The two misses before it spent their numbers, so their samples came late and were dropped.
    expect(buffer.stats.late).toBe(2);
  });

  it('does not grow for lost samples: a sample that never comes is no evidence of jitter', () => {
    const { buffer, tick } = rig();
    let next = 0;
    for (; next < 3; next++) buffer.accept([sample(next)]);
    while (buffer.queued > 0) tick();
    for (let t = 0; t < 600; t++) {
      // One sample in ten is lost on the way and never arrives; the rest are on time.
      if (t % 10 !== 9) buffer.accept([sample(next)]);
      next++;
      tick();
    }
    expect(buffer.stats.missing).toBe(60);
    expect(buffer.stats.late).toBe(0);
    expect(buffer.stats.grown).toBe(0);
    expect(buffer.delayTicks).toBe(DEFAULT_TICK_INPUT_POLICY.initialDelay);
  });

  it('does not grow for a stall: a run of misses is taken as repeated controls', () => {
    const { buffer, tick } = rig();
    let next = 0;
    for (; next < 3; next++) buffer.accept([sample(next)]);
    while (buffer.queued > 0) tick();
    const held: InputSample[] = [];
    for (let t = 0; t < 6 * 50; t++) {
      const s = sample(next++);
      // Every 50 ticks the network holds everything for eight ticks (a lost TCP segment),
      // then delivers it at once. The client keeps time throughout.
      if (t % 50 < 8) held.push(s);
      else {
        if (held.length > 0) buffer.accept(held.splice(0));
        buffer.accept([s]);
      }
      tick();
    }
    expect(buffer.stats.missing).toBeGreaterThanOrEqual(6 * 7);
    expect(buffer.stats.grown).toBe(0);
    expect(buffer.stats.reanchors).toBe(0);
  });

  it('shrinks by exactly one number when the buffer was deeper than needed for a whole window', () => {
    const policy = DEFAULT_TICK_INPUT_POLICY;
    const { buffer, applied, tick } = rig();
    let next = 0;
    // Always five samples ahead: one more than the shrink slack.
    for (; next < policy.shrinkSlack + 2; next++) buffer.accept([sample(next)]);
    for (let t = 0; t < policy.shrinkWindow + 5; t++) {
      tick();
      buffer.accept([sample(next++)]);
    }
    expect(buffer.stats.shrunk).toBe(1);
    const acks = applied.filter((a) => a.outcome === 'sample').map((a) => a.ack);
    const jumps = acks.slice(1).map((a, i) => a - acks[i]!);
    // Exactly one tick skipped a number; every other tick spent one.
    expect(jumps.filter((j) => j === 2)).toHaveLength(1);
    expect(jumps.every((j) => j === 1 || j === 2)).toBe(true);
    expect(buffer.delayTicks).toBe(policy.initialDelay - 1);
  });

  it('drains fast when it is far deeper than any network needs', () => {
    const { buffer, tick } = rig();
    let next = 0;
    // The room stalled for half a second while the client kept sending: 18 samples waiting.
    for (; next < 18; next++) buffer.accept([sample(next)]);
    for (let t = 0; t < 150; t++) {
      tick();
      buffer.accept([sample(next++)]);
    }
    expect(buffer.stats.shrunk).toBeGreaterThanOrEqual(5);
    expect(buffer.queued).toBeLessThanOrEqual(2 * DEFAULT_TICK_INPUT_POLICY.shrinkSlack + 1);
  });

  it('skips duplicates, refuses what is too far ahead, and keeps going', () => {
    const { buffer, tick } = rig();
    buffer.accept([sample(0), sample(1), sample(2), sample(1), sample(2)]);
    expect(buffer.stats.duplicates).toBe(2);
    tick();
    buffer.accept([sample(1000)]);
    expect(buffer.stats.overflow).toBe(1);
    expect(tick()).toBe('sample');
  });

  it('anchors again when packets keep arriving behind the room, as after a frozen page', () => {
    const { buffer, applied, tick } = rig();
    let next = 0;
    for (; next < 3; next++) buffer.accept([sample(next)]);
    for (let t = 0; t < 30; t++) {
      tick();
      buffer.accept([sample(next++)]);
    }
    // The page freezes for a second: the room runs 30 ticks on stand-ins, the client sends
    // nothing and its clock loses that time.
    for (let t = 0; t < 30; t++) tick();
    const ackBefore = buffer.ackSequence;
    expect(next).toBeLessThan(ackBefore);
    // It resumes numbering where it stopped; every packet is now behind the room.
    for (let t = 0; t < DEFAULT_TICK_INPUT_POLICY.reanchorLag + 6; t++) {
      buffer.accept([sample(next++, -0.5)]);
      tick();
    }
    expect(buffer.stats.reanchors).toBe(1);
    expect(applied.at(-1)!.outcome).toBe('sample');
    expect(applied.at(-1)!.steer).toBe(-0.5);
  });

  it('does not anchor again when a burst of late packets ends with ones on time', () => {
    const { buffer, tick } = rig();
    let next = 0;
    for (; next < 3; next++) buffer.accept([sample(next)]);
    for (let t = 0; t < 20; t++) {
      tick();
      buffer.accept([sample(next++)]);
    }
    for (let t = 0; t < 12; t++) tick();
    // A network stall: the twelve samples sent meanwhile and the next three arrive together.
    const burst: InputSample[] = [];
    for (let i = 0; i < 15; i++) burst.push(sample(next++));
    buffer.accept(burst.slice(0, 12));
    buffer.accept(burst.slice(12));
    for (let t = 0; t < 20; t++) {
      tick();
      buffer.accept([sample(next++)]);
    }
    expect(buffer.stats.reanchors).toBe(0);
    expect(buffer.stats.late).toBeGreaterThan(5);
  });

  it('refuses the numbers of an earlier connection after a reconnect', () => {
    const { buffer, applied, tick } = rig();
    for (let s = 0; s < 3; s++) buffer.accept([sample(s)]);
    for (let t = 0; t < 10; t++) tick();
    buffer.restartStream();
    buffer.accept([sample(0, -1), sample(1, -1), sample(2, -1)]);
    expect(buffer.stats.late).toBe(3);
    buffer.accept([sample(40, 0.7), sample(41, 0.7), sample(42, 0.7)]);
    tick();
    expect(applied.at(-1)!.outcome).toBe('sample');
    expect(applied.at(-1)!.steer).toBe(0.7);
  });

  it('starts over for a new race', () => {
    const { buffer, tick } = rig();
    for (let s = 100; s < 103; s++) buffer.accept([sample(s)]);
    tick();
    buffer.reset();
    expect(buffer.ackSequence).toBe(-1);
    expect(buffer.stats.received).toBe(0);
    for (let s = 1; s < 4; s++) buffer.accept([sample(s)]);
    expect(tick()).toBe('sample');
    expect(buffer.ackSequence).toBe(1);
  });

  it('spends exactly one number per tick, whatever the arrival pattern, except when it retimes', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed);
      const { buffer, applied, tick } = rig();
      let next = 0;
      const inFlight: Array<{ at: number; samples: InputSample[] }> = [];
      let lastAt = 0;
      for (let t = 0; t < 900; t++) {
        // The client makes one sample a tick and sends pairs; each pair is delayed by up to
        // eight ticks, in order.
        if (t % 2 === 0) {
          const at = Math.max(lastAt, t + 2 + Math.floor(rng() * 8 * rng()));
          lastAt = at;
          inFlight.push({ at, samples: [sample(next++), sample(next++)] });
        }
        while (inFlight.length > 0 && inFlight[0]!.at <= t)
          buffer.accept(inFlight.shift()!.samples);
        tick();
      }
      const started = applied.findIndex((a) => a.outcome !== 'idle');
      const ran = applied.length - started;
      // Every tick produced exactly one control: the driver's own or a stand-in.
      expect(buffer.stats.consumed + buffer.stats.missing, `seed ${seed}`).toBe(ran);
      if (buffer.stats.reanchors === 0) {
        const spent = buffer.ackSequence - applied[started]!.ack + 1;
        expect(spent, `seed ${seed}`).toBe(ran - buffer.stats.grown + buffer.stats.shrunk);
      }
      // A quarter second of jitter is absorbed, never mistaken for a client that lost time.
      expect(buffer.stats.reanchors, `seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });
});
