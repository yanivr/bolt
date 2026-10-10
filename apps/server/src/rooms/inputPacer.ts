import type { ControlInput, InputSample } from '@bolt/shared';
import { NEUTRAL_INPUT, SIM_HZ } from '@bolt/shared';
import { InputQueue } from './inputQueue.js';

/**
 * Decides, once per server tick, how one car's simulation advances given the control samples
 * that have arrived for it.
 *
 * The rule that matters for feel: the car is simulated with each sample exactly once, in
 * order. A predicting client that replays its unacknowledged samples on top of a snapshot then
 * lands exactly where the server will, and nothing has to be corrected on screen.
 *
 * Samples do not arrive evenly. A phone drops a few frames, or a packet is held up, and for a
 * tick or two the queue is empty. The car then simply waits, for at most `MAX_STALL_TICKS`,
 * and when the late samples arrive it runs the missed steps to catch up. The total number of
 * steps can never exceed the number of ticks that have passed, so sending faster buys nothing.
 * Only when a car has waited as long as it is allowed to does the server fall back to holding
 * the last sample, and after half a second of silence to a neutral coast.
 *
 * A car whose driver has not sent anything yet does not start at all. Its countdown begins
 * with the first sample.
 *
 * The alternative, used before, was to repeat the last sample the moment the queue ran dry.
 * That put the server's car one tick ahead of everything the client had predicted, every time,
 * which showed up as a small forward lurch.
 */

/** Ticks a starved car may wait for its samples before the server stops waiting: 267 ms. */
export const MAX_STALL_TICKS = 8;
/** Extra steps one tick may run to repay waited ticks. */
export const MAX_CATCH_UP_STEPS = 3;
/** Ticks an old sample keeps being reused before the car falls back to a neutral coast. */
export const STALE_INPUT_TICKS = Math.round(0.5 * SIM_HZ);
/** Largest hole in the sequence numbers that is patched with the previous sample. */
const MAX_GAP_FILL = 4;
/**
 * A waited tick that has not been repaid after this long was time the client lost for good
 * (a paused tab, a very long frame). It is written off, so the car can wait again next time.
 */
const STALL_FORGIVE_TICKS = Math.round(0.5 * SIM_HZ);

export class InputPacer {
  private readonly queue: InputQueue;
  /** The sample most recently consumed. Reused while the queue runs dry. */
  private readonly applied: ControlInput = { steer: 0, brake: 0, coast: true };
  private hasApplied = false;
  /** Highest sequence ever queued. Survives resets and reconnects so replays stay rejected. */
  private lastQueued = -1;
  /** Sequence of the last sample the simulation consumed. */
  ackSequence = -1;
  ticksSinceInput = STALE_INPUT_TICKS + 1;
  /** Ticks this car has waited and not yet caught up. */
  stalledTicks = 0;
  private stallAge = 0;

  constructor(capacity: number) {
    this.queue = new InputQueue(capacity);
  }

  get queued(): number {
    return this.queue.size;
  }

  /**
   * Queues validated samples. Packets may repeat recent samples, so duplicates and stale
   * sequence numbers are normal traffic and are skipped. Returns true if anything was new.
   */
  accept(samples: readonly InputSample[]): boolean {
    let accepted = false;
    for (const sample of samples) {
      if (sample.sequence <= this.lastQueued) continue;
      this.lastQueued = sample.sequence;
      this.queue.push(sample);
      accepted = true;
    }
    if (accepted) this.ticksSinceInput = 0;
    return accepted;
  }

  /**
   * Forgets pending and held input, for example after a reset or a dropped connection. The
   * sequence high-water mark is kept so nothing sent before can be replayed afterwards.
   */
  clear(): void {
    this.queue.clear();
    this.hasApplied = false;
    this.stalledTicks = 0;
    this.stallAge = 0;
  }

  /** Marks the driver as present again without inventing input. */
  touch(): void {
    this.ticksSinceInput = 0;
  }

  /**
   * Advances one server tick. `simulate` is called once per simulation step this tick, which
   * is usually once, sometimes not at all, and occasionally a few times while catching up.
   * Returns the number of steps run.
   */
  tick(connected: boolean, simulate: (control: ControlInput) => void): number {
    this.ticksSinceInput += 1;
    if (!connected) {
      simulate(NEUTRAL_INPUT);
      return 1;
    }

    // Nothing has arrived since the car was placed on the grid: its driver is still loading
    // the track, or has only just reset. The session waits, so the countdown starts when the
    // player can see it rather than while their phone is still downloading terrain.
    if (!this.hasApplied && this.queue.size === 0) return 0;

    let steps = 0;
    for (;;) {
      const next = this.queue.peekSequence();
      if (next < 0) break;
      const gap = next - this.ackSequence - 1;
      if (this.hasApplied && gap > 0 && gap <= MAX_GAP_FILL) {
        // A sample went missing on the way. Stand in the previous one and acknowledge the
        // hole, so the client's replay skips it too.
        this.ackSequence += 1;
      } else {
        this.ackSequence = this.queue.shiftInto(this.applied);
        this.hasApplied = true;
      }
      simulate(this.applied);
      steps += 1;
      // Catch up on waited ticks, but only while a sample is left over for the next tick.
      if (this.stalledTicks <= 0 || steps > MAX_CATCH_UP_STEPS || this.queue.size < 2) break;
      this.stalledTicks -= 1;
      this.stallAge = 0;
    }

    if (steps > 0) {
      if (this.stalledTicks > 0 && ++this.stallAge > STALL_FORGIVE_TICKS) {
        this.stalledTicks -= 1;
        this.stallAge = 0;
      }
      return steps;
    }

    const fresh = this.hasApplied && this.ticksSinceInput <= STALE_INPUT_TICKS;
    if (fresh && this.stalledTicks < MAX_STALL_TICKS) {
      this.stalledTicks += 1;
      return 0;
    }
    // Waited long enough. Hold the last known controls for a moment, without acknowledging
    // anything new, and then coast. Whatever was being waited for is not coming.
    this.stalledTicks = 0;
    this.stallAge = 0;
    simulate(fresh ? this.applied : NEUTRAL_INPUT);
    return 1;
  }
}
