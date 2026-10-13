import type { ControlInput } from './physics.js';
import type { InputSample } from './protocol.js';

/**
 * The server-paced input pipeline for one human driver (Milestone E, docs/MULTIPLAYER.md).
 *
 * A room advances its race on its own fixed 30 Hz clock, whoever is connected. Each tick, every
 * human car needs one control sample. The client numbers its samples, one per simulation step it
 * predicted, and this buffer maps those numbers onto room ticks one to one: tick `t` consumes
 * sequence `next`, then `next + 1` on the following tick, and so on. Because the mapping never
 * slips, a client that replays its unacknowledged samples on top of a snapshot lands on the
 * server's tick, and the only thing it can get wrong is a control the server did not have.
 *
 * Samples arrive in packets, late and unevenly, so the buffer holds a few ticks of them (the
 * input delay). When the sample for a tick is missing the server does not wait, since the
 * other driver must never stall: it repeats the last control the driver gave (a held stick is
 * by far the likeliest thing the missing sample says), counts a miss and consumes the number, so
 * the late sample is dropped when it comes. After `staleTicks` of silence the driver is treated
 * as absent and the room decides what drives the car.
 *
 * The delay adapts in whole ticks:
 * - Samples that keep arriving just after their tick ran (`missesToGrow` of them within
 *   `missWindow` ticks) prove the buffer too shallow for this network's jitter. On the next miss
 *   the number is not consumed: the car runs one tick on the repeated control and the buffer is
 *   a tick deeper from then on. A sample that never comes (lost on the way) is no such proof: a
 *   deeper buffer would not have helped, so it never grows the delay.
 * - A buffer that never ran low (`shrinkSlack` spare samples at least, through a whole
 *   `shrinkWindow` with no miss) is deeper than the network needs. One sample is skipped.
 * Either change moves the client's car by one tick of travel against its prediction, which is
 * why both are rare and rate limited, and free during the countdown when no car moves.
 *
 * A client that froze (a hidden tab, a debugger) and comes back with numbers far behind the
 * room is anchored again at its newest samples (`reanchor`).
 *
 * Pure and deterministic: no clocks, no timers. The server calls `step` once per tick.
 */

export type TickInputPolicy = {
  /** Samples held at most. Anything further ahead of the room than this is dropped. */
  capacity: number;
  /** Samples buffered before the first one is consumed. */
  initialDelay: number;
  /** The delay is never grown past this many ticks. */
  maxDelay: number;
  /** Ticks over which late arrivals are counted for growing. */
  missWindow: number;
  /** Late arrivals of missed samples within `missWindow` that make the next miss grow the delay. */
  missesToGrow: number;
  /** Ticks without a miss, and with spare samples throughout, before the delay shrinks. */
  shrinkWindow: number;
  /** Spare samples (beyond the one consumed) that must have been there at every tick of the window. */
  shrinkSlack: number;
  /** Ticks after a retime before another one. */
  retimeCooldown: number;
  /** Ticks of silence after which the driver counts as absent. */
  staleTicks: number;
  /** Ticks every packet must have been wholly behind the room before the stream is anchored again. */
  reanchorLag: number;
  /** Count only the late arrival for the first miss of a run toward growing (see `step`). */
  growOnIsolatedMissesOnly: boolean;
};

export const DEFAULT_TICK_INPUT_POLICY: Readonly<TickInputPolicy> = Object.freeze({
  capacity: 64,
  initialDelay: 3,
  maxDelay: 12,
  missWindow: 90,
  missesToGrow: 2,
  shrinkWindow: 150,
  shrinkSlack: 4,
  retimeCooldown: 30,
  staleTicks: 15,
  reanchorLag: 10,
  growOnIsolatedMissesOnly: true,
});

/**
 * What a tick was given:
 * - `sample`: the driver's own sample for this tick.
 * - `repeat`: the sample was missing; the last control was repeated.
 * - `absent`: nothing has come for a while, or the client said it went away. The control is
 *   neutral and the room may hand the car to an autopilot.
 * - `idle`: the stream has not started (or restarted) yet. The control is neutral.
 */
/** Ticks of a deep buffer after which the fast drain takes one tick off. */
const FAST_SHRINK_WINDOW = 15;

export type TickOutcome = 'sample' | 'repeat' | 'absent' | 'idle';

export type TickInputStats = {
  /** Samples received in packets for the current race. */
  received: number;
  /** Ticks that consumed the driver's own sample. */
  consumed: number;
  /** Ticks whose sample had not arrived: the last control stood in. */
  missing: number;
  /** Samples that arrived after their tick had run, and were dropped. */
  late: number;
  /** Samples received twice. */
  duplicates: number;
  /** Samples too far ahead of the room to hold. */
  overflow: number;
  /** Times the delay grew by one tick, and shrank by one. */
  grown: number;
  shrunk: number;
  /** Times the stream was anchored again after the client fell far behind. */
  reanchors: number;
};

function emptyStats(): TickInputStats {
  return {
    received: 0,
    consumed: 0,
    missing: 0,
    late: 0,
    duplicates: 0,
    overflow: 0,
    grown: 0,
    shrunk: 0,
    reanchors: 0,
  };
}

function neutral(out: ControlInput): void {
  out.steer = 0;
  out.brake = 0;
  out.coast = true;
  out.fire = 0;
  out.use = 0;
  out.target = 0;
}

export class TickInputBuffer {
  readonly policy: TickInputPolicy;
  private readonly seqs: Int32Array;
  private readonly steers: Float64Array;
  private readonly brakes: Float64Array;
  private readonly coasts: Uint8Array;
  private readonly fires: Uint8Array;
  private readonly uses: Uint8Array;
  private readonly targets: Uint8Array;

  /** The control given on the last tick that had one, repeated while samples are missing. */
  private readonly last: ControlInput = {
    steer: 0,
    brake: 0,
    coast: true,
    fire: 0,
    use: 0,
    target: 0,
  };
  private hasLast = false;
  private anchored = false;
  /** Sequence the next tick consumes, once anchored. */
  private nextSeq = 0;
  private highest = -1;
  /** Ticks since a tick last consumed the driver's own sample. */
  private silent = 0;
  private away = false;
  private tick = 0;
  private lastRetimeTick = -1_000_000;
  /** Ticks at which a missed sample turned up late: the evidence for growing. */
  private readonly lateTicks: number[] = [];
  /** Per slot, the sequence that was missed there and may still turn up late, or -1. */
  private readonly missed: Int32Array;
  private windowStart = 0;
  private windowSpareMin = Infinity;
  private windowMissed = false;
  /** Tick at which packets began arriving wholly behind the room, or -1. */
  private behindSince = -1;
  private readonly lastBehind: InputSample[] = [];
  /** True between a re-anchor and the stream starting again. */
  private restarting = false;
  /** Lowest sequence still accepted: everything below was used by an earlier stream. */
  private floor = -1;

  /** Sequence of the last sample the simulation consumed (or stood a repeat in for). */
  ackSequence = -1;
  /** Ticks of delay the buffer is aiming for: the initial delay plus growth less shrinkage. */
  delayTicks: number;
  /** Samples waiting at the start of the last tick, including the one it consumed. */
  depth = 0;
  stats: TickInputStats = emptyStats();

  constructor(policy: Partial<TickInputPolicy> = {}) {
    this.policy = { ...DEFAULT_TICK_INPUT_POLICY, ...policy };
    const n = this.policy.capacity;
    this.seqs = new Int32Array(n).fill(-1);
    this.missed = new Int32Array(n).fill(-1);
    this.steers = new Float64Array(n);
    this.brakes = new Float64Array(n);
    this.coasts = new Uint8Array(n);
    this.fires = new Uint8Array(n);
    this.uses = new Uint8Array(n);
    this.targets = new Uint8Array(n);
    this.delayTicks = this.policy.initialDelay;
  }

  /** True once samples are flowing, until the stream goes quiet or is restarted. */
  get started(): boolean {
    return this.anchored;
  }

  /** True while the driver counts as absent: silent too long, or away by its own word. */
  get absent(): boolean {
    return this.away || (this.anchored && this.silent > this.policy.staleTicks);
  }

  /** Ticks since the driver's own sample was last consumed. */
  get silentTicks(): number {
    return this.silent;
  }

  /** Samples held for ticks still to come. */
  get queued(): number {
    return this.countFrom(this.anchored ? this.nextSeq : -1);
  }

  /**
   * Forgets everything for a new race: the client starts its numbering again with the new race,
   * and packets of the old race are refused by race id before they reach this buffer.
   */
  reset(): void {
    this.seqs.fill(-1);
    this.hasLast = false;
    neutral(this.last);
    this.anchored = false;
    this.nextSeq = 0;
    this.highest = -1;
    this.silent = 0;
    this.away = false;
    this.tick = 0;
    this.lastRetimeTick = -1_000_000;
    this.lateTicks.length = 0;
    this.missed.fill(-1);
    this.windowStart = 0;
    this.windowSpareMin = Infinity;
    this.windowMissed = false;
    this.behindSince = -1;
    this.lastBehind.length = 0;
    this.restarting = false;
    this.floor = -1;
    this.ackSequence = -1;
    this.delayTicks = this.policy.initialDelay;
    this.depth = 0;
    this.stats = emptyStats();
  }

  /** Highest sequence received in this stream, or -1. */
  get highestSequence(): number {
    return Math.max(this.highest, this.floor - 1);
  }

  /** Refuses every sequence below `sequence` from now on (a new race of the same client). */
  refuseBelow(sequence: number): void {
    this.floor = Math.max(this.floor, sequence);
  }

  /**
   * The same driver on a new connection: whatever was queued belonged to the old one, and its
   * numbering continues from wherever its page is now. The stream anchors again on what comes
   * next; the statistics and the last control are kept.
   */
  restartStream(): void {
    this.seqs.fill(-1);
    this.anchored = false;
    // Numbers the old connection used are never accepted again.
    this.floor = Math.max(this.floor, this.highest + 1, this.nextSeq);
    this.highest = -1;
    this.behindSince = -1;
    this.lastBehind.length = 0;
    this.restarting = this.hasLast;
  }

  /**
   * The client said it went away (its tab was hidden, its menu asked for neutral input). The
   * car gets neutral control at once rather than a repeat of whatever was held; a fresh sample
   * ends it.
   */
  markAway(): void {
    this.away = true;
  }

  /** Queues validated samples from one packet. Duplicates and stale numbers are skipped. */
  accept(samples: readonly InputSample[]): void {
    if (samples.length === 0) return;
    let newest = -1;
    for (const s of samples) if (s.sequence > newest) newest = s.sequence;
    // A packet that is wholly behind the room. Right after a network stall the first packets of
    // the burst are like this and the last are on time again; a client that stood still (a
    // hidden tab, a long freeze) lost that time for good and stays behind. `step` tells the two
    // apart by whether the lateness lasts.
    if (this.anchored && newest < this.nextSeq) {
      if (this.behindSince < 0) this.behindSince = this.tick;
      this.lastBehind.length = 0;
      for (const s of samples) this.lastBehind.push(s);
    } else this.behindSince = -1;
    for (const s of samples) {
      this.stats.received += 1;
      const seq = s.sequence;
      if ((this.anchored && seq < this.nextSeq) || seq < this.floor) {
        this.stats.late += 1;
        const cap = this.policy.capacity;
        const slot = seq % cap;
        if (this.anchored && this.missed[slot] === seq) {
          this.missed[slot] = -1;
          // The sample a repeat stood in for has come after all. If its miss was a lone one
          // (the next tick has not run yet, or had its own sample), the buffer was a little too
          // shallow: evidence for growing. If the next tick missed too, it was a stall.
          const lone = this.nextSeq === seq + 1 || this.missed[(seq + 1) % cap] !== seq + 1;
          if (lone || !this.policy.growOnIsolatedMissesOnly) this.lateTicks.push(this.tick);
        }
        continue;
      }
      const slot = seq % this.policy.capacity;
      if (this.seqs[slot] === seq) {
        this.stats.duplicates += 1;
        continue;
      }
      const floor = this.anchored ? this.nextSeq : this.highest - this.policy.capacity + 1;
      if (seq >= floor + this.policy.capacity) {
        if (this.anchored) {
          this.stats.overflow += 1;
          continue;
        }
      }
      this.seqs[slot] = seq;
      this.steers[slot] = s.steer;
      this.brakes[slot] = s.brake;
      this.coasts[slot] = s.coast ? 1 : 0;
      this.fires[slot] = s.fire ?? 0;
      this.uses[slot] = s.use ?? 0;
      this.targets[slot] = s.target ?? 0;
      if (seq > this.highest) this.highest = seq;
      this.away = false;
    }
    if (!this.anchored) this.dropBelow(this.highest - this.policy.capacity + 1);
  }

  /**
   * Advances one room tick: writes the control for this tick into `out` and says where it came
   * from. Never waits: every call produces a control.
   */
  step(out: ControlInput): TickOutcome {
    this.tick += 1;
    const p = this.policy;
    if (this.anchored && this.behindSince >= 0 && this.tick - this.behindSince >= p.reanchorLag) {
      // Everything for `reanchorLag` ticks has been behind the room: the client's clock lost
      // time. Start its stream again from its newest samples.
      this.seqs.fill(-1);
      this.anchored = false;
      this.highest = -1;
      this.behindSince = -1;
      this.stats.reanchors += 1;
      this.restarting = true;
      const again = this.lastBehind.splice(0);
      this.accept(again);
      this.stats.received -= again.length;
    }
    if (!this.anchored) {
      const lowest = this.lowest();
      if (lowest < 0 || this.countFrom(lowest) < p.initialDelay) {
        this.depth = this.countFrom(-1);
        if (this.restarting && this.hasLast && !this.away) {
          // Between streams: hold the last control a moment, as for a missing sample.
          this.silent += 1;
          if (this.silent <= p.staleTicks) {
            copyControl(this.last, out);
            return 'repeat';
          }
          neutral(out);
          return 'absent';
        }
        neutral(out);
        return this.away ? 'absent' : 'idle';
      }
      this.anchor(lowest);
    }

    const depth = this.countFrom(this.nextSeq);
    this.depth = depth;
    const slot = this.nextSeq % p.capacity;
    if (this.seqs[slot] === this.nextSeq) {
      this.load(slot, out);
      this.ackSequence = this.nextSeq;
      this.nextSeq += 1;
      this.silent = 0;
      this.stats.consumed += 1;
      this.observeSpare(depth - 1);
      this.maybeShrink();
      return 'sample';
    }

    // The sample for this tick is not here.
    this.stats.missing += 1;
    this.silent += 1;
    this.windowMissed = true;
    // Only the first miss of a run counts toward growing: scattered late samples are jitter,
    // which a deeper buffer absorbs; a run of misses is a stall (a lost packet held up the
    // stream, or a frozen page), which only a buffer as deep as the stall could absorb, at that
    // cost in delay on every tick. Stalls are taken as repeated controls instead.
    const isolated = this.silent === 1 || !p.growOnIsolatedMissesOnly;
    while (this.lateTicks.length > 0 && this.lateTicks[0]! <= this.tick - p.missWindow)
      this.lateTicks.shift();
    const absent = this.absent;
    const grow =
      !absent &&
      isolated &&
      this.lateTicks.length >= p.missesToGrow &&
      this.delayTicks < p.maxDelay &&
      this.tick - this.lastRetimeTick >= p.retimeCooldown;
    if (grow) {
      // Run this tick on the repeated control without consuming a number: one tick deeper.
      this.delayTicks += 1;
      this.stats.grown += 1;
      this.lastRetimeTick = this.tick;
      this.lateTicks.length = 0;
    } else {
      // The repeated control stands in for this number; its sample is dropped if it comes, and
      // is evidence for growing if its miss turns out to have been a lone one.
      this.missed[this.nextSeq % p.capacity] = this.nextSeq;
      this.ackSequence = this.nextSeq;
      this.nextSeq += 1;
    }
    if (absent || !this.hasLast) {
      neutral(out);
      return absent ? 'absent' : 'repeat';
    }
    copyControl(this.last, out);
    return 'repeat';
  }

  private anchor(lowest: number): void {
    this.anchored = true;
    this.restarting = false;
    this.nextSeq = lowest;
    this.ackSequence = lowest - 1;
    this.silent = 0;
    this.delayTicks = this.policy.initialDelay;
    this.lateTicks.length = 0;
    this.missed.fill(-1);
    this.windowStart = this.tick;
    this.windowSpareMin = Infinity;
    this.windowMissed = false;
  }

  private observeSpare(spare: number): void {
    if (spare < this.windowSpareMin) this.windowSpareMin = spare;
  }

  private maybeShrink(): void {
    const p = this.policy;
    const span = this.tick - this.windowStart;
    // Far deeper than any network needs (the room stalled, or the client's clock ran ahead):
    // drain a tick twice a second rather than one every few seconds.
    const far = span >= FAST_SHRINK_WINDOW && this.windowSpareMin >= 2 * p.shrinkSlack;
    if (!far && span < p.shrinkWindow) return;
    const shrink =
      !this.windowMissed &&
      this.windowSpareMin >= p.shrinkSlack &&
      (far || this.tick - this.lastRetimeTick >= p.retimeCooldown);
    if (shrink) {
      // Skip one number: its sample (if here) is never simulated.
      const slot = this.nextSeq % p.capacity;
      if (this.seqs[slot] === this.nextSeq) this.seqs[slot] = -1;
      this.ackSequence = this.nextSeq;
      this.nextSeq += 1;
      this.delayTicks = Math.max(1, this.delayTicks - 1);
      this.stats.shrunk += 1;
      this.lastRetimeTick = this.tick;
    }
    this.windowStart = this.tick;
    this.windowSpareMin = Infinity;
    this.windowMissed = false;
  }

  private load(slot: number, out: ControlInput): void {
    const last = this.last;
    last.steer = this.steers[slot]!;
    last.brake = this.brakes[slot]!;
    last.coast = this.coasts[slot] === 1;
    last.fire = this.fires[slot]!;
    last.use = this.uses[slot]!;
    last.target = this.targets[slot]!;
    this.seqs[slot] = -1;
    this.hasLast = true;
    copyControl(last, out);
  }

  /** Lowest buffered sequence, or -1. */
  private lowest(): number {
    let low = -1;
    for (let i = 0; i < this.seqs.length; i++) {
      const s = this.seqs[i]!;
      if (s >= 0 && (low < 0 || s < low)) low = s;
    }
    return low;
  }

  private countFrom(from: number): number {
    let n = 0;
    for (let i = 0; i < this.seqs.length; i++) if (this.seqs[i]! >= from && this.seqs[i]! >= 0) n++;
    return n;
  }

  private dropBelow(floor: number): void {
    for (let i = 0; i < this.seqs.length; i++)
      if (this.seqs[i]! >= 0 && this.seqs[i]! < floor) this.seqs[i] = -1;
  }
}

function copyControl(from: ControlInput, to: ControlInput): void {
  to.steer = from.steer;
  to.brake = from.brake;
  to.coast = from.coast;
  to.fire = from.fire ?? 0;
  to.use = from.use ?? 0;
  to.target = from.target ?? 0;
}
