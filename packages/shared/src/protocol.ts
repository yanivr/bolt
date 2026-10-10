import { z } from 'zod';
import { MAX_INPUTS_PER_PACKET, PROTOCOL_VERSION } from './balance.js';
import type { MatchPhase, VehicleMotionState, VehicleProgressState } from './types.js';

/**
 * Wire contract between the web client and the authoritative server. Every inbound payload is
 * parsed with these schemas before it can touch room state (Sections 15.4 and 19.6).
 */

export const ROOM_DRIVE = 'drive';

export const ClientMessage = {
  PLAYER_INPUT: 'PLAYER_INPUT',
  READY: 'READY',
  RESET_CAR: 'RESET_CAR',
  LEAVE: 'LEAVE',
} as const;

export const ServerMessage = {
  MATCH_PHASE: 'MATCH_PHASE',
  COUNTDOWN: 'COUNTDOWN',
  RACE_EVENT: 'RACE_EVENT',
  RESULTS: 'RESULTS',
  ERROR: 'ERROR',
} as const;

const finite = z.number().finite();

export const inputSampleSchema = z
  .object({
    sequence: z.number().int().nonnegative().max(0x7fffffff),
    clientTick: z.number().int().nonnegative().max(0x7fffffff),
    steer: finite.min(-1).max(1),
    brake: finite.min(0).max(1),
    coast: z.boolean(),
  })
  .strict();
export type InputSample = z.infer<typeof inputSampleSchema>;

export const playerInputMessageSchema = z
  .object({ inputs: z.array(inputSampleSchema).min(1).max(MAX_INPUTS_PER_PACKET) })
  .strict();
export type PlayerInputMessage = z.infer<typeof playerInputMessageSchema>;

const idSchema = z.string().min(1).max(48).regex(/^[a-z0-9_]+$/);

export const loadoutSchema = z
  .object({ chassisId: idSchema, engineId: idSchema, tireKitId: idSchema, paintId: idSchema })
  .strict();

export const driveJoinOptionsSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    guestToken: z.string().min(16).max(512),
    trackId: idSchema,
    weatherPresetId: idSchema,
    loadout: loadoutSchema,
  })
  .strict();
export type DriveJoinOptions = z.infer<typeof driveJoinOptionsSchema>;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'VERSION_MISMATCH',
  'UNKNOWN_TRACK',
  'UNKNOWN_PART',
  'ILLEGAL_BUILD',
  'RATE_LIMITED',
  'SERVER_FULL',
  'NOT_FOUND',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiError = { error: { code: ErrorCode; message: string } };

/**
 * Colyseus join refusals only carry a number, so each refusal reason has a stable code in the
 * application range. The client maps them back to player-facing screens.
 */
export const JOIN_ERROR_CODES = {
  BAD_REQUEST: 4400,
  UNAUTHORIZED: 4401,
  UNKNOWN_TRACK: 4404,
  VERSION_MISMATCH: 4409,
  UNKNOWN_PART: 4422,
  RATE_LIMITED: 4429,
  INTERNAL: 4500,
  SERVER_FULL: 4503,
} as const satisfies Partial<Record<ErrorCode, number>>;
export type JoinErrorCode = keyof typeof JOIN_ERROR_CODES;

export type MatchPhaseMessage = { phase: MatchPhase; tick: number };

export type RaceEvent =
  | { id: number; type: 'checkpoint'; tick: number; index: number }
  | { id: number; type: 'lap'; tick: number; lap: number; lapTimeMs: number }
  | { id: number; type: 'finish'; tick: number; raceTimeMs: number }
  | { id: number; type: 'wall'; tick: number; speed: number };

/**
 * Plain snapshot of one authoritative car. The Colyseus schema mirrors these fields; the
 * client converts state patches into this shape before reconciling its prediction.
 */
export type CarSnapshot = {
  tick: number;
  /** Sequence number of the last input sample the server consumed for this car. */
  ackSequence: number;
  raceTimeMs: number;
  phase: MatchPhase;
  /** Whole seconds left on the start countdown, zero once racing. */
  countdown: number;
  /** Exact simulation ticks left before GO, so a predicting client starts on the same tick. */
  countdownTicks: number;
  motion: VehicleMotionState;
  progress: VehicleProgressState;
  bestLapMs: number;
  lastLapMs: number;
};

export type GuestSessionResponse = {
  guestId: string;
  token: string;
  expiresAt: string;
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  protocolVersion: number;
  catalogVersion: string;
  uptimeSeconds: number;
  rooms: number;
  dependencies: Record<string, 'ok' | 'unavailable' | 'not_configured'>;
};
