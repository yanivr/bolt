import type { ControlInput, InputSample, TickInputPolicy } from '@bolt/shared';
import { TickInputBuffer } from '@bolt/shared';

/**
 * The server's input pipeline for one car, as the rooms run it (`RaceHost`): a
 * `TickInputBuffer` consumed once per room tick. The car waits on the grid until its driver's
 * stream has started, as the drive room's does; from then on it steps once every tick, on the
 * driver's sample, or on the repeated control when the sample is missing.
 */
export class PacedServer {
  readonly buffer: TickInputBuffer;
  private readonly control: ControlInput = {
    steer: 0,
    brake: 0,
    coast: true,
    fire: 0,
    use: 0,
    target: 0,
  };

  constructor(policy: Partial<TickInputPolicy> = {}) {
    this.buffer = new TickInputBuffer(policy);
  }

  accept(samples: readonly InputSample[]): void {
    this.buffer.accept(samples);
  }

  get ackSequence(): number {
    return this.buffer.ackSequence;
  }

  /** One room tick. Returns the number of simulation steps run: 0 before the stream starts, else 1. */
  tick(simulate: (control: ControlInput) => void): number {
    if (this.buffer.step(this.control) === 'idle') return 0;
    simulate(this.control);
    return 1;
  }
}
