import { z } from 'zod';
import { MAX_INPUTS_PER_PACKET, PROTOCOL_VERSION } from './balance.js';
import { blueprintSchema } from './blueprint.js';
import { inputSampleSchema } from './protocol.js';
import type { MatchPhase, VehicleBlueprint } from './types.js';

/**
 * Race a Friend (Sections 3.2, 3.3, 5.4 and 15.7): the match room, its friend codes, its
 * messages and the public state both players share. docs/MULTIPLAYER.md describes the flow.
 *
 * Everything that crosses the wire is parsed with these schemas before it reaches the room.
 */

export const ROOM_MATCH = 'match';

// --- Friend codes ---------------------------------------------------------------------------------

/**
 * A match code is six symbols from an alphabet with no 0, O, 1, I, L or U, so it reads the same
 * aloud, on a small screen and in a messaging app. It is never a blueprint code: those are
 * `CAR-XXXXXX-XX` and use a different alphabet (Section 0.1, item 12).
 */
export const MATCH_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const MATCH_CODE_LENGTH = 6;
export const MATCH_CODE_PATTERN = /^[2-9A-HJKMNP-TV-Z]{6}$/;

/**
 * What a player typed or pasted, as a code: upper case, without spaces, dashes or dots, and
 * with an invite link reduced to the code at its end. The result may still be invalid.
 */
export function normalizeMatchCode(raw: string): string {
  let text = String(raw).trim();
  const link = /\/join\/([^/?#\s]+)/i.exec(text);
  if (link?.[1]) text = link[1];
  return text.toUpperCase().replace(/[\s._-]+/g, '');
}

export function isMatchCode(code: string): boolean {
  return MATCH_CODE_PATTERN.test(code);
}

/** Why a typed code cannot be one, for the join screen: too short, too long, or a symbol codes never use. */
export function matchCodeIssue(normalized: string): 'short' | 'long' | 'symbol' | null {
  for (const ch of normalized) if (!MATCH_CODE_ALPHABET.includes(ch)) return 'symbol';
  if (normalized.length < MATCH_CODE_LENGTH) return 'short';
  if (normalized.length > MATCH_CODE_LENGTH) return 'long';
  return null;
}

/** `K7MQ2X` as `K7M-Q2X`, the way the lobby prints it. */
export function formatMatchCode(code: string): string {
  return code.length === MATCH_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/**
 * A fresh code from a source of uniform random integers in `[0, n)`. The server passes a
 * cryptographic one (`crypto.randomInt`); tests pass a seeded one.
 */
export function generateMatchCode(randomInt: (n: number) => number): string {
  let code = '';
  for (let i = 0; i < MATCH_CODE_LENGTH; i++)
    code += MATCH_CODE_ALPHABET[randomInt(MATCH_CODE_ALPHABET.length)]!;
  return code;
}

export const matchCodeSchema = z.string().regex(MATCH_CODE_PATTERN);

// --- Player identity ----------------------------------------------------------------------------

/**
 * Section 3.2: names are preset nicknames only. A player is shown to the other as one of these
 * and one of the emblems; nothing a player types ever reaches the other device.
 */
export const NICKNAMES = [
  'Sprocket',
  'Piston',
  'Gearbox',
  'Turbo',
  'Axle',
  'Rivet',
  'Spark',
  'Torque',
  'Clutch',
  'Nitro',
  'Drift',
  'Ratchet',
  'Wrench',
  'Throttle',
  'Camber',
  'Chrome',
  'Fender',
  'Muffler',
  'Dynamo',
  'Gasket',
  'Flywheel',
  'Spanner',
  'Crankshaft',
  'Carburetor',
] as const;

/** Emblem ids, drawn by the client with its own pixel glyphs. */
export const EMBLEM_COUNT = 8;

export const profileSchema = z
  .object({
    nickname: z
      .number()
      .int()
      .min(0)
      .max(NICKNAMES.length - 1),
    emblem: z
      .number()
      .int()
      .min(0)
      .max(EMBLEM_COUNT - 1),
  })
  .strict();
export type MatchProfile = z.infer<typeof profileSchema>;

/**
 * The car name and creation time are what a player typed and when; the other player is shown
 * the car itself, never those (Section 16: no free text between players).
 */
export const PUBLIC_RIVAL_CAR_NAME = 'Rival Car';
export const PUBLIC_RIVAL_CREATED_AT = '2026-01-01T00:00:00Z';

export function publicBlueprint(blueprint: VehicleBlueprint): VehicleBlueprint {
  return { ...blueprint, name: PUBLIC_RIVAL_CAR_NAME, createdAt: PUBLIC_RIVAL_CREATED_AT };
}

// --- HTTP: create and join -------------------------------------------------------------------------

/** `POST /api/v1/match`: open a lobby. The guest token travels in the Authorization header. */
export const createMatchRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    profile: profileSchema,
    /** The car the host has now. Validated; the room keeps it as the host's build until changed. */
    blueprint: blueprintSchema,
  })
  .strict();
export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;

/** `POST /api/v1/match/join`: take the second seat of the lobby a code names. */
export const joinMatchRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    /** Normalized by the server as well; a malformed code is refused like an unknown one. */
    code: z.string().min(1).max(64),
    profile: profileSchema,
    blueprint: blueprintSchema,
  })
  .strict();
export type JoinMatchRequest = z.infer<typeof joinMatchRequestSchema>;

/** What colyseus.js needs to open the socket for a seat the server reserved. */
export type MatchSeatReservation = {
  room: { roomId: string; processId: string; name: string };
  sessionId: string;
};

export type MatchJoinResponse = {
  reservation: MatchSeatReservation;
  code: string;
};

/**
 * What the matchmaker hands the room for an admitted player. Built by the HTTP route after it
 * authenticated the guest and validated the build; never taken from a client.
 */
export const matchSeatOptionsSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    guestToken: z.string().min(16).max(512),
    intent: z.enum(['create', 'join']),
    code: matchCodeSchema.optional(),
    profile: profileSchema,
    blueprint: blueprintSchema,
  })
  .strict();
export type MatchSeatOptions = z.infer<typeof matchSeatOptionsSchema>;

// --- Room messages --------------------------------------------------------------------------------

export const MatchClientMessage = {
  /** Host: the track and weather, or a random pick when the build starts. */
  SELECT_TRACK: 'SELECT_TRACK',
  /** Host: lock the course and reveal it to both (`Start Build`). */
  LOCK_TRACK: 'LOCK_TRACK',
  /** "This phase's screen is up": the track preview was read, or the race scene has loaded. */
  ROOM_READY: 'ROOM_READY',
  /** The newest legal build while building. Sent on every legal change, debounced. */
  SUBMIT_BUILD: 'SUBMIT_BUILD',
  /** The committed build and Ready. */
  READY: 'READY',
  PLAYER_INPUT: 'PLAYER_INPUT',
  /** The page was hidden or the driver's menu wants neutral input (Section 5.10). */
  NEUTRAL: 'NEUTRAL',
  REMATCH_VOTE: 'REMATCH_VOTE',
  /** Pick a different preset nickname or emblem in the lobby. */
  PROFILE: 'PROFILE',
  /** After results with an empty seat: open the lobby again for a new rival. */
  REOPEN: 'REOPEN',
  PING: 'PING',
  LEAVE: 'LEAVE',
} as const;

export const MatchServerMessage = {
  /** Which seat this connection holds. Sent on join and on every reconnection. */
  WELCOME: 'WELCOME',
  MATCH_PHASE: 'MATCH_PHASE',
  BUILD_RESULT: 'BUILD_RESULT',
  /** The build the server locked for this player at the end of the build phase. */
  BUILD_LOCKED: 'BUILD_LOCKED',
  RACE_EVENT: 'RACE_EVENT',
  RESULTS: 'RESULTS',
  PONG: 'PONG',
  ERROR: 'ERROR',
} as const;

const idSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_]+$/);

export const selectTrackSchema = z.union([
  z.object({ trackId: idSchema, weatherPresetId: idSchema }).strict(),
  z.object({ random: z.literal(true) }).strict(),
]);
export type SelectTrackMessage = z.infer<typeof selectTrackSchema>;

export const submitBuildSchema = z
  .object({
    /** Echoed in `BUILD_RESULT` so the client can match an answer to a submission. */
    requestId: z.number().int().min(0).max(0x7fffffff),
    blueprint: blueprintSchema,
  })
  .strict();
export type SubmitBuildMessage = z.infer<typeof submitBuildSchema>;

export const REMATCH_CHOICES = ['race', 'swap', 'build', 'none'] as const;
export type RematchChoice = (typeof REMATCH_CHOICES)[number];
export const rematchVoteSchema = z.object({ choice: z.enum(REMATCH_CHOICES) }).strict();

export const pingSchema = z
  .object({
    /** The client's clock, echoed back in `PONG`. */
    t: z.number().finite().min(0).max(1e15),
    /** The client's last measured round trip, ms: shown as latency quality, decides nothing. */
    rtt: z.number().finite().min(0).max(60_000).optional(),
  })
  .strict();

export const matchInputMessageSchema = z
  .object({
    /** The race the samples belong to; samples for any other race are dropped. */
    race: z.number().int().min(0).max(0xffff),
    inputs: z.array(inputSampleSchema).min(1).max(MAX_INPUTS_PER_PACKET),
  })
  .strict();
export type MatchInputMessage = z.infer<typeof matchInputMessageSchema>;

export type WelcomeMessage = { seat: number; code: string };
export type MatchRoomPhaseMessage = { phase: MatchPhase; endsAt: number; serverNow: number };
export type BuildResultMessage =
  | { requestId: number; ok: true; buildHash: string; totalCost: number }
  | { requestId: number; ok: false; code: string; message: string };
/** `raceId`: the race this build was locked for. */
export type BuildLockedMessage = { blueprint: VehicleBlueprint; buildHash: string; raceId: number };
export type PongMessage = { t: number; now: number };

/** Why the room went back to the lobby or closed, for the player-facing notice. */
/**
 * How long a dropped player's seat is kept, by phase (Section 3.3, docs/MULTIPLAYER.md): the
 * initial connection timeout in the lobby, the build grace, the race autopilot, and the time
 * to come back to the results. The room uses these; the client counts them down.
 */
export const MATCH_GRACE_MS = Object.freeze({
  lobby: 90_000,
  build: 20_000,
  race: 15_000,
  results: 30_000,
});

/** The grace a seat dropped in `phase` gets. */
export function matchGraceMs(phase: MatchPhase | string): number {
  switch (phase) {
    case 'CREATED':
    case 'WAITING_FOR_OPPONENT':
    case 'TRACK_REVEAL':
      return MATCH_GRACE_MS.lobby;
    case 'BUILDING':
      return MATCH_GRACE_MS.build;
    case 'VS_REVEAL':
    case 'COUNTDOWN':
    case 'RACING':
      return MATCH_GRACE_MS.race;
    default:
      return MATCH_GRACE_MS.results;
  }
}

export const MATCH_NOTICES = [
  '',
  'rival_left',
  'rival_timed_out',
  'build_cancelled',
  'host_left',
  'expired',
] as const;
export type MatchNotice = (typeof MATCH_NOTICES)[number];

/** Seat a match room publishes about each player: what the other may know (Section 3.2). */
export type MatchSeatView = {
  present: boolean;
  connected: boolean;
  host: boolean;
  nickname: number;
  emblem: number;
  ready: boolean;
  loaded: boolean;
  vote: RematchChoice | '';
  /** The car this seat drives in the current race, or -1. */
  car: number;
  /** Round trip, ms, rounded to tens: the latency quality in the lobby. */
  latencyMs: number;
  /** Epoch ms when a dropped seat's grace ends, or 0. */
  graceEndsAt: number;
};

/** Connection quality as the lobby and HUD show it. Thresholds from Section 15.4. */
export function latencyQuality(roundTripMs: number): 'good' | 'fair' | 'poor' | 'unknown' {
  if (!(roundTripMs > 0)) return 'unknown';
  if (roundTripMs <= 120) return 'good';
  if (roundTripMs <= 220) return 'fair';
  return 'poor';
}
