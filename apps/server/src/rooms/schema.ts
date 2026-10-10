import type { SchemaType } from '@colyseus/schema';
import { schema } from '@colyseus/schema';
import type { DriveSession } from '@bolt/shared';
import { countdownSeconds, raceTimeMs } from '@bolt/shared';

const uint8 = (value = 0) => ({ type: 'uint8', default: value }) as const;
const uint16 = (value = 0) => ({ type: 'uint16', default: value }) as const;
const uint32 = (value = 0) => ({ type: 'uint32', default: value }) as const;
const int32 = (value = 0) => ({ type: 'int32', default: value }) as const;
const float64 = (value = 0) => ({ type: 'float64', default: value }) as const;

/**
 * Synchronized state of a test-drive room. Field names mirror `CarSnapshot` in the shared
 * protocol (its `motion` and `progress` members are flattened here) so the client can rebuild
 * a snapshot from a patch without a lookup table.
 *
 * Continuous motion values travel as float64 on purpose: the client replays its unconfirmed
 * inputs on top of this state, and any quantization would show up as a correction every
 * snapshot. Bandwidth for one car is small enough that exactness is the better trade. Note
 * that the schema type named `number` would not do: it picks the smallest encoding per value
 * and sends fractions as float32.
 *
 * The class is declared with `schema()` rather than `@type` decorators. Decorated fields only
 * work when every tool that compiles this file (tsc, esbuild, tsx, Vitest) agrees on the
 * legacy decorator and class-field settings, and a mismatch fails at startup, not at build.
 */
export const DriveState = schema(
  {
    tick: uint32(),
    phase: { type: 'string', default: 'COUNTDOWN' },
    countdown: uint8(),
    countdownTicks: uint16(),
    raceTimeMs: uint32(),
    /** Sequence of the last input sample the simulation consumed. -1 until the first one. */
    ackSequence: int32(-1),
    bestLapMs: uint32(),
    lastLapMs: uint32(),

    // VehicleMotionState
    x: float64(),
    y: float64(),
    headingRad: float64(),
    velocityX: float64(),
    velocityY: float64(),
    yawRate: float64(),
    steeringInput: float64(),
    brakeInput: float64(),
    throttleFraction: float64(),
    reverseHold: float64(),
    reversing: { type: 'boolean', default: false },
    wallGrace: float64(),

    // VehicleProgressState
    checkpointIndex: uint16(),
    lap: uint8(),
    courseProgress: float64(),
    lastCheckpointMs: uint32(),
    wrongWaySeconds: float64(),
    /** Race time at the finish in milliseconds, or -1 while the car has not finished. */
    finishedAtMs: int32(-1),
  },
  'DriveState',
);
export type DriveState = SchemaType<typeof DriveState>;

/**
 * Copies the authoritative session into the schema. Plain field writes only: the schema
 * tracks which values actually changed, so unchanged fields cost nothing on the wire.
 */
export function writeDriveState(
  state: DriveState,
  session: DriveSession,
  ackSequence: number,
): void {
  state.tick = session.tick;
  state.phase = session.phase;
  state.countdown = countdownSeconds(session);
  state.countdownTicks = session.phase === 'COUNTDOWN' ? Math.max(0, session.countdownTicks) : 0;
  state.raceTimeMs = raceTimeMs(session);
  state.ackSequence = ackSequence;
  state.bestLapMs = session.bestLapMs;
  state.lastLapMs = session.lastLapMs;

  const motion = session.motion;
  state.x = motion.x;
  state.y = motion.y;
  state.headingRad = motion.headingRad;
  state.velocityX = motion.velocityX;
  state.velocityY = motion.velocityY;
  state.yawRate = motion.yawRate;
  state.steeringInput = motion.steeringInput;
  state.brakeInput = motion.brakeInput;
  state.throttleFraction = motion.throttleFraction;
  state.reverseHold = motion.reverseHold;
  state.reversing = motion.reversing;
  state.wallGrace = motion.wallGrace;

  const progress = session.progress;
  state.checkpointIndex = progress.checkpointIndex;
  state.lap = progress.lap;
  state.courseProgress = progress.courseProgress;
  state.lastCheckpointMs = progress.lastCheckpointMs;
  state.wrongWaySeconds = progress.wrongWaySeconds;
  state.finishedAtMs = progress.finishedAtMs ?? -1;
}
