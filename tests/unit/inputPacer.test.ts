import type { ControlInput, InputSample } from '@bolt/shared';
import { MAX_QUEUED_INPUTS } from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import {
  InputPacer,
  MAX_CATCH_UP_STEPS,
  MAX_STALL_TICKS,
  STALE_INPUT_TICKS,
} from '../../apps/server/src/rooms/inputPacer.js';

function sample(sequence: number, steer = sequence / 1000): InputSample {
  return { sequence, clientTick: sequence, steer, brake: 0, coast: false };
}

function rig() {
  const pacer = new InputPacer(MAX_QUEUED_INPUTS);
  const applied: ControlInput[] = [];
  const tick = (connected = true) => pacer.tick(connected, (c) => applied.push({ ...c }));
  return { pacer, applied, tick };
}

describe('drive room input policy', () => {
  it('simulates each sample exactly once, in order, one per tick', () => {
    const { pacer, applied, tick } = rig();
    for (let i = 1; i <= 20; i++) {
      pacer.accept([sample(i)]);
      expect(tick()).toBe(1);
      expect(pacer.ackSequence).toBe(i);
    }
    expect(applied.map((c) => c.steer)).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) / 1000));
  });

  it('waits when a sample is late, then catches up without repeating or skipping anything', () => {
    const { pacer, applied, tick } = rig();
    pacer.accept([sample(1), sample(2)]);
    tick();
    tick();
    // Three ticks with nothing: the car waits rather than inventing input.
    expect(tick()).toBe(0);
    expect(tick()).toBe(0);
    expect(tick()).toBe(0);
    expect(pacer.stalledTicks).toBe(3);
    expect(pacer.ackSequence).toBe(2);
    // The late samples arrive in a burst and the missed steps are run.
    pacer.accept([sample(3), sample(4), sample(5), sample(6), sample(7)]);
    const steps = tick();
    expect(steps).toBeGreaterThan(1);
    expect(steps).toBeLessThanOrEqual(1 + MAX_CATCH_UP_STEPS);
    while (pacer.queued > 0) tick();
    expect(applied.map((c) => c.steer)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => n / 1000));
    expect(pacer.ackSequence).toBe(7);
  });

  it('never runs more steps than ticks have passed, however the client sends', () => {
    const { pacer, applied, tick } = rig();
    let sequence = 0;
    let ticks = 0;
    for (let round = 0; round < 200; round++) {
      // Bursts of up to six samples, then silence, in an awkward rhythm.
      const burst = (round * 7) % 6;
      const batch: InputSample[] = [];
      for (let i = 0; i < burst; i++) batch.push(sample(++sequence));
      pacer.accept(batch);
      for (let i = 0; i < 1 + (round % 3); i++) {
        tick();
        ticks++;
        expect(applied.length).toBeLessThanOrEqual(ticks);
      }
    }
  });

  it('stops waiting after the allowance, holds the last sample, then coasts on neutral', () => {
    const { pacer, applied, tick } = rig();
    pacer.accept([sample(1, 0.5)]);
    tick();
    for (let i = 0; i < MAX_STALL_TICKS; i++) expect(tick()).toBe(0);
    // Allowance used up: the car moves again on the held sample, unacknowledged.
    expect(tick()).toBe(1);
    expect(applied.at(-1)).toEqual({ steer: 0.5, brake: 0, coast: false });
    expect(pacer.ackSequence).toBe(1);
    for (let i = 0; i < STALE_INPUT_TICKS + MAX_STALL_TICKS + 4; i++) tick();
    expect(applied.at(-1)!.coast).toBe(true);
    expect(pacer.ackSequence).toBe(1);
  });

  it('does not start the session until its driver has sent a first sample', () => {
    const { pacer, applied, tick } = rig();
    for (let i = 0; i < 10; i++) expect(tick()).toBe(0);
    expect(applied).toHaveLength(0);
    // Waiting for a driver to load is not the same as waiting for a late packet.
    expect(pacer.stalledTicks).toBe(0);
    pacer.accept([sample(1)]);
    expect(tick()).toBe(1);
    // The same holds after a reset: the grid waits for the next sample.
    pacer.clear();
    expect(tick()).toBe(0);
    pacer.accept([sample(2)]);
    expect(tick()).toBe(1);
    expect(applied).toHaveLength(2);
  });

  it('stands in the previous sample for one that went missing and acknowledges the hole', () => {
    const { pacer, applied, tick } = rig();
    pacer.accept([sample(1), sample(2)]);
    tick();
    tick();
    pacer.accept([sample(4), sample(5)]);
    tick();
    expect(pacer.ackSequence).toBe(3);
    expect(applied.at(-1)!.steer).toBe(0.002);
    tick();
    expect(pacer.ackSequence).toBe(4);
    expect(applied.at(-1)!.steer).toBe(0.004);
  });

  it('ignores duplicates and old sequence numbers, even after a reset', () => {
    const { pacer, tick } = rig();
    expect(pacer.accept([sample(1), sample(2), sample(2), sample(1)])).toBe(true);
    expect(pacer.queued).toBe(2);
    tick();
    pacer.clear();
    expect(pacer.queued).toBe(0);
    expect(pacer.accept([sample(1), sample(2)])).toBe(false);
    expect(pacer.accept([sample(3)])).toBe(true);
    tick();
    expect(pacer.ackSequence).toBe(3);
  });

  it('simulates a neutral coast while the driver is disconnected', () => {
    const { pacer, applied, tick } = rig();
    pacer.accept([sample(1, 0.9)]);
    expect(tick(false)).toBe(1);
    expect(applied.at(-1)!.coast).toBe(true);
    expect(pacer.ackSequence).toBe(-1);
  });
});
