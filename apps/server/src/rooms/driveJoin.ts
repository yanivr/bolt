import { ServerError } from '@colyseus/core';
import {
  CATALOG,
  conditionsFor,
  environmentFor,
  getScenario,
  getTemplate,
  getTrack,
} from '@bolt/content';
import type {
  AiDifficulty,
  BlueprintIssue,
  BuildConditions,
  RaceEnvironment,
  ResolvedBuild,
  TrackDefinition,
  VehicleBlueprint,
  VehicleParams,
} from '@bolt/shared';
import {
  JOIN_ERROR_CODES,
  PROTOCOL_VERSION,
  deriveVehicleParams,
  driveJoinOptionsSchema,
  validateBlueprint,
} from '@bolt/shared';
import type { DriveJoinOptions, JoinErrorCode } from '@bolt/shared';

/**
 * Join validation for the test-drive room. Everything a car is made of is looked up from
 * server-side content by id; the client never supplies totals, coefficients or track data.
 */

/**
 * Colyseus reports join failures as a numeric code plus a message. These codes sit in the
 * application range, clear of the ones Colyseus reserves (4000 to 4010 and 4201 to 4217),
 * and echo the matching HTTP status so they are easy to recognize in logs.
 */
export { JOIN_ERROR_CODES };
export type { JoinErrorCode };

export const JOIN_ERROR_MESSAGES: Record<JoinErrorCode, string> = {
  BAD_REQUEST: 'The join request was not valid.',
  UNAUTHORIZED: 'Your guest session has expired. Reload the game to start a new one.',
  UNKNOWN_TRACK: 'That track is not available.',
  VERSION_MISMATCH: 'This version of the game is out of date. Refresh the page to update.',
  UNKNOWN_PART: 'That car uses a part this server does not recognize.',
  ILLEGAL_BUILD: "That car can't race as built. Open the garage to fix it.",
  CATALOG_MISMATCH: 'This build uses older part values. Review it before racing.',
  RATE_LIMITED: 'You are joining too quickly. Wait a moment and try again.',
  INTERNAL: 'Something went wrong on the server. Try again in a moment.',
  SERVER_FULL: 'All race servers are busy right now. Try again in a moment.',
};

export function joinError(code: JoinErrorCode, message = JOIN_ERROR_MESSAGES[code]): ServerError {
  return new ServerError(JOIN_ERROR_CODES[code], message);
}

/**
 * Colyseus forwards the message of whatever a join hook throws straight to the client. Join
 * refusals are written for players; anything else is an internal failure whose text must
 * stay on the server, so it is swapped for a generic refusal after the caller has logged it.
 */
export function asJoinError(error: unknown, onUnexpected: (error: unknown) => void): ServerError {
  if (error instanceof ServerError) return error;
  onUnexpected(error);
  return joinError('INTERNAL');
}

/**
 * Parses raw join options. The protocol version is checked on its own first so an outdated
 * client gets "please refresh" rather than a generic validation failure caused by whatever
 * else changed between versions.
 */
export function parseJoinOptions(options: unknown): DriveJoinOptions {
  if (typeof options !== 'object' || options === null) throw joinError('BAD_REQUEST');
  if ((options as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) {
    throw joinError('VERSION_MISMATCH');
  }
  const parsed = driveJoinOptionsSchema.safeParse(options);
  if (!parsed.success) throw joinError('BAD_REQUEST');
  return parsed.data;
}

export type DriveCourse = { track: TrackDefinition; env: RaceEnvironment };

export function resolveCourse(trackId: string, weatherPresetId: string): DriveCourse {
  const track = getTrack(trackId);
  if (!track) throw joinError('UNKNOWN_TRACK');
  // A preset must be one this track publishes, not merely one that exists somewhere.
  const env = track.weatherPresetIds.includes(weatherPresetId)
    ? environmentFor(weatherPresetId)
    : undefined;
  if (!env) throw joinError('BAD_REQUEST', 'That weather is not available on this track.');
  return { track, env };
}

export { getScenario, getTemplate };

export type ResolvedCar = {
  params: VehicleParams;
  /** The resolved build, for the race's combat state. */
  build: ResolvedBuild;
  /** The published conditions the coefficients were derived under. */
  conditions: BuildConditions;
  /** The canonical form of the accepted blueprint. */
  blueprint: VehicleBlueprint;
  buildHash: string;
  totalCost: number;
};

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Turns the first error into a refusal a player can act on. */
function buildRefusal(issues: BlueprintIssue[]): ServerError {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.some((i) => i.code === 'CATALOG_MISMATCH')) return joinError('CATALOG_MISMATCH');
  if (errors.some((i) => i.code === 'UNKNOWN_PART')) return joinError('UNKNOWN_PART');
  const first = errors[0];
  if (!first) return joinError('ILLEGAL_BUILD');
  return joinError(
    'ILLEGAL_BUILD',
    `That car can't race as built. ${sentence(first.hint ?? first.message)}`,
  );
}

/**
 * The server's own verdict on a blueprint. Every id is looked up in the server's catalog,
 * the build is validated in full, and mass, cost and every physical coefficient are derived
 * here for the published track and weather. Nothing the client computed is consulted.
 */
export function resolveCar(
  blueprint: VehicleBlueprint,
  trackId: string,
  weatherPresetId: string,
): ResolvedCar {
  const conditions = conditionsFor(trackId, weatherPresetId);
  if (!conditions) throw joinError('BAD_REQUEST');
  const check = validateBlueprint(blueprint, CATALOG);
  if (!check.ok) throw buildRefusal(check.issues);
  return {
    params: deriveVehicleParams(check.build, conditions),
    build: check.build,
    conditions,
    blueprint: check.blueprint,
    buildHash: check.buildHash,
    totalCost: check.totalCost,
  };
}

/**
 * What the room keeps about an admitted driver. It crosses Colyseus's seat reservation as
 * JSON, so it holds the blueprint only; derived physics values are rebuilt from content on
 * arrival.
 */
export type DriveAuth = {
  guestId: string;
  trackId: string;
  weatherPresetId: string;
  blueprint: VehicleBlueprint;
  /** How good the AI rival is. A player choice; Racer when not given. */
  difficulty?: AiDifficulty;
  /** Debug and test options: which shipped template to race, and the seed for its choices. */
  rivalTemplateId?: string;
  seed?: number;
  /** Debug and test option: a showcase scenario to host instead of a race. */
  scenarioId?: string;
};
