import type { InputSample } from '@bolt/shared';
import { SIM_DT } from '@bolt/shared';

/**
 * Sends control samples the way a real client does since rooms run on their own clock
 * (Milestone E): one sample per 30 Hz step of wall time, numbered on, in packets of two. The
 * room consumes one per tick, so a feeder that keeps time is never starved and never runs ahead.
 */
export type FeedControl = {
  steer: number;
  brake: number;
  coast: boolean;
  fire?: number;
  use?: number;
};

export class Feeder {
  sequence: number;
  control: FeedControl = { steer: 0, brake: 0, coast: false };
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private produced = 0;
  private outbox: InputSample[] = [];

  constructor(
    private readonly send: (inputs: InputSample[]) => void,
    startSequence = 0,
  ) {
    this.sequence = startSequence;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.produced = 0;
    this.timer = setInterval(() => this.pump(), 5);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  private pump(): void {
    const due = Math.min(
      8,
      Math.floor((Date.now() - this.startedAt) / (SIM_DT * 1000)) - this.produced,
    );
    for (let i = 0; i < due; i++) {
      const c = this.control;
      const sample: InputSample = {
        sequence: this.sequence++,
        clientTick: this.produced,
        steer: c.steer,
        brake: c.brake,
        coast: c.coast,
      };
      if (c.fire) sample.fire = c.fire;
      if (c.use) sample.use = c.use;
      this.outbox.push(sample);
      this.produced += 1;
      if (this.outbox.length >= 2) this.flush();
    }
  }

  private flush(): void {
    if (this.outbox.length === 0) return;
    this.send(this.outbox.splice(0));
  }
}
