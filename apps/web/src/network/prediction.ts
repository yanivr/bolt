import type {
  BuildConditions,
  CarSnapshot,
  ControlInput,
  DriveSession,
  InputSample,
  ResolvedBuild,
  RivalSnapshot,
  StepResult,
  VehicleParams,
} from '@bolt/shared';
import {
  COMPONENT_FIRST_WHEEL,
  SIM_DT,
  advanceTow,
  angleDelta,
  clearTow,
  copyEffects,
  copyMotionState,
  createContact,
  createMotionState,
  deriveParamsWithDisabled,
  findCarContact,
  resetEffects,
  resolveCarContact,
  stepDriveSession,
} from '@bolt/shared';

/**
 * Client-side prediction for the local car (Section 15.4). The client runs the same pure
 * session the server runs, one fixed step per input sample, and keeps every sample the server
 * has not acknowledged yet. When an authoritative snapshot arrives, the local session is reset
 * to it and the unacknowledged samples are replayed. Whatever difference that produces is
 * absorbed by a visual offset that decays quickly, so small corrections never jerk the camera.
 *
 * What is predicted, and what is not (docs/COMBAT_API.md, "Prediction"):
 * - The local car's motion, heat, energy and checkpoint progress are predicted exactly.
 * - What damage and statuses do to its driving is not predicted: the snapshot carries the
 *   car's `VehicleEffects` and the replay uses those numbers as they were at the snapshot.
 * - The tow (the long-range catch-up) is the exception among effects, and is predicted exactly.
 *   It depends on where the rival is, which the client only hears about, so the server decides
 *   it on a slow clock and announces each decision one period (half a second) before it takes
 *   effect. The snapshot carries the bonus, what it is moving toward and what was announced
 *   next, and `advanceTow` moves them on tick by tick here exactly as the race does. Only a
 *   client more than a whole period ahead of its last snapshot would have to guess, and what
 *   it would get wrong is a ramp of a fraction of a percent of top speed.
 * - Contact with the rival's body is predicted against where the rival was last seen, moved
 *   forward at its last known velocity, so the local car does not drive through it between
 *   snapshots. Only the local car is moved; the rival's response is the server's.
 * - Nothing else is: hits, shoves, tethers, wrecks and every weapon outcome arrive from the
 *   server and are taken as corrections, smoothed like any other.
 */

const SNAP_DISTANCE = 140;
const ERROR_DECAY_SECONDS = 0.1;
/** The rival is moved forward at its last velocity for at most this many ticks. */
const GHOST_MAX_TICKS = 12;

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

  /** The local car's build, for re-deriving coefficients when a part fails or is repaired. */
  private build: ResolvedBuild | null = null;
  private conditions: BuildConditions | null = null;
  private baseParams: VehicleParams;
  private disabledMask = 0;

  /** The rival as last seen: a body to collide with, never a car to simulate. */
  private readonly ghost = createMotionState(0, 0, 0);
  private ghostParams: VehicleParams | null = null;
  private ghostTick = -1;
  private ghostX = 0;
  private ghostY = 0;
  private readonly contact = createContact();

  constructor(session: DriveSession) {
    this.session = session;
    this.baseParams = session.params;
  }

  /** Gives the predictor the local car's build, so it can follow part failures. */
  setBuild(build: ResolvedBuild, conditions: BuildConditions): void {
    this.build = build;
    this.conditions = conditions;
  }

  /** Gives the predictor the rival's body shape and mass. Without it contact is not predicted. */
  setRivalBody(params: VehicleParams | null): void {
    this.ghostParams = params;
  }

  /** Where the rival was at server tick `tick`. */
  setRival(rival: RivalSnapshot, tick: number): void {
    this.ghostTick = rival.ko ? -1 : tick;
    this.ghostX = rival.x;
    this.ghostY = rival.y;
    this.ghost.headingRad = rival.headingRad;
    this.ghost.velocityX = rival.velocityX;
    this.ghost.velocityY = rival.velocityY;
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
    if (control.fire) sample.fire = control.fire;
    if (control.use) sample.use = control.use;
    if (control.target) sample.target = control.target;
    this.pending.push(sample);
    // A stalled connection must not grow this without bound; two seconds is far past playable.
    if (this.pending.length > 60) this.pending.shift();
    const result = this.advance(control);
    return { sample, result };
  }

  /** One predicted step: the car's own physics, then contact with the rival's body. */
  private advance(control: ControlInput): StepResult {
    const s = this.session;
    // The tow moves on with the race clock, as in `stepTow`: a car that is not racing has none.
    if (s.phase === 'RACING') advanceTow(s.effects, s.raceTicks + 1);
    else clearTow(s.effects);
    const result = stepDriveSession(s, control);
    const body = this.ghostParams;
    if (!body || this.ghostTick < 0 || s.phase !== 'RACING' || s.effects.airborne) return result;
    const ahead = s.tick - this.ghostTick;
    if (ahead < 0 || ahead > GHOST_MAX_TICKS) return result;
    const ghost = this.ghost;
    ghost.x = this.ghostX + ghost.velocityX * ahead * SIM_DT;
    ghost.y = this.ghostY + ghost.velocityY * ahead * SIM_DT;
    if (findCarContact(s.motion, s.params, ghost, body, this.contact))
      resolveCarContact(s.motion, s.params, ghost, body, this.contact, 1, 1, false);
    return result;
  }

  reconcile(snapshot: CarSnapshot): void {
    const s = this.session;
    const beforeX = s.motion.x;
    const beforeY = s.motion.y;
    const beforeH = s.motion.headingRad;

    // The motion state includes heat, battery and engine state, so the replay below starts
    // from exactly what the server simulated.
    copyMotionState(snapshot.motion, s.motion);
    Object.assign(s.progress, snapshot.progress);
    for (let i = 0; i < s.wheelIntegrity.length && i < snapshot.wheelIntegrity.length; i++)
      s.wheelIntegrity[i] = snapshot.wheelIntegrity[i]!;
    s.phase = snapshot.phase;
    s.tick = snapshot.tick;
    s.countdownTicks = snapshot.countdownTicks;
    s.raceTicks = Math.round(snapshot.raceTimeMs / (SIM_DT * 1000));
    s.bestLapMs = snapshot.bestLapMs;
    s.lastLapMs = snapshot.lastLapMs;
    // What damage and statuses are doing to the car, as the server computed it.
    if (snapshot.effects) copyEffects(snapshot.effects, s.effects);
    else resetEffects(s.effects);
    this.followDisabledParts(snapshot);

    let keep = 0;
    while (keep < this.pending.length && this.pending[keep]!.sequence <= snapshot.ackSequence)
      keep++;
    if (keep > 0) this.pending.splice(0, keep);
    for (const sample of this.pending) this.advance(sample);

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

  /**
   * A part at zero integrity stops contributing (a dead fan no longer cools). The server
   * re-derives the car's coefficients when that set changes, and so does the predictor, from
   * the same build with the same function, so both integrate with identical numbers.
   */
  private followDisabledParts(snapshot: CarSnapshot): void {
    const combat = snapshot.combat;
    if (!combat || !this.build || !this.conditions) return;
    const first = COMPONENT_FIRST_WHEEL + this.build.chassis.wheelAnchors.length;
    let mask = 0;
    for (let i = 0; i < this.build.parts.length; i++)
      if ((combat.components[first + i] ?? 1) <= 0) mask |= 1 << i;
    if (mask === this.disabledMask) return;
    this.disabledMask = mask;
    this.session.params =
      mask === 0 ? this.baseParams : deriveParamsWithDisabled(this.build, this.conditions, mask);
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
    this.clearError();
  }

  /** Drop the visual offset so the car is shown exactly where it is predicted to be. */
  clearError(): void {
    this.errorX = 0;
    this.errorY = 0;
    this.errorHeading = 0;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
