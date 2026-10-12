import {
  BASELINE_BLUEPRINT,
  conditionsFor,
  createScenarioRace,
  createSparringRace,
  defaultRaceSeed,
  environmentFor,
  getScenario,
  getTrack,
  resolveBuild,
} from '@bolt/content';
import type {
  BuildConditions,
  ControlInput,
  DriveSession,
  ResolvedBuild,
  ScenarioDefinition,
  TrackRuntime,
  VehicleBlueprint,
  VehicleParams,
} from '@bolt/shared';
import {
  PROTOCOL_VERSION,
  blueprintSchema,
  buildTrack,
  copyMotionState,
  createDriveSession,
  createScenarioScratch,
  scenarioControl,
} from '@bolt/shared';
import { ensureGuest, probeServer } from '../network/api.js';
import type { DriveLink } from '../network/link.js';
import { OfflineLink } from '../network/offlineLink.js';
import { JoinError, OnlineLink } from '../network/onlineLink.js';

/** The other car on the grid, as far as the client needs it: to draw it and to bump into it. */
export type RivalSetup = {
  blueprint: VehicleBlueprint;
  /** Body shape and mass, for predicting contact. */
  params: VehicleParams;
};

export type DriveSetup = {
  link: DriveLink;
  /** The locally predicted session. The link owns the authoritative one. */
  session: DriveSession;
  track: TrackRuntime;
  /** The canonical blueprint being raced. */
  blueprint: VehicleBlueprint;
  buildHash: string;
  /** The local car's resolved build and the conditions it races under, for the predictor. */
  build: ResolvedBuild;
  conditions: BuildConditions;
  rival: RivalSetup | null;
  /**
   * Set when a showcase scenario is playing: the local car's controls come from its script,
   * computed against the predicted session so prediction stays exact.
   */
  script: ((session: DriveSession) => ControlInput) | null;
  scenario: ScenarioDefinition | null;
};

export type DriveSetupError = 'version' | 'server' | 'content';

/** Debug and test options (ignored in production unless `?debug=1`). */
export type DriveOptions = {
  /** Shipped template id of the rival to race. */
  rivalTemplateId?: string;
  seed?: number;
  /** Showcase scenario id. Runs in the page; the server is not involved. */
  scenarioId?: string;
};

const trackCache = new Map<string, TrackRuntime>();

function runtimeFor(trackId: string): TrackRuntime | null {
  const cached = trackCache.get(trackId);
  if (cached) return cached;
  const def = getTrack(trackId);
  if (!def) return null;
  const runtime = buildTrack(def);
  trackCache.set(trackId, runtime);
  return runtime;
}

const FORCE_OFFLINE = import.meta.env.VITE_FORCE_OFFLINE === '1';
/** The offline test drive is a Milestone A development aid; production builds can turn it off. */
const ALLOW_OFFLINE = import.meta.env.VITE_ALLOW_OFFLINE !== '0';

function rivalFromJson(json: string, conditions: BuildConditions): RivalSetup | null {
  try {
    const parsed = blueprintSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const resolved = resolveBuild(parsed.data, conditions);
    return resolved.ok ? { blueprint: resolved.build.blueprint, params: resolved.params } : null;
  } catch {
    return null;
  }
}

/** Starts a showcase scenario in the page, with both cars on their scripts. */
function startScenario(def: ScenarioDefinition): DriveSetup | { error: DriveSetupError } {
  const track = runtimeFor(def.trackId);
  const env = environmentFor(def.weatherPresetId);
  const conditions = conditionsFor(def.trackId, def.weatherPresetId);
  if (!track || !env || !conditions) return { error: 'content' };
  const scenario = createScenarioRace(def, track);
  const own = def.cars[0];
  const entry = scenario?.entries[0];
  if (!scenario || !own || !entry) return { error: 'content' };
  const authority = scenario.race.cars[0]!.session;
  const session = createDriveSession(track, env, entry.params, 0);
  copyMotionState(authority.motion, session.motion);
  session.countdownTicks = authority.countdownTicks;
  const other = scenario.entries[1];
  const scratch = createScenarioScratch(own);
  const control: ControlInput = { steer: 0, brake: 0, coast: false, fire: 0, use: 0, target: 0 };
  return {
    link: new OfflineLink(scenario.race, scenario.brains, def),
    session,
    track,
    blueprint: entry.build.blueprint,
    buildHash: entry.buildHash,
    build: entry.build,
    conditions,
    rival: other ? { blueprint: other.build.blueprint, params: other.params } : null,
    script: (predicted) => scenarioControl(own, track, predicted, scratch, control),
    scenario: def,
  };
}

/**
 * Connects a race against the sparring rival. The authoritative server is always preferred.
 * If it cannot be reached and offline driving is allowed, the same shared race runs in the
 * page, with the same rival from the same seed, and the HUD says so; it is never presented as
 * a real race.
 *
 * The blueprint is validated here with the same rules the server applies, and the predicted
 * car is derived from it for the same published conditions, so prediction and authority
 * start from identical coefficients. The server still derives its own.
 */
export async function startDrive(
  trackId: string,
  weatherPresetId: string,
  blueprint: VehicleBlueprint = BASELINE_BLUEPRINT,
  options: DriveOptions = {},
): Promise<DriveSetup | { error: DriveSetupError }> {
  if (options.scenarioId !== undefined) {
    const def = getScenario(options.scenarioId);
    return def ? startScenario(def) : { error: 'content' };
  }

  const track = runtimeFor(trackId);
  const env = environmentFor(weatherPresetId);
  const conditions = conditionsFor(trackId, weatherPresetId);
  if (!track || !env || !conditions) return { error: 'content' };
  // As the server does (resolveCourse): a preset must be one of this track's two.
  if (!track.def.weatherPresetIds.includes(weatherPresetId)) return { error: 'content' };
  const resolved = resolveBuild(blueprint, conditions);
  if (!resolved.ok) return { error: 'content' };
  const raced = resolved.build.blueprint;
  const setup = (link: DriveLink, rival: RivalSetup | null): DriveSetup => ({
    link,
    session: createDriveSession(track, env, resolved.params, 0),
    track,
    blueprint: raced,
    buildHash: resolved.buildHash,
    build: resolved.build,
    conditions,
    rival,
    script: null,
    scenario: null,
  });

  if (!FORCE_OFFLINE) {
    const probe = await probeServer();
    if (probe.reachable) {
      if (!probe.versionOk) return { error: 'version' };
      try {
        const guest = await ensureGuest();
        const link = await OnlineLink.join({
          protocolVersion: PROTOCOL_VERSION,
          guestToken: guest.token,
          trackId,
          weatherPresetId,
          blueprint: raced,
          ...(options.rivalTemplateId !== undefined
            ? { rivalTemplateId: options.rivalTemplateId }
            : {}),
          ...(options.seed !== undefined ? { seed: options.seed } : {}),
        });
        return setup(link, rivalFromJson(link.rivalBlueprint, conditions));
      } catch (error) {
        if (error instanceof JoinError && error.reason === 'version') return { error: 'version' };
        // A server that refuses the build itself must never be answered with an offline
        // drive of the same build: that would present a car the authority rejected.
        if (error instanceof JoinError && error.reason === 'build') return { error: 'content' };
        if (!ALLOW_OFFLINE) return { error: 'server' };
      }
    } else if (!ALLOW_OFFLINE) {
      return { error: 'server' };
    }
  }

  const seed = options.seed ?? defaultRaceSeed(resolved.buildHash, trackId);
  const sparring = createSparringRace(
    track,
    env,
    conditions,
    { build: resolved.build, params: resolved.params, buildHash: resolved.buildHash },
    seed,
    options.rivalTemplateId,
  );
  if (!sparring) return { error: 'content' };
  const rivalEntry = sparring.race.cars[1];
  return setup(
    new OfflineLink(sparring.race, sparring.brains),
    rivalEntry ? { blueprint: rivalEntry.build.blueprint, params: rivalEntry.baseParams } : null,
  );
}
