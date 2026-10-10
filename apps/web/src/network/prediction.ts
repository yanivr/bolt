import type {
  CarSnapshot,
  ControlInput,
  DriveSession,
  InputSample,
  StepResult,
} from '@bolt/shared';
import { SIM_DT, angleDelta, copyMotionState, stepDriveSession } from '@bolt/shared';

/**
 * Client-side prediction for the local car (Section 15.4). The client runs the same pure
 * session the server runs, one fixed step per input sample, and keeps every sample the server
 * has not acknowledged yet. When an authoritative snapshot arrives, the local session is reset
 * to it and the unacknowledged samples are replayed. Whatever difference that produces is
 * absorbed by a visual offset that decays quickly, so small corrections never jerk the camera.
 */

const SNAP_DISTANCE = 140;
const ERROR_DECAY_SECONDS = 0.1;

export class Predictor {
  readonly session: DriveSession;
  private pending: InputSample[] = [];
  private sequence = 0;
  private clientTick = 0;
  /** Visual-only offset from the predicted pose, decaying to zero. */
  errorX = 0;
  errorY = 0;
  errorHeading = 0;
  /** Largest single correction seen, in world pixels, for diagnostics. */
  maxCorrection = 0;
  corrections = 0;

  constructor(session: DriveSession) {
    this.session = session;
  }

  /** Samples the controls for one tick, advances the prediction, and returns the sample to send. */
  step(control: ControlInput): { sample: InputSample; result: StepResult } {
    this.sequence += 1;
    this.clientTick += 1;
    const sample: InputSample = {
      sequence: this.sequence,
      clientTick: this.clientTick,
      steer: control.steer,
      brake: control.brake,
      coast: control.coast,
    };
    this.pending.push(sample);
    // A stalled connection must not grow this without bound; two seconds is far past playable.
    if (this.pending.length > 60) this.pending.shift();
    const result = stepDriveSession(this.session, control);
    return { sample, result };
  }

  reconcile(snapshot: CarSnapshot): void {
    const s = this.session;
    const beforeX = s.motion.x;
    const beforeY = s.motion.y;
    const beforeH = s.motion.headingRad;

    copyMotionState(snapshot.motion, s.motion);
    Object.assign(s.progress, snapshot.progress);
    s.phase = snapshot.phase;
    s.tick = snapshot.tick;
    s.countdownTicks = snapshot.countdownTicks;
    s.raceTicks = Math.round(snapshot.raceTimeMs / (SIM_DT * 1000));
    s.bestLapMs = snapshot.bestLapMs;
    s.lastLapMs = snapshot.lastLapMs;

    let keep = 0;
    while (keep < this.pending.length && this.pending[keep]!.sequence <= snapshot.ackSequence)
      keep++;
    if (keep > 0) this.pending.splice(0, keep);
    for (const sample of this.pending) stepDriveSession(s, sample);

    const dx = beforeX - s.motion.x;
    const dy = beforeY - s.motion.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.01) {
      this.corrections += 1;
      this.maxCorrection = Math.max(this.maxCorrection, distance);
    }
    if (distance > SNAP_DISTANCE) {
      // Extreme desync: show the truth immediately rather than sliding across the map.
      this.errorX = 0;
      this.errorY = 0;
      this.errorHeading = 0;
      return;
    }
    this.errorX += dx;
    this.errorY += dy;
    this.errorHeading += angleDelta(s.motion.headingRad, beforeH);
  }

  /** Call once per rendered frame. */
  decayError(dtSeconds: number): void {
    const k = Math.exp(-dtSeconds / ERROR_DECAY_SECONDS);
    this.errorX *= k;
    this.errorY *= k;
    this.errorHeading *= k;
  }

  /** Forget unacknowledged input, for example after the car is reset to the grid. */
  clearPending(): void {
    this.pending.length = 0;
    this.errorX = 0;
    this.errorY = 0;
    this.errorHeading = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
