import type { ControlInput, InputSample } from '@bolt/shared';

/**
 * Fixed-capacity ring of pending control samples for one car. Slots are allocated once and
 * overwritten in place, so the 30 Hz loop never creates garbage, and a client that sends
 * faster than the simulation consumes can only ever displace its own oldest samples.
 */
export class InputQueue {
  private readonly sequences: Int32Array;
  private readonly steers: Float64Array;
  private readonly brakes: Float64Array;
  private readonly coasts: Uint8Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.sequences = new Int32Array(capacity);
    this.steers = new Float64Array(capacity);
    this.brakes = new Float64Array(capacity);
    this.coasts = new Uint8Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Appends a validated sample. When full, the oldest pending sample is discarded. */
  push(sample: InputSample): void {
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this.count -= 1;
    }
    const slot = (this.head + this.count) % this.capacity;
    this.sequences[slot] = sample.sequence;
    this.steers[slot] = sample.steer;
    this.brakes[slot] = sample.brake;
    this.coasts[slot] = sample.coast ? 1 : 0;
    this.count += 1;
  }

  /**
   * Moves the oldest sample into `out` and returns its sequence number, or -1 when empty.
   */
  shiftInto(out: ControlInput): number {
    if (this.count === 0) return -1;
    const slot = this.head;
    out.steer = this.steers[slot]!;
    out.brake = this.brakes[slot]!;
    out.coast = this.coasts[slot] === 1;
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
    return this.sequences[slot]!;
  }

  /** Sequence number of the oldest pending sample, or -1 when empty. */
  peekSequence(): number {
    return this.count === 0 ? -1 : this.sequences[this.head]!;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
